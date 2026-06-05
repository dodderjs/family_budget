---
name: "Database & Schema Modifications"
description: "Use when: adding database tables, modifying schemas, running migrations, or optimizing queries. Covers SQLAlchemy, Alembic, and MariaDB management."
applyTo: "backend/app/models/transaction.py,backend/app/db/**/*.py,backend/alembic/**/*.py"
---

# Database & Schema Development Guide

## Quick Rules

1. **All models inherit from `Base`** - For Alembic to track
2. **Add new columns to models first** - Before migration
3. **Generate migration** - `alembic revision --autogenerate`
4. **Review migration code** - Ensure correct SQL
5. **Apply migration** - `alembic upgrade head`
6. **Always commit after writes** - `db.commit()`
7. **Use transactions for multi-step** - Try/catch with rollback

---

## Project Structure

```
backend/
├── app/
│   ├── models/
│   │   └── transaction.py       # SQLAlchemy ORM models
│   └── db/
│       └── database.py          # Engine & session setup
└── alembic/                     # Migration management
    ├── env.py
    ├── script.py_mako
    └── versions/                # Migration files
```

---

## Current State: Lazy Schema Creation

**⚠️ Important**: Currently, tables are created at startup via SQLAlchemy ORM (`Base.metadata.create_all()`), **NOT via Alembic migrations**.

### Current Approach
- Database schema defined in Python models (`backend/app/models/`)
- Tables auto-created on first app startup
- No migration history tracked
- Alembic folder exists but `alembic/versions/` is empty

### Limitations
- ❌ Production deployments unversioned (rollback impossible)
- ❌ Multi-environment schema conflicts
- ❌ No audit trail of schema changes
- ❌ Difficult to coordinate schema and code releases

### Future Path (Recommended)
1. Initialize Alembic migrations (see "Alembic Setup" below)
2. Migrate to database-first approach
3. Never use `metadata.create_all()` in production

---

## Alembic Setup & Migration Workflow

### Initial Setup (One-time)

The project has Alembic configured, but needs initial migration snapshot:

```bash
# 1. Start services
docker-compose up -d

# 2. Initialize Alembic (already done, but for reference)
# alembic init backend/alembic

# 3. Create initial migration snapshot (captures current schema)
cd backend
alembic revision --autogenerate -m "Initial schema snapshot"

# 4. Apply to database
alembic upgrade head

# 5. Verify
alembic history  # Shows migration history
alembic current  # Shows current revision
```

### Migration Workflow

**For every schema change**:

1. **Modify model** in `backend/app/models/transaction.py`
2. **Generate migration**:
   ```bash
   cd backend
   docker-compose exec backend alembic revision --autogenerate -m "Description of change"
   ```
3. **Review** generated file in `alembic/versions/`:
   ```python
   def upgrade() -> None:
       op.add_column(...)
   
   def downgrade() -> None:
       op.drop_column(...)
   ```
4. **Test locally**:
   ```bash
   docker-compose exec backend alembic upgrade head
   ```
5. **Verify in DB**:
   ```bash
   docker-compose exec mariadb mysql -u budget_user -p family_budget
   DESCRIBE transactions;
   ```

### Rollback

```bash
# Rollback one migration
alembic downgrade -1

# Rollback to specific revision
alembic downgrade 2024_05_17_xxxxx

# Check history
alembic history
```

### Common Issues

**Issue**: Alembic detects spurious changes
```python
# Solution: Remove `server_default` if unnecessary
# or add to Alembic's ignore list in `alembic/env.py`:
def include_object(object, name, type_, reflected, compare_to):
    if type_ == "server_default":
        return False
    return True
```

**Issue**: Migration fails with "table already exists"
```bash
# Check migration history
alembic history

# Mark current schema as migrated (don't re-run)
alembic stamp head
```

**Issue**: Foreign key constraint errors
```python
# Ensure ForeignKey defined in model:
account_id = Column(String(36), ForeignKey("accounts.id"))
# Then regenerate migration
```

---

## Current Schema

### Models

**Account**
```python
class Account(Base):
    __tablename__ = "accounts"
    
    id: str (UUID)
    name: str
    bank_name: str
    created_at: datetime
    
    relationships:
    - transactions: List[Transaction]
```

**Transaction**
```python
class Transaction(Base):
    __tablename__ = "transactions"
    
    id: str (UUID)
    account_id: str (FK → Account)
    date: str (YYYY-MM-DD)
    amount: float
    currency: str (e.g., "USD")
    description: str
    merchant: str (nullable)
    raw_source: str (nullable, full JSON)
    hash_fingerprint: str (UNIQUE)
    category_predicted: str
    category_confidence: float
    category_final: str
    is_transfer: bool
    transfer_match_id: str (nullable)
    created_at: datetime
    updated_at: datetime
    
    relationships:
    - account: Account
```

**Category**
```python
class Category(Base):
    __tablename__ = "categories"
    
    id: str (UUID)
    name: str (UNIQUE)
    created_at: datetime
```

**TrainingData**
```python
class TrainingData(Base):
    __tablename__ = "training_data"
    
    id: str (UUID)
    transaction_id: str (FK → Transaction)
    original_label: str
    corrected_label: str
    created_at: datetime
```

---

## Adding a New Column

### Step 1: Update Model
Edit `backend/app/models/transaction.py`:

```python
from sqlalchemy import Column, String, Boolean, DateTime
from datetime import datetime

class Transaction(Base):
    __tablename__ = "transactions"
    
    # existing columns...
    
    # NEW COLUMN
    notes = Column(String(500), nullable=True)
    is_reconciled = Column(Boolean, default=False)
    reconciled_at = Column(DateTime, nullable=True)
```

### Step 2: Generate Migration
```bash
cd backend

# Alembic auto-detects model changes
alembic revision --autogenerate -m "Add notes and reconciliation fields"

# Review generated file in alembic/versions/
# Example: alembic/versions/2024_05_17_xxxxx_add_notes_and_reconciliation.py
```

### Step 3: Review Migration
Check `alembic/versions/xxxx_*.py`:

```python
def upgrade() -> None:
    op.add_column('transactions', 
        sa.Column('notes', sa.String(500), nullable=True))
    op.add_column('transactions',
        sa.Column('is_reconciled', sa.Boolean(), server_default='0', 
                  nullable=False))
    op.add_column('transactions',
        sa.Column('reconciled_at', sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column('transactions', 'reconciled_at')
    op.drop_column('transactions', 'is_reconciled')
    op.drop_column('transactions', 'notes')
```

### Step 4: Apply Migration
```bash
# Run all pending migrations
alembic upgrade head

# Verify in DB
docker-compose exec mariadb mysql -u budget_user -p family_budget
DESCRIBE transactions;  # See new columns
```

---

## Adding a New Table

### Step 1: Create Model
Add to `backend/app/models/transaction.py`:

```python
class Reconciliation(Base):
    __tablename__ = "reconciliations"
    
    id = Column(String(36), primary_key=True, 
                default=lambda: str(uuid.uuid4()))
    transaction_id = Column(String(36), ForeignKey("transactions.id"), 
                            nullable=False)
    reconciled_by = Column(String(255))
    reconciliation_date = Column(DateTime, default=datetime.utcnow)
    notes = Column(Text)
    
    transaction = relationship("Transaction")
```

### Step 2: Generate & Apply
```bash
alembic revision --autogenerate -m "Add reconciliations table"
alembic upgrade head
```

### Step 3: Use in Code
```python
from app.models.transaction import Reconciliation

# Create
recon = Reconciliation(
    transaction_id="...",
    reconciled_by="admin",
    notes="Manual review completed"
)
db.add(recon)
db.commit()

# Query
reconciled = db.query(Reconciliation).filter(
    Reconciliation.transaction_id == tx_id
).first()
```

---

## Common Patterns

### Query with Filtering
```python
from sqlalchemy import and_, or_

# AND condition
results = db.query(Transaction).filter(
    and_(
        Transaction.amount > 0,
        Transaction.account_id == account_id
    )
).all()

# OR condition
results = db.query(Transaction).filter(
    or_(
        Transaction.category_predicted == "groceries",
        Transaction.category_predicted == "utilities"
    )
).all()

# IN clause
categories = ["groceries", "utilities"]
results = db.query(Transaction).filter(
    Transaction.category_predicted.in_(categories)
).all()
```

### Aggregation Queries
```python
from sqlalchemy import func

# Count
count = db.query(func.count(Transaction.id)).scalar()

# Sum
total = db.query(func.sum(Transaction.amount)).scalar()

# Group by with aggregates
breakdown = db.query(
    Transaction.category_final,
    func.count(Transaction.id).label('count'),
    func.sum(Transaction.amount).label('total'),
    func.avg(Transaction.amount).label('avg')
).group_by(Transaction.category_final).all()

# Format result
for category, count, total, avg in breakdown:
    print(f"{category}: {count} items, ${total:.2f} total")
```

### Ordering & Pagination
```python
# Simple ordering
query = db.query(Transaction).order_by(Transaction.date.desc()).all()

# Pagination
limit = 25
offset = page * limit
results = db.query(Transaction).limit(limit).offset(offset).all()

# Combined
results = db.query(Transaction)\
    .order_by(Transaction.date.desc())\
    .limit(25)\
    .offset(0)\
    .all()
```

### Updating Multiple Records
```python
# Update all matching
db.query(Transaction).filter(
    Transaction.account_id == old_account_id
).update({
    Transaction.account_id: new_account_id
})
db.commit()

# Update with logic
from datetime import datetime
db.query(Transaction).filter(
    Transaction.category_final == None
).update({
    Transaction.category_final: "other"
}, synchronize_session=False)
db.commit()
```

### Bulk Insert
```python
transactions = [
    Transaction(...),
    Transaction(...),
    Transaction(...),
]
db.add_all(transactions)
db.commit()
```

---

## Database Connection

### Location
`backend/app/db/database.py`

```python
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "mysql+pymysql://budget_user:budget_password@localhost:3306/family_budget"
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,  # Validate connections
    connect_args={"charset": "utf8mb4"}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

### Direct Connection
```python
from app.db.database import engine, SessionLocal

# Create session
db = SessionLocal()

try:
    # Query
    result = db.query(Transaction).first()
    print(result)
finally:
    db.close()
```

---

## Performance Optimization

### Adding Indexes
In model:
```python
class Transaction(Base):
    __tablename__ = "transactions"
    
    id = Column(String(36), primary_key=True)
    account_id = Column(String(36), ForeignKey("accounts.id"), 
                       index=True)  # ← Index on FK
    date = Column(String(10), index=True)  # ← Index on frequently filtered
    hash_fingerprint = Column(String(64), unique=True)  # ← Unique also indexes
```

Generate migration:
```bash
alembic revision --autogenerate -m "Add indexes on account_id and date"
alembic upgrade head
```

### Query Optimization
```python
# BEFORE: N+1 query problem
transactions = db.query(Transaction).all()
for tx in transactions:
    print(tx.account.name)  # ← Extra query for each transaction!

# AFTER: Use joinedload
from sqlalchemy.orm import joinedload
transactions = db.query(Transaction).options(
    joinedload(Transaction.account)
).all()
for tx in transactions:
    print(tx.account.name)  # ← No extra queries
```

---

## Backup & Restore

### Backup
```bash
# Via docker
docker-compose exec mariadb mysqldump \
  -u budget_user -p family_budget > backup.sql

# Verify size
ls -lh backup.sql
```

### Restore
```bash
# Via docker
docker-compose exec mariadb mysql \
  -u budget_user -p family_budget < backup.sql

# Verify
docker-compose exec mariadb mysql -u budget_user -p \
  -e "SELECT COUNT(*) FROM transactions;"
```

---

## Debugging Queries

### Print Generated SQL
```python
from sqlalchemy.dialects import mysql

query = db.query(Transaction).filter(
    Transaction.account_id == "123"
)
print(query.statement.compile(dialect=mysql.dialect()))

# Output:
# SELECT transactions.id, ...
# FROM transactions
# WHERE transactions.account_id = :account_id_1
```

### Slow Query Log
```bash
# Connect to DB
docker-compose exec mariadb mysql -u root -p

# Enable slow query log
SET GLOBAL slow_query_log = 'ON';
SET GLOBAL long_query_time = 1;

# Later view slow queries
SELECT * FROM mysql.slow_log;
```

### Connection Pool Stats
```python
from app.db.database import engine

pool = engine.pool
print(f"Pool size: {pool.size()}")
print(f"Checked in: {pool.checkedin()}")
print(f"Checked out: {pool.checkedout()}")
```

---

## Testing with Database

### Using TestClient
```python
from fastapi.testclient import TestClient
from app.main import app
from app.db.database import SessionLocal

client = TestClient(app)

def test_create_transaction():
    # POST request
    response = client.post(
        "/api/v1/transactions/normalize",
        json={
            "account_id": "test-account",
            "bank_format": "bank_a",
            "data": [{...}]
        }
    )
    
    assert response.status_code == 200
    
    # Verify in DB
    db = SessionLocal()
    tx = db.query(Transaction).filter(...).first()
    assert tx is not None
    db.close()
```

---

## Common Issues

### Issue: Migration Conflicts
**Symptom**: `alembic revision --autogenerate` says models changed but no migration

**Solution**:
```bash
# Check current DB state
alembic current

# View migration history
alembic history --verbose

# Revert recent
alembic downgrade -1

# Regenerate
alembic revision --autogenerate
```

### Issue: Foreign Key Constraint Error
**Symptom**: `IntegrityError: FOREIGN KEY constraint failed`

**Cause**: Deleting or updating parent before children

**Solution**:
```python
# Delete children first
db.query(TrainingData).filter(
    TrainingData.transaction_id == tx_id
).delete()

# Then delete parent
db.query(Transaction).filter(
    Transaction.id == tx_id
).delete()

db.commit()
```

### Issue: Charset/Encoding Errors
**Symptom**: `UnicodeEncodeError` when saving non-ASCII

**Solution**: Already configured in `database.py`:
```python
connect_args={"charset": "utf8mb4"}  # ← Handles emoji, special chars
```

---

## Reference

**Model Reference**: `backend/app/models/transaction.py`
**Database Reference**: `data/SCHEMA.md`
**Alembic Docs**: https://alembic.sqlalchemy.org/
**SQLAlchemy Docs**: https://docs.sqlalchemy.org/

