import re
import unicodedata
from sqlalchemy.orm import Session
from app.models.transaction import Category


class CategoryNotFoundError(Exception):
    """Raised when a parent_id doesn't match any existing category."""


class ParentMustBeMainCategoryError(Exception):
    """Raised when creating a leaf under another leaf - only one level of
    nesting is supported, so a leaf's parent must itself have no parent."""


def slugify(label: str) -> str:
    """Ascii snake_case key from a user-typed label - e.g. 'Éves kártyadíj'
    -> 'eves_kartyadij'. NFKD decomposition splits accented letters into a
    base ascii letter + a combining mark (this also covers Hungarian's
    double-acute ő/ű), so a plain ascii encode/ignore drops the mark and
    keeps the base letter instead of dropping the whole character."""
    ascii_text = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_text).strip("_").lower()
    return slug or "category"


# (main_key, main_label, leaf_key, leaf_label, sign, ml_index) - ml_index 0-14
# are pinned to the exact position those categories held in the old static
# CATEGORIES list, so the already-trained model.pkl keeps meaning the same
# thing. Only 15+ are new. See the plan doc for the full rationale.
_SEED_HIERARCHY = [
    ("groceries", "Groceries", "groceries", "Groceries", "negative", 0),
    ("rent", "Rent", "rent", "Rent", "negative", 1),
    ("salary", "Salary", "salary", "Salary", "positive", 2),
    ("bills", "Bills", "bills", "Bills", "negative", 3),
    ("transport", "Transport", "transport", "Transport", "negative", 4),
    ("entertainment", "Entertainment", "entertainment", "Entertainment", "negative", 5),
    ("other", "Other", "other", "Other", None, 6),
    ("shopping", "Shopping", "shopping", "Shopping", "negative", 7),
    ("eating_out", "Eating Out", "eating_out", "Eating Out", "negative", 8),
    ("travel", "Travel", "travel", "Travel", "negative", 9),
    ("health", "Health", "health", "Health", "negative", 10),
    ("transfers", "Transfers", "topup", "Top-Up", None, 11),
    ("transfers", "Transfers", "credit_payback", "Credit Payback", None, 12),
    ("transfers", "Transfers", "saving", "Saving", None, 13),
    ("transfers", "Transfers", "transfer", "Transfer", None, 14),
    ("business_services", "Business Services", "business_services", "Business Services", "negative", 15),
    ("general", "General", "general", "General", None, 16),
    ("finance", "Finance", "general_finance", "General Finance", "negative", 17),
    ("finance", "Finance", "bank_fees", "Bank Fees", "negative", 18),
    ("finance", "Finance", "interest", "Interest", "positive", 19),
    ("finance", "Finance", "loan_interest", "Loan Interest", "negative", 20),
    ("finance", "Finance", "loan_principal", "Loan Principal", "negative", 21),
    ("finance", "Finance", "cash_withdrawal", "Cash Withdrawal", "negative", 22),
]


class CategoryService:
    @staticmethod
    def seed_defaults(db: Session) -> None:
        """Idempotent - only creates rows for keys that don't exist yet, so
        it's safe to call on every app startup and in every test's db_session
        fixture."""
        existing_keys = {c.key for c in db.query(Category).all()}
        mains_by_key = {}

        for main_key, main_label, leaf_key, leaf_label, sign, ml_index in _SEED_HIERARCHY:
            if main_key not in mains_by_key:
                main = db.query(Category).filter(
                    Category.key == main_key, Category.parent_id.is_(None)
                ).first()
                if not main:
                    main = Category(key=main_key, label=main_label, parent_id=None)
                    db.add(main)
                    db.flush()
                mains_by_key[main_key] = main

            if leaf_key in existing_keys:
                continue
            main = mains_by_key[main_key]
            db.add(Category(
                key=leaf_key,
                label=leaf_label,
                parent_id=main.id,
                sign=sign,
                requires_transfer_account=(main_key == "transfers"),
                ml_index=ml_index,
            ))

        db.commit()

    @staticmethod
    def list_categories(db: Session) -> list[Category]:
        return db.query(Category).all()

    @staticmethod
    def create_main_category(db: Session, label: str) -> Category:
        key = CategoryService._unique_key(db, label, is_leaf=False)
        category = Category(key=key, label=label, parent_id=None)
        db.add(category)
        db.commit()
        db.refresh(category)
        return category

    @staticmethod
    def create_leaf_category(db: Session, label: str, parent_id: str) -> Category:
        parent = db.query(Category).filter(Category.id == parent_id).first()
        if not parent:
            raise CategoryNotFoundError(parent_id)
        if parent.parent_id is not None:
            raise ParentMustBeMainCategoryError(parent_id)

        key = CategoryService._unique_key(db, label, is_leaf=True)
        next_index = (db.query(Category.ml_index)
                      .filter(Category.ml_index.isnot(None))
                      .order_by(Category.ml_index.desc())
                      .first())
        ml_index = (next_index[0] + 1) if next_index else 0

        category = Category(
            key=key,
            label=label,
            parent_id=parent.id,
            sign=None,
            requires_transfer_account=(parent.key == "transfers"),
            ml_index=ml_index,
        )
        db.add(category)
        db.commit()
        db.refresh(category)
        return category

    @staticmethod
    def _unique_key(db: Session, label: str, is_leaf: bool) -> str:
        """Keys only need to be unique within their own level - a main and a
        leaf may legitimately share one (see Category's docstring)."""
        scope = Category.parent_id.isnot(None) if is_leaf else Category.parent_id.is_(None)
        base = slugify(label)
        key = base
        suffix = 2
        while db.query(Category).filter(Category.key == key, scope).first():
            key = f"{base}_{suffix}"
            suffix += 1
        return key

    @staticmethod
    def get_sign(db: Session, key: str) -> str | None:
        category = db.query(Category).filter(Category.key == key, Category.parent_id.isnot(None)).first()
        return category.sign if category else None

    @staticmethod
    def requires_transfer_account(db: Session, key: str) -> bool:
        category = db.query(Category).filter(Category.key == key, Category.parent_id.isnot(None)).first()
        return bool(category and category.requires_transfer_account)

    @staticmethod
    def get_ml_index_map(db: Session) -> dict[str, int]:
        rows = db.query(Category.key, Category.ml_index).filter(Category.ml_index.isnot(None)).all()
        return dict(rows)
