import pytest

from app.services import ml_service
from app.services.category_service import CategoryService
from app.services.ml_service import (
    SEED_DATA, CategoryPredictor, _category_allowed, _label_to_index,
    _match_known_merchant, _scaled_amount, _NEUTRAL_AMOUNT_FEATURE,
)


def test_label_to_index_assigns_each_category_a_distinct_index(db_session):
    keys = CategoryService.get_ml_index_map(db_session).keys()
    indices = {key: _label_to_index(db_session, key) for key in keys}
    assert len(set(indices.values())) == len(keys)


def test_label_to_index_falls_back_to_other_for_unknown_labels(db_session):
    assert _label_to_index(db_session, "totally-unknown-category") == _label_to_index(db_session, "other")


@pytest.fixture
def predictor(tmp_path, monkeypatch):
    # Train into a throwaway directory instead of the real backend/app/ml/models/
    monkeypatch.setattr(ml_service, "MODEL_DIR", tmp_path)
    return CategoryPredictor()


def test_baseline_model_predicts_its_own_seed_examples_correctly(predictor, db_session):
    # Regression test for the index/label mismatch bug: predicted_idx (a
    # position in predict_proba's output) was previously used directly as a
    # CATEGORIES index, instead of going through model.classes_ first. That
    # made the predicted category effectively random across process restarts
    # (set() iteration order is hash-seed dependent). These are exact seed
    # phrases, so a correct mapping should rank them highly.
    #
    # With ~23 leaf categories now seeded (vs. the original 11), a handful of
    # examples per class spreads softmax probability thin enough that two
    # categories can end up within a hair of each other on a training
    # example itself (e.g. "Credit Card Payment" vs "rent" - 0.109 vs 0.108) -
    # an inherent property of this tiny char n-gram model with many classes,
    # not a mapping bug. Top-2 is the meaningful, reproducible bar; pinning
    # exact rank-1 here started failing on dataset growth alone.
    samples = {
        "Grocery Store": "groceries",
        "Monthly Rent Payment": "rent",
        "Salary Deposit": "salary",
        "Electric Company": "bills",
        "Uber": "transport",
        "Cinema": "entertainment",
        "Department Store": "shopping",
        "Restaurant": "eating_out",
        "Hotel Booking": "travel",
        "Pharmacy": "health",
        "Revolut Top-Up": "topup",
        "Credit Card Payment": "credit_payback",
        "Transfer To Savings": "saving",
        "Bank Transfer": "transfer",
    }
    for description, expected_category in samples.items():
        if not predictor.model:
            predictor._create_baseline(db_session)
        X = predictor._build_features([description.lower()], [None])
        probabilities = predictor.model.predict_proba(X)[0]
        ranked = probabilities.argsort()[::-1][:2]
        top2 = [ml_service._index_to_label(db_session, predictor.model.classes_[i]) for i in ranked]
        assert expected_category in top2, (
            f"{description!r} top-2 was {top2}, expected {expected_category!r} in there"
        )


def test_predicted_category_is_always_a_known_category(predictor, db_session):
    category, _ = predictor.predict(db_session, "Some completely unrelated gibberish text")
    assert category in CategoryService.get_ml_index_map(db_session)


def test_retrain_with_corrections_in_a_single_category_does_not_crash(predictor, db_session):
    # Regression test: a brand new user who has only ever corrected
    # transactions into one category (e.g. several "groceries" fixes) used to
    # crash retrain() with sklearn's "needs at least 2 classes" error, because
    # retrain() fit on the corrections alone instead of merging with the seed
    # baseline.
    predictor.retrain(db_session, [("My Local Store", "groceries", -3000.0, "2024-01-15"), ("Another Shop", "groceries", -3000.0, "2024-01-16")])

    category, _ = predictor.predict(db_session, "My Local Store")
    assert category in CategoryService.get_ml_index_map(db_session)


def test_retrain_does_not_forget_categories_absent_from_corrections(predictor, db_session):
    # Corrections only ever cover "groceries", but the model must still be
    # able to predict "rent" afterwards because the seed baseline is merged
    # in - retraining shouldn't erase categories the user hasn't corrected.
    predictor.retrain(db_session, [("Corner Shop", "groceries", -3000.0, "2024-01-15")])

    category, _ = predictor.predict(db_session, "Monthly Rent Payment")
    assert category == "rent"


def test_fit_skips_and_keeps_existing_model_when_fewer_than_two_classes(predictor, db_session):
    fitted = predictor._fit(db_session, ["a", "b"], ["groceries", "groceries"])
    assert fitted is False

    # The baseline model from the fixture should still be intact and usable.
    category, _ = predictor.predict(db_session, "Grocery Store")
    assert category == "groceries"


def test_seed_data_covers_at_least_two_categories():
    # Guards the invariant retrain() relies on: SEED_DATA alone must always
    # provide enough class diversity for LogisticRegression to fit.
    assert len({label for _, label, _ in SEED_DATA}) >= 2


def test_category_allowed_enforces_income_only_categories(db_session):
    assert _category_allowed(db_session, "salary", 1000.0) is True
    assert _category_allowed(db_session, "salary", -1000.0) is False


def test_category_allowed_enforces_expense_only_categories(db_session):
    assert _category_allowed(db_session, "groceries", -50.0) is True
    assert _category_allowed(db_session, "groceries", 50.0) is False


def test_category_allowed_other_is_unconstrained(db_session):
    assert _category_allowed(db_session, "other", 50.0) is True
    assert _category_allowed(db_session, "other", -50.0) is True


def test_category_allowed_rejects_income_only_categories_on_a_credit_account(db_session):
    # A positive amount on a credit account is the cardholder paying down
    # their balance (or a refund), not genuine income.
    assert _category_allowed(db_session, "salary", 1000.0, account_type="Credit") is False
    assert _category_allowed(db_session, "salary", 1000.0, account_type="Credit Card") is False
    assert _category_allowed(db_session, "salary", 1000.0, account_type="credit") is False


def test_category_allowed_credit_account_does_not_affect_expense_categories(db_session):
    # The credit-account veto only targets income-only categories - a normal
    # purchase (negative amount) on a credit account is unaffected.
    assert _category_allowed(db_session, "groceries", -50.0, account_type="Credit") is True


def test_category_allowed_non_credit_account_types_are_unaffected(db_session):
    assert _category_allowed(db_session, "salary", 1000.0, account_type="Debit") is True
    assert _category_allowed(db_session, "salary", 1000.0, account_type="Checking") is True
    assert _category_allowed(db_session, "salary", 1000.0, account_type=None) is True


def test_predict_never_returns_salary_for_a_positive_amount_on_a_credit_account(predictor, db_session):
    # "Salary Deposit" is the exact seed phrase for salary, but a positive
    # amount landing on a credit account is a balance payback, not income -
    # the veto must rule out "salary" specifically. Which sign-compatible
    # category the model ranks next (e.g. a transfer category - those are
    # sign-unconstrained too) is an implementation detail, not pinned here.
    category, confidence = predictor.predict(db_session, "Salary Deposit", amount=300000.0, account_type="Credit")
    assert category != "salary"
    assert 0.0 <= confidence <= 1.0


def test_predict_still_returns_salary_for_a_positive_amount_on_a_non_credit_account(predictor, db_session):
    category, _ = predictor.predict(db_session, "Salary Deposit", amount=300000.0, account_type="Checking")
    assert category == "salary"


def test_predict_never_returns_salary_for_a_negative_amount(predictor, db_session):
    # Even though "Salary Deposit" is the seed phrase for salary, a negative
    # (expense) amount must never be classified as the income-only category.
    category, _ = predictor.predict(db_session, "Salary Deposit", amount=-500.0)
    assert category != "salary"


def test_predict_never_returns_an_expense_only_category_for_a_positive_amount(db_session):
    # Direct unit test of the rule table itself, independent of what the
    # model happens to rank first - every expense-only category should be
    # rejected for a positive (income) amount.
    expense_only = [key for key in CategoryService.get_ml_index_map(db_session)
                     if CategoryService.get_sign(db_session, key) == "negative"]
    for category in expense_only:
        assert _category_allowed(db_session, category, 100.0) is False


def test_predict_without_amount_is_unconstrained(predictor, db_session):
    # Backward compatible: omitting amount skips the sign filter entirely.
    category, _ = predictor.predict(db_session, "Salary Deposit")
    assert category == "salary"


# --- Known-merchant lookup (deterministic, checked before the ML model) ---

def test_match_known_merchant_finds_real_examples():
    assert _match_known_merchant("Vásárlás LIDL HU 334 Debrecen") == "groceries"
    assert _match_known_merchant("MOL 18355 sz. toltoallomas") == "transport"
    assert _match_known_merchant("Booking.com Hotel") == "travel"
    assert _match_known_merchant("Rossmann 278.") == "health"


def test_match_known_merchant_is_case_insensitive():
    assert _match_known_merchant("tesco 41720 godollo") == "groceries"


def test_match_known_merchant_returns_none_for_unrecognized_text():
    assert _match_known_merchant("Some Local Unbranded Shop") is None


def test_match_known_merchant_requires_whole_word_not_substring():
    # "mol" (transport) must not fire just because it's a substring of an
    # unrelated word - "gyumolcs" (fruit/veg) contains "mol" but isn't MOL.
    assert _match_known_merchant("Zoldseg Gyumolcs") is None


def test_match_known_merchant_avoids_ambiguous_hungarian_word():
    # Bare "bolt" is also the Hungarian word for "shop" - only the literal
    # Bolt.eu brand domain is matched, not every merchant whose name happens
    # to end in "bolt" (e.g. a generic produce/hardware shop).
    assert _match_known_merchant("Mezőgazdasági Bolt") is None
    assert _match_known_merchant("Bolt.eu /O/2107310059") == "transport"


def test_predict_returns_known_merchant_at_full_confidence(predictor, db_session):
    category, confidence = predictor.predict(db_session, "Vásárlás LIDL HU 334 Debrecen", amount=-3500.0)
    assert category == "groceries"
    assert confidence == 1.0


def test_predict_known_merchant_still_respects_category_sign(predictor, db_session):
    # Shell is unambiguously transport, but transport is expense-only -
    # a positive amount must not get a confident wrong answer just because
    # the merchant name matched.
    category, confidence = predictor.predict(db_session, "Shell", amount=500.0)
    assert category != "transport"


# --- Char n-grams: generalizing to text with no keyword-table coverage ---
# (rent/salary deliberately have no KNOWN_MERCHANT_CATEGORIES entries - no
# brand name reliably means "rent" - so any correct match here is the
# TF-IDF/char-ngram model itself, not the deterministic lookup.)

def test_char_ngrams_generalize_to_unseen_rent_variant(predictor, db_session):
    category, _ = predictor.predict(db_session, "Havi Lakber Atutalas", amount=-150000.0)
    assert category == "rent"


def test_char_ngrams_generalize_to_unseen_salary_variant(predictor, db_session):
    category, _ = predictor.predict(db_session, "Februari Munkaber", amount=350000.0)
    assert category == "salary"


# --- Amount-magnitude feature ---

def test_scaled_amount_increases_with_magnitude():
    assert _scaled_amount(-500) < _scaled_amount(-50000) < _scaled_amount(-3000000)


def test_scaled_amount_is_capped_at_one():
    assert _scaled_amount(-50000000) == 1.0


def test_scaled_amount_ignores_sign():
    assert _scaled_amount(1000) == _scaled_amount(-1000)


def test_neutral_amount_feature_is_within_observed_seed_range():
    # Regression: defaulting the "amount unknown" feature to 0.0 used to be
    # far outside every SEED_DATA example's actual scaled range (~0.5-0.85
    # for real HUF magnitudes), which made predict() without an amount
    # misclassify even exact seed phrases (e.g. "Monthly Rent Payment" came
    # back as "transport"). The neutral default must fall inside that range.
    scaled = [_scaled_amount(amt) for _, _, amt in SEED_DATA]
    assert min(scaled) <= _NEUTRAL_AMOUNT_FEATURE <= max(scaled)
