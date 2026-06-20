from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
from app.db.database import get_db
from app.models.schemas import (
    UploadRequest, TransactionResponse, TransactionUpdate,
    AccountCreate, AccountResponse, AnalyticsSummary, TrainingDataCreate
)
from app.services.transaction_service import TransactionService
from app.services.normalization import normalize_transaction, should_skip_row
from app.services.format_service import get_mapping_for_format, suggest_mapping, read_csv_rows
from app.models.transaction import Account, Transaction, TrainingData

router = APIRouter(prefix="/api/v1", tags=["transactions"])

@router.post("/accounts", response_model=AccountResponse)
def create_account(account: AccountCreate, db: Session = Depends(get_db)):
    """Create a new account"""
    db_account = Account(**account.dict())
    db.add(db_account)
    db.commit()
    db.refresh(db_account)
    return db_account

@router.get("/accounts", response_model=list[AccountResponse])
def list_accounts(db: Session = Depends(get_db)):
    """List all accounts"""
    return db.query(Account).all()

@router.post("/upload")
def upload_csv(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Upload and process CSV file.
    Headers should be properly labeled or format auto-detected.
    """
    try:
        contents = file.file.read()
        rows = read_csv_rows(contents)

        if not rows:
            raise HTTPException(status_code=400, detail="Empty CSV file")

        # Suggest format mapping
        suggestion = suggest_mapping(list(rows[0].keys()))
        
        return {
            "status": "preview_ready",
            "row_count": len(rows),
            "detected_format": suggestion["detected_format"],
            "suggested_mapping": suggestion["mapping"],
            "sample_row": rows[0] if rows else None
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/transactions/normalize")
def normalize_transactions(
    request: UploadRequest,
    db: Session = Depends(get_db)
):
    """
    Normalize and ingest transactions.
    Requires account to exist first.
    """
    # Verify account exists
    account = db.query(Account).filter(Account.id == request.account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    
    # Get format mapping
    mapping = get_mapping_for_format(request.bank_format)
    
    created = 0
    duplicates = 0
    skipped = 0
    errors = []

    for row in request.data:
        if should_skip_row(row, mapping):
            skipped += 1
            continue
        try:
            normalized = normalize_transaction(row, mapping, request.account_id)
            transaction = TransactionService.create_transaction(db, normalized)
            if transaction:
                created += 1
        except ValueError as e:
            duplicates += 1
        except Exception as e:
            errors.append(str(e))

    return {
        "created": created,
        "duplicates": duplicates,
        "skipped": skipped,
        "errors": errors,
        "status": "success"
    }

@router.get("/transactions", response_model=list[TransactionResponse])
def list_transactions(
    account_id: str = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db)
):
    """List transactions"""
    return TransactionService.get_transactions(db, account_id, limit, offset)

@router.get("/transactions/review", response_model=list[TransactionResponse])
def get_review_transactions(
    limit: int = 50,
    db: Session = Depends(get_db)
):
    """Get transactions pending review (no final category)"""
    return TransactionService.get_transactions_for_review(db, limit)

@router.patch("/transactions/{transaction_id}", response_model=TransactionResponse)
def update_transaction(
    transaction_id: str,
    update: TransactionUpdate,
    db: Session = Depends(get_db)
):
    """Update transaction details and category"""
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    if update.category_final:
        transaction = TransactionService.update_transaction_category(
            db, transaction_id, update.category_final
        )
    
    if update.merchant is not None:
        transaction.merchant = update.merchant
        transaction.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(transaction)
    
    return transaction

@router.get("/analytics/summary")
def get_analytics_summary(
    account_id: str = None,
    db: Session = Depends(get_db)
):
    """Get analytics summary"""
    return TransactionService.get_analytics_summary(db, account_id)

@router.get("/analytics/breakdown")
def get_category_breakdown(
    account_id: str = None,
    db: Session = Depends(get_db)
):
    """Get category breakdown"""
    return TransactionService.get_category_breakdown(db, account_id)

@router.get("/analytics/trends")
def get_monthly_trends(
    account_id: str = None,
    db: Session = Depends(get_db)
):
    """Get monthly trends"""
    return TransactionService.get_monthly_trends(db, account_id)

@router.post("/ml/retrain")
def retrain_model(db: Session = Depends(get_db)):
    """Retrain ML model with user corrections"""
    from app.services.ml_service import predictor
    
    training_data = db.query(TrainingData).all()
    if not training_data:
        return {"status": "no_training_data"}
    
    # Extract description and corrected label
    data = []
    for td in training_data:
        transaction = db.query(Transaction).filter(
            Transaction.id == td.transaction_id
        ).first()
        if transaction:
            data.append((transaction.description, td.corrected_label))
    
    if data:
        predictor.retrain(data)
    
    return {"status": "retrained", "samples": len(data)}
