import pytest

from app.models.transaction import Account, Transaction
from app.services.ml_service import predictor
from app.services.transaction_service import TransactionService, DuplicateTransactionError


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
    monkeypatch.setattr(predictor, "predict", lambda description: ("groceries", 0.9))


def _txn_data(account_id, fingerprint="fp-1", description="Lidl"):
    return {
        "account_id": account_id,
        "date": "2024-01-05",
        "amount": -100.0,
        "currency": "USD",
        "description": description,
        "merchant": "Lidl",
        "raw_source": "{}",
        "hash_fingerprint": fingerprint,
    }


def test_create_transaction_persists_a_new_row(db_session, account):
    created = TransactionService.create_transaction(db_session, _txn_data(account.id))
    assert created.id is not None
    assert db_session.query(Transaction).count() == 1


def test_duplicate_fingerprint_raises_and_does_not_create_a_second_row(db_session, account):
    TransactionService.create_transaction(db_session, _txn_data(account.id))

    with pytest.raises(DuplicateTransactionError):
        TransactionService.create_transaction(db_session, _txn_data(account.id))

    assert db_session.query(Transaction).count() == 1


def test_different_fingerprints_both_get_created(db_session, account):
    TransactionService.create_transaction(db_session, _txn_data(account.id, fingerprint="fp-1"))
    TransactionService.create_transaction(db_session, _txn_data(account.id, fingerprint="fp-2"))
    assert db_session.query(Transaction).count() == 2


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
