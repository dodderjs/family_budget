---
name: "Backend API Development"
description: "Use when: adding/modifying FastAPI endpoints, services, or business logic. Helps with route handlers, validation, error handling, and integration with database."
applyTo: "backend/app/**/*.py"
---

# Backend API Development Guide

## Quick Rules

1. **Always use Pydantic schemas** for request/response validation
2. **Type-hint all functions** - no untyped parameters
3. **Use dependency injection** for database sessions (`Depends(get_db)`)
4. **Return proper HTTP status codes** - 200, 201, 400, 404, 500
5. **Validate before querying** - Pydantic schemas provide first layer
6. **Use services for business logic** - don't put logic in routes

---

## File Structure

```
backend/app/
├── api/
│   └── transactions.py          # Route handlers ONLY
├── services/
│   ├── transaction_service.py
│   ├── ml_service.py
│   ├── normalization.py
│   └── format_service.py        # Business logic HERE
├── models/
│   ├── transaction.py           # SQLAlchemy ORM
│   └── schemas.py               # Pydantic schemas
└── db/
    └── database.py              # Connections
```

---

## Adding an Endpoint

### 1. Define Schema (if needed)
**File**: `backend/app/models/schemas.py`

```python
class MyRequestSchema(BaseModel):
    field_name: str
    optional_field: Optional[int] = None
    
class MyResponseSchema(BaseModel):
    id: str
    field_name: str
    created_at: datetime
    
    class Config:
        from_attributes = True  # For SQLAlchemy ORM
```

### 2. Add Service Method
**File**: `backend/app/services/transaction_service.py` or relevant service

```python
@staticmethod
def my_business_logic(db: Session, param1: str) -> MyModel:
    """Docstring explaining what this does."""
    result = db.query(MyModel).filter(...).first()
    if not result:
        raise ValueError("Not found")
    # Process
    return result
```

### 3. Add Route Handler
**File**: `backend/app/api/transactions.py`

```python
@router.post("/endpoint", response_model=MyResponseSchema)
def my_endpoint(
    request: MyRequestSchema,
    db: Session = Depends(get_db)
) -> MyResponseSchema:
    """Endpoint description for auto-docs."""
    try:
        result = MyService.my_business_logic(db, request.field_name)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal error")
```

### 4. Query Parameters
```python
@router.get("/transactions")
def list_transactions(
    account_id: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db)
):
    return TransactionService.get_transactions(db, account_id, limit, offset)
```

### 5. Path Parameters
```python
@router.patch("/transactions/{transaction_id}")
def update_transaction(
    transaction_id: str,
    update: TransactionUpdate,
    db: Session = Depends(get_db)
):
    return TransactionService.update_transaction_category(
        db, transaction_id, update.category_final
    )
```

---

## Common Patterns

### Error Handling
```python
@router.post("/endpoint")
def my_endpoint(db: Session = Depends(get_db)):
    try:
        # Business logic
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except KeyError:
        raise HTTPException(status_code=404, detail="Not found")
    except Exception as e:
        print(f"Unexpected error: {e}")
        raise HTTPException(status_code=500, detail="Internal error")
```

### Query with Filters
```python
def get_transactions(
    db: Session,
    account_id: Optional[str] = None,
    limit: int = 100
):
    query = db.query(Transaction)
    
    if account_id:
        query = query.filter(Transaction.account_id == account_id)
    
    return query.order_by(Transaction.date.desc()).limit(limit).all()
```

### Update and Return
```python
def update_transaction(db: Session, tx_id: str, category: str):
    tx = db.query(Transaction).filter(Transaction.id == tx_id).first()
    if not tx:
        raise ValueError("Not found")
    
    tx.category_final = category
    tx.updated_at = datetime.utcnow()
    
    db.commit()
    db.refresh(tx)
    
    return tx
```

---

## SQLAlchemy Tips

### Query Patterns
```python
# Single result
result = db.query(Model).filter(Model.id == id).first()

# Multiple results
results = db.query(Model).filter(Model.active == True).all()

# With ordering and limit
query = db.query(Model).order_by(Model.date.desc()).limit(10).all()

# Filter multiple conditions
query = query.filter(
    (Model.amount > 0) & (Model.status == "active")
)

# Grouping (for aggregates)
by_category = db.query(
    Transaction.category_final,
    func.sum(Transaction.amount).label('total')
).group_by(Transaction.category_final).all()
```

### Transactions & Commits
```python
# Always commit after writes
db.add(new_object)
db.commit()
db.refresh(new_object)  # Load DB-generated fields

# Changes in session but not committed
db.add(obj)
# ... not committed yet
db.rollback()  # Discard

# Multiple operations
try:
    db.add(obj1)
    db.add(obj2)
    db.commit()
except Exception:
    db.rollback()
    raise
```

---

## Testing Endpoints

### Using FastAPI TestClient
```python
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_create_account():
    response = client.post(
        "/api/v1/accounts",
        json={"name": "Test", "bank_name": "Bank"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "Test"
```

### Via curl
```bash
curl -X POST http://localhost:8000/api/v1/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","bank_name":"Bank"}'
```

### Via Swagger UI
- Navigate to http://localhost:8000/docs
- Try out endpoints directly in browser

---

## Common Mistakes

❌ **Don't put business logic in routes**
```python
# WRONG
@router.post("/endpoint")
def my_endpoint(db: Session):
    result = db.query(...).filter(...).all()  # ← Too much logic here
    return result
```

✅ **Do move it to service**
```python
# RIGHT
@router.post("/endpoint")
def my_endpoint(db: Session):
    result = MyService.get_something(db)
    return result

# In service:
class MyService:
    @staticmethod
    def get_something(db: Session):
        return db.query(...).filter(...).all()
```

❌ **Don't forget to commit writes**
```python
# WRONG - data not saved
db.add(obj)
# Missing: db.commit()
```

❌ **Don't mix HTTP errors with database errors**
```python
# WRONG
raise ValueError("field is required")  # ← User sees 500, not 400

# RIGHT
raise HTTPException(status_code=400, detail="field is required")
```

---

## Debugging

### Print Debugging
```python
import logging
logger = logging.getLogger(__name__)

logger.debug(f"Query result: {result}")
logger.error(f"Error: {e}")
```

### Database Debugging
```python
# Print generated SQL
from sqlalchemy.dialects import mysql
query = db.query(Transaction).filter(...)
print(query.statement.compile(dialect=mysql.dialect()))
```

### Remote Debugging
- Backend already configured with debugpy on port 5678
- Set breakpoint in VSCode and run: Python: Remote Attach

---

**Example**: See `/backend/app/api/transactions.py` for all current endpoints
