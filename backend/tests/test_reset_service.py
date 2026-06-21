import pytest

from app.models.transaction import Account, Transaction, TrainingData
from app.services import ml_service, reset_service
from app.services.ml_service import CategoryPredictor
from app.services.reset_service import reset_all_transaction_data


@pytest.fixture(autouse=True)
def isolated_predictor(tmp_path, monkeypatch):
    # reset_all_transaction_data() calls predictor.reset_to_baseline(), which
    # writes model files - point it at a throwaway predictor/directory
    # instead of mutating the real global model in backend/app/ml/models/.
    monkeypatch.setattr(ml_service, "MODEL_DIR", tmp_path)
    monkeypatch.setattr(reset_service, "predictor", CategoryPredictor())


@pytest.fixture
def account(db_session):
    acc = Account(name="Test Account", account_number="****1234")
    db_session.add(acc)
    db_session.commit()
    return acc


def test_reset_deletes_transactions_and_training_data_but_keeps_account(db_session, account):
    txn = Transaction(
        account_id=account.id, date="2024-01-01", amount=-10.0, description="Coffee",
        hash_fingerprint="fp-1",
    )
    db_session.add(txn)
    db_session.commit()
    db_session.add(TrainingData(transaction_id=txn.id, original_label="other", corrected_label="groceries"))
    db_session.commit()

    result = reset_all_transaction_data(db_session)

    assert result == {"transactions_deleted": 1, "training_data_deleted": 1}
    assert db_session.query(Transaction).count() == 0
    assert db_session.query(TrainingData).count() == 0
    assert db_session.query(Account).filter(Account.id == account.id).first() is not None


def test_reset_with_no_data_is_a_noop(db_session, account):
    result = reset_all_transaction_data(db_session)
    assert result == {"transactions_deleted": 0, "training_data_deleted": 0}
    assert db_session.query(Account).filter(Account.id == account.id).first() is not None


def test_reset_with_training_kept_deletes_transactions_but_not_corrections(db_session, account):
    txn = Transaction(
        account_id=account.id, date="2024-01-01", amount=-10.0, description="Coffee Shop",
        hash_fingerprint="fp-1",
    )
    db_session.add(txn)
    db_session.commit()
    db_session.add(TrainingData(
        transaction_id=txn.id, description="Coffee Shop", original_label="other", corrected_label="eating_out",
    ))
    db_session.commit()

    result = reset_all_transaction_data(db_session, reset_training=False)

    assert result == {"transactions_deleted": 1, "training_data_deleted": 0}
    assert db_session.query(Transaction).count() == 0

    remaining = db_session.query(TrainingData).one()
    assert remaining.description == "Coffee Shop"
    assert remaining.corrected_label == "eating_out"
    # Decoupled from the now-deleted transaction, not left dangling on it.
    assert remaining.transaction_id is None


def test_reset_with_training_kept_does_not_touch_the_model(db_session, account):
    txn = Transaction(
        account_id=account.id, date="2024-01-01", amount=-10.0, description="Coffee Shop",
        hash_fingerprint="fp-1",
    )
    db_session.add(txn)
    db_session.commit()

    from app.services import reset_service
    calls = []
    reset_service.predictor.reset_to_baseline = lambda: calls.append(True)

    reset_all_transaction_data(db_session, reset_training=False)

    assert calls == []
