from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func
from app.models.transaction import Transaction, TrainingData, Account, Card
from app.models.schemas import TransactionCreate, TransactionResponse
from app.services.account_service import AccountNotFoundError
from app.services.currency_service import CurrencyService, HUF
from app.services.ml_service import predictor, _merchant_key
from app.services.normalization import detect_transfers, detect_curve_duplicates, _dates_within
from datetime import datetime
import json


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

        # Some bank exports (e.g. Curve) already tag a category. Treat it as
        # a trusted default prediction (full confidence, overriding the ML
        # guess) rather than an ML guess - but still leave category_final
        # unset so it goes through the normal review queue like everything
        # else, and feed it back as training data so the model learns from it.
        category_hint = transaction_data.get("category_hint")
        predicted_category = category_hint or category
        predicted_confidence = 1.0 if category_hint else confidence

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
            raw_source=transaction_data.get("raw_source"),
            hash_fingerprint=transaction_data["hash_fingerprint"],
            category_predicted=predicted_category,
            category_confidence=predicted_confidence,
            card_hint=transaction_data.get("card_hint"),
        )

        db.add(db_transaction)
        db.commit()
        db.refresh(db_transaction)

        # "other" is the deliberate catch-all and has no SEED_DATA examples of
        # its own, so it never disagrees with anything except by definition -
        # every "other"-hinted row (MBH/KH bank fees, Curve's "general"/
        # "finance"/etc) would otherwise become a training example. Bank-fee
        # rows in particular vastly outnumber the handful of English seed
        # phrases for every real category, so retraining on them skewed the
        # whole classifier toward predicting "other" for everything,
        # including completely unrelated descriptions (e.g. "Lidl").
        if category_hint and category_hint != category and category_hint != "other":
            db.add(TrainingData(
                transaction_id=db_transaction.id,
                description=db_transaction.description,
                amount=db_transaction.amount,
                transaction_date=db_transaction.date,
                merchant_key=_merchant_key(db_transaction.description),
                original_label=category,
                corrected_label=category_hint,
            ))
            db.commit()

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
        results = query.order_by(order).limit(limit).offset(offset).all()
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
    def get_analytics_summary(
        db: Session, account_id: str = None, date_from: str = None, date_to: str = None
    ):
        """Get analytics summary"""
        query = db.query(Transaction).filter(Transaction.is_transfer == False, Transaction.is_duplicate == False)
        query = TransactionService._apply_filters(query, account_id, date_from, date_to)

        transactions = query.all()
        
        total = len(transactions)
        income = sum(t.amount for t in transactions if t.amount > 0)
        expenses = sum(abs(t.amount) for t in transactions if t.amount < 0)
        average = sum(t.amount for t in transactions) / total if total > 0 else 0
        
        categories = set()
        for t in transactions:
            if t.category_final:
                categories.add(t.category_final)
            elif t.category_predicted:
                categories.add(t.category_predicted)
        
        return {
            "total_transactions": total,
            "total_income": income,
            "total_expenses": expenses,
            "average_transaction": average,
            "categories_used": list(categories),
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
        query = db.query(Transaction).filter(
            Transaction.is_transfer == True,
            Transaction.account_id.in_(account_ids),
            Transaction.amount < 0,
        )
        query = TransactionService._apply_filters(query, None, date_from, date_to)
        outgoing = query.all()

        total = 0.0
        for t in outgoing:
            match = db.query(Transaction).filter(Transaction.id == t.transfer_match_id).first()
            if match and match.account_id in account_ids:
                total += abs(t.amount)
        return total


    @staticmethod
    def get_category_breakdown(
        db: Session,
        account_id: str = None,
        date_from: str = None,
        date_to: str = None,
        group_by: str = "category",
    ):
        """Get breakdown by category, merchant, or account"""
        query = db.query(Transaction).filter(Transaction.is_transfer == False, Transaction.is_duplicate == False)
        query = TransactionService._apply_filters(query, account_id, date_from, date_to)

        transactions = query.all()
        breakdown = {}

        for t in transactions:
            if group_by == "merchant":
                key = t.merchant or "Unknown"
            elif group_by == "account":
                key = t.account.name if t.account else "Unknown"
            else:
                key = t.category_final or t.category_predicted or "uncategorized"

            if key not in breakdown:
                breakdown[key] = {"count": 0, "total": 0}
            breakdown[key]["count"] += 1
            breakdown[key]["total"] += t.amount

        return breakdown

    @staticmethod
    def get_monthly_trends(
        db: Session, account_id: str = None, date_from: str = None, date_to: str = None
    ):
        """Get monthly income/expense trends"""
        query = db.query(Transaction).filter(Transaction.is_transfer == False, Transaction.is_duplicate == False)
        query = TransactionService._apply_filters(query, account_id, date_from, date_to)

        transactions = query.all()
        trends = {}
        
        for t in transactions:
            month = t.date[:7]  # YYYY-MM
            if month not in trends:
                trends[month] = {"income": 0, "expenses": 0}
            
            if t.amount > 0:
                trends[month]["income"] += t.amount
            else:
                trends[month]["expenses"] += abs(t.amount)
        
        return dict(sorted(trends.items()))
