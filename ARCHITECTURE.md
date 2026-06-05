# Architecture & System Design

Comprehensive documentation of the Family Budget system architecture, design decisions, and component interactions.

## Table of Contents
1. [System Overview](#system-overview)
2. [Architecture Diagram](#architecture-diagram)
3. [Data Model](#data-model)
4. [Backend Architecture](#backend-architecture)
5. [Frontend Architecture](#frontend-architecture)
6. [API Design](#api-design)
7. [ML Pipeline](#ml-pipeline)
8. [Infrastructure](#infrastructure)
9. [Data Flow](#data-flow)
10. [Design Decisions](#design-decisions)

---

## System Overview

**Family Budget** is a full-stack financial transaction analysis system that automatically categorizes transactions and provides spending analytics.

### Key Features
1. **Multi-bank support** - Import transactions from different bank formats
2. **Smart categorization** - ML-based automatic transaction categorization
3. **Analytics dashboard** - Visual spending analysis and trends
4. **Transaction review** - Manual categorization adjustments with model retraining
5. **Duplicate detection** - Fingerprint-based transaction deduplication

### Technology Stack
- **Backend**: FastAPI (Python 3.11) + SQLAlchemy ORM + scikit-learn ML
- **Frontend**: React 18 + TypeScript + Zustand store + Mantine UI
- **Database**: MariaDB 11 with UTF-8mb4 charset
- **Containerization**: Docker + Docker Compose
- **Development**: Vite hot reload, debugpy remote debugging

---

## Architecture Diagram

### High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     User Browser                             │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP/WebSocket
                       ▼
        ┌──────────────────────────┐
        │    React Frontend App    │
        │  (Vite Dev Server)       │
        │  - UploadPage            │
        │  - ReviewPage (AG Grid)  │
        │  - AnalyticsPage         │
        │  (Zustand State Mgmt)    │
        └──────────────┬───────────┘
                       │ REST API
                       ▼
        ┌──────────────────────────┐
        │      FastAPI Backend      │ ◄─── Debugpy (port 5678)
        │  ┌────────────────────┐  │
        │  │ Transaction API    │  │
        │  │ - Upload           │  │
        │  │ - List/Filter      │  │
        │  │ - Update Category  │  │
        │  │ - Analytics        │  │
        │  └────────────────────┘  │
        │  ┌────────────────────┐  │
        │  │ Services Layer     │  │
        │  │ - Format           │  │
        │  │ - Normalization    │  │
        │  │ - Transaction      │  │
        │  │ - ML               │  │
        │  └────────────────────┘  │
        └──────────────┬───────────┘
                       │ SQL
                       ▼
        ┌──────────────────────────┐
        │    MariaDB Database      │
        │  - accounts              │
        │  - transactions          │
        │  - categories            │
        │  - training_data         │
        │  (Persistent Volume)     │
        └──────────────────────────┘
```

---

## Data Model

### Database Schema

#### Account Table
```sql
CREATE TABLE account (
    id CHAR(36) PRIMARY KEY,           -- UUID
    name VARCHAR(200) NOT NULL,        -- "Main Checking"
    account_number VARCHAR(100) NOT NULL UNIQUE,  -- "****1234"
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP ON UPDATE NOW(),
    INDEX idx_name (name)
);
```

#### Transaction Table
```sql
CREATE TABLE transaction (
    id CHAR(36) PRIMARY KEY,           -- UUID
    account_id CHAR(36) NOT NULL,      -- Foreign Key
    date DATE NOT NULL,                -- Transaction date
    amount DECIMAL(12,2) NOT NULL,     -- Amount (can be negative)
    description VARCHAR(500) NOT NULL, -- Original description
    category VARCHAR(50),              -- groceries, rent, salary, utilities, etc.
    confidence FLOAT,                  -- ML confidence (0-1)
    bank_reference VARCHAR(100),       -- Original reference number
    hash_fingerprint VARCHAR(64) UNIQUE NOT NULL,  -- Deduplication
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP ON UPDATE NOW(),
    FOREIGN KEY (account_id) REFERENCES account(id),
    INDEX idx_account_date (account_id, date),
    INDEX idx_category (category),
    INDEX idx_hash (hash_fingerprint)
);
```

#### Category Table
```sql
CREATE TABLE category (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL,  -- groceries, rent, etc.
    color VARCHAR(7),                  -- Hex color for UI
    icon VARCHAR(50),                  -- Icon name
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### TrainingData Table
```sql
CREATE TABLE training_data (
    id CHAR(36) PRIMARY KEY,           -- UUID
    transaction_id CHAR(36) NOT NULL,  -- Reference
    description VARCHAR(500) NOT NULL, -- Feature
    category VARCHAR(50) NOT NULL,     -- Label
    user_confirmed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (transaction_id) REFERENCES transaction(id),
    INDEX idx_category (category)
);
```

### ER Diagram Relationships

```
┌─────────────┐
│   Account   │
├─────────────┤
│ id (PK)     │
│ name        │
│ bank        │
└────┬────────┘
     │ 1
     │
     │ N
     ▼
┌─────────────────────┐
│   Transaction       │
├─────────────────────┤
│ id (PK)             │
│ account_id (FK)     │
│ date                │
│ amount              │
│ description         │
│ category            │
│ confidence          │
│ hash_fingerprint    │
└────┬────────────────┘
     │ 1
     │
     │ N
     ▼
┌──────────────────────┐
│   TrainingData       │
├──────────────────────┤
│ id (PK)              │
│ transaction_id (FK)  │
│ description          │
│ category (Label)     │
│ user_confirmed       │
└──────────────────────┘
```

---

## Backend Architecture

### Directory Structure
```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                 # FastAPI app entry point
│   ├── api/
│   │   ├── __init__.py
│   │   └── transactions.py     # All route handlers (11 endpoints)
│   ├── db/
│   │   ├── __init__.py
│   │   └── database.py         # SQLAlchemy setup, session factory
│   ├── models/
│   │   ├── __init__.py
│   │   ├── transaction.py      # SQLAlchemy ORM models
│   │   └── schemas.py          # Pydantic request/response schemas
│   ├── services/
│   │   ├── __init__.py
│   │   ├── transaction_service.py   # CRUD & analytics logic
│   │   ├── ml_service.py            # sklearn TF-IDF + LogisticRegression
│   │   ├── normalization.py         # CSV parsing & deduplication
│   │   └── format_service.py        # Bank format detection & mapping
│   ├── ml/
│   │   ├── __init__.py
│   │   └── models/             # Joblib model storage
│   └── __pycache__/
├── requirements.txt            # Python dependencies
└── Dockerfile                  # Multi-stage build optimized
```

### Key Services

#### TransactionService
**Purpose**: Business logic for transaction operations

**Methods**:
- `create_transaction(trans_data, db)` - Insert single transaction
- `get_transactions(account_id, filters, db)` - Query with filtering
- `update_transaction_category(trans_id, category, db)` - Manual categorization
- `get_analytics_summary(account_id, db)` - Aggregates spending by category/date
- `batch_create_transactions(data, db)` - Bulk insert (optimization)

**Used by**: Transaction API routes

---

#### MLService
**Purpose**: Machine learning for automatic categorization

**Algorithm**: TF-IDF vectorization + Logistic Regression
- TF-IDF: Converts transaction descriptions to numerical features
- Logistic Regression: Multi-class classification (7 categories)
- Scikit-learn: Industry-standard ML library

**Methods**:
- `predict(description)` - Returns category + confidence
- `retrain(sample_size)` - Rebuild model from training data
- `save_model()` - Persist to joblib file
- `load_model()` - Load from disk

**Training Data**:
- Uses manually-reviewed transactions as labels
- Minimum 10 samples per category for acceptable performance
- Auto-retrains when new training data added

---

#### NormalizationService
**Purpose**: Transform raw CSV transactions to canonical format

**Process**:
1. Detect bank format (Bank A, Bank B, Generic)
2. Parse CSV according to detected format
3. Generate unique fingerprint per transaction (hash of date+amount+description)
4. Detect transfers between own accounts
5. Return normalized transactions ready for database

**Deduplication**:
- SHA256 hash: `hash(account_id + date + amount + description)`
- Database UNIQUE constraint prevents duplicates
- Prevents same transaction imported multiple times

---

#### FormatService
**Purpose**: Support multiple bank CSV formats

**Supported Formats**:
1. **Bank A**: Columns: Date, Reference, Description, Amount
2. **Bank B**: Columns: TransactionDate, Memo, Debit, Credit
3. **Generic**: Standard format (Date, Amount, Description)

**Methods**:
- `detect_bank_format(csv_data)` - Analyze headers to identify format
- `get_mapping_for_format(format_name)` - Return column mapping
- `suggest_mapping()` - Interactive format suggestion

---

### Request/Response Flow

```
Client HTTP Request
    ↓
FastAPI Router (app/api/transactions.py)
    ↓
Pydantic Schema Validation
    ↓
Service Layer
    ├── TransactionService (CRUD)
    ├── MLService (Categorization)
    ├── NormalizationService (CSV parsing)
    └── FormatService (Format detection)
    ↓
SQLAlchemy ORM
    ↓
MariaDB Database
    ↓
Database Result
    ↓
Pydantic Response Schema
    ↓
JSON Response to Client
```

---

## Frontend Architecture

### Directory Structure
```
frontend/
├── src/
│   ├── pages/
│   │   ├── UploadPage.tsx       # CSV file upload & bank format selection
│   │   ├── ReviewPage.tsx       # AG Grid transaction review & categorization
│   │   └── AnalyticsPage.tsx    # Dashboard with Recharts visualizations
│   ├── components/              # Reusable UI components (optional)
│   ├── store/
│   │   └── transactionStore.ts  # Zustand global state
│   ├── services/
│   │   └── api.ts               # Fetch wrapper for API calls
│   ├── App.tsx                  # Main route component
│   └── main.tsx                 # React entry point
├── package.json                 # Dependencies + scripts
├── vite.config.ts              # Build configuration
├── tsconfig.json               # TypeScript configuration
└── Dockerfile                  # Node-based development container
```

### State Management (Zustand Store)

**Store Location**: `frontend/src/store/transactionStore.ts`

**State Structure**:
```typescript
interface TransactionStore {
  // Data
  transactions: Transaction[]
  accounts: Account[]
  currentAccount: Account | null
  
  // UI State
  loading: boolean
  selectedRows: Set<string>
  filterCategory: string | null
  sortBy: 'date' | 'amount' | 'category'
  
  // Actions
  setTransactions: (trans: Transaction[]) => void
  setAccounts: (accs: Account[]) => void
  updateTransaction: (id: string, updates: Partial<Transaction>) => void
  selectRows: (ids: string[]) => void
  setFilter: (category: string | null) => void
}
```

**Usage Pattern**:
```typescript
// In component
const store = useTransactionStore()
const transactions = store.transactions
store.setTransactions(newTransactions)
```

---

### Component Lifecycle

#### UploadPage
1. User selects CSV file
2. File uploaded to backend API
3. Backend detects format, parses CSV
4. Returns detected format + preview
5. User confirms import
6. API creates transactions in database

#### ReviewPage
1. Loads all transactions for account
2. Displays in AG Grid (virtual scrolling)
3. User can:
   - Change category dropdown
   - View ML confidence score
   - Mark as manually confirmed
4. Changes synced to database
5. Can trigger model retraining

#### AnalyticsPage
1. Fetches analytics summary from API
2. Displays using Recharts:
   - Pie chart: Category breakdown
   - Bar chart: Top categories
   - Line chart: Monthly spending trend

---

## API Design

### Endpoint Categories

#### Authentication & Health
```
GET  /health                          # Health check
GET  /docs                            # Swagger UI
GET  /redoc                           # ReDoc documentation
```

#### Account Management
```
POST   /api/accounts                  # Create account
GET    /api/accounts                  # List all accounts
GET    /api/accounts/{id}             # Get account details
PUT    /api/accounts/{id}             # Update account
DELETE /api/accounts/{id}             # Delete account
```

#### Transaction Operations
```
POST   /api/upload                    # Upload CSV file
GET    /api/transactions              # List transactions (paginated)
GET    /api/transactions/{id}         # Get transaction details
PUT    /api/transactions/{id}         # Update transaction
DELETE /api/transactions/{id}         # Delete transaction
POST   /api/transactions/normalize    # Normalize raw data
```

#### Analytics
```
GET    /api/analytics/summary/{account_id}    # Summary by category
GET    /api/analytics/trends/{account_id}     # Monthly trends
GET    /api/analytics/top-categories          # Top spending categories
```

#### Machine Learning
```
POST   /ml/retrain                    # Retrain ML model
GET    /ml/model-status               # Model performance metrics
POST   /ml/predict                    # Predict category for text
```

### Request/Response Format

**Successful Request** (200 OK):
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "account_id": "550e8400-e29b-41d4-a716-446655440001",
  "date": "2024-01-15",
  "amount": -45.99,
  "description": "WHOLE FOODS MARKET",
  "category": "groceries",
  "confidence": 0.92,
  "created_at": "2024-01-15T10:30:00Z"
}
```

**Error Response** (4xx/5xx):
```json
{
  "detail": "Transaction not found",
  "status": 404,
  "timestamp": "2024-01-15T10:30:00Z"
}
```

---

## ML Pipeline

### Categorization Workflow

```
Transaction Description
    ↓
TF-IDF Vectorizer
├─ Tokenize text
├─ Remove stopwords
└─ Calculate term frequencies
    ↓
Feature Vector (1000+ dimensions)
    ↓
Logistic Regression Model
├─ Trained on historical transactions
├─ 7 category classes
└─ Outputs probability per class
    ↓
Category + Confidence Score
├─ Category: groceries (highest probability)
└─ Confidence: 0.92 (92% probability)
```

### Training Data Collection

**Sources**:
1. User manual corrections during review
2. Initial training batch from sample data
3. Accumulates over time as users review

**Model Retraining**:
- Triggered manually via Review page button
- Triggered automatically after fixed # of corrections
- Uses last N training samples (configurable)
- Rebuilt and saved; old model backed up

**Performance**:
- Typical accuracy: 85-90% after 500+ samples
- Confidence score correlates with accuracy
- Categories improve as more training data collected

---

## Infrastructure

### Docker Compose Architecture

```yaml
services:
  mariadb:          # Database container
    - Port 3306     # MySQL protocol
    - Volume: mariadb_data (persistent)
    
  backend:          # FastAPI application
    - Port 8000     # HTTP API
    - Port 5678     # Debugpy remote debugging
    - Volume: ./backend:/app (source code)
    
  frontend:         # React development server
    - Port 5173     # Vite dev server
    - Volume: ./frontend:/app (source code)
    - Volume: /app/node_modules (dependencies)

volumes:
  mariadb_data:  # Persists database between restarts

networks:
  budget-network:  # Internal Docker network (DNS: service name)
```

### Database Persistence

**Volume Mounting**:
```yaml
mariadb:
  volumes:
    - mariadb_data:/var/lib/mysql  # All DB data
    - backup.sql:/docker-entrypoint-initdb.d/backup.sql  # Initial data
```

**Data Survival**:
- ✅ `docker-compose down` - Data persists
- ❌ `docker-compose down -v` - Data deleted
- ✅ `docker restart` - Data persists
- ❌ Docker image deletion - Data persists (separate volume)

---

## Data Flow

### Complete Transaction Upload & Categorization Flow

```
1. USER UPLOADS CSV
   ┌────────────────────────────────┐
   │ UploadPage component           │
   │ - Select file                  │
   │ - Choose bank format           │
   └────────────┬───────────────────┘
                │
                ▼
   ┌────────────────────────────────┐
   │ POST /api/upload               │
   │ Upload CSV file                │
   └────────────┬───────────────────┘
                │
2. BACKEND PROCESSES
   ┌────────────────────────────────┐
   │ FormatService.detect_format()  │
   │ - Parse CSV headers            │
   │ - Identify bank format         │
   └────────────┬───────────────────┘
                │
                ▼
   ┌────────────────────────────────┐
   │ NormalizationService.normalize()│
   │ - Apply format mapping         │
   │ - Generate fingerprints        │
   │ - Detect duplicates            │
   └────────────┬───────────────────┘
                │
                ▼
   ┌────────────────────────────────┐
   │ MLService.predict()            │
   │ - For each transaction:        │
   │   - TF-IDF vectorize desc.     │
   │   - Logistic regression        │
   │   - Return category + score    │
   └────────────┬───────────────────┘
                │
                ▼
   ┌────────────────────────────────┐
   │ TransactionService.create_many()│
   │ - Insert to database           │
   │ - Return created transactions  │
   └────────────┬───────────────────┘
                │
3. RESPONSE TO FRONTEND
   ┌────────────────────────────────┐
   │ 200 OK with transactions       │
   │ Zustand store updates          │
   │ ReviewPage shows grid          │
   └────────────────────────────────┘
   
4. USER REVIEWS & CORRECTS
   ┌────────────────────────────────┐
   │ ReviewPage - User changes cat. │
   │ - Click dropdown               │
   │ - Select correct category      │
   └────────────┬───────────────────┘
                │
                ▼
   ┌────────────────────────────────┐
   │ PUT /api/transactions/{id}     │
   │ Update category                │
   └────────────┬───────────────────┘
                │
                ▼
   ┌────────────────────────────────┐
   │ Create TrainingData entry      │
   │ - description + new category   │
   │ - marked as user_confirmed     │
   └────────────────────────────────┘

5. MODEL RETRAIN (Optional)
   ┌────────────────────────────────┐
   │ Review page "Retrain" button   │
   │ POST /ml/retrain               │
   └────────────┬───────────────────┘
                │
                ▼
   ┌────────────────────────────────┐
   │ MLService.retrain()            │
   │ - Load training_data from DB   │
   │ - Fit TF-IDF vectorizer        │
   │ - Fit LogisticRegression       │
   │ - Save model to joblib         │
   └────────────────────────────────┘

6. FUTURE PREDICTIONS
   ┌────────────────────────────────┐
   │ Next upload uses new model     │
   │ - Better accuracy expected     │
   │ - Based on user's categories   │
   └────────────────────────────────┘
```

---

## Design Decisions

### 1. **Synchronous API (Current) vs Async**
**Decision**: Synchronous with FastAPI (async-safe)
**Rationale**:
- Simpler to understand and debug
- SQLAlchemy sync ORM well-tested
- Can migrate to async later without breaking changes
- Sufficient for initial scale

**Trade-offs**:
- Slightly lower concurrency potential
- Thread-based rather than async/await

---

### 2. **Scikit-learn vs Deep Learning**
**Decision**: Scikit-learn TF-IDF + LogisticRegression
**Rationale**:
- Fast training (seconds, not hours)
- Interpretable results
- Minimal dependencies
- Works well with small datasets (< 10K samples)
- Easy to re-train

**Trade-offs**:
- Lower accuracy ceiling vs neural networks
- Limited feature engineering

---

### 3. **Hash-based Deduplication**
**Decision**: SHA256 fingerprint of (account_id + date + amount + description)
**Rationale**:
- Deterministic: same transaction always has same hash
- User can import same file multiple times safely
- Works cross-bank transfers (same fingerprint)
- Simple to implement

**Trade-offs**:
- Edge case: genuinely identical transactions get deduplicated
- Admin must clean up if needed

---

### 4. **Multi-Bank Format Detection**
**Decision**: Header-based automatic detection
**Rationale**:
- User doesn't need to manually select format
- System learns common patterns
- Fallback to generic format

**Trade-offs**:
- Requires CSV headers in file
- Detection could fail on unusual formats

---

### 5. **Zustand for Frontend State**
**Decision**: Zustand (lightweight, hook-based)
**Rationale**:
- Minimal boilerplate vs Redux
- Easy to understand and modify
- Good TypeScript support
- Sufficient for app complexity

**Trade-offs**:
- No Redux DevTools integration
- Smaller ecosystem

---

### 6. **Mantine UI Framework**
**Decision**: Mantine + AG Grid + Recharts combination
**Rationale**:
- Professional component library
- Grid: Best-in-class for large tables
- Charts: Easy to learn, beautiful defaults
- All have TypeScript support

**Trade-offs**:
- Three separate libraries vs single framework
- Some redundant components

---

### 7. **Vite Build Tool**
**Decision**: Vite for frontend bundling
**Rationale**:
- Lightning-fast hot reload (ES modules)
- Minimal configuration
- Near-zero startup time
- Better dev experience

**Trade-offs**:
- Newer than Webpack (but stable)
- Some legacy tool integrations missing

---

### 8. **Docker for Development**
**Decision**: Docker for all environments
**Rationale**:
- Same environment for all developers
- Eliminates "works on my machine"
- Easy to add services (Redis, etc.)
- Production-like setup

**Trade-offs**:
- Slight overhead vs native dev
- Docker desktop memory usage

---

## Performance Characteristics

### Expected Performance

| Operation | Latency | Notes |
|-----------|---------|-------|
| List 1000 transactions | 200-400ms | With sorting/filtering |
| Create 1 transaction | 50-100ms | Includes ML prediction |
| Categorize 100 transactions | 100-200ms | ML TF-IDF vectorization |
| Get analytics summary | 300-500ms | Multiple aggregations |
| Upload 10K CSV | 2-5s | Parse + normalize + ML |
| Retrain ML model | 1-3s | Fit on 1000 samples |

### Scalability Limits

| Resource | Current | Bottleneck |
|----------|---------|-----------|
| Database connections | 20 | SQLAlchemy pool |
| Transaction storage | 1M+ | MariaDB disk |
| Memory usage | 512MB | Docker limit |
| CSV file size | 100MB | Docker volume limit |
| Concurrent users | 10-20 | Connection pool |

**Scaling to 1000+ users**:
- Add connection pooling (Redis)
- Implement caching layer
- Migrate to async ORM
- Horizontal scaling with load balancer
- Separate API and background workers

---

## Future Enhancement Opportunities

1. **Real-time Sync** - WebSocket for live updates
2. **Recurring Transactions** - Pattern detection
3. **Budget Alerts** - Spending threshold notifications
4. **Data Export** - CSV/PDF reports
5. **Multi-user Accounts** - Sharing & permissions
6. **API Rate Limiting** - Protect against abuse
7. **Advanced Search** - Full-text search engine
8. **Mobile App** - React Native version
9. **Bank Integration** - Open Banking APIs
10. **Forecasting** - Spending predictions

---

## References

- [FastAPI Official](https://fastapi.tiangolo.com) - Backend framework
- [SQLAlchemy Documentation](https://docs.sqlalchemy.org) - ORM
- [Scikit-learn Guide](https://scikit-learn.org) - ML library
- [React Documentation](https://react.dev) - Frontend framework
- [Zustand GitHub](https://github.com/pmndrs/zustand) - State management
- [AG Grid Docs](https://www.ag-grid.com) - Data grid
- [Recharts Docs](https://recharts.org) - Charting library
- [Docker Documentation](https://docs.docker.com) - Containerization
