import pytest

from app.models.transaction import Account, Card, Transaction, TrainingData, AccountCoverageFlag
from app.services.account_service import (
    AccountService, AccountNotFoundError, AccountHasTransactionsError,
    CardNotFoundError, CardAlreadyExistsError
)


@pytest.fixture
def account(db_session):
    acc = Account(name="Test Account", account_number="****1234", type=None)
    db_session.add(acc)
    db_session.commit()
    return acc


def test_update_account_sets_type(db_session, account):
    updated = AccountService.update_account(db_session, account.id, type="Credit")
    assert updated.type == "Credit"


def test_update_account_can_change_name_and_number(db_session, account):
    updated = AccountService.update_account(
        db_session, account.id, name="Renamed", account_number="****9999"
    )
    assert updated.name == "Renamed"
    assert updated.account_number == "****9999"


def test_update_account_leaves_unset_fields_untouched(db_session, account):
    AccountService.update_account(db_session, account.id, type="Credit")
    updated = AccountService.update_account(db_session, account.id, name="New Name")
    assert updated.name == "New Name"
    assert updated.type == "Credit"


def test_update_unknown_account_raises(db_session):
    with pytest.raises(AccountNotFoundError):
        AccountService.update_account(db_session, "missing-id", type="Credit")


def test_delete_account_without_transactions(db_session, account):
    deleted_count = AccountService.delete_account(db_session, account.id)
    assert deleted_count == 0
    assert db_session.query(Account).filter(Account.id == account.id).first() is None


def test_delete_account_with_registered_cards(db_session, account):
    # Regression test: Card.account_id is a NOT NULL FK with no cascade
    # configured, so deleting an account with cards on file used to crash
    # with an IntegrityError trying to null out the FK instead of erroring cleanly.
    card = AccountService.add_card(db_session, account.id, "****9948")

    deleted_count = AccountService.delete_account(db_session, account.id)

    assert deleted_count == 0
    assert db_session.query(Account).filter(Account.id == account.id).first() is None
    assert db_session.query(Card).filter(Card.id == card.id).first() is None


def test_delete_account_with_transactions_requires_force(db_session, account):
    txn = Transaction(
        account_id=account.id, date="2024-01-01", amount=-10.0, description="Coffee",
        hash_fingerprint="fp-1",
    )
    db_session.add(txn)
    db_session.commit()

    with pytest.raises(AccountHasTransactionsError):
        AccountService.delete_account(db_session, account.id)

    assert db_session.query(Account).filter(Account.id == account.id).first() is not None


def test_delete_account_with_force_removes_transactions_and_training_data(db_session, account):
    txn = Transaction(
        account_id=account.id, date="2024-01-01", amount=-10.0, description="Coffee",
        hash_fingerprint="fp-1",
    )
    db_session.add(txn)
    db_session.commit()
    db_session.add(TrainingData(transaction_id=txn.id, original_label="other", corrected_label="groceries"))
    db_session.commit()
    txn_id = txn.id  # capture before deletion expunges the ORM object

    deleted_count = AccountService.delete_account(db_session, account.id, force=True)

    assert deleted_count == 1
    assert db_session.query(Account).filter(Account.id == account.id).first() is None
    assert db_session.query(Transaction).filter(Transaction.id == txn_id).first() is None
    assert db_session.query(TrainingData).filter(TrainingData.transaction_id == txn_id).first() is None


def test_delete_account_with_coverage_flags(db_session, account):
    # Regression test: AccountCoverageFlag.account_id is also a NOT NULL FK
    # with no cascade configured, same hazard already fixed for Card above.
    db_session.add(AccountCoverageFlag(account_id=account.id, month="2024-03", status="missing"))
    db_session.commit()

    deleted_count = AccountService.delete_account(db_session, account.id)

    assert deleted_count == 0
    assert db_session.query(Account).filter(Account.id == account.id).first() is None
    assert db_session.query(AccountCoverageFlag).filter(AccountCoverageFlag.account_id == account.id).first() is None


def test_delete_unknown_account_raises(db_session):
    with pytest.raises(AccountNotFoundError):
        AccountService.delete_account(db_session, "missing-id")


def test_add_card_registers_a_card_to_an_account(db_session, account):
    card = AccountService.add_card(db_session, account.id, "****9948")
    assert card.account_id == account.id
    assert card.card_number == "****9948"
    assert db_session.query(Card).filter(Card.account_id == account.id).count() == 1


def test_add_card_keeps_old_cards_when_a_new_one_is_added(db_session, account):
    AccountService.add_card(db_session, account.id, "****1111")
    AccountService.add_card(db_session, account.id, "****2222")

    cards = db_session.query(Card).filter(Card.account_id == account.id).all()
    assert {c.card_number for c in cards} == {"****1111", "****2222"}


def test_add_duplicate_card_to_same_account_raises(db_session, account):
    AccountService.add_card(db_session, account.id, "****9948")
    with pytest.raises(CardAlreadyExistsError):
        AccountService.add_card(db_session, account.id, "****9948")


def test_add_card_to_unknown_account_raises(db_session):
    with pytest.raises(AccountNotFoundError):
        AccountService.add_card(db_session, "missing-id", "****9948")


def test_remove_card(db_session, account):
    card = AccountService.add_card(db_session, account.id, "****9948")
    AccountService.remove_card(db_session, card.id)
    assert db_session.query(Card).filter(Card.id == card.id).first() is None


def test_remove_unknown_card_raises(db_session):
    with pytest.raises(CardNotFoundError):
        AccountService.remove_card(db_session, "missing-id")
