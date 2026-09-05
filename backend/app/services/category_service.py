import re
import unicodedata
from sqlalchemy import func
from sqlalchemy.orm import Session
from app.constants.category_hierarchy import SEED_HIERARCHY
from app.models.transaction import Category, Transaction

# Sentinel used by update_category to distinguish "field not provided" from
# "field explicitly set to None" for the is_income argument.
_UNSET = object()


class CategoryNotFoundError(Exception):
    """Raised when a parent_id doesn't match any existing category."""


class ParentMustBeMainCategoryError(Exception):
    """Raised when creating a leaf under another leaf - only one level of
    nesting is supported, so a leaf's parent must itself have no parent."""


class CategoryLevelChangeError(Exception):
    """Raised when an update would change a main category into a leaf or
    vice versa. The hierarchy level of an item is fixed at creation time."""


def slugify(label: str) -> str:
    """Ascii snake_case key from a user-typed label - e.g. 'Éves kártyadíj'
    -> 'eves_kartyadij'. NFKD decomposition splits accented letters into a
    base ascii letter + a combining mark (this also covers Hungarian's
    double-acute ő/ű), so a plain ascii encode/ignore drops the mark and
    keeps the base letter instead of dropping the whole character."""
    ascii_text = unicodedata.normalize("NFKD", label).encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^a-zA-Z0-9]+", "_", ascii_text).strip("_").lower()
    return slug or "category"


class CategoryService:
    @staticmethod
    def seed_defaults(db: Session) -> None:
        """Idempotent - only creates rows for keys that don't exist yet, so
        it's safe to call on every app startup and in every test's db_session
        fixture."""
        existing_keys = {c.key for c in db.query(Category).all()}
        mains_by_key = {}

        for main_key, main_label, leaf_key, leaf_label, sign, ml_index in SEED_HIERARCHY:
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
            is_income = True if sign == "positive" else (False if sign == "negative" else None)
            db.add(Category(
                key=leaf_key,
                label=leaf_label,
                parent_id=main.id,
                sign=sign,
                requires_transfer_account=(main_key == "transfers"),
                is_income=is_income,
                ml_index=ml_index,
            ))

        db.commit()

    @staticmethod
    def list_categories(db: Session) -> list[Category]:
        """Attaches a transient transaction_count to each leaf - how many
        transactions actually have category_final set to it. Deliberately
        only category_final, not category_predicted/is_transfer - this is
        "how many are actually stored/finalized as this category", not a
        prediction or analytics total."""
        categories = db.query(Category).all()
        counts = dict(
            db.query(Transaction.category_final, func.count(Transaction.id))
            .filter(Transaction.category_final.isnot(None))
            .group_by(Transaction.category_final)
            .all()
        )
        for c in categories:
            c.transaction_count = counts.get(c.key, 0)
        return categories

    @staticmethod
    def create_main_category(db: Session, label: str, is_income: bool | None = None) -> Category:
        existing = CategoryService._find_existing_by_label(db, label, parent_id=None)
        if existing:
            return existing

        key = CategoryService._unique_key(db, label, is_leaf=False)
        category = Category(key=key, label=label, parent_id=None, is_income=is_income)
        db.add(category)
        db.commit()
        db.refresh(category)
        return category

    @staticmethod
    def create_leaf_category(db: Session, label: str, parent_id: str, is_income: bool | None = None) -> Category:
        parent = db.query(Category).filter(Category.id == parent_id).first()
        if not parent:
            raise CategoryNotFoundError(parent_id)
        if parent.parent_id is not None:
            raise ParentMustBeMainCategoryError(parent_id)

        existing = CategoryService._find_existing_by_label(db, label, parent_id=parent.id)
        if existing:
            return existing

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
            is_income=is_income,
            ml_index=ml_index,
        )
        db.add(category)
        db.commit()
        db.refresh(category)
        return category

    @staticmethod
    def _find_existing_by_label(db: Session, label: str, parent_id: str | None) -> Category | None:
        """Case-insensitive, trimmed match scoped to the same level (and,
        for leaves, the same parent main) - lets re-typing an existing
        category's name reuse it instead of creating a same-looking
        duplicate with a disambiguated key (e.g. a second "Loan Principal"
        under Finance, distinct only in its hidden key)."""
        scope = Category.parent_id == parent_id if parent_id else Category.parent_id.is_(None)
        normalized = label.strip().lower()
        return db.query(Category).filter(scope, func.lower(Category.label) == normalized).first()

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

    @staticmethod
    def update_category(
        db: Session,
        category_id: str,
        *,
        label: str | None = None,
        is_income: bool | None | object = _UNSET,
        requires_transfer_account: bool | None = None,
        parent_id: str | None = None,
    ) -> Category:
        """Update a category's properties. Enforces level constraints:
        mains can never gain a parent; leaves can never lose their parent.
        When a leaf is moved to a new parent, requires_transfer_account is
        auto-synced from the new parent, then can be overridden explicitly."""
        category = db.query(Category).filter(Category.id == category_id).first()
        if not category:
            raise CategoryNotFoundError(category_id)

        is_main = category.parent_id is None
        is_leaf = category.parent_id is not None

        # Enforce level constraint: main trying to become a leaf
        if is_main and parent_id is not None:
            raise CategoryLevelChangeError(
                "Cannot move a main category under another category. "
                "Main categories are top-level and cannot have parents."
            )

        # Enforce level constraint: leaf trying to become a main
        if is_leaf and parent_id is not None:
            # Leaf is being moved to a different parent
            new_parent = db.query(Category).filter(Category.id == parent_id).first()
            if not new_parent:
                raise CategoryNotFoundError(parent_id)
            if new_parent.parent_id is not None:
                raise ParentMustBeMainCategoryError(parent_id)

            category.parent_id = parent_id
            # Auto-sync requires_transfer_account from new parent
            category.requires_transfer_account = (new_parent.key == "transfers")

        # Update label
        if label is not None:
            category.label = label.strip()

        # Update is_income (allow null by checking against _UNSET)
        if is_income is not _UNSET:
            category.is_income = is_income

        # Update requires_transfer_account (explicit override after parent sync)
        if requires_transfer_account is not None:
            category.requires_transfer_account = requires_transfer_account

        db.commit()
        db.refresh(category)
        return category
