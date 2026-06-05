from sqlalchemy.orm import Session
from app.models.transaction import Transaction, TrainingData, Account
from app.models.schemas import TransactionCreate, TransactionResponse
from app.services.ml_service import predictor
from datetime import datetime
import json

class TransactionService:
    @staticmethod
    def create_transaction(db: Session, transaction_data: dict) -> Transaction:
        """Create a new transaction with ML prediction"""
        
        # Check for duplicate
        existing = db.query(Transaction).filter(
            Transaction.hash_fingerprint == transaction_data["hash_fingerprint"]
        ).first()
        
        if existing:
            return existing
        
        # Predict category
        category, confidence = predictor.predict(transaction_data["description"])
        
        # Create transaction
        db_transaction = Transaction(
            account_id=transaction_data["account_id"],
            date=transaction_data["date"],
            amount=transaction_data["amount"],
            currency=transaction_data.get("currency", "USD"),
            description=transaction_data["description"],
            merchant=transaction_data.get("merchant"),
            raw_source=transaction_data.get("raw_source"),
            hash_fingerprint=transaction_data["hash_fingerprint"],
            category_predicted=category,
            category_confidence=confidence,
        )
        
        db.add(db_transaction)
        db.commit()
        db.refresh(db_transaction)
        
        return db_transaction
    
    @staticmethod
    def get_transactions(db: Session, account_id: str = None, limit: int = 100, offset: int = 0):
        """Get transactions with optional filtering"""
        query = db.query(Transaction)
        
        if account_id:
            query = query.filter(Transaction.account_id == account_id)
        
        return query.order_by(Transaction.date.desc()).limit(limit).offset(offset).all()
    
    @staticmethod
    def get_transactions_for_review(db: Session, limit: int = 50):
        """Get transactions without final category for review"""
        return db.query(Transaction).filter(
            Transaction.category_final == None
        ).order_by(Transaction.category_confidence.asc()).limit(limit).all()
    
    @staticmethod
    def update_transaction_category(db: Session, transaction_id: str, category: str) -> Transaction:
        """Update transaction category and create training data"""
        transaction = db.query(Transaction).filter(Transaction.id == transaction_id).first()
        
        if not transaction:
            raise ValueError(f"Transaction {transaction_id} not found")
        
        # Record training data
        if transaction.category_predicted != category:
            training = TrainingData(
                transaction_id=transaction_id,
                original_label=transaction.category_predicted or "unknown",
                corrected_label=category
            )
            db.add(training)
        
        transaction.category_final = category
        transaction.updated_at = datetime.utcnow()
        
        db.commit()
        db.refresh(transaction)
        
        return transaction
    
    @staticmethod
    def get_analytics_summary(db: Session, account_id: str = None):
        """Get analytics summary"""
        query = db.query(Transaction)
        
        if account_id:
            query = query.filter(Transaction.account_id == account_id)
        
        transactions = query.all()
        
        total = len(transactions)
        income = sum(t.amount for t in transactions if t.amount > 0)
        expenses = sum(abs(t.amount) for t in transactions if t.amount < 0)
        average = sum(t.amount for t in transactions) / total if total > 0 else 0
        
        categories = set()
        for t in transactions:
            if t.category_final:
                categories.add(t.category_final)
            elif t.category_predicted:
                categories.add(t.category_predicted)
        
        return {
            "total_transactions": total,
            "total_income": income,
            "total_expenses": expenses,
            "average_transaction": average,
            "categories_used": list(categories)
        }
    
    @staticmethod
    def get_category_breakdown(db: Session, account_id: str = None):
        """Get breakdown by category"""
        query = db.query(Transaction)
        
        if account_id:
            query = query.filter(Transaction.account_id == account_id)
        
        transactions = query.all()
        breakdown = {}
        
        for t in transactions:
            cat = t.category_final or t.category_predicted or "uncategorized"
            if cat not in breakdown:
                breakdown[cat] = {"count": 0, "total": 0}
            breakdown[cat]["count"] += 1
            breakdown[cat]["total"] += t.amount
        
        return breakdown
    
    @staticmethod
    def get_monthly_trends(db: Session, account_id: str = None):
        """Get monthly income/expense trends"""
        query = db.query(Transaction)
        
        if account_id:
            query = query.filter(Transaction.account_id == account_id)
        
        transactions = query.all()
        trends = {}
        
        for t in transactions:
            month = t.date[:7]  # YYYY-MM
            if month not in trends:
                trends[month] = {"income": 0, "expenses": 0}
            
            if t.amount > 0:
                trends[month]["income"] += t.amount
            else:
                trends[month]["expenses"] += abs(t.amount)
        
        return dict(sorted(trends.items()))
