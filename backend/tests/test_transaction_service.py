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
