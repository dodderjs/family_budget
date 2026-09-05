from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class TransactionBase(BaseModel):
    date: str
    amount: float
    currency: str = "HUF"
    description: str
    merchant: Optional[str] = None
    type: Optional[str] = None
    account_id: str

class TransactionCreate(TransactionBase):
    raw_source: Optional[str] = None

class TransactionUpdate(BaseModel):
    category_final: Optional[str] = None
    merchant: Optional[str] = None

class TransferPairUpdate(BaseModel):
    # The account the transaction should be paired with as a transfer; null
    # clears any existing pairing (the transaction isn't a transfer).
    account_id: Optional[str] = None

class TransactionResponse(TransactionBase):
    id: str
    hash_fingerprint: str
    category_predicted: Optional[str]
    category_confidence: Optional[float]
    category_final: Optional[str]
    is_transfer: bool
    transfer_match_id: Optional[str]
    # The account_id to show/edit in the Transfer column - either the other
    # side of a matched transfer_match_id pairing, or a one-sided
    # transfer_account_id when no real counterpart transaction exists.
    # Attached by TransactionService at query time (see
    # _attach_transfer_pair_accounts) so the Review page can show/edit it
    # without an extra fetch per row.
    transfer_match_account_id: Optional[str] = None
    card_hint: Optional[str] = None
    is_duplicate: bool = False
    duplicate_of_id: Optional[str] = None
    original_amount: Optional[float] = None
    exchange_rate: Optional[float] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class TransactionListResponse(BaseModel):
    items: list[TransactionResponse]
    total: int

class AccountCreate(BaseModel):
    name: str
    account_number: str
    type: Optional[str] = None  # Credit, Debit, Saving, Prepaid, Curve, etc.

    class Config:
        json_schema_extra = {
            "example": {
                "name": "My Checking Account",
                "account_number": "****1234",
                "type": "Checking"
            }
        }

class AccountUpdate(BaseModel):
    name: Optional[str] = None
    account_number: Optional[str] = None
    type: Optional[str] = None

class CardCreate(BaseModel):
    card_number: str

class CardResponse(BaseModel):
    id: str
    account_id: str
    card_number: str
    created_at: datetime

    class Config:
        from_attributes = True

class AccountResponse(BaseModel):
    id: str
    name: str
    account_number: str
    type: Optional[str] = None
    created_at: datetime
    cards: list[CardResponse] = []

    class Config:
        from_attributes = True

class UploadRequest(BaseModel):
    account_id: str
    bank_format: str  # e.g., "bank_a", "bank_b"
    data: list[dict]  # Parsed CSV rows

class NormalizeRequest(BaseModel):
    data: list[dict]
    mapping: dict  # Field mapping configuration
    account_id: str
    bank_name: str

class AnalyticsSummary(BaseModel):
    total_transactions: int
    total_income: float
    total_expenses: float
    average_transaction: float
    total_transferred: float = 0.0
    categories_used: list[str]

class TrainingDataCreate(BaseModel):
    transaction_id: str
    corrected_label: str


class RetrainModelResponse(BaseModel):
    status: str
    trained_samples_total: int = 0
    trained_samples_selected: int = 0

class CoverageMonthEntry(BaseModel):
    month: str
    transaction_count: int
    status: str  # covered | gap | missing | dismissed

class AccountCoverageResponse(BaseModel):
    account_id: str
    first_date: Optional[str] = None
    last_date: Optional[str] = None
    months: list[CoverageMonthEntry] = []

class CoverageFlagUpdate(BaseModel):
    status: str  # missing | dismissed | gap

class CategoryCreate(BaseModel):
    label: str
    # None creates a main (group) category; set, creates a leaf under that
    # main - see CategoryService.create_leaf_category for validation.
    parent_id: Optional[str] = None
    is_income: Optional[bool] = None

class CategoryUpdate(BaseModel):
    label: Optional[str] = None
    is_income: Optional[bool] = None
    requires_transfer_account: Optional[bool] = None
    parent_id: Optional[str] = None

class CategoryResponse(BaseModel):
    id: str
    key: str
    label: str
    parent_id: Optional[str] = None
    sign: Optional[str] = None
    requires_transfer_account: bool = False
    is_income: Optional[bool] = None
    ml_index: Optional[int] = None
    # How many transactions have category_final actually set to this leaf -
    # attached by CategoryService.list_categories at query time. Always 0
    # for mains (never assigned to a transaction directly).
    transaction_count: int = 0
    created_at: datetime

    class Config:
        from_attributes = True
