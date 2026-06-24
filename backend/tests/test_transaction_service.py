import pytest

from app.models.transaction import Account, Card, Transaction, TrainingData
from app.services import currency_service
from app.services.account_service import AccountNotFoundError
from app.services.ml_service import predictor
from app.services.transaction_service import (
    TransactionService, DuplicateTransactionError, TransactionNotFoundError
)


@pytest.fixture
def account(db_session):
    acc = Account(name="Test Account", account_number="****1234")
    db_session.add(acc)
    db_session.commit()
    return acc


@pytest.fixture
def second_account(db_session):
    acc = Account(name="Savings Account", account_number="****5678")
    db_session.add(acc)
    db_session.commit()
    return acc


@pytest.fixture(autouse=True)
def mock_predictor(monkeypatch):
    # Isolate these tests from the real ML model (sklearn/joblib), which is
    # unrelated to the dedup logic under test.
    monkeypatch.setattr(predictor, "predict", lambda db, description, amount=None, account_type=None, date=None: ("groceries", 0.9))


def _txn_data(
    account_id, fingerprint="fp-1", description="Lidl", date="2024-01-05", merchant="Lidl",
    category_hint=None, card_hint=None, amount=-100.0, account_type=None, currency="HUF",
):
    return {
        "account_id": account_id,
        "date": date,
        "amount": amount,
        "currency": currency,
        "description": description,
        "merchant": merchant,
        "raw_source": "{}",
        "hash_fingerprint": fingerprint,
        "category_hint": category_hint,
        "card_hint": card_hint,
        "account_type": account_type,
    }


def test_create_transaction_persists_a_new_row(db_session, account):
    created = TransactionService.create_transaction(db_session, _txn_data(account.id))
    assert created.id is not None
    assert db_session.query(Transaction).count() == 1


def test_card_hint_column_fits_a_full_account_number(db_session, account):
    # SQLite (used by these tests) doesn't enforce VARCHAR length, unlike
    # MariaDB - so a too-narrow column here wouldn't otherwise fail until it
    # hit production. Regression for card_hint being VARCHAR(20): MBH/K&H
    # formats put a full bank account number in here (up to ~26 chars), not
    # just a card's last-4 digits, which made every one of their inserts
    # fail with "Data too long for column 'card_hint'".
    assert Transaction.__table__.c.card_hint.type.length >= 100

    long_account_number = "10100895-89248114-48556663"
    created = TransactionService.create_transaction(
        db_session, _txn_data(account.id, card_hint=long_account_number)
    )
    assert created.card_hint == long_account_number


def test_create_transaction_passes_account_type_through_to_the_predictor(db_session, account, monkeypatch):
    seen = {}

    def fake_predict(db, description, amount=None, account_type=None, date=None):
        seen["account_type"] = account_type
        return "other", 0.5

    monkeypatch.setattr(predictor, "predict", fake_predict)
    TransactionService.create_transaction(db_session, _txn_data(account.id, account_type="Credit"))
    assert seen["account_type"] == "Credit"


def test_duplicate_fingerprint_raises_and_does_not_create_a_second_row(db_session, account):
    TransactionService.create_transaction(db_session, _txn_data(account.id))

    with pytest.raises(DuplicateTransactionError):
        TransactionService.create_transaction(db_session, _txn_data(account.id))

    assert db_session.query(Transaction).count() == 1


def test_huf_transaction_is_stored_unconverted(db_session, account):
    created = TransactionService.create_transaction(db_session, _txn_data(account.id, amount=-100.0))
    assert created.amount == -100.0
    assert created.currency == "HUF"
    assert created.original_amount is None
    assert created.exchange_rate is None


def test_foreign_currency_transaction_is_converted_to_huf(db_session, account, monkeypatch):
    monkeypatch.setattr(
        currency_service.CurrencyService, "convert_to_huf", lambda amount, currency, date: (amount * 390.0, 390.0)
    )
    created = TransactionService.create_transaction(
        db_session, _txn_data(account.id, amount=-7.99, currency="EUR")
    )
    assert created.amount == pytest.approx(-7.99 * 390.0)
    assert created.currency == "EUR"
    assert created.original_amount == -7.99
    assert created.exchange_rate == 390.0


def test_foreign_currency_transaction_keeps_raw_amount_when_conversion_fails(db_session, account, monkeypatch):
    # Unknown/non-ISO currency (e.g. Curve's "CPT" points) or a network
    # failure - the row is still created, just left unconverted and flagged
    # (original_amount/exchange_rate stay None) instead of failing the import.
    monkeypatch.setattr(currency_service.CurrencyService, "convert_to_huf", lambda amount, currency, date: None)
    created = TransactionService.create_transaction(
        db_session, _txn_data(account.id, amount=78.0, currency="CPT")
    )
    assert created.amount == 78.0
    assert created.currency == "CPT"
    assert created.original_amount is None
    assert created.exchange_rate is None


def test_ml_prediction_uses_the_converted_huf_amount_not_the_raw_one(db_session, account, monkeypatch):
    # A raw foreign-currency magnitude (e.g. -7.99) would be a wildly
    # different signal to the amount-magnitude ML feature than its real HUF
    # equivalent (~-3000) - prediction must see the converted amount.
    monkeypatch.setattr(
        currency_service.CurrencyService, "convert_to_huf", lambda amount, currency, date: (amount * 390.0, 390.0)
    )
    seen = {}

    def fake_predict(db, description, amount=None, account_type=None, date=None):
        seen["amount"] = amount
        return "other", 0.5

    monkeypatch.setattr(predictor, "predict", fake_predict)
    TransactionService.create_transaction(db_session, _txn_data(account.id, amount=-7.99, currency="EUR"))
    assert seen["amount"] == pytest.approx(-7.99 * 390.0)


def test_different_fingerprints_both_get_created(db_session, account):
    TransactionService.create_transaction(db_session, _txn_data(account.id, fingerprint="fp-1"))
    TransactionService.create_transaction(db_session, _txn_data(account.id, fingerprint="fp-2"))
    assert db_session.query(Transaction).count() == 2


def test_category_hint_overrides_predicted_category_with_full_confidence(db_session, account):
    created = TransactionService.create_transaction(
        db_session, _txn_data(account.id, category_hint="utilities")
    )
    assert created.category_predicted == "utilities"
    assert created.category_confidence == 1.0
    assert created.category_final is None  # still goes through the normal review queue


def test_category_hint_disagreeing_with_prediction_creates_training_data(db_session, account):
    created = TransactionService.create_transaction(
        db_session, _txn_data(account.id, category_hint="utilities")
    )
    training = db_session.query(TrainingData).filter(TrainingData.transaction_id == created.id).first()
    assert training is not None
    assert training.original_label == "groceries"
    assert training.corrected_label == "utilities"


def test_training_data_denormalizes_description_and_amount(db_session, account):
    created = TransactionService.create_transaction(
        db_session, _txn_data(account.id, category_hint="utilities", description="Lidl", amount=-1234.0)
    )
    training = db_session.query(TrainingData).filter(TrainingData.transaction_id == created.id).first()
    assert training.description == "Lidl"
    assert training.amount == -1234.0


def test_category_hint_matching_prediction_does_not_duplicate_training_data(db_session, account):
    created = TransactionService.create_transaction(
        db_session, _txn_data(account.id, category_hint="groceries")
    )
    assert created.category_predicted == "groceries"
    assert db_session.query(TrainingData).filter(TrainingData.transaction_id == created.id).count() == 0


def test_other_category_hint_does_not_create_training_data(db_session, account):
    # Regression: "other" has no SEED_DATA examples, so it always "disagrees"
    # with the model's own guess by definition. MBH/KH bank-fee rows hint
    # "other" far more often than any real category has seed phrases, so
    # recording every one of them as a correction skewed retrain() into
    # predicting "other" for nearly everything, including unrelated text.
    created = TransactionService.create_transaction(
        db_session, _txn_data(account.id, category_hint="other")
    )
    assert created.category_predicted == "other"
    assert created.category_confidence == 1.0
    assert db_session.query(TrainingData).filter(TrainingData.transaction_id == created.id).count() == 0


def test_update_transaction_category_denormalizes_description_and_amount(db_session, account):
    txn = TransactionService.create_transaction(
        db_session, _txn_data(account.id, description="Lidl", amount=-1234.0)
    )
    TransactionService.update_transaction_category(db_session, txn.id, "rent")

    training = db_session.query(TrainingData).filter(TrainingData.transaction_id == txn.id).first()
    assert training.description == "Lidl"
    assert training.amount == -1234.0


def test_finalizing_a_transfer_category_without_a_pairing_still_succeeds(db_session, account):
    # Many real transfers (e.g. a card top-up funded from outside the
    # tracked accounts) never get a counterpart transaction at all - the
    # category can still be finalized; only is_transfer/analytics exclusion
    # waits on an actual pairing (see set_transfer_pair).
    txn = TransactionService.create_transaction(db_session, _txn_data(account.id))
    updated = TransactionService.update_transaction_category(db_session, txn.id, "saving")
    assert updated.category_final == "saving"
    assert updated.is_transfer is False


def test_finalizing_a_transfer_category_succeeds_once_paired(db_session, account, second_account):
    out = TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-out", description="Transfer out", amount=-50000.0)
    )
    TransactionService.create_transaction(
        db_session, _txn_data(second_account.id, fingerprint="fp-in", description="Transfer in", amount=50000.0)
    )
    TransactionService.set_transfer_pair(db_session, out.id, second_account.id)

    updated = TransactionService.update_transaction_category(db_session, out.id, "saving")
    assert updated.category_final == "saving"


def test_non_transfer_category_never_requires_a_pairing(db_session, account):
    txn = TransactionService.create_transaction(db_session, _txn_data(account.id))
    updated = TransactionService.update_transaction_category(db_session, txn.id, "groceries")
    assert updated.category_final == "groceries"


def test_no_category_hint_leaves_transaction_in_review_queue(db_session, account):
    created = TransactionService.create_transaction(db_session, _txn_data(account.id))
    assert created.category_final is None


def test_category_hint_transactions_still_appear_in_review_queue(db_session, account):
    TransactionService.create_transaction(db_session, _txn_data(account.id, category_hint="utilities"))

    review = TransactionService.get_transactions_for_review(db_session, account_id=account.id)

    assert len(review) == 1
    assert review[0].category_predicted == "utilities"


def test_detect_and_flag_transfers_flags_cross_account_pair(db_session, account, second_account):
    out = TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-out", description="Transfer out")
    )
    out.amount = -50000.0
    inflow = TransactionService.create_transaction(
        db_session, _txn_data(second_account.id, fingerprint="fp-in", description="Transfer in")
    )
    inflow.amount = 50000.0
    db_session.commit()

    flagged = TransactionService.detect_and_flag_transfers(db_session)

    assert flagged == 1
    db_session.refresh(out)
    db_session.refresh(inflow)
    assert out.is_transfer is True
    assert inflow.is_transfer is True
    assert out.transfer_match_id == inflow.id
    assert inflow.transfer_match_id == out.id


def test_detect_and_flag_transfers_leaves_unrelated_transaction_alone(db_session, account):
    txn = TransactionService.create_transaction(db_session, _txn_data(account.id, fingerprint="fp-solo"))

    flagged = TransactionService.detect_and_flag_transfers(db_session)

    assert flagged == 0
    db_session.refresh(txn)
    assert txn.is_transfer is False
    assert txn.transfer_match_id is None


def test_set_transfer_pair_links_both_sides(db_session, account, second_account):
    out = TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-out", description="Transfer out", amount=-50000.0)
    )
    inflow = TransactionService.create_transaction(
        db_session, _txn_data(second_account.id, fingerprint="fp-in", description="Transfer in", amount=50000.0)
    )

    updated = TransactionService.set_transfer_pair(db_session, out.id, second_account.id)

    assert updated.is_transfer is True
    assert updated.transfer_match_id == inflow.id
    # Regression: set_transfer_pair's own return value used to skip
    # _attach_transfer_pair_accounts, so transfer_match_account_id was
    # always None on the response even on success - callers (e.g. the
    # Review page) that update local state directly from this response
    # would see the pairing immediately "disappear" despite the DB write
    # having actually succeeded.
    assert updated.transfer_match_account_id == second_account.id
    db_session.refresh(inflow)
    assert inflow.is_transfer is True
    assert inflow.transfer_match_id == out.id


def test_set_transfer_pair_picks_the_closest_date_when_ambiguous(db_session, account, second_account):
    out = TransactionService.create_transaction(
        db_session, _txn_data(
            account.id, fingerprint="fp-out", description="Transfer out", date="2024-01-10", amount=-50000.0
        )
    )
    far = TransactionService.create_transaction(
        db_session, _txn_data(
            second_account.id, fingerprint="fp-far", description="Far candidate", date="2024-01-08", amount=50000.0
        )
    )
    close = TransactionService.create_transaction(
        db_session, _txn_data(
            second_account.id, fingerprint="fp-close", description="Close candidate", date="2024-01-11", amount=50000.0
        )
    )

    updated = TransactionService.set_transfer_pair(db_session, out.id, second_account.id)

    assert updated.transfer_match_id == close.id
    db_session.refresh(far)
    assert far.is_transfer is False


def test_set_transfer_pair_with_none_clears_an_existing_pairing(db_session, account, second_account):
    out = TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-out", description="Transfer out", amount=-50000.0)
    )
    inflow = TransactionService.create_transaction(
        db_session, _txn_data(second_account.id, fingerprint="fp-in", description="Transfer in", amount=50000.0)
    )
    TransactionService.set_transfer_pair(db_session, out.id, second_account.id)

    updated = TransactionService.set_transfer_pair(db_session, out.id, None)

    assert updated.is_transfer is False
    assert updated.transfer_match_id is None
    db_session.refresh(inflow)
    assert inflow.is_transfer is False
    assert inflow.transfer_match_id is None


def test_set_transfer_pair_falls_back_to_one_sided_when_no_candidate_matches(db_session, account, second_account):
    # E.g. a card top-up funded from outside the tracked accounts - there's
    # no real counterpart transaction to link, but the user still knows
    # which account it involves.
    out = TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-out", description="Transfer out", amount=-50000.0)
    )
    TransactionService.create_transaction(
        db_session, _txn_data(second_account.id, fingerprint="fp-wrong-sign", description="Same sign", amount=-50000.0)
    )

    updated = TransactionService.set_transfer_pair(db_session, out.id, second_account.id)

    assert updated.is_transfer is True
    assert updated.transfer_match_id is None
    assert updated.transfer_match_account_id == second_account.id


def test_set_transfer_pair_with_none_clears_a_one_sided_pairing(db_session, account, second_account):
    out = TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-out", description="Transfer out", amount=-50000.0)
    )
    TransactionService.set_transfer_pair(db_session, out.id, second_account.id)

    updated = TransactionService.set_transfer_pair(db_session, out.id, None)

    assert updated.is_transfer is False
    assert updated.transfer_match_account_id is None


def test_set_transfer_pair_raises_for_unknown_transaction(db_session):
    with pytest.raises(TransactionNotFoundError):
        TransactionService.set_transfer_pair(db_session, "missing-id", None)


def test_set_transfer_pair_raises_for_unknown_account(db_session, account):
    out = TransactionService.create_transaction(db_session, _txn_data(account.id, fingerprint="fp-out"))
    with pytest.raises(AccountNotFoundError):
        TransactionService.set_transfer_pair(db_session, out.id, "missing-account-id")


def test_get_transactions_for_review_attaches_transfer_pair_account_id(db_session, account, second_account):
    out = TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-out", description="Transfer out", amount=-50000.0)
    )
    TransactionService.create_transaction(
        db_session, _txn_data(second_account.id, fingerprint="fp-in", description="Transfer in", amount=50000.0)
    )
    TransactionService.set_transfer_pair(db_session, out.id, second_account.id)

    results = TransactionService.get_transactions_for_review(db_session, limit=50, include_finalized=True)
    out_result = next(t for t in results if t.id == out.id)
    assert out_result.transfer_match_account_id == second_account.id


def test_get_transactions_attaches_none_when_not_a_transfer(db_session, account):
    txn = TransactionService.create_transaction(db_session, _txn_data(account.id, fingerprint="fp-solo"))
    results = TransactionService.get_transactions(db_session)
    assert next(t for t in results if t.id == txn.id).transfer_match_account_id is None


def test_detect_and_flag_curve_duplicates_links_pair_and_enriches_canonical(db_session, account, second_account):
    db_session.add(Card(account_id=account.id, card_number="****9948"))
    db_session.commit()

    canonical = TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-mbh", description="Otpmobl", merchant=None, amount=-6805.0)
    )
    curve = TransactionService.create_transaction(
        db_session,
        _txn_data(
            second_account.id, fingerprint="fp-curve", description="Otpmobl Curve",
            merchant="Otpmobl*Icsekk", category_hint="utilities", card_hint="9948", amount=-6805.0,
        ),
    )

    flagged = TransactionService.detect_and_flag_curve_duplicates(db_session)

    assert flagged == 1
    db_session.refresh(canonical)
    db_session.refresh(curve)

    assert canonical.is_duplicate is False
    assert canonical.duplicate_of_id == curve.id
    assert canonical.category_predicted == "utilities"
    assert canonical.category_confidence == 1.0
    assert canonical.merchant == "Otpmobl*Icsekk"  # enriched from curve, since canonical had none

    assert curve.is_duplicate is True
    assert curve.duplicate_of_id == canonical.id
    assert curve.category_final == "utilities"  # auto-closed out of the review queue


def test_detect_and_flag_curve_duplicates_does_not_overwrite_confirmed_category(db_session, account, second_account):
    db_session.add(Card(account_id=account.id, card_number="****9948"))
    db_session.commit()

    canonical = TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-mbh", amount=-6805.0)
    )
    TransactionService.update_transaction_category(db_session, canonical.id, "rent")
    TransactionService.create_transaction(
        db_session,
        _txn_data(second_account.id, fingerprint="fp-curve", category_hint="utilities", card_hint="9948", amount=-6805.0),
    )

    TransactionService.detect_and_flag_curve_duplicates(db_session)

    db_session.refresh(canonical)
    assert canonical.category_final == "rent"  # user's confirmed choice is never overwritten


def test_analytics_summary_excludes_curve_duplicates_but_counts_canonical_once(db_session, account, second_account):
    db_session.add(Card(account_id=account.id, card_number="****9948"))
    db_session.commit()

    TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-mbh", amount=-6805.0)
    )
    TransactionService.create_transaction(
        db_session,
        _txn_data(second_account.id, fingerprint="fp-curve", card_hint="9948", amount=-6805.0),
    )
    TransactionService.detect_and_flag_curve_duplicates(db_session)

    summary = TransactionService.get_analytics_summary(db_session)

    assert summary["total_transactions"] == 1
    assert summary["total_expenses"] == 6805.0


def test_analytics_summary_excludes_flagged_transfers(db_session, account, second_account):
    out = TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-out", description="Transfer out")
    )
    out.amount = -50000.0
    inflow = TransactionService.create_transaction(
        db_session, _txn_data(second_account.id, fingerprint="fp-in", description="Transfer in")
    )
    inflow.amount = 50000.0
    db_session.commit()
    TransactionService.detect_and_flag_transfers(db_session)

    TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-groceries", description="Lidl")
    )

    summary = TransactionService.get_analytics_summary(db_session)

    assert summary["total_transactions"] == 1
    assert summary["total_expenses"] == 100.0
    assert summary["total_income"] == 0


def test_analytics_summary_respects_date_range(db_session, account):
    TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-jan", date="2024-01-15")
    )
    TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-feb", date="2024-02-15")
    )

    summary = TransactionService.get_analytics_summary(db_session, date_from="2024-02-01", date_to="2024-02-28")

    assert summary["total_transactions"] == 1


def test_category_breakdown_can_group_by_merchant(db_session, account):
    TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-1", merchant="Lidl")
    )
    TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-2", merchant="Aldi")
    )

    breakdown = TransactionService.get_category_breakdown(db_session, group_by="merchant")

    assert set(breakdown.keys()) == {"Lidl", "Aldi"}
    assert breakdown["Lidl"]["count"] == 1


def test_category_breakdown_can_group_by_account(db_session, account, second_account):
    TransactionService.create_transaction(db_session, _txn_data(account.id, fingerprint="fp-1"))
    TransactionService.create_transaction(db_session, _txn_data(second_account.id, fingerprint="fp-2"))

    breakdown = TransactionService.get_category_breakdown(db_session, group_by="account")

    assert set(breakdown.keys()) == {"Test Account", "Savings Account"}


def test_monthly_trends_respects_date_range(db_session, account):
    TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-jan", date="2024-01-15")
    )
    TransactionService.create_transaction(
        db_session, _txn_data(account.id, fingerprint="fp-feb", date="2024-02-15")
    )

    trends = TransactionService.get_monthly_trends(db_session, date_from="2024-02-01")

    assert list(trends.keys()) == ["2024-02"]


def test_review_queue_can_be_filtered_by_account(db_session, account, second_account):
    TransactionService.create_transaction(db_session, _txn_data(account.id, fingerprint="fp-1"))
    TransactionService.create_transaction(db_session, _txn_data(second_account.id, fingerprint="fp-2"))

    review = TransactionService.get_transactions_for_review(db_session, account_id=account.id)

    assert len(review) == 1
    assert review[0].account_id == account.id


def test_review_queue_can_be_filtered_by_multiple_accounts(db_session, account, second_account):
    third_account = Account(name="Third Account", account_number="****9012")
    db_session.add(third_account)
    db_session.commit()

    TransactionService.create_transaction(db_session, _txn_data(account.id, fingerprint="fp-1"))
    TransactionService.create_transaction(db_session, _txn_data(second_account.id, fingerprint="fp-2"))
    TransactionService.create_transaction(db_session, _txn_data(third_account.id, fingerprint="fp-3"))

    review = TransactionService.get_transactions_for_review(
        db_session, account_id=f"{account.id},{second_account.id}"
    )

    assert {t.account_id for t in review} == {account.id, second_account.id}


def test_review_queue_excludes_finalized_by_default(db_session, account):
    txn = TransactionService.create_transaction(db_session, _txn_data(account.id))
    TransactionService.update_transaction_category(db_session, txn.id, "groceries")

    review = TransactionService.get_transactions_for_review(db_session, account_id=account.id)

    assert review == []


def test_review_queue_can_include_finalized(db_session, account):
    txn = TransactionService.create_transaction(db_session, _txn_data(account.id))
    TransactionService.update_transaction_category(db_session, txn.id, "groceries")

    review = TransactionService.get_transactions_for_review(
        db_session, account_id=account.id, include_finalized=True
    )

    assert len(review) == 1
    assert review[0].category_final == "groceries"


def _create_transfer_pair(db_session, account_a, account_b, amount=50000.0):
    out = TransactionService.create_transaction(
        db_session, _txn_data(account_a.id, fingerprint=f"fp-out-{account_a.id}-{account_b.id}", description="Transfer out")
    )
    out.amount = -amount
    inflow = TransactionService.create_transaction(
        db_session, _txn_data(account_b.id, fingerprint=f"fp-in-{account_a.id}-{account_b.id}", description="Transfer in")
    )
    inflow.amount = amount
    db_session.commit()
    TransactionService.detect_and_flag_transfers(db_session)


def test_total_transferred_is_zero_for_a_single_selected_account(db_session, account, second_account):
    _create_transfer_pair(db_session, account, second_account)

    summary = TransactionService.get_analytics_summary(db_session, account_id=account.id)

    assert summary["total_transferred"] == 0.0


def test_total_transferred_sums_transfers_between_selected_accounts(db_session, account, second_account):
    _create_transfer_pair(db_session, account, second_account, amount=50000.0)

    summary = TransactionService.get_analytics_summary(
        db_session, account_id=f"{account.id},{second_account.id}"
    )

    assert summary["total_transferred"] == 50000.0


def test_total_transferred_ignores_transfers_to_an_unselected_account(db_session, account, second_account):
    third_account = Account(name="Third Account", account_number="****9012")
    db_session.add(third_account)
    db_session.commit()
    _create_transfer_pair(db_session, account, third_account, amount=25000.0)

    summary = TransactionService.get_analytics_summary(
        db_session, account_id=f"{account.id},{second_account.id}"
    )

    assert summary["total_transferred"] == 0.0
