---
name: "Testing & Quality Assurance"
description: "Use when: writing unit tests, integration tests, or test fixtures. Covers pytest for backend and vitest for frontend. Defines testing conventions, mocking strategies, and coverage targets."
applyTo: "backend/tests/**/*.py,frontend/src/__tests__/**/*.test.tsx"
---

# Testing & QA Development Guide

## Overview

**Current Status**: ⚠️ Testing infrastructure not yet configured  
**Goal**: Add pytest (backend) and vitest (frontend) before production deploy  
**Coverage Target**: 70%+ for critical paths (ML, transactions, normalization)

---

## Backend Testing (Python + pytest)

### Setup
```bash
# Install pytest and plugins
pip install pytest pytest-cov pytest-mock pytest-asyncio

# Create tests directory
mkdir -p backend/tests
touch backend/tests/__init__.py
```

### File Structure
```
backend/tests/
├── __init__.py
├── conftest.py              # Shared fixtures
├── test_services/
│   ├── test_transaction_service.py
│   ├── test_ml_service.py
│   ├── test_normalization.py
│   └── test_format_service.py
├── test_api/
│   └── test_transactions.py    # Route tests
└── test_models/
    └── test_schemas.py
```

### Running Tests
```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=app --cov-report=html

# Run specific test file
pytest backend/tests/test_services/test_transaction_service.py

# Run with verbose output
pytest -v

# Run in watch mode (requires pytest-watch)
ptw
```

### Database Fixtures

```python
# backend/tests/conftest.py
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.database import Base
from app.models.transaction import Account, Transaction

@pytest.fixture
def test_db():
    """Create in-memory SQLite database for testing."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()
    
    yield db
    
    db.close()
    Base.metadata.drop_all(engine)

@pytest.fixture
def sample_account(test_db):
    """Create test account."""
    account = Account(
        id="test-account-1",
        name="Test Account",
        account_number="ACC123456",
        type="Credit"
    )
    test_db.add(account)
    test_db.commit()
    return account

@pytest.fixture
def sample_transaction(test_db, sample_account):
    """Create test transaction."""
    transaction = Transaction(
        id="test-txn-1",
        account_id=sample_account.id,
        date="2024-01-15",
        amount=100.0,
        currency="USD",
        description="Test transaction",
        hash_fingerprint="abc123"
    )
    test_db.add(transaction)
    test_db.commit()
    return transaction
```

### Service Testing

```python
# backend/tests/test_services/test_transaction_service.py
import pytest
from unittest.mock import Mock, patch
from app.services.transaction_service import TransactionService
from app.models.schemas import CreateTransactionRequest

class TestTransactionService:
    
    def test_create_transaction_success(self, test_db, sample_account):
        """Test creating a transaction with ML prediction."""
        service = TransactionService()
        request = CreateTransactionRequest(
            account_id=sample_account.id,
            date="2024-01-15",
            amount=50.0,
            description="Grocery store",
            merchant="Whole Foods"
        )
        
        result = service.create_transaction(test_db, request)
        
        assert result.id is not None
        assert result.account_id == sample_account.id
        assert result.description == "Grocery store"
        assert result.category_predicted in ["groceries", "other"]
    
    def test_create_transaction_duplicate(self, test_db, sample_account, sample_transaction):
        """Test duplicate detection via fingerprint."""
        service = TransactionService()
        
        # Create transaction with same fingerprint
        with pytest.raises(Exception) as exc_info:
            service.create_transaction(test_db, {...})
        
        assert "duplicate" in str(exc_info.value).lower()
    
    def test_get_transactions_with_filter(self, test_db, sample_account, sample_transaction):
        """Test filtering transactions by account."""
        service = TransactionService()
        
        results = service.get_transactions(
            test_db,
            account_id=sample_account.id
        )
        
        assert len(results) == 1
        assert results[0].id == sample_transaction.id
    
    def test_update_category_and_log_training(self, test_db, sample_transaction):
        """Test category update and training data recording."""
        service = TransactionService()
        
        service.update_transaction_category(
            test_db,
            sample_transaction.id,
            old_category="other",
            new_category="groceries"
        )
        
        # Verify transaction updated
        updated_txn = test_db.query(Transaction).get(sample_transaction.id)
        assert updated_txn.category_final == "groceries"
        
        # Verify training data logged
        training_data = test_db.query(TrainingData).filter_by(
            transaction_id=sample_transaction.id
        ).first()
        assert training_data.original_label == "other"
        assert training_data.corrected_label == "groceries"
```

### API Route Testing

```python
# backend/tests/test_api/test_transactions.py
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_create_account(test_db):
    """Test POST /accounts."""
    response = client.post(
        "/api/v1/accounts",
        json={
            "name": "My Account",
            "account_number": "ACC123456",
            "type": "Credit"
        }
    )
    
    assert response.status_code == 201
    data = response.json()
    assert data["name"] == "My Account"
    assert data["account_number"] == "ACC123456"
    assert data["type"] == "Credit"
    assert data["id"] is not None

def test_get_accounts_empty(test_db):
    """Test GET /accounts when empty."""
    response = client.get("/api/v1/accounts")
    
    assert response.status_code == 200
    assert response.json() == []

def test_upload_csv_invalid_format(test_db):
    """Test POST /upload with invalid CSV."""
    response = client.post(
        "/api/v1/upload",
        files={"file": ("invalid.txt", "not a csv")}
    )
    
    assert response.status_code == 400
    assert "Invalid CSV format" in response.json()["detail"]
```

### ML Service Testing

```python
# backend/tests/test_services/test_ml_service.py
import pytest
from app.services.ml_service import CategoryPredictor

class TestMLService:
    
    @pytest.fixture
    def predictor(self):
        """Load or create predictor."""
        return CategoryPredictor()
    
    def test_predict_groceries(self, predictor):
        """Test prediction for grocery transaction."""
        category, confidence = predictor.predict("Whole Foods grocery store")
        
        assert category in ["groceries", "other"]
        assert 0.0 <= confidence <= 1.0
    
    def test_predict_salary(self, predictor):
        """Test prediction for salary/income."""
        category, confidence = predictor.predict("Employer direct deposit")
        
        assert category in ["salary", "other"]
    
    def test_confidence_threshold(self, predictor):
        """Test that low-confidence predictions use 'other' category."""
        category, confidence = predictor.predict("xyz random text")
        
        # Baseline model may not have pattern, so confidence should be low
        if confidence < 0.65:
            # Consider marking for manual review
            assert True
```

---

## Frontend Testing (TypeScript + vitest)

### Setup
```bash
cd frontend

# Install testing dependencies
npm install -D vitest @testing-library/react @testing-library/jest-dom \
  @testing-library/user-event jsdom

# Update vite.config.ts to include vitest
```

### vite.config.ts
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/__tests__/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/']
    }
  }
});
```

### File Structure
```
frontend/src/__tests__/
├── setup.ts                     # Global test setup
├── test-utils.tsx               # Helper utilities
├── components/
│   └── *.test.tsx
├── pages/
│   ├── UploadPage.test.tsx
│   ├── ReviewPage.test.tsx
│   └── AnalyticsPage.test.tsx
├── services/
│   ├── api.test.ts
│   └── transactionService.test.ts
└── store/
    └── transactionStore.test.ts
```

### Running Tests
```bash
# Run all tests
npm run test

# Run with coverage
npm run test -- --coverage

# Run specific test file
npm run test -- pages/UploadPage.test.tsx

# Watch mode
npm run test -- --watch

# Update snapshots
npm run test -- -u
```

### Setup File

```typescript
// frontend/src/__tests__/setup.ts
import '@testing-library/jest-dom';
import { expect, afterEach, beforeAll } from 'vitest';
import { cleanup } from '@testing-library/react';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock localStorage
const localStorageMock = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};
global.localStorage = localStorageMock as any;

// Mock fetch
global.fetch = async () => ({
  ok: true,
  json: async () => ({}),
} as any);
```

### Test Utilities

```typescript
// frontend/src/__tests__/test-utils.tsx
import React, { ReactElement } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

const AllTheProviders = ({ children }: { children: React.ReactNode }) => {
  return (
    <MantineProvider>
      {children}
    </MantineProvider>
  );
};

const customRender = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>,
) => render(ui, { wrapper: AllTheProviders, ...options });

export * from '@testing-library/react';
export { customRender as render };
```

### Component Testing

```typescript
// frontend/src/__tests__/pages/UploadPage.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '../test-utils';
import { UploadPage } from '../../pages/UploadPage';

describe('UploadPage', () => {
  it('renders upload form', () => {
    render(<UploadPage />);
    
    expect(screen.getByRole('heading', { name: /upload/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /upload/i })).toBeInTheDocument();
  });

  it('accepts CSV file', async () => {
    const mockApi = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ preview: [] }),
    } as any);

    render(<UploadPage />);

    const file = new File(['data'], 'test.csv', { type: 'text/csv' });
    const input = screen.getByRole('button', { name: /upload/i });

    fireEvent.click(input);
    // Simulate file selection...

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalled();
    });
  });

  it('shows error on invalid file', async () => {
    render(<UploadPage />);

    const input = screen.getByRole('button', { name: /upload/i });
    fireEvent.click(input);
    // Select non-CSV file...

    await waitFor(() => {
      expect(screen.getByText(/invalid file/i)).toBeInTheDocument();
    });
  });
});
```

### Service Testing

```typescript
// frontend/src/__tests__/services/transactionService.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { transactionService } from '../../services/transactionService';

describe('transactionService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('lists transactions', async () => {
    const mockData = [
      {
        id: '1',
        description: 'Test transaction',
        amount: 100,
        category_final: 'groceries'
      }
    ];

    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockData,
    } as any);

    const result = await transactionService.listTransactions();

    expect(result).toEqual(mockData);
  });

  it('handles API errors', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ detail: 'Server error' }),
    } as any);

    await expect(
      transactionService.listTransactions()
    ).rejects.toThrow();
  });
});
```

### State Management Testing

```typescript
// frontend/src/__tests__/store/transactionStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useTransactionStore } from '../../store/transactionStore';

describe('transactionStore', () => {
  beforeEach(() => {
    // Reset store
    useTransactionStore.setState({
      transactions: [],
      accounts: [],
    });
  });

  it('adds transaction', () => {
    const { getState, setState } = useTransactionStore;
    
    setState({
      transactions: [{
        id: '1',
        description: 'Test',
        amount: 100,
      }]
    });

    expect(getState().transactions).toHaveLength(1);
  });

  it('filters transactions by category', () => {
    const { getState, filterByCategory } = useTransactionStore;
    
    setState({
      transactions: [
        { id: '1', category_final: 'groceries' },
        { id: '2', category_final: 'rent' },
      ]
    });

    const filtered = getState().transactions.filter(
      t => t.category_final === 'groceries'
    );

    expect(filtered).toHaveLength(1);
  });
});
```

---

## Coverage Standards

### Minimum Requirements
- **Critical Services** (transaction_service, ml_service): 70%+
- **API Routes**: 50%+ (cover happy path + error cases)
- **Utility Functions**: 80%+
- **Components**: 40%+ (cover main flows)

### Excluded from Coverage
- `__init__.py` files
- Configuration files
- Third-party imports

### Generate Coverage Report
```bash
# Backend
pytest --cov=app --cov-report=html
# Report at: htmlcov/index.html

# Frontend
npm run test -- --coverage
# Report at: coverage/index.html
```

---

## Mocking Strategy

### When to Mock
- ✅ External API calls (http requests)
- ✅ Database operations (use test database instead)
- ✅ ML model predictions (for speed)
- ✅ File operations (read/write CSV)
- ❌ Core business logic (test real behavior)

### Example: Mocking ML Service
```python
# backend/tests/test_api/test_transactions.py
from unittest.mock import patch

@patch('app.api.transactions.MLService.predict')
def test_upload_with_mocked_ml(mock_predict, test_db):
    mock_predict.return_value = ("groceries", 0.95)
    
    response = client.post(
        "/api/v1/upload",
        files={"file": ("test.csv", csv_content)}
    )
    
    assert response.status_code == 200
    assert response.json()["transactions"][0]["category_predicted"] == "groceries"
```

---

## Continuous Integration

### GitHub Actions Workflow (Optional)
```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      mariadb:
        image: mariadb:11
        env:
          MYSQL_ROOT_PASSWORD: root
          MYSQL_DATABASE: family_budget

    steps:
      - uses: actions/checkout@v3
      
      - name: Test Backend
        run: |
          cd backend
          pip install -r requirements.txt pytest pytest-cov
          pytest --cov=app --cov-fail-under=70

      - name: Test Frontend
        run: |
          cd frontend
          npm install
          npm run test -- --coverage
```

---

## Resources

- [pytest Documentation](https://docs.pytest.org)
- [Testing Library Documentation](https://testing-library.com)
- [vitest Documentation](https://vitest.dev)
- [FastAPI Testing Guide](https://fastapi.tiangolo.com/advanced/testing-dependencies/)
