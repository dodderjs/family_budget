from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from sqlalchemy.orm import Session
from datetime import datetime
import json
from app.db.database import get_db
from app.models.schemas import (
    UploadRequest, TransactionResponse, TransactionListResponse, TransactionUpdate, TransferPairUpdate,
    AccountCreate, AccountUpdate, AccountResponse, AnalyticsSummary, TrainingDataCreate,
    CardCreate, CardResponse, AccountCoverageResponse, CoverageFlagUpdate,
    CategoryCreate, CategoryResponse, RetrainModelResponse
)
from app.services.transaction_service import (
    TransactionService, DuplicateTransactionError, TransactionNotFoundError
)
from app.services.account_service import (
    AccountService, AccountNotFoundError, AccountHasTransactionsError,
    CardNotFoundError, CardAlreadyExistsError
)
from app.services.coverage_service import CoverageService
from app.services.category_service import CategoryService, CategoryNotFoundError, ParentMustBeMainCategoryError
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

@router.patch("/accounts/{account_id}", response_model=AccountResponse)
def update_account(account_id: str, update: AccountUpdate, db: Session = Depends(get_db)):
    """Update an account's name, account number, or type"""
    try:
        return AccountService.update_account(
            db, account_id, name=update.name, account_number=update.account_number, type=update.type
        )
    except AccountNotFoundError:
        raise HTTPException(status_code=404, detail="Account not found")

@router.delete("/accounts/{account_id}")
def delete_account(account_id: str, force: bool = False, db: Session = Depends(get_db)):
    """Delete an account. If it has transactions, requires force=true since
    that also deletes those transactions and any training data tied to them."""
    try:
        deleted = AccountService.delete_account(db, account_id, force=force)
    except AccountNotFoundError:
        raise HTTPException(status_code=404, detail="Account not found")
    except AccountHasTransactionsError as e:
        raise HTTPException(
            status_code=409,
            detail=f"Account has {e.transaction_count} transaction(s). Pass force=true to delete them too.",
        )
    return {"status": "deleted", "transactions_deleted": deleted}

@router.get("/accounts/{account_id}/coverage", response_model=AccountCoverageResponse)
def get_account_coverage(account_id: str, db: Session = Depends(get_db)):
    """Per-month transaction coverage for an account, with detected gaps and
    any user-confirmed missing/dismissed status."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    return CoverageService.get_account_coverage(db, account_id)

@router.put("/accounts/{account_id}/coverage/{month}")
def update_account_coverage_month(
    account_id: str, month: str, update: CoverageFlagUpdate, db: Session = Depends(get_db)
):
    """Mark a month as missing/dismissed, or pass status=gap to reset it
    back to an unreviewed detected gap."""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="Account not found")
    if update.status not in ("missing", "dismissed", "gap"):
        raise HTTPException(status_code=400, detail="status must be one of: missing, dismissed, gap")
    CoverageService.set_month_status(db, account_id, month, update.status)
    return {"status": "ok"}

@router.post("/accounts/{account_id}/cards", response_model=CardResponse)
def add_card(account_id: str, card: CardCreate, db: Session = Depends(get_db)):
    """Register a card to an account. Old cards aren't removed when a new
    one is added - keep them on file so past transactions still resolve."""
    try:
        return AccountService.add_card(db, account_id, card.card_number)
    except AccountNotFoundError:
        raise HTTPException(status_code=404, detail="Account not found")
    except CardAlreadyExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))

@router.delete("/accounts/{account_id}/cards/{card_id}")
def remove_card(account_id: str, card_id: str, db: Session = Depends(get_db)):
    """Remove a card from an account."""
    try:
        AccountService.remove_card(db, card_id)
    except CardNotFoundError:
        raise HTTPException(status_code=404, detail="Card not found")
    return {"status": "deleted"}

@router.get("/categories", response_model=list[CategoryResponse])
def list_categories(db: Session = Depends(get_db)):
    """List every category - mains (parent_id null) and leaves together."""
    return CategoryService.list_categories(db)

@router.post("/categories", response_model=CategoryResponse)
def create_category(category: CategoryCreate, db: Session = Depends(get_db)):
    """Create a main category (parent_id omitted) or a leaf under an
    existing main (parent_id set)."""
    try:
        if category.parent_id is None:
            return CategoryService.create_main_category(db, category.label)
        return CategoryService.create_leaf_category(db, category.label, category.parent_id)
    except CategoryNotFoundError:
        raise HTTPException(status_code=404, detail="Parent category not found")
    except ParentMustBeMainCategoryError:
        raise HTTPException(status_code=400, detail="parent_id must be a main category, not a leaf")

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
    created_dates = []

    for row in request.data:
        if should_skip_row(row, mapping):
            skipped += 1
            continue
        try:
            normalized = normalize_transaction(row, mapping, request.account_id)
            normalized["account_type"] = account.type
            TransactionService.create_transaction(db, normalized)
            created += 1
            created_dates.append(normalized["date"])
        except DuplicateTransactionError:
            duplicates += 1
        except Exception as e:
            errors.append(str(e))

    transfers_detected = TransactionService.detect_and_flag_transfers(db) if created else 0
    curve_duplicates_detected = TransactionService.detect_and_flag_curve_duplicates(db) if created else 0

    return {
        "created": created,
        "duplicates": duplicates,
        "skipped": skipped,
        "transfers_detected": transfers_detected,
        "curve_duplicates_detected": curve_duplicates_detected,
        "date_from": min(created_dates) if created_dates else None,
        "date_to": max(created_dates) if created_dates else None,
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

@router.get("/transactions/review", response_model=TransactionListResponse)
def get_review_transactions(
    limit: int = 50,
    offset: int = 0,
    account_id: str = None,
    date_from: str = None,
    date_to: str = None,
    include_finalized: bool = False,
    sort_by: str = None,
    sort_dir: str = "asc",
    filter_model: str = None,
    db: Session = Depends(get_db)
):
    """Get one page of transactions pending review (no final category by
    default; pass include_finalized=true to also show already-confirmed
    ones). sort_by/sort_dir drive the AG Grid column-header sort on the
    Review page - see _REVIEW_SORTABLE_COLUMNS for the whitelist. filter_model
    is the AG Grid per-column filterModel as a JSON string (the SSRM datasource
    sends a nested object, so it can't be a flat query param); a malformed one
    is ignored rather than failing the request - see _apply_column_filters."""
    parsed_filter = None
    if filter_model:
        try:
            parsed_filter = json.loads(filter_model)
        except (ValueError, TypeError):
            parsed_filter = None
    items, total = TransactionService.get_transactions_for_review(
        db, limit, account_id, date_from, date_to, include_finalized, offset, sort_by, sort_dir, parsed_filter
    )
    return {"items": items, "total": total}

@router.get("/transactions/{transaction_id}", response_model=TransactionResponse)
def get_transaction(transaction_id: str, db: Session = Depends(get_db)):
    """Fetch a single transaction by id - used by the review page to drill
    into a linked Curve/bank-account duplicate that isn't in the current
    review queue page (e.g. it's already finalized)."""
    transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return transaction

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

@router.patch("/transactions/{transaction_id}/transfer", response_model=TransactionResponse)
def update_transfer_pair(transaction_id: str, update: TransferPairUpdate, db: Session = Depends(get_db)):
    """Manually set or clear which account a transaction is paired with as a
    transfer - corrects detect_and_flag_transfers' greedy auto-matching when
    it picks the wrong same-amount candidate, or clears a wrong auto-match
    entirely (account_id=null)."""
    try:
        return TransactionService.set_transfer_pair(db, transaction_id, update.account_id)
    except TransactionNotFoundError:
        raise HTTPException(status_code=404, detail="Transaction not found")
    except AccountNotFoundError:
        raise HTTPException(status_code=404, detail="Account not found")

@router.get("/analytics/summary")
def get_analytics_summary(
    account_id: str = None,
    date_from: str = None,
    date_to: str = None,
    db: Session = Depends(get_db)
):
    """Get analytics summary"""
    return TransactionService.get_analytics_summary(db, account_id, date_from, date_to)

@router.get("/analytics/breakdown")
def get_category_breakdown(
    account_id: str = None,
    date_from: str = None,
    date_to: str = None,
    group_by: str = "category",
    db: Session = Depends(get_db)
):
    """Get breakdown by category, merchant, or account"""
    return TransactionService.get_category_breakdown(db, account_id, date_from, date_to, group_by)

@router.get("/analytics/trends")
def get_monthly_trends(
    account_id: str = None,
    date_from: str = None,
    date_to: str = None,
    db: Session = Depends(get_db)
):
    """Get monthly trends"""
    return TransactionService.get_monthly_trends(db, account_id, date_from, date_to)

@router.post("/ml/retrain", response_model=RetrainModelResponse)
def retrain_model(trained_samples_selected: int = 0, db: Session = Depends(get_db)):
    """Retrain ML model with user corrections"""
    from app.services.ml_service import predictor
    
    training_data = db.query(TrainingData).all()
    if not training_data:
        return {
            "status": "no_training_data",
            "trained_samples_total": 0,
            "trained_samples_selected": max(0, trained_samples_selected),
        }

    # description/amount/transaction_date are denormalized onto TrainingData at
    # creation time so a correction still trains the model after its original
    # transaction is gone (e.g. reset_data.py's transactions-only reset). Older
    # rows from before that change fall back to the join.
    data = []
    for td in training_data:
        description = td.description
        amount = td.amount
        date = td.transaction_date
        if not description and td.transaction_id:
            transaction = db.query(Transaction).filter(
                Transaction.id == td.transaction_id
            ).first()
            description = transaction.description if transaction else None
            amount = transaction.amount if transaction else None
            date = transaction.date if transaction else None
        if description:
            data.append((description, td.corrected_label, amount, date))

    if data:
        predictor.retrain(db, data)
    
    return {
        "status": "retrained",
        "trained_samples_total": len(data),
        "trained_samples_selected": max(0, trained_samples_selected),
    }
