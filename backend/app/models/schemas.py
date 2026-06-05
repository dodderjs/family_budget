from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class TransactionBase(BaseModel):
    date: str
    amount: float
    currency: str = "USD"
    description: str
    merchant: Optional[str] = None
    account_id: str

class TransactionCreate(TransactionBase):
    raw_source: Optional[str] = None

class TransactionUpdate(BaseModel):
    category_final: Optional[str] = None
    merchant: Optional[str] = None

class TransactionResponse(TransactionBase):
    id: str
    hash_fingerprint: str
    category_predicted: Optional[str]
    category_confidence: Optional[float]
    category_final: Optional[str]
    is_transfer: bool
    transfer_match_id: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class AccountCreate(BaseModel):
    name: str
    account_number: str

    class Config:
        json_schema_extra = {
            "example": {
                "name": "My Checking Account",
                "account_number": "****1234"
            }
        }

class AccountResponse(BaseModel):
    id: str
    name: str
    account_number: str
    created_at: datetime

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
    categories_used: list[str]

class TrainingDataCreate(BaseModel):
    transaction_id: str
    corrected_label: str
