from sqlalchemy.orm import Session
from app.models.transaction import Transaction, TrainingData
from app.services.ml_service import predictor


def reset_all_transaction_data(db: Session, reset_training: bool = True) -> dict:
    """Delete all transactions, and reset accounts to a clean transaction
    slate. Accounts are left untouched either way.

    reset_training controls whether learned corrections go too: True deletes
    TrainingData and reverts the model to its bare seed baseline (useful when
    testing categorization logic itself). False leaves TrainingData and the
    current model alone, so months of accumulated review corrections aren't
    wiped just because the transactions they were attached to were deleted for
    a re-import."""
    training_deleted = 0
    if reset_training:
        training_deleted = db.query(TrainingData).delete()
    else:
        # transaction_id is a FK to transactions - null it out first so
        # deleting every transaction below doesn't violate that constraint.
        # TrainingData.description (denormalized at write time) is all
        # retrain() actually needs, so the rows stay fully usable.
        db.query(TrainingData).update({TrainingData.transaction_id: None})

    transactions_deleted = db.query(Transaction).delete()
    db.commit()

    if reset_training:
        predictor.reset_to_baseline(db)

    return {"transactions_deleted": transactions_deleted, "training_data_deleted": training_deleted}
