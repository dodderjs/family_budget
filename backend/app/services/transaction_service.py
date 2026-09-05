from sqlalchemy.orm import Session, aliased
from sqlalchemy import and_, or_, case, func
from app.config import settings
from app.models.transaction import Transaction, TrainingData, Account, Card, Category
from app.models.schemas import TransactionCreate, TransactionResponse
from app.services.account_service import AccountNotFoundError
from app.services.currency_service import CurrencyService, HUF
from app.services.ml_service import predictor, _merchant_key
from app.services.normalization import detect_transfers, detect_curve_duplicates, _dates_within
from datetime import datetime
import json


# Shared SQL expressions for the analytics aggregates. Kept at module level so
# every endpoint groups by exactly the same definitions - the effective
# category of a row is its final one, falling back to the prediction (mirrors
# _transaction_category_key), and the month is a lexical slice of the ISO date
# (Transaction.date is stored as YYYY-MM-DD, so substr is index-friendly and
# behaves identically on MariaDB and the SQLite test DB).
_SQL_CATEGORY_OR_NULL = func.coalesce(Transaction.category_final, Transaction.category_predicted)
_SQL_CATEGORY_KEY = func.coalesce(_SQL_CATEGORY_OR_NULL, "uncategorized")
_SQL_MONTH = func.substr(Transaction.date, 1, 7)
_SQL_INCOME_SUM = func.sum(case((Transaction.amount > 0, Transaction.amount), else_=0.0))
# A zero amount lands in the expense bucket (it adds nothing either way) so the
# grouped totals match the row-by-row version this replaced.
_SQL_EXPENSE_SUM = func.sum(case((Transaction.amount < 0, -Transaction.amount), else_=0.0))
_SQL_SIGN_BUCKET = case((Transaction.amount > 0, "income"), else_="expenses")


class DuplicateTransactionError(Exception):
    """Raised when a transaction with the same hash_fingerprint already exists."""


class TransactionNotFoundError(Exception):
    """Raised when a transaction_id doesn't match any existing transaction."""


# Whitelist of columns the Review grid's column headers may sort by - maps
# the AG Grid colId (identical to the column's `field`) straight to the
# Transaction column, so the frontend can pass colId through unchanged.
# Never build the ORDER BY from an unvalidated client string directly.
_REVIEW_SORTABLE_COLUMNS = {
    "date": Transaction.date,
    "amount": Transaction.amount,
    "account_id": Transaction.account_id,
    "type": Transaction.type,
    "merchant": Transaction.merchant,
    "description": Transaction.description,
    "category_predicted": Transaction.category_predicted,
    "category_confidence": Transaction.category_confidence,
    "category_final": Transaction.category_final,
}

# Columns the Review grid may filter on, mapped from AG Grid colId (== the
# column's `field`) to the Transaction column. Same security stance as the sort
# whitelist: the client sends a filterModel keyed by colId and we only ever
# build conditions for keys in here, so an unknown/spoofed colId is ignored
# rather than reaching the query. account_id is intentionally absent - the
# account selection is owned by the app-level FilterBar (multi-select, applied
# in _apply_filters), so a per-column account filter here would be a confusing
# duplicate. The transfer-pairing column is a UI-only widget with no backing
# Transaction column, so it isn't filterable either.
_REVIEW_FILTERABLE_COLUMNS = {
    "date": Transaction.date,
    "amount": Transaction.amount,
    "type": Transaction.type,
    "description": Transaction.description,
    "merchant": Transaction.merchant,
    "category_predicted": Transaction.category_predicted,
    "category_confidence": Transaction.category_confidence,
    "category_final": Transaction.category_final,
}


def _text_condition(column, op: str, value):
    """One AG Grid text-filter condition -> SQLAlchemy. Matching is
    case-insensitive (ilike / lower()) to mirror AG Grid's own client-side
    text filter. `blank`/`notBlank` treat NULL and empty-string the same."""
    if op == "blank":
        return or_(column.is_(None), column == "")
    if op == "notBlank":
        return and_(column.isnot(None), column != "")
    if value is None:
        return None
    value = str(value)
    if op == "equals":
        return func.lower(column) == value.lower()
    if op == "notEqual":
        return or_(column.is_(None), func.lower(column) != value.lower())
    if op == "contains":
        return column.ilike(f"%{value}%")
    if op == "notContains":
        return or_(column.is_(None), column.notilike(f"%{value}%"))
    if op == "startsWith":
        return column.ilike(f"{value}%")
    if op == "endsWith":
        return column.ilike(f"%{value}")
    return None


def _number_condition(column, op: str, value, value_to):
    """One AG Grid number-filter condition -> SQLAlchemy."""
    if op == "blank":
        return column.is_(None)
    if op == "notBlank":
        return column.isnot(None)
    if op == "inRange":
        if value is None or value_to is None:
            return None
        low, high = sorted((value, value_to))
        return and_(column >= low, column <= high)
    if value is None:
        return None
    ops = {
        "equals": column == value,
        "notEqual": column != value,
        "greaterThan": column > value,
        "greaterThanOrEqual": column >= value,
        "lessThan": column < value,
        "lessThanOrEqual": column <= value,
    }
    return ops.get(op)


def _date_condition(column, op: str, date_from, date_to):
    """One AG Grid date-filter condition -> SQLAlchemy. Transaction.date is a
    String(10) ISO date, so AG Grid's 'YYYY-MM-DD HH:MM:SS' bounds are sliced
    to their date part and compared lexically (valid because the format is
    zero-padded and fixed-width)."""
    if op == "blank":
        return or_(column.is_(None), column == "")
    if op == "notBlank":
        return and_(column.isnot(None), column != "")
    lo = date_from[:10] if date_from else None
    hi = date_to[:10] if date_to else None
    if op == "inRange":
        if not lo or not hi:
            return None
        low, high = sorted((lo, hi))
        return and_(column >= low, column <= high)
    if not lo:
        return None
    ops = {
        "equals": column == lo,
        "notEqual": or_(column.is_(None), column != lo),
        "greaterThan": column > lo,
        "lessThan": column < lo,
    }
    return ops.get(op)


def _single_condition(column, model: dict):
    """Dispatch one AG Grid filter condition dict (no AND/OR wrapper) to the
    right builder by its filterType. Returns a SQLAlchemy expression or None
    (unknown type/op -> ignored, never an error)."""
    filter_type = model.get("filterType", "text")
    op = model.get("type")
    if not op:
        return None
    if filter_type == "number":
        return _number_condition(column, op, model.get("filter"), model.get("filterTo"))
    if filter_type == "date":
        return _date_condition(column, op, model.get("dateFrom"), model.get("dateTo"))
    return _text_condition(column, op, model.get("filter"))


def _build_filter_condition(column, model: dict):
    """Build a SQLAlchemy condition for one column's AG Grid filter model,
    handling both a single condition and the combined {operator, conditions:[]}
    shape (two conditions joined by AND/OR)."""
    if "operator" in model:
        conditions = [_single_condition(column, c) for c in model.get("conditions", [])]
        conditions = [c for c in conditions if c is not None]
        if not conditions:
            return None
        return and_(*conditions) if model["operator"] == "AND" else or_(*conditions)
    return _single_condition(column, model)


class TransactionService:
    @staticmethod
    def _transaction_category_key(transaction: Transaction) -> str:
        return transaction.category_final or transaction.category_predicted or "uncategorized"

    @staticmethod
    def _build_parent_category_lookup(db: Session) -> dict[str, str]:
        """Maps a leaf's key to its parent's key (not label) - the rolled-up
        value has to survive a round trip back through category_keys, which
        matches on keys (see _apply_analytics_filters), for a legend click on
        a parent-level chart to filter anything at all."""
        categories = db.query(Category).all()
        by_id = {category.id: category for category in categories}
        lookup: dict[str, str] = {}

        for category in categories:
            if not category.parent_id:
                continue
            parent = by_id.get(category.parent_id)
            lookup[category.key] = parent.key if parent else category.key

        return lookup

    @staticmethod
    def _apply_analytics_filters(query, category_keys: list[str] = None, merchant_names: list[str] = None):
        if category_keys:
            query = query.filter(
                or_(
                    Transaction.category_final.in_(category_keys),
                    and_(Transaction.category_final.is_(None), Transaction.category_predicted.in_(category_keys)),
                )
            )

        if merchant_names:
            includes_unknown = "Unknown" in merchant_names
            known_merchants = [merchant for merchant in merchant_names if merchant != "Unknown"]
            if includes_unknown and known_merchants:
                query = query.filter(or_(Transaction.merchant.in_(known_merchants), Transaction.merchant.is_(None)))
            elif includes_unknown:
                query = query.filter(Transaction.merchant.is_(None))
            else:
                query = query.filter(Transaction.merchant.in_(known_merchants))

        return query

    @staticmethod
    def _should_auto_retrain(finalized_count: int) -> bool:
        threshold = settings.ML_AUTO_RETRAIN_FINALIZED_THRESHOLD
        step = max(1, settings.ML_AUTO_RETRAIN_FINALIZED_STEP)
        return finalized_count >= threshold and (finalized_count - threshold) % step == 0

    @staticmethod
    def _build_retrain_samples(db: Session) -> list[tuple[str, str, float, str]]:
        training_data = db.query(TrainingData).all()
        data = []
        for td in training_data:
            description = td.description
            amount = td.amount
            date = td.transaction_date
            if not description and td.transaction_id:
                transaction = db.query(Transaction).filter(
                    Transaction.id == td.transaction_id
                ).first()
                description = transaction.description if transaction else None
                amount = transaction.amount if transaction else None
                date = transaction.date if transaction else None
            if description:
                data.append((description, td.corrected_label, amount, date))
        return data

    @staticmethod
    def _auto_retrain_and_repredict_if_needed(db: Session) -> None:
        finalized_count = db.query(func.count(Transaction.id)).filter(
            Transaction.category_final.isnot(None)
        ).scalar() or 0
        if not TransactionService._should_auto_retrain(finalized_count):
            return

        samples = TransactionService._build_retrain_samples(db)
        if not samples:
            return

        predictor.retrain(db, samples)

        candidates = db.query(Transaction).filter(
            Transaction.category_final.is_(None),
            Transaction.category_confidence < 1.0,
        ).all()
        if not candidates:
            return

        account_types = {a.id: a.type for a in db.query(Account).all()}
        for txn in candidates:
            category, confidence = predictor.predict(
                db, txn.description, txn.amount, account_types.get(txn.account_id), txn.date
            )
            txn.category_predicted = category
            txn.category_confidence = confidence

        db.commit()

    @staticmethod
    def create_transaction(db: Session, transaction_data: dict) -> Transaction:
        """Create a new transaction with ML prediction"""

        # Check for duplicate
        existing = db.query(Transaction).filter(
            Transaction.hash_fingerprint == transaction_data["hash_fingerprint"]
        ).first()

        if existing:
            raise DuplicateTransactionError(transaction_data["hash_fingerprint"])

        # Convert non-HUF rows to their HUF equivalent before anything else
        # touches `amount` - ML categorization, transfer detection, and
        # analytics all assume HUF magnitudes. The pre-conversion figure and
        # rate used are kept on the row (see Transaction model) for the few
        # currencies/dates where no rate could be found, `amount` is left as
        # the raw, unconverted figure instead of failing the import.
        amount = transaction_data["amount"]
        currency = transaction_data.get("currency", HUF)
        original_amount = None
        exchange_rate = None
        if currency != HUF:
            converted = CurrencyService.convert_to_huf(amount, currency, transaction_data["date"])
            if converted:
                amount, exchange_rate = converted
                original_amount = transaction_data["amount"]

        # Predict category (amount lets predict() rule out sign-inconsistent
        # categories, e.g. never "salary" for a negative/expense amount;
        # account_type additionally rules out income categories for a
        # positive amount on a credit account - that's a balance payback)
        category, confidence = predictor.predict(
            db, transaction_data["description"], amount,
            transaction_data.get("account_type"), transaction_data["date"]
        )

        # Some bank exports already carry a category-like hint. Use it only
        # when the model is uncertain enough.
        category_hint = transaction_data.get("category_hint")
        use_hint = bool(category_hint) and confidence < 0.90
        predicted_category = category_hint if use_hint else category
        predicted_confidence = confidence

        # Create transaction
        db_transaction = Transaction(
            account_id=transaction_data["account_id"],
            date=transaction_data["date"],
            amount=amount,
            currency=currency,
            original_amount=original_amount,
            exchange_rate=exchange_rate,
            description=transaction_data["description"],
            merchant=transaction_data.get("merchant"),
            type=transaction_data.get("type"),
            raw_source=transaction_data.get("raw_source"),
            hash_fingerprint=transaction_data["hash_fingerprint"],
            category_predicted=predicted_category,
            category_confidence=predicted_confidence,
            card_hint=transaction_data.get("card_hint"),
        )

        db.add(db_transaction)
        db.commit()
        db.refresh(db_transaction)

        return db_transaction
    
    @staticmethod
    def detect_and_flag_transfers(db: Session) -> int:
        """
        Find transfer pairs among not-yet-flagged transactions across all
        accounts and mark them is_transfer=True with a transfer_match_id.
        Returns the number of pairs flagged.
        """
        candidates = db.query(Transaction).filter(Transaction.is_transfer == False).all()
        candidate_dicts = [
            {"id": t.id, "account_id": t.account_id, "amount": t.amount, "date": t.date}
            for t in candidates
        ]
        pairs = detect_transfers(candidate_dicts)

        by_id = {t.id: t for t in candidates}
        for id1, id2 in pairs:
            t1, t2 = by_id[id1], by_id[id2]
            t1.is_transfer = True
            t1.transfer_match_id = t2.id
            t2.is_transfer = True
            t2.transfer_match_id = t1.id

        if pairs:
            db.commit()

        return len(pairs)

    @staticmethod
    def detect_and_flag_curve_duplicates(db: Session) -> int:
        """
        Find pairs of transactions that are the same real-world purchase
        reported twice (e.g. once via Curve, once via the underlying bank
        account it charged) and link them: the underlying-account leg stays
        counted (is_duplicate=False) and gets enriched with the other leg's
        merchant/category; the other leg is flagged is_duplicate=True so
        analytics doesn't double-count it. Returns the number of pairs flagged.
        """
        candidates = db.query(Transaction).filter(
            Transaction.is_transfer == False, Transaction.is_duplicate == False
        ).all()
        candidate_dicts = [
            {
                "id": t.id, "account_id": t.account_id, "amount": t.amount,
                "date": t.date, "card_hint": t.card_hint,
            }
            for t in candidates
        ]
        cards = [{"account_id": c.account_id, "card_number": c.card_number} for c in db.query(Card).all()]
        pairs = detect_curve_duplicates(candidate_dicts, cards)

        by_id = {t.id: t for t in candidates}
        for canonical_id, curve_id in pairs:
            canonical, curve = by_id[canonical_id], by_id[curve_id]

            curve.is_duplicate = True
            curve.duplicate_of_id = canonical.id
            canonical.duplicate_of_id = curve.id

            if canonical.category_final is None and curve.category_predicted:
                canonical.category_predicted = curve.category_predicted
                canonical.category_confidence = 1.0
            if not canonical.merchant and curve.merchant:
                canonical.merchant = curve.merchant

            if curve.category_final is None:
                curve.category_final = curve.category_predicted

        if pairs:
            db.commit()

        return len(pairs)

    @staticmethod
    def _split_account_ids(account_id: str = None) -> list:
        """account_id is a single id or a comma-separated list of ids (the
        analytics/review account filter supports multi-select)."""
        if not account_id:
            return []
        return [a for a in account_id.split(",") if a]

    @staticmethod
    def _apply_filters(query, account_id: str = None, date_from: str = None, date_to: str = None):
        """Shared account/date-range filtering. date_from/date_to are ISO
        YYYY-MM-DD strings - lexical comparison works since Transaction.date
        is stored in that format."""
        account_ids = TransactionService._split_account_ids(account_id)
        if account_ids:
            query = query.filter(Transaction.account_id.in_(account_ids))
        if date_from:
            query = query.filter(Transaction.date >= date_from)
        if date_to:
            query = query.filter(Transaction.date <= date_to)
        return query

    @staticmethod
    def _apply_column_filters(query, filter_model: dict = None):
        """Apply the Review grid's per-column AG Grid filterModel. Only colIds
        in _REVIEW_FILTERABLE_COLUMNS are honored; anything else (unknown or
        spoofed) is skipped. Each value is parameterized via SQLAlchemy
        expressions - the client string never reaches the SQL text."""
        if not filter_model:
            return query
        for col_id, model in filter_model.items():
            column = _REVIEW_FILTERABLE_COLUMNS.get(col_id)
            if column is None or not isinstance(model, dict):
                continue
            condition = _build_filter_condition(column, model)
            if condition is not None:
                query = query.filter(condition)
        return query

    @staticmethod
    def get_transactions(db: Session, account_id: str = None, limit: int = 100, offset: int = 0):
        """Get transactions with optional filtering"""
        query = db.query(Transaction)
        query = TransactionService._apply_filters(query, account_id)
        results = query.order_by(Transaction.date.desc()).limit(limit).offset(offset).all()
        return TransactionService._attach_transfer_pair_accounts(db, results)

    @staticmethod
    def get_transactions_for_review(
        db: Session,
        limit: int = 50,
        account_id: str = None,
        date_from: str = None,
        date_to: str = None,
        include_finalized: bool = False,
        offset: int = 0,
        sort_by: str = None,
        sort_dir: str = "asc",
        filter_model: dict = None,
    ):
        """Get one page of transactions for review, plus the total matching
        count so the frontend can drive its own pager. By default only ones
        without a final category; set include_finalized=True to also show
        already-confirmed ones, so the user can go back and correct a past
        decision. sort_by must be a column the grid actually shows (see
        _REVIEW_SORTABLE_COLUMNS) - falls back to the original
        lowest-confidence-first default when omitted or unrecognized.
        filter_model is the AG Grid per-column filterModel (see
        _apply_column_filters), applied on top of the app-level account/date
        filters before the page and the total count are computed."""
        query = db.query(Transaction)
        if not include_finalized:
            query = query.filter(Transaction.category_final == None)
        query = TransactionService._apply_filters(query, account_id, date_from, date_to)
        query = TransactionService._apply_column_filters(query, filter_model)
        total = query.count()
        sort_column = _REVIEW_SORTABLE_COLUMNS.get(sort_by, Transaction.category_confidence)
        order = sort_column.desc() if sort_dir == "desc" else sort_column.asc()
        # id is the tiebreaker: every sortable column has real ties (notably
        # category_confidence, the default), and without a unique second key
        # the DB is free to order tied rows differently per LIMIT/OFFSET
        # query - which makes rows repeat or vanish as the user pages.
        results = query.order_by(order, Transaction.id.asc()).limit(limit).offset(offset).all()
        return TransactionService._attach_transfer_pair_accounts(db, results), total
    
    @staticmethod
    def update_transaction_category(db: Session, transaction_id: str, category: str) -> Transaction:
        """Update transaction category and create training data"""
        transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
        
        if not transaction:
            raise ValueError(f"Transaction {transaction_id} not found")

        # A transfer-type category (e.g. "topup") can be finalized even
        # without a matched pairing yet - many real transfers (e.g. a card
        # top-up funded from outside the tracked accounts) never get a
        # counterpart transaction at all. The frontend still flags these
        # visually so the user knows is_transfer (and analytics exclusion)
        # won't kick in until/unless a pairing exists.

        was_unfinalized = transaction.category_final is None

        # Record training data
        if transaction.category_predicted != category:
            training = TrainingData(
                transaction_id=transaction_id,
                description=transaction.description,
                amount=transaction.amount,
                transaction_date=transaction.date,
                merchant_key=_merchant_key(transaction.description),
                original_label=transaction.category_predicted or "unknown",
                corrected_label=category
            )
            db.add(training)
        
        transaction.category_final = category
        transaction.updated_at = datetime.utcnow()

        db.commit()

        if was_unfinalized:
            try:
                TransactionService._auto_retrain_and_repredict_if_needed(db)
            except Exception:
                db.rollback()

        db.refresh(transaction)

        return transaction

    @staticmethod
    def set_transfer_pair(db: Session, transaction_id: str, account_id: str = None) -> Transaction:
        """Manually set (or clear) which account a transaction is paired
        with as a transfer. Tries to find a real matching counterpart
        transaction first (opposite sign, ~equal magnitude, within the day
        window) and links the two - this is what corrects
        detect_and_flag_transfers' greedy auto-matching when it picks the
        wrong same-amount candidate. If no such counterpart exists (e.g. a
        card top-up funded from outside the tracked accounts), falls back to
        a one-sided pairing on transfer_account_id - just records which
        account this is a transfer to/from, with no transaction to link on
        the other side. account_id=None clears either kind of pairing."""
        transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
        if not transaction:
            raise TransactionNotFoundError(transaction_id)

        # Unlink any existing matched pair first, regardless of whether
        # we're about to set a new one - covers re-pairing to a different
        # account too.
        if transaction.transfer_match_id:
            old_pair = db.query(Transaction).filter(Transaction.id == transaction.transfer_match_id).first()
            if old_pair and old_pair.transfer_match_id == transaction.id:
                old_pair.is_transfer = False
                old_pair.transfer_match_id = None
            transaction.transfer_match_id = None
        transaction.is_transfer = False
        transaction.transfer_account_id = None

        if account_id is None:
            db.commit()
            db.refresh(transaction)
            return TransactionService._attach_transfer_pair_accounts(db, [transaction])[0]

        account = db.query(Account).filter(Account.id == account_id).first()
        if not account:
            raise AccountNotFoundError(account_id)

        candidates = db.query(Transaction).filter(
            Transaction.account_id == account_id, Transaction.id != transaction.id
        ).all()

        best, best_day_diff = None, None
        for candidate in candidates:
            if candidate.amount * transaction.amount >= 0:
                continue  # must be opposite sign
            if abs(abs(candidate.amount) - abs(transaction.amount)) > 0.01:
                continue  # must be (near-)equal magnitude
            if not _dates_within(transaction.date, candidate.date, max_days=2):
                continue
            day_diff = abs((datetime.strptime(transaction.date, "%Y-%m-%d") -
                            datetime.strptime(candidate.date, "%Y-%m-%d")).days)
            if best is None or day_diff < best_day_diff:
                best, best_day_diff = candidate, day_diff

        transaction.is_transfer = True
        if best:
            transaction.transfer_match_id = best.id
            best.is_transfer = True
            best.transfer_match_id = transaction.id
        else:
            # One-sided: no matching transaction to link, but the user still
            # knows which account it involves.
            transaction.transfer_account_id = account.id

        db.commit()
        db.refresh(transaction)
        return TransactionService._attach_transfer_pair_accounts(db, [transaction])[0]

    @staticmethod
    def _attach_transfer_pair_accounts(db: Session, transactions: list) -> list:
        """Attach a transient transfer_match_account_id attribute - the
        account_id to show/edit in the Transfer column, sourced from either
        a matched counterpart transaction's account (transfer_match_id) or
        a one-sided pairing (transfer_account_id) - in one batched query
        instead of one per row."""
        match_ids = {t.transfer_match_id for t in transactions if t.transfer_match_id}
        account_by_id = {}
        if match_ids:
            account_by_id = dict(
                db.query(Transaction.id, Transaction.account_id).filter(Transaction.id.in_(match_ids)).all()
            )
        for t in transactions:
            if t.transfer_match_id:
                t.transfer_match_account_id = account_by_id.get(t.transfer_match_id)
            else:
                t.transfer_match_account_id = t.transfer_account_id
        return transactions

    @staticmethod
    def _analytics_query(
        db: Session,
        *columns,
        account_id: str = None,
        date_from: str = None,
        date_to: str = None,
        category_keys: list[str] = None,
        merchant_names: list[str] = None,
    ):
        """Column-only base query shared by every analytics aggregate.
        Transfers and Curve duplicates are excluded so a single real movement
        of money is never counted twice (see CLAUDE.md)."""
        query = db.query(*columns).filter(
            Transaction.is_transfer == False, Transaction.is_duplicate == False
        )
        query = TransactionService._apply_filters(query, account_id, date_from, date_to)
        return TransactionService._apply_analytics_filters(query, category_keys, merchant_names)

    @staticmethod
    def get_analytics_summary(
        db: Session,
        account_id: str = None,
        date_from: str = None,
        date_to: str = None,
        category_keys: list[str] = None,
        merchant_names: list[str] = None,
    ):
        """Get analytics summary"""
        filters = dict(
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            category_keys=category_keys,
            merchant_names=merchant_names,
        )

        total, income, expenses, net = TransactionService._analytics_query(
            db,
            func.count(Transaction.id),
            _SQL_INCOME_SUM,
            _SQL_EXPENSE_SUM,
            func.sum(Transaction.amount),
            **filters,
        ).one()

        total = total or 0
        # A row with neither a final nor a predicted category contributes no
        # entry here - "uncategorized" is a display fallback, not a category
        # the user has actually used.
        categories = [
            key
            for (key,) in TransactionService._analytics_query(db, _SQL_CATEGORY_OR_NULL, **filters)
            .filter(_SQL_CATEGORY_OR_NULL.isnot(None))
            .distinct()
            .all()
        ]

        return {
            "total_transactions": total,
            "total_income": float(income or 0.0),
            "total_expenses": float(expenses or 0.0),
            "average_transaction": (float(net or 0.0) / total) if total > 0 else 0,
            "categories_used": categories,
            "total_transferred": TransactionService._get_total_transferred(db, account_id, date_from, date_to),
        }

    @staticmethod
    def _get_total_transferred(
        db: Session, account_id: str = None, date_from: str = None, date_to: str = None
    ) -> float:
        """Sum of transfers where BOTH legs belong to the selected account
        set - i.e. money moved between the accounts being looked at, not just
        any transfer touching one of them. 0 unless 2+ accounts are selected."""
        account_ids = set(TransactionService._split_account_ids(account_id))
        if len(account_ids) < 2:
            return 0.0

        # Only the outgoing (negative) leg is summed, so each transfer pair
        # is counted once even though both legs are stored as separate rows.
        query = db.query(Transaction.amount, Transaction.transfer_match_id).filter(
            Transaction.is_transfer == True,
            Transaction.account_id.in_(account_ids),
            Transaction.amount < 0,
            Transaction.transfer_match_id.isnot(None),
        )
        query = TransactionService._apply_filters(query, None, date_from, date_to)
        outgoing = query.all()
        if not outgoing:
            return 0.0

        # One batched lookup for every counterpart leg rather than a query per
        # row - same pattern as _attach_transfer_pair_accounts.
        match_ids = {match_id for _, match_id in outgoing}
        matched_accounts = dict(
            db.query(Transaction.id, Transaction.account_id)
            .filter(Transaction.id.in_(match_ids))
            .all()
        )

        return sum(
            abs(amount)
            for amount, match_id in outgoing
            if matched_accounts.get(match_id) in account_ids
        )

    @staticmethod
    def get_category_breakdown(
        db: Session,
        account_id: str = None,
        date_from: str = None,
        date_to: str = None,
        group_by: str = "category",
        category_level: str = "leaf",
        category_keys: list[str] = None,
        merchant_names: list[str] = None,
    ):
        """Get breakdown by category, merchant, or account"""
        if group_by == "merchant":
            # A merchant that is NULL *or* empty reads as "Unknown".
            key_expr = case(
                (or_(Transaction.merchant.is_(None), Transaction.merchant == ""), "Unknown"),
                else_=Transaction.merchant,
            )
        elif group_by == "account":
            key_expr = func.coalesce(Account.name, "Unknown")
        else:
            key_expr = _SQL_CATEGORY_KEY

        query = TransactionService._analytics_query(
            db,
            key_expr,
            func.count(Transaction.id),
            func.sum(Transaction.amount),
            account_id=account_id,
            date_from=date_from,
            date_to=date_to,
            category_keys=category_keys,
            merchant_names=merchant_names,
        )
        if group_by == "account":
            # Outer join so a row whose account row is missing still shows up
            # under "Unknown" instead of dropping out of the breakdown.
            query = query.outerjoin(Account, Transaction.account_id == Account.id)

        rows = query.group_by(key_expr).all()

        # The parent rollup folds the already-grouped rows (a handful, not the
        # whole table) rather than joining Category in SQL - a main and a leaf
        # are allowed to share a key, so a key-based join isn't safe.
        parent_lookup = (
            TransactionService._build_parent_category_lookup(db)
            if group_by == "category" and category_level == "parent"
            else {}
        )

        breakdown = {}
        for key, count, total in rows:
            key = parent_lookup.get(key, key)
            entry = breakdown.setdefault(key, {"count": 0, "total": 0})
            entry["count"] += count
            entry["total"] += float(total or 0.0)

        return breakdown

    @staticmethod
    def get_monthly_trends(
        db: Session,
        account_id: str = None,
        date_from: str = None,
        date_to: str = None,
        category_keys: list[str] = None,
        merchant_names: list[str] = None,
    ):
        """Get monthly income/expense trends"""
        rows = (
            TransactionService._analytics_query(
                db,
                _SQL_MONTH,
                _SQL_INCOME_SUM,
                _SQL_EXPENSE_SUM,
                account_id=account_id,
                date_from=date_from,
                date_to=date_to,
                category_keys=category_keys,
                merchant_names=merchant_names,
            )
            .group_by(_SQL_MONTH)
            .order_by(_SQL_MONTH)
            .all()
        )

        return {
            month: {"income": float(income or 0.0), "expenses": float(expenses or 0.0)}
            for month, income, expenses in rows
        }

    @staticmethod
    def get_stacked_monthly_trends(
        db: Session,
        account_id: str = None,
        date_from: str = None,
        date_to: str = None,
        category_level: str = "leaf",
        category_keys: list[str] = None,
        merchant_names: list[str] = None,
    ):
        """Get monthly trends split by category and sign for stacked charts."""
        # Grouping by the sign bucket (rather than summing both signs per
        # category) keeps a category out of the "income" map entirely when it
        # only ever had expenses that month, instead of emitting a 0.0 series.
        rows = (
            TransactionService._analytics_query(
                db,
                _SQL_MONTH,
                _SQL_CATEGORY_KEY,
                _SQL_SIGN_BUCKET,
                func.sum(func.abs(Transaction.amount)),
                account_id=account_id,
                date_from=date_from,
                date_to=date_to,
                category_keys=category_keys,
                merchant_names=merchant_names,
            )
            .group_by(_SQL_MONTH, _SQL_CATEGORY_KEY, _SQL_SIGN_BUCKET)
            .order_by(_SQL_MONTH)
            .all()
        )

        parent_lookup = (
            TransactionService._build_parent_category_lookup(db) if category_level == "parent" else {}
        )

        trends: dict[str, dict[str, dict[str, float]]] = {}
        for month, raw_category, bucket, total in rows:
            category_key = parent_lookup.get(raw_category, raw_category)
            month_entry = trends.setdefault(month, {"income": {}, "expenses": {}})
            month_entry[bucket][category_key] = month_entry[bucket].get(category_key, 0.0) + float(total or 0.0)

        return trends

    @staticmethod
    def get_transfer_analytics(
        db: Session,
        account_id: str = None,
        date_from: str = None,
        date_to: str = None,
    ):
        """Money moved between the family's own accounts, per month and per
        route. Every other analytics aggregate deliberately excludes transfers
        (so one movement isn't counted as both income and expense) - this is
        the one place that reports on them.

        Only the outgoing leg of a matched pair is counted, so a transfer that
        exists as two rows is reported once, and its direction is unambiguous."""
        outgoing = db.query(Transaction).filter(
            Transaction.is_transfer == True,
            Transaction.amount < 0,
        )
        outgoing = TransactionService._apply_filters(outgoing, account_id, date_from, date_to)

        monthly_rows = (
            outgoing.with_entities(
                _SQL_MONTH,
                func.sum(func.abs(Transaction.amount)),
                func.count(Transaction.id),
            )
            .group_by(_SQL_MONTH)
            .order_by(_SQL_MONTH)
            .all()
        )
        monthly = {
            month: {"amount": float(amount or 0.0), "count": count}
            for month, amount, count in monthly_rows
        }

        # Matched pairs: join the counterpart row to learn the destination
        # account in SQL rather than one lookup per transfer.
        counterpart = aliased(Transaction)
        source_account = aliased(Account)
        target_account = aliased(Account)
        matched_q = (
            db.query(
                source_account.name,
                target_account.name,
                func.sum(func.abs(Transaction.amount)),
                func.count(Transaction.id),
            )
            .join(counterpart, Transaction.transfer_match_id == counterpart.id)
            .join(source_account, Transaction.account_id == source_account.id)
            .join(target_account, counterpart.account_id == target_account.id)
            .filter(Transaction.is_transfer == True, Transaction.amount < 0)
        )
        matched_q = TransactionService._apply_filters(matched_q, account_id, date_from, date_to)
        # Keyed by route so the two halves of a one-sided pair (the outgoing
        # row on one account and the incoming row on the other) collapse into
        # the single route they describe instead of being reported twice.
        by_route: dict[tuple, dict] = {}

        def _add_flow(from_account: str, to_account: str, amount: float, count: int, matched: bool) -> None:
            key = (from_account or "Unknown", to_account or "Unknown", matched)
            entry = by_route.setdefault(
                key,
                {"from_account": key[0], "to_account": key[1], "amount": 0.0, "count": 0, "matched": matched},
            )
            entry["amount"] += float(amount or 0.0)
            entry["count"] += count

        for src, dst, amount, count in matched_q.group_by(source_account.name, target_account.name).all():
            _add_flow(src, dst, amount, count, True)

        # One-sided transfers: the user named the other account but no
        # counterpart row exists (e.g. a top-up funded from outside the
        # tracked accounts). Direction follows the sign.
        declared_account = aliased(Account)
        own_account = aliased(Account)
        one_sided_q = (
            db.query(
                own_account.name,
                declared_account.name,
                Transaction.amount < 0,
                func.sum(func.abs(Transaction.amount)),
                func.count(Transaction.id),
            )
            .join(own_account, Transaction.account_id == own_account.id)
            .join(declared_account, Transaction.transfer_account_id == declared_account.id)
            .filter(
                Transaction.is_transfer == True,
                Transaction.transfer_match_id.is_(None),
                Transaction.transfer_account_id.isnot(None),
            )
        )
        one_sided_q = TransactionService._apply_filters(one_sided_q, account_id, date_from, date_to)
        for own, declared, is_outgoing, amount, count in one_sided_q.group_by(
            own_account.name, declared_account.name, Transaction.amount < 0
        ).all():
            _add_flow(
                own if is_outgoing else declared,
                declared if is_outgoing else own,
                amount,
                count,
                False,
            )

        flows = sorted(by_route.values(), key=lambda f: f["amount"], reverse=True)
        return {
            "monthly": monthly,
            "flows": flows,
            "total_amount": sum(entry["amount"] for entry in monthly.values()),
            "transfer_count": sum(entry["count"] for entry in monthly.values()),
        }

    @staticmethod
    def get_recurring_charges(
        db: Session,
        account_id: str = None,
        date_from: str = None,
        date_to: str = None,
        min_months: int = 3,
    ):
        """Merchants that look like a subscription or standing cost: charged
        in at least `min_months` distinct months, roughly once a month, and
        for a consistent amount.

        Consistency is measured as (max - min) / average rather than a real
        standard deviation because SQLite (used by the tests) has no stddev
        aggregate, and over a bounded window the two agree closely enough for
        ranking. Callers are expected to pass a trailing window - across many
        years a subscription's price rises and the spread stops being a useful
        signal. With no window given, a trailing 12 months ending at the most
        recent transaction is used - anchoring on the data rather than on today
        keeps the result meaningful when imports lag behind the calendar."""
        if not date_from and not date_to:
            latest = db.query(func.max(Transaction.date)).scalar()
            if not latest:
                return []
            date_to = latest
            year, month = int(latest[:4]), int(latest[5:7])
            date_from = f"{year - 1:04d}-{month:02d}-01"

        rows = (
            db.query(
                Transaction.merchant,
                func.count(func.distinct(_SQL_MONTH)),
                func.count(Transaction.id),
                func.sum(func.abs(Transaction.amount)),
                func.avg(func.abs(Transaction.amount)),
                func.min(func.abs(Transaction.amount)),
                func.max(func.abs(Transaction.amount)),
                func.max(Transaction.date),
            )
            .filter(
                Transaction.is_transfer == False,
                Transaction.is_duplicate == False,
                Transaction.amount < 0,
                Transaction.merchant.isnot(None),
                Transaction.merchant != "",
            )
        )
        rows = TransactionService._apply_filters(rows, account_id, date_from, date_to)
        rows = (
            rows.group_by(Transaction.merchant)
            .having(func.count(func.distinct(_SQL_MONTH)) >= min_months)
            .all()
        )

        charges = []
        for merchant, months, count, total, average, low, high, last_date in rows:
            months = months or 0
            average = float(average or 0.0)
            if months <= 0 or average <= 0:
                continue
            per_month = count / months
            spread = (float(high or 0.0) - float(low or 0.0)) / average
            # ~1 charge a month with a stable amount. Anything lumpier is
            # ordinary shopping at a favourite merchant, not a standing cost.
            if not (0.7 <= per_month <= 1.4) or spread > 0.35:
                continue
            charges.append({
                "merchant": merchant,
                "months_active": months,
                "charge_count": count,
                "total_amount": float(total or 0.0),
                "average_amount": average,
                "last_date": last_date,
                "amount_spread": round(spread, 4),
                "annualized_amount": average * 12,
            })

        charges.sort(key=lambda c: c["annualized_amount"], reverse=True)
        return charges
