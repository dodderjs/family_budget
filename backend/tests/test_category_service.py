import pytest

from app.models.transaction import Category
from app.services.category_service import (
    CategoryService, CategoryNotFoundError, ParentMustBeMainCategoryError, slugify,
)


def test_slugify_strips_accents_and_snake_cases():
    assert slugify("Éves kártyadíj") == "eves_kartyadij"


def test_slugify_handles_hungarian_double_acute_letters():
    # ő/ű (LATIN SMALL LETTER O/U WITH DOUBLE ACUTE) decompose under NFKD to
    # a base o/u + a combining mark distinct from the regular acute accent -
    # worth a dedicated case since it's the one Hungarian-specific wrinkle.
    assert slugify("Költség") == "koltseg"
    assert slugify("Tőketörlesztés") == "toketorlesztes"


def test_slugify_collapses_punctuation_and_spaces():
    assert slugify("Movies & TV!!") == "movies_tv"


def test_seed_defaults_creates_the_full_hierarchy(db_session):
    # conftest's db_session fixture already calls seed_defaults once -
    # confirms the expected shape came out of that.
    categories = CategoryService.list_categories(db_session)
    mains = [c for c in categories if c.parent_id is None]
    leaves = [c for c in categories if c.parent_id is not None]
    assert len(mains) == 15
    assert len(leaves) == 23


def test_seed_defaults_pins_the_original_fifteen_ml_indices(db_session):
    index_map = CategoryService.get_ml_index_map(db_session)
    original_order = [
        "groceries", "rent", "salary", "bills", "transport", "entertainment", "other",
        "shopping", "eating_out", "travel", "health", "topup", "credit_payback", "saving", "transfer",
    ]
    for expected_index, key in enumerate(original_order):
        assert index_map[key] == expected_index


def test_seed_defaults_is_idempotent(db_session):
    before = db_session.query(Category).count()
    CategoryService.seed_defaults(db_session)
    after = db_session.query(Category).count()
    assert before == after


def test_create_leaf_category_under_existing_main(db_session):
    entertainment = db_session.query(Category).filter(Category.key == "entertainment").first()
    leaf = CategoryService.create_leaf_category(db_session, "Movies", entertainment.id)

    assert leaf.key == "movies"
    assert leaf.parent_id == entertainment.id
    assert leaf.requires_transfer_account is False


def test_create_leaf_category_under_transfers_auto_sets_requires_transfer_account(db_session):
    transfers = db_session.query(Category).filter(Category.key == "transfers").first()
    leaf = CategoryService.create_leaf_category(db_session, "Loan Disbursement", transfers.id)

    assert leaf.requires_transfer_account is True


def test_create_leaf_category_assigns_the_next_ml_index(db_session):
    current_max = max(CategoryService.get_ml_index_map(db_session).values())
    entertainment = db_session.query(Category).filter(Category.key == "entertainment").first()
    leaf = CategoryService.create_leaf_category(db_session, "Movies", entertainment.id)

    assert leaf.ml_index == current_max + 1


def test_create_leaf_category_rejects_leaf_as_parent(db_session):
    groceries_leaf = db_session.query(Category).filter(
        Category.key == "groceries", Category.parent_id.isnot(None)
    ).first()
    with pytest.raises(ParentMustBeMainCategoryError):
        CategoryService.create_leaf_category(db_session, "Organic Groceries", groceries_leaf.id)


def test_create_leaf_category_raises_for_unknown_parent(db_session):
    with pytest.raises(CategoryNotFoundError):
        CategoryService.create_leaf_category(db_session, "Movies", "does-not-exist")


def test_create_main_category(db_session):
    main = CategoryService.create_main_category(db_session, "Pets")
    assert main.key == "pets"
    assert main.parent_id is None


def test_duplicate_label_gets_a_disambiguated_key(db_session):
    entertainment = db_session.query(Category).filter(Category.key == "entertainment").first()
    first = CategoryService.create_leaf_category(db_session, "Movies", entertainment.id)
    second = CategoryService.create_leaf_category(db_session, "Movies", entertainment.id)

    assert first.key == "movies"
    assert second.key == "movies_2"


def test_get_sign_and_requires_transfer_account(db_session):
    assert CategoryService.get_sign(db_session, "salary") == "positive"
    assert CategoryService.get_sign(db_session, "groceries") == "negative"
    assert CategoryService.get_sign(db_session, "other") is None
    assert CategoryService.requires_transfer_account(db_session, "saving") is True
    assert CategoryService.requires_transfer_account(db_session, "groceries") is False
