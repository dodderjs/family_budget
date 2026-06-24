# Database models
from sqlalchemy import Column, String, DateTime, Float, Boolean, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from app.db.database import Base

class Account(Base):
    __tablename__ = "accounts"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    account_number = Column(String(100), nullable=False, unique=True)
    type = Column(String(50), nullable=True)  # Credit, Debit, Saving, Prepaid, Curve, etc.
    created_at = Column(DateTime, default=datetime.utcnow)

    # foreign_keys is required here since transactions now has two FKs to
    # accounts (account_id and transfer_account_id) - without it SQLAlchemy
    # can't tell which one this relationship should join on.
    transactions = relationship(
        "Transaction", back_populates="account", foreign_keys="Transaction.account_id"
    )
    cards = relationship("Card", back_populates="account")

class Card(Base):
    """A card number registered to an account. Multiple rows per account are
    kept on purpose - a replaced/expired card stays on file so historical
    transactions referencing it (e.g. via Curve's per-row card hint) still
    resolve to the right account."""
    __tablename__ = "cards"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=False)
    card_number = Column(String(100), nullable=False)  # full, masked, or last-4
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (UniqueConstraint("account_id", "card_number", name="uq_card_account_number"),)

    account = relationship("Account", back_populates="cards")

class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=False)
    date = Column(String(10), nullable=False)  # ISO format YYYY-MM-DD
    # The canonical, HUF-equivalent amount - everything downstream (ML
    # categorization, transfer/curve-duplicate detection, analytics) reads
    # this and assumes HUF. For a non-HUF row, original_amount/exchange_rate
    # below preserve what was actually reported (see currency_service.py).
    amount = Column(Float, nullable=False)
    currency = Column(String(3), default="HUF")
    # Pre-conversion amount in `currency`'s units, and the HUF-per-unit rate
    # used to produce `amount` from it - both set together, only when
    # currency != HUF and a historical rate was found. Null currency != HUF
    # rows are foreign-currency transactions that couldn't be converted
    # (unknown/non-ISO currency code, or the rate lookup failed) - `amount`
    # is left as the raw, unconverted figure for those instead of blocking
    # the import.
    original_amount = Column(Float, nullable=True)
    exchange_rate = Column(Float, nullable=True)
    description = Column(String(500), nullable=False)
    merchant = Column(String(255), nullable=True)
    raw_source = Column(Text, nullable=True)
    hash_fingerprint = Column(String(64), unique=True, nullable=False)
    category_predicted = Column(String(50), nullable=True)
    category_confidence = Column(Float, nullable=True)
    category_final = Column(String(50), nullable=True)
    is_transfer = Column(Boolean, default=False)
    transfer_match_id = Column(String(36), nullable=True)
    # Set instead of transfer_match_id when set_transfer_pair finds no real
    # counterpart transaction to link (e.g. a card top-up funded from
    # outside the tracked accounts) - records which account the user says
    # this is a transfer to/from without claiming a specific other
    # transaction exists. Mutually exclusive with transfer_match_id in
    # practice, but not DB-enforced since the cost of that isn't worth it.
    transfer_account_id = Column(String(36), ForeignKey("accounts.id"), nullable=True)
    # Per-row card/account identifier from the bank format's accountNumberField
    # (e.g. Curve's "Card Last 4 Digits", or MBH/KH's full account number) -
    # used to cross-reference against other accounts' registered Cards. Not
    # the same as account_id/account_number. Sized to match Card.card_number
    # since some formats put a full account number here, not just a card.
    card_hint = Column(String(100), nullable=True)
    # True if this row is a re-statement of a purchase already counted via a
    # different account's transaction (see duplicate_of_id) - excluded from
    # analytics totals so it isn't double-counted. Mirrors is_transfer/transfer_match_id.
    is_duplicate = Column(Boolean, default=False)
    duplicate_of_id = Column(String(36), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    account = relationship("Account", back_populates="transactions", foreign_keys=[account_id])

class AccountCoverageFlag(Base):
    """User-confirmed status for a month that has zero transactions in an
    account's date range. Gaps themselves are computed live from Transaction
    dates (see coverage_service.py) - this table only stores the user's
    explicit call on a detected gap ("missing" = needs upload, "dismissed" =
    real quiet month). No row means "gap, unreviewed"."""
    __tablename__ = "account_coverage_flags"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=False)
    month = Column(String(7), nullable=False)  # "YYYY-MM"
    status = Column(String(20), nullable=False)  # "missing" | "dismissed"
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (UniqueConstraint("account_id", "month", name="uq_coverage_flag_account_month"),)

class Category(Base):
    """Two-level category hierarchy: a main (group) category has parent_id
    None; a leaf category's parent_id points at a main. Only leaves are ever
    assigned to a transaction (category_predicted/category_final) - mains
    exist purely for grouping/picker UX. key is the ascii snake_case
    identifier used everywhere in code (ML training labels, category_hint
    mapping, transfer-requirement checks); label is what the user actually
    typed when creating it."""
    __tablename__ = "categories"

    # key is unique only *within* its own level (enforced in CategoryService,
    # not via a DB constraint) - a main and a leaf are allowed to share a key
    # (e.g. main "groceries" + leaf "groceries") since mains are never looked
    # up by key anywhere; only leaf keys are ever assigned to a transaction.
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    key = Column(String(100), nullable=False)
    label = Column(String(100), nullable=False)
    parent_id = Column(String(36), ForeignKey("categories.id"), nullable=True)
    # Leaves only - mirrors the old hardcoded CATEGORY_SIGN: which amount
    # direction this category is valid for. None means unconstrained.
    sign = Column(String(10), nullable=True)
    # Leaves only - True iff this leaf's parent main is "Transfers". Derived
    # automatically at creation time (see CategoryService.create_leaf_category),
    # not user-set, so it can't go stale if the main is later renamed.
    requires_transfer_account = Column(Boolean, default=False)
    # Leaves only - the integer label a model is trained on. Assigned once,
    # permanently, when the leaf is created (never reused even if a leaf is
    # later deleted) since it's baked into the persisted model.pkl - see
    # ml_service.py's module docstring for why this can never be reordered.
    ml_index = Column(Integer, unique=True, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

class TrainingData(Base):
    __tablename__ = "training_data"

    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    # Nullable, not a hard dependency: retrain() reads `description` below
    # directly rather than joining through the transaction, so a correction
    # survives (and keeps training the model) even after the transaction
    # it was made on is deleted - e.g. by reset_data.py's transactions-only
    # reset, which clears transactions for a re-import without discarding
    # months of learned corrections.
    transaction_id = Column(String(36), ForeignKey("transactions.id"), nullable=True)
    description = Column(String(500), nullable=True)
    # Denormalized alongside description - retrain() feeds this into the
    # model's amount-magnitude feature (see ml_service.py) without needing
    # the original transaction to still exist.
    amount = Column(Float, nullable=True)
    # Denormalized ISO date (YYYY-MM-DD) of the corrected transaction. Feeds
    # the model's day-of-month/day-of-week features in retrain() - kept here,
    # like description/amount, so a correction survives its transaction's
    # deletion and still trains the temporal signal.
    transaction_date = Column(String(10), nullable=True)
    # Normalized merchant key (see ml_service._merchant_key) for the per-user
    # merchant-memory lookup: predict() resolves this row's corrected_label
    # directly for any future transaction whose description normalizes to the
    # same key, before consulting the model. Indexed since predict() queries
    # by it on every prediction.
    merchant_key = Column(String(255), nullable=True, index=True)
    original_label = Column(String(50), nullable=False)
    corrected_label = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
