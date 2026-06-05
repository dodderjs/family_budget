# Database models
from sqlalchemy import Column, String, DateTime, Float, Boolean, ForeignKey, Integer, Text
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
from app.db.database import Base

class Account(Base):
    __tablename__ = "accounts"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    account_number = Column(String(100), nullable=False, unique=True)
    type = Column(String(50), nullable=True)  # Credit, Debit, Saving, Prepaid, Curve, etc.
    created_at = Column(DateTime, default=datetime.utcnow)
    
    transactions = relationship("Transaction", back_populates="account")

class Transaction(Base):
    __tablename__ = "transactions"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id = Column(String(36), ForeignKey("accounts.id"), nullable=False)
    date = Column(String(10), nullable=False)  # ISO format YYYY-MM-DD
    amount = Column(Float, nullable=False)
    currency = Column(String(3), default="USD")
    description = Column(String(500), nullable=False)
    merchant = Column(String(255), nullable=True)
    raw_source = Column(Text, nullable=True)
    hash_fingerprint = Column(String(64), unique=True, nullable=False)
    category_predicted = Column(String(50), nullable=True)
    category_confidence = Column(Float, nullable=True)
    category_final = Column(String(50), nullable=True)
    is_transfer = Column(Boolean, default=False)
    transfer_match_id = Column(String(36), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    account = relationship("Account", back_populates="transactions")

class Category(Base):
    __tablename__ = "categories"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(50), unique=True, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class TrainingData(Base):
    __tablename__ = "training_data"
    
    id = Column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    transaction_id = Column(String(36), ForeignKey("transactions.id"), nullable=False)
    original_label = Column(String(50), nullable=False)
    corrected_label = Column(String(50), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
