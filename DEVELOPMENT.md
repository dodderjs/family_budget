# Development Guide

## 🛠️ Local Development (Without Docker)

### Backend Setup

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export DATABASE_URL="mysql+pymysql://budget_user:<your-password>@localhost:3306/family_budget"
export DEBUG=1

# Run migrations (if using Alembic)
alembic upgrade head

# Start server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev

# Build for production
npm run build
```

## 🐛 Backend Debugging

### With VSCode

1. Install Python extension
2. Create `.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Python: FastAPI",
      "type": "python",
      "request": "launch",
      "module": "uvicorn",
      "args": ["app.main:app", "--reload"],
      "jinja": true,
      "cwd": "${workspaceFolder}/backend"
    }
  ]
}
```

3. Set breakpoints and press F5

### With Docker

```bash
# The debugpy is already configured in docker-compose.yml
# In VSCode, create launch config:

{
  "name": "Python: Remote Attach",
  "type": "python",
  "request": "attach",
  "connect": {
    "host": "localhost",
    "port": 5678
  },
  "pathMapping": {
    "/app": "${workspaceFolder}/backend"
  }
}
```

Then press F5 to attach debugger.

## 📝 Code Organization

### Backend Structure

```
app/
├── main.py              # FastAPI app initialization
├── api/
│   └── transactions.py  # Route handlers
├── services/
│   ├── transaction_service.py   # Business logic
│   ├── ml_service.py            # ML predictions
│   ├── normalization.py         # CSV normalization
│   └── format_service.py        # Bank format detection
├── models/
│   ├── transaction.py   # SQLAlchemy ORM
│   └── schemas.py       # Pydantic validation
└── db/
    └── database.py      # Database connection
```

### Frontend Structure

```
src/
├── App.tsx              # Main router
├── main.tsx             # Entry point
├── pages/
│   ├── UploadPage.tsx
│   ├── ReviewPage.tsx
│   └── AnalyticsPage.tsx
├── components/          # Reusable components
├── services/
│   ├── api.ts          # Axios instance
│   ├── transactionService.ts  # API calls
│   └── csvService.ts   # CSV utilities
├── store/
│   └── transactionStore.ts    # Zustand state
└── utils/
```

## 🧪 Testing

### Backend Unit Tests

```bash
cd backend
pip install pytest pytest-asyncio

# Run tests
pytest -v
```

### Example Test

```python
# test_services.py
from app.services.normalization import normalize_transaction

def test_normalize_transaction():
    row = {
        "Transaction Date": "2024-01-15",
        "Amount": "150.00",
        "Description": "Whole Foods",
        "Merchant": "Grocery"
    }
    mapping = {
        "dateField": "Transaction Date",
        "amountField": "Amount",
        "descriptionField": "Description",
        "merchantField": "Merchant"
    }
    
    result = normalize_transaction(row, mapping, "account-id")
    assert result["date"] == "2024-01-15"
    assert result["amount"] == 150.0
```

## 📦 Adding Dependencies

### Backend

```bash
cd backend
pip install new-package
pip freeze > requirements.txt

# Rebuild image
docker-compose build backend
```

### Frontend

```bash
cd frontend
npm install new-package
npm install --save-dev new-dev-package

# Rebuild image
docker-compose build frontend
```

## 🔄 Git Workflow

```bash
# Create feature branch
git checkout -b feature/your-feature

# Make changes, commit
git add .
git commit -m "feat: Add your feature"

# Push and create PR
git push origin feature/your-feature
```

## 📊 Database Migrations

Using Alembic:

```bash
cd backend

# Create new migration
alembic revision --autogenerate -m "Add new column"

# Review migration file in alembic/versions/

# Apply migration
alembic upgrade head

# Rollback
alembic downgrade -1
```

## 🚀 Performance Tips

### Backend
- Use database indexes on frequently queried columns
- Cache ML model in memory (already done in service)
- Use pagination for large result sets

### Frontend
- Lazy load pages with React.lazy()
- Memoize expensive computations with useMemo
- Virtual scrolling for large tables (AG Grid supports this)

## 📚 Useful Commands

```bash
# View logs
docker-compose logs -f backend
docker-compose logs -f frontend

# Connect to database
docker-compose exec mariadb mysql -u budget_user -p family_budget

# Restart a service
docker-compose restart backend

# Run a one-off command
docker-compose exec backend bash

# Clean up everything
docker-compose down -v
docker system prune -a
```

## 🔗 References

- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [SQLAlchemy Docs](https://docs.sqlalchemy.org/)
- [React Docs](https://react.dev/)
- [Zustand Docs](https://github.com/pmndrs/zustand)
- [AG Grid Docs](https://www.ag-grid.com/react-data-grid/)
- [Recharts Docs](https://recharts.org/)
