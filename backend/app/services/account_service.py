from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.models.transaction import Account, Card, Transaction, TrainingData, AccountCoverageFlag


class AccountNotFoundError(Exception):
    """Raised when an account_id doesn't match any existing account."""


class AccountHasTransactionsError(Exception):
    """Raised when deleting an account with transactions is attempted without force=True."""

    def __init__(self, transaction_count: int):
        self.transaction_count = transaction_count
        super().__init__(f"Account has {transaction_count} transaction(s)")


class CardNotFoundError(Exception):
    """Raised when a card_id doesn't match any existing card."""


class CardAlreadyExistsError(Exception):
    """Raised when a card number is already registered to the given account."""

    def __init__(self, card_number: str):
        self.card_number = card_number
        super().__init__(f"Card {card_number!r} is already registered to this account")


class AccountService:
    @staticmethod
    def update_account(db: Session, account_id: str, name: str = None, account_number: str = None, type: str = None) -> Account:
        account = db.query(Account).filter(Account.id == account_id).first()
        if not account:
            raise AccountNotFoundError(account_id)

        if name is not None:
            account.name = name
        if account_number is not None:
            account.account_number = account_number
        if type is not None:
            account.type = type

        db.commit()
        db.refresh(account)
        return account

    @staticmethod
    def delete_account(db: Session, account_id: str, force: bool = False) -> int:
        """Delete an account. Returns the number of transactions deleted with it.
        Raises AccountHasTransactionsError if it has transactions and force is False."""
        account = db.query(Account).filter(Account.id == account_id).first()
        if not account:
            raise AccountNotFoundError(account_id)

        transaction_ids = [t.id for t in db.query(Transaction.id).filter(Transaction.account_id == account_id).all()]
        if transaction_ids and not force:
            raise AccountHasTransactionsError(len(transaction_ids))

        if transaction_ids:
            db.query(TrainingData).filter(TrainingData.transaction_id.in_(transaction_ids)).delete(synchronize_session="fetch")
            db.query(Transaction).filter(Transaction.account_id == account_id).delete(synchronize_session="fetch")

        # Cards and coverage flags have a NOT NULL FK to accounts with no
        # cascade configured - without this, deleting the account fails
        # trying to null them out.
        db.query(Card).filter(Card.account_id == account_id).delete(synchronize_session="fetch")
        db.query(AccountCoverageFlag).filter(AccountCoverageFlag.account_id == account_id).delete(synchronize_session="fetch")

        db.delete(account)
        db.commit()
        return len(transaction_ids)

    @staticmethod
    def add_card(db: Session, account_id: str, card_number: str) -> Card:
        """Register a card to an account. Old cards are never removed
        automatically when a new one is added - history is kept so past
        transactions referencing a retired card still resolve correctly."""
        account = db.query(Account).filter(Account.id == account_id).first()
        if not account:
            raise AccountNotFoundError(account_id)

        existing = db.query(Card).filter(
            Card.account_id == account_id, Card.card_number == card_number
        ).first()
        if existing:
            raise CardAlreadyExistsError(card_number)

        card = Card(account_id=account_id, card_number=card_number)
        db.add(card)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise CardAlreadyExistsError(card_number)
        db.refresh(card)
        return card

    @staticmethod
    def remove_card(db: Session, card_id: str) -> None:
        card = db.query(Card).filter(Card.id == card_id).first()
        if not card:
            raise CardNotFoundError(card_id)
        db.delete(card)
        db.commit()
