---
name: "Family Budget Project Instructions"
description: "Use when: working on the Family Budget financial transaction analysis system. Provides project context, architecture overview, coding standards, and best practices for all development tasks."
---

# Family Budget - Copilot Instructions

> **Project**: Financial transaction analysis system with ML categorization
> **Stack**: FastAPI (Python) + React (TypeScript) + MariaDB + Docker
> **Status**: Production-ready MVP
> **Last Updated**: May 2024

---

## 🎯 Project Overview

**Family Budget** is a full-stack monorepo for processing bank transactions from multiple CSV formats, normalizing them, applying ML categorization, detecting transfers, and visualizing analytics.

### Core Problem This Solves
1. Banks export transactions in different CSV formats
2. Users need unified view across accounts
3. Automatic categorization saves manual work
4. Duplicate detection prevents data corruption
5. Analytics help visualize spending patterns

### Architecture Pattern
```
User Browser → React Frontend (Vite)
            ↓
         HTTP/REST
            ↓
      FastAPI Backend
            ↓
         SQL/ORM
            ↓
       MariaDB (Persistent)
```

---

## 📁 Project Structure

### Backend (`backend/`)
```
backend/app/
├── main.py                      # FastAPI initialization & CORS
├── api/
│   └── transactions.py          # 11 REST endpoints
├── services/
│   ├── transaction_service.py   # Business logic (CRUD, analytics)
│   ├── ml_service.py            # ML predictions (sklearn)
│   ├── normalization.py         # CSV parsing & validation
│   └── format_service.py        # Bank format detection
├── models/
│   ├── transaction.py           # SQLAlchemy ORM models (Account, Transaction, etc.)
│   └── schemas.py               # Pydantic validation schemas
└── db/
    └── database.py              # SQLAlchemy engine & session
```

### Frontend (`frontend/`)
```
frontend/src/
├── App.tsx                      # Router & header/nav
├── main.tsx                     # React entry point
├── pages/
│   ├── UploadPage.tsx           # CSV upload & preview
│   ├── ReviewPage.tsx           # Transaction categorization
│   └── AnalyticsPage.tsx        # Dashboard with charts
├── services/
│   ├── api.ts                   # Axios instance (BASE_URL)
│   ├── transactionService.ts    # API wrappers
│   └── csvService.ts            # CSV parsing utilities
├── store/
│   └── transactionStore.ts      # Zustand global state
└── utils/                       # Helpers (if needed)
```

### Configuration
```
.env                            # Environment variables (git-ignored)
docker-compose.yml              # Services orchestration
backend/requirements.txt         # Python dependencies
frontend/package.json           # Node dependencies
```

### Data & Docs
```
data/
├── bank_a_transactions.csv      # Sample data (Bank A format)
├── bank_b_transactions.csv      # Sample data (Bank B format)
└── SCHEMA.md                    # Database schema

[Documentation files in root]
├── README.md                    # Quick start
├── SETUP.md                     # Installation guide
├── DEVELOPMENT.md               # Dev workflow
├── DEPLOYMENT.md                # Production guide
├── API_REFERENCE.md             # API endpoint docs
└── CHECKLIST.md                 # Feature verification
```

---

## 🔌 API Endpoints Reference

All endpoints prefixed with `/api/v1`. Return JSON except file uploads.

### Accounts
- `POST /accounts` → Create account
- `GET /accounts` → List all accounts

### Upload & Normalize
- `POST /upload` → Parse CSV, detect format, return preview + mapping
- `POST /transactions/normalize` → Ingest normalized transactions

### Transactions
- `GET /transactions` → List with pagination, optional account filter
- `GET /transactions/review` → Get unreviewed transactions (category_final=null)
- `PATCH /transactions/{id}` → Update category + log training data

### Analytics
- `GET /analytics/summary` → Totals (income, expenses, avg, categories)
- `GET /analytics/breakdown` → Category-level aggregation
- `GET /analytics/trends` → Monthly income/expense trends

### ML
- `POST /ml/retrain` → Retrain model using user corrections

---

## 🛠️ Key Services Explained

### `TransactionService`
**Purpose**: Core transaction CRUD and analytics

**Methods**:
- `create_transaction()` - Insert with ML prediction
- `get_transactions()` - Query with filters
- `get_transactions_for_review()` - Pending categorization
- `update_transaction_category()` - Save correction + training data
- `get_analytics_summary()` - Aggregate stats
- `get_category_breakdown()` - Group by category
- `get_monthly_trends()` - Group by month

### `MLService`
**Purpose**: scikit-learn categorization pipeline

**Key Class**: `CategoryPredictor`
- `__init__()` - Load or create baseline model
- `predict()` - Return (category, confidence)
- `retrain()` - Fit new model with corrected data
- Model stored in `backend/app/ml/models/` (joblib)

**Baseline**: 22 seed transactions across 7 categories

### `NormalizationService`
**Purpose**: CSV → Standard schema

**Key Functions**:
- `normalize_transaction()` - Apply mapping, parse amounts, generate fingerprint
- `generate_fingerprint()` - SHA-256(date|amount|description|account_id)
- `detect_transfers()` - Find opposite-sign, same-amount pairs

### `FormatService`
**Purpose**: Auto-detect bank CSV formats

**Supported Formats**:
- `bank_a` - "Transaction Date", "Amount", "Description", "Merchant", "Currency"
- `bank_b` - "Date", "Debit/Credit", "Transaction", "Vendor"
- `generic` - Fallback mapping

---

## 📊 Data Model

### Transaction Fields
```python
id VARCHAR(36) PK
account_id VARCHAR(36) FK → Account
date VARCHAR(10)                    # ISO format: YYYY-MM-DD
amount FLOAT                        # Can be +/- (income/expense)
currency VARCHAR(3)                 # e.g., "USD"
description VARCHAR(500)            # Raw text from CSV
merchant VARCHAR(255)               # Optional user input/correction
hash_fingerprint VARCHAR(64) UNIQUE # Deduplication key
category_predicted VARCHAR(50)      # ML prediction
category_confidence FLOAT           # 0.0-1.0
category_final VARCHAR(50)          # User-corrected value (nullable)
is_transfer BOOLEAN                 # Detected transfer
transfer_match_id VARCHAR(36)       # Linked transaction ID
created_at DATETIME
updated_at DATETIME
```

### ML Categories
```
groceries        # Whole Foods, Supermarket, Food Market
rent             # Monthly Rent, Landlord, Property Mgmt
salary           # Paycheck, Direct Deposit, Employment
utilities        # Electric, Water, Gas, Internet, Phone
transport        # Uber, Taxi, Metro, Gas, Parking
entertainment    # Cinema, Movies, Concerts, Restaurants
other            # Uncategorized
```

---

## 🐳 Docker & Development

### Services in docker-compose.yml
1. **mariadb** (port 3306)
   - Persists to `mariadb_data` volume
   - Init credentials in `.env` (see `docker-compose.dev.yml`)
   - Health check enabled

2. **backend** (port 8000 + 5678 for debugpy)
   - Mounts `./backend` for hot reload
   - Environment: DATABASE_URL, DEBUG=1, PYTHONUNBUFFERED=1
   - Depends on MariaDB health check

3. **frontend** (port 5173)
   - Mounts `./frontend/src` for hot reload
   - npm run dev (Vite dev server)
   - Environment: VITE_API_URL

### Running Locally
```bash
# Development with hot reload
docker-compose up --build

# Tear down
docker-compose down -v

# Connect to DB
docker-compose exec mariadb mysql -u budget_user -p family_budget

# View logs
docker-compose logs -f backend
```

---

## ✅ Coding Standards

### Python (Backend)

**File Organization**:
- Imports grouped: stdlib → third-party → local (isort-style)
- Type hints on all function signatures
- Docstrings for non-obvious functions
- Constants UPPERCASE

**Example**:
```python
from typing import Optional
from sqlalchemy.orm import Session
from datetime import datetime

def update_transaction_category(
    db: Session,
    transaction_id: str,
    category: str
) -> Transaction:
    """Update transaction and log training data."""
    transaction = db.query(Transaction).filter(...).first()
    if not transaction:
        raise ValueError(f"Transaction {transaction_id} not found")
    # ... logic
    return transaction
```

**Validation**:
- Use Pydantic schemas for request/response
- FastAPI automatic docs generation
- Return appropriate HTTP status codes

### TypeScript/React (Frontend)

**File Organization**:
- Components: Functional + React hooks
- Props: Typed interfaces (not inline)
- State: Zustand for global, useState for local
- Async: async/await, handle errors

**Example**:
```typescript
import React, { useEffect, useState } from 'react';
import { transactionService, Transaction } from '../services/transactionService';

interface ReviewPageProps {}

export const ReviewPage: React.FC<ReviewPageProps> = () => {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await transactionService.listTransactions();
      setTransactions(res.data);
    } catch (err) {
      console.error('Failed to load', err);
    } finally {
      setLoading(false);
    }
  };

  return <div>{/* ... */}</div>;
};
```

---

## 🔄 Common Development Tasks

### Adding a New Endpoint

1. **Define Schema** (if needed) in `backend/app/models/schemas.py`
   ```python
   class MyRequest(BaseModel):
       field: str
   ```

2. **Add Service Method** in `backend/app/services/`
   ```python
   def my_logic(db: Session, param: str):
       # Business logic
       return result
   ```

3. **Add Route** in `backend/app/api/transactions.py`
   ```python
   @router.get("/endpoint")
   def my_endpoint(db: Session = Depends(get_db)):
       result = TransactionService.my_logic(db)
       return result
   ```

4. **Test** via `/docs` or `curl`

### Adding a New Frontend Page

1. **Create Page Component** in `frontend/src/pages/MyPage.tsx`
   ```typescript
   export const MyPage: React.FC = () => {
     // Component code
     return <Container>...</Container>;
   };
   ```

2. **Add Route** in `frontend/src/App.tsx`
   ```typescript
   <Route path="/my-path" element={<MyPage />} />
   ```

3. **Add Nav Link** in `App.tsx` header

### Updating ML Model

1. **Collect corrections** via `/transactions/{id}` PATCH endpoint
2. **Verify training data** in `training_data` table
3. **Trigger retrain** via `/ml/retrain` endpoint
4. **Model pickle** saved to `backend/app/ml/models/`

---

## 🧪 Testing Tips

### Sample CSV Uploads
Use files in `data/` directory:
- `bank_a_transactions.csv` → Test Bank A format
- `bank_b_transactions.csv` → Test Bank B format

### API Testing
```bash
# Create account
curl -X POST http://localhost:8000/api/v1/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","bank_name":"Test Bank"}'

# List transactions
curl http://localhost:8000/api/v1/transactions

# View Swagger docs
open http://localhost:8000/docs
```

### Frontend Testing
- Hot reload: Save `src/` file → auto-refresh in browser
- DevTools: Check `console` for errors
- Network tab: Verify API calls

---

## 🚨 Common Gotchas

### Database
- **Connection string**: Must use `pymysql` dialect (not `mysql`)
- **Charset**: UTF-8 specified in connection kwargs
- **Migrations**: Alembic ready if schema changes needed

### Backend
- **CORS**: Enabled for all origins (development only)
- **Hot reload**: Restart if requirements change
- **Debugpy**: Port 5678 for remote debugging

### Frontend
- **API URL**: Uses `VITE_API_URL` environment variable
- **AG Grid**: Free version has some limitations
- **Mantine**: CSS imported globally in `main.tsx`

### CSV Parsing
- **Amounts**: Parsed from string, handle commas/dollar signs
- **Dates**: Normalized to YYYY-MM-DD format
- **Encoding**: UTF-8 assumed

---

## 📚 Reference Files

**Always check these when working on specific areas**:
- `API_REFERENCE.md` - All endpoint signatures + examples
- `SETUP.md` - How to set up locally
- `DEVELOPMENT.md` - Debugging, testing, local setup
- `DEPLOYMENT.md` - Production deployment
- `CHECKLIST.md` - Feature list + verification

---

## ✅ Testing Standards

### Backend (Python)
- **Framework**: pytest (not yet configured, setup needed)
- **Location**: `backend/tests/`
- **Convention**: `test_*.py` files, test functions start with `test_`
- **Mocking**: Use `unittest.mock` for database and services
- **Coverage**: Target 70%+ on critical services (ML, transaction, normalization)

**Template**:
```python
# backend/tests/test_transaction_service.py
import pytest
from unittest.mock import Mock
from app.services.transaction_service import TransactionService

@pytest.fixture
def mock_db():
    return Mock()

def test_create_transaction(mock_db):
    service = TransactionService()
    result = service.create_transaction(mock_db, {...})
    assert result.id is not None
```

### Frontend (TypeScript)
- **Framework**: vitest + @testing-library/react (not yet configured, setup needed)
- **Location**: `frontend/src/__tests__/`
- **Convention**: `*.test.tsx` files
- **Coverage**: Test components, hooks, state management

**Template**:
```typescript
// frontend/src/__tests__/ReviewPage.test.tsx
import { render, screen } from '@testing-library/react';
import { ReviewPage } from '../pages/ReviewPage';

test('renders review page', () => {
  render(<ReviewPage />);
  expect(screen.getByText(/Review/i)).toBeInTheDocument();
});
```

---

## 🔐 Security & Authentication

### Current State
- ✅ **Development**: All endpoints public (for local testing)
- ⚠️ **Production**: Authentication not yet implemented

### Required Before Production Deploy
- [ ] Implement JWT or session authentication
- [ ] Add auth endpoints (login, logout, refresh)
- [ ] Protect all endpoints with `@require_auth` decorator
- [ ] Store user_id in sessions/JWT
- [ ] Filter transactions by user (multi-tenant isolation)
- [ ] Add HTTPS requirement

### Template for Protected Endpoint
```python
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer

security = HTTPBearer()

def verify_token(credentials: HTTPAuthCredentials = Depends(security)):
    token = credentials.credentials
    # Validate JWT
    if not valid_token(token):
        raise HTTPException(status_code=401, detail="Invalid token")
    return token

@router.get("/protected")
def protected_endpoint(token = Depends(verify_token)):
    # Logic here
    pass
```

---

## 🚨 Error Handling Patterns

### Backend (FastAPI)
```python
from fastapi import HTTPException

# Bad (avoid)
raise Exception("Something went wrong")

# Good (consistent)
raise HTTPException(
    status_code=400,
    detail="Invalid category: must be one of [groceries, rent, salary, utilities, transport, entertainment, other]"
)

# Database not found
raise HTTPException(
    status_code=404,
    detail=f"Transaction {transaction_id} not found"
)

# Server error
raise HTTPException(
    status_code=500,
    detail="Failed to retrain ML model. Check backend logs."
)
```

### Frontend (React)
```typescript
// Handle API errors consistently
try {
  const res = await transactionService.uploadCSV(file);
  setTransactions(res.data);
} catch (err: any) {
  const errorMsg = err.response?.data?.detail || "Unknown error";
  showErrorNotification(`Upload failed: ${errorMsg}`);
  console.error('Upload error:', err);
} finally {
  setLoading(false);
}

// Use try/catch for state updates
useEffect(() => {
  (async () => {
    try {
      const data = await loadData();
      setState(data);
    } catch (err) {
      setError(err);
    }
  })();
}, []);
```

---

## 📦 Database Migrations (Alembic)

### Current State
- ⚠️ **Schema created** via SQLAlchemy ORM at startup (no migrations)
- **Risk**: Production deployments unversioned; rollback impossible

### Workflow for Schema Changes
1. **Modify model** in `backend/app/models/transaction.py`
2. **Generate migration** (after Docker services running):
   ```bash
   docker-compose exec backend alembic revision --autogenerate -m "Add new field"
   ```
3. **Review generated** migration in `backend/alembic/versions/`
4. **Apply migration**:
   ```bash
   docker-compose exec backend alembic upgrade head
   ```
5. **Verify schema** in MariaDB:
   ```bash
   docker-compose exec mariadb mysql -u budget_user -p family_budget
   DESCRIBE transactions;
   ```

**See**: [database-schema.instructions.md](.github/instructions/database-schema.instructions.md)

---

## 🧠 ML Model Lifecycle

### Training Pipeline
1. **Baseline model** loaded at startup (`backend/app/ml/models/default_model.pkl`)
2. **User corrects** transaction category via PATCH endpoint
3. **Correction logged** to `training_data` table
4. **Manual retrain** triggered via `/ml/retrain` endpoint
5. **New model** persisted to disk

### Best Practices
- **Confidence threshold**: Use predicted category if confidence > 0.65, otherwise require review
- **Evaluation**: Track precision/recall per category before deploying
- **Baseline**: Ensure seed data covers all 7 categories
- **Monitor**: Check `training_data` table growth to trigger retraining

### Categories
```
groceries       # Food purchases
rent            # Housing payments
salary          # Income
utilities       # Bills (electric, water, gas, internet, phone)
transport       # Commute (uber, gas, metro, parking)
entertainment   # Leisure (restaurants, movies, concerts)
other           # Uncategorized
```

**See**: [ml-categorization.instructions.md](.github/instructions/ml-categorization.instructions.md)

---

## 🏦 Adding Bank CSV Format Support

### Current Formats
- **bank_a**: Columns = Transaction Date, Amount, Description, Merchant, Currency
- **bank_b**: Columns = Date, Debit/Credit, Transaction, Vendor
- **generic**: Fallback (auto-detects common CSV headers)

### Steps to Add New Format

1. **Identify format** (collect sample CSV from bank)

2. **Add constant** to `backend/app/services/format_service.py`:
   ```python
   BANK_FORMATS = {
       "bank_a": {...},
       "bank_b": {...},
       "new_bank": {  # ADD HERE
           "date_column": "Transaction Date",
           "amount_column": "Amount",
           "description_column": "Description",
           "merchant_column": "Merchant",
           "currency_column": "Currency",
           "expected_columns": ["Transaction Date", "Amount", "Description", "Merchant", "Currency"]
       }
   }
   ```

3. **Test detection** by uploading sample CSV to `/upload` endpoint

4. **Add mapping logic** if column transformations needed (e.g., parse "Debit/Credit" signs)

5. **Document** new format in this section

---

## 🔄 Common Development Tasks

### Adding a New Endpoint

1. **Schema** (if needed) in `backend/app/models/schemas.py`
2. **Service method** in `backend/app/services/transaction_service.py`
3. **Route handler** in `backend/app/api/transactions.py`
4. **Error handling** using HTTPException pattern (see above)
5. **Test** via `/docs` or curl
6. **Write test** in `backend/tests/` (required before merge)

### Updating ML Model

1. **User corrects** category via PATCH endpoint
2. **Check** `training_data` table has entries
3. **Trigger retrain** via `/ml/retrain` endpoint
4. **Verify** new model saved to `backend/app/ml/models/`
5. **A/B test** if needed before full rollout

### Extending Transfer Detection

Currently placeholder. To implement:
1. **Query** for opposite-sign, same-amount pairs (same day ± 3 days)
2. **Match via** `transfer_match_id` field
3. **Flag** `is_transfer = TRUE` for both transactions

---

## 🎓 When to Ask for Help

**Good questions for Copilot**:
- "Add a new [endpoint/page/component]"
- "Fix error: [error message]"
- "Explain how [service/component] works"
- "Write [unit test/integration test]"
- "How to [deploy/debug/test] this?"

**Provide context**:
- What file(s) you're editing
- What error you see (full error message)
- What you expect vs. what happens
- Stack trace if applicable

---

## 🔐 Best Practices

1. **Always use Pydantic schemas** for request validation
2. **Type everything** in TypeScript/Python
3. **Return appropriate HTTP status codes** (400 for client error, 500 for server)
4. **Handle errors consistently** - See Error Handling section above
5. **Use environment variables** for secrets (never hardcode)
6. **Write tests** for new code before merge (see Testing Standards)
7. **Keep services focused** - single responsibility
8. **Reuse existing services** instead of duplicating logic
9. **Use migrations** for schema changes (see Database Migrations)
10. **Log important events** (errors, model retraining, data imports)

---

## 📞 Support & Resources

- **Documentation**: See `*.md` files in root
- **Database Schema**: [data/SCHEMA.md](data/SCHEMA.md)
- **API Docs**: http://localhost:8000/docs (when running)
- **Sample Data**: `data/bank_*.csv` for testing
- **Instruction Files**: [.github/instructions/](.github/instructions/)
  - [backend-api.instructions.md](.github/instructions/backend-api.instructions.md)
  - [frontend-react.instructions.md](.github/instructions/frontend-react.instructions.md)
  - [database-schema.instructions.md](.github/instructions/database-schema.instructions.md)
  - [ml-categorization.instructions.md](.github/instructions/ml-categorization.instructions.md)

---

**Last Updated**: June 2026 | **Version**: 1.1.0
