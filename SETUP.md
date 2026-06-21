# Family Budget - Complete Setup Guide

## 🚀 Quick Start (Production Ready)

### Prerequisites
- Docker & Docker Compose installed
- Git

### One-Command Setup

```bash
cd family_budget
cp .env.example .env
docker-compose up --build

# Services will be available at:
# - Frontend: http://localhost:5173
# - Backend API: http://localhost:8000
# - API Docs: http://localhost:8000/docs
# - MariaDB: localhost:3306
```

## 📋 First Steps

1. **Create an Account**
   - Frontend: Click to create an account (Bank A or Bank B)
   - This account will receive your transactions

2. **Upload a CSV**
   - Use sample files from `/data/`:
     - `bank_a_transactions.csv` - Format A layout
     - `bank_b_transactions.csv` - Format B layout
   - Or prepare your own CSV with columns:
     ```
     Transaction Date, Amount, Description, Merchant, Currency
     ```

3. **Review & Categorize**
   - Navigate to Review page
   - Auto-predicted categories appear in the table
   - Click on category to update with correct value
   - Model learns from your corrections

4. **View Analytics**
   - Navigate to Analytics Dashboard
   - See income vs expenses breakdown
   - Monthly trends and category analysis

## 🏗️ Architecture Overview

### Backend Services
- **FastAPI** REST API on port 8000
- **MariaDB** database on port 3306
- **ML Service** for transaction categorization
- **Normalization Service** for CSV parsing

### Frontend
- **Vite + React** dev server on port 5173
- Hot reload enabled
- TypeScript for type safety

### Database
- **MariaDB 11** with persistent volume
- Auto-initializes on first run
- Alembic migrations (ready for extensions)

## 📖 API Endpoints

### Accounts
```
POST   /api/v1/accounts               # Create account
GET    /api/v1/accounts               # List accounts
```

### Upload & Normalize
```
POST   /api/v1/upload                 # Upload CSV (preview)
POST   /api/v1/transactions/normalize # Process & store transactions
```

### Transactions
```
GET    /api/v1/transactions           # List all transactions
GET    /api/v1/transactions/review    # Get transactions pending review
PATCH  /api/v1/transactions/:id       # Update category
```

### Analytics
```
GET    /api/v1/analytics/summary      # Summary stats
GET    /api/v1/analytics/breakdown    # Category breakdown
GET    /api/v1/analytics/trends       # Monthly trends
```

### ML
```
POST   /api/v1/ml/retrain             # Retrain model with corrections
```

## 🔧 Development Workflow

### Hot Reload
Both frontend and backend support hot reload:
- **Backend**: Changes to `/backend/app` reload automatically
- **Frontend**: Changes to `/frontend/src` reload automatically

### Debugging Backend
1. Set breakpoints in VSCode
2. Connect debugpy:
   ```
   python -m debugpy --listen 5678 --wait-for-client -m uvicorn app.main:app
   ```
3. Or already configured in docker-compose on port 5678

### Database Access
```bash
# Connect to MariaDB
docker-compose exec mariadb mysql -u budget_user -p family_budget

# Or use credentials from .env:
# User: budget_user
# Password: Change this to a strong password
```

## 📊 Data Models

### Transaction
```python
{
  "id": "uuid",
  "account_id": "uuid",
  "date": "2024-01-15",
  "amount": 150.00,
  "currency": "USD",
  "description": "Whole Foods Market",
  "merchant": "Grocery Store",
  "hash_fingerprint": "sha256_hash",
  "category_predicted": "groceries",
  "category_confidence": 0.92,
  "category_final": "groceries",
  "is_transfer": false,
  "transfer_match_id": null,
  "created_at": "2024-01-15T10:30:00"
}
```

### ML Categories
- `groceries` - Food & supermarkets
- `rent` - Housing payments
- `salary` - Income
- `utilities` - Bills & services
- `transport` - Gas, transit, rideshares
- `entertainment` - eating_out, events, movies
- `other` - Uncategorized

## 🔄 Upload Flow

1. **Parse CSV** → PapaParse on frontend
2. **Detect Format** → Backend auto-detects bank format
3. **Suggest Mapping** → Returns field mapping
4. **User Confirmation** → Frontend shows preview
5. **Normalize** → Backend converts to standard schema
6. **Deduplicate** → Hash-based duplicate detection
7. **ML Predict** → Automatic categorization
8. **Store** → Transactions saved to MariaDB

## ⚙️ Configuration

### Environment Variables (.env)
```env
# Database
MYSQL_ROOT_PASSWORD=<your-secure-password>
MYSQL_DATABASE=family_budget
MYSQL_USER=budget_user
MYSQL_PASSWORD=<your-secure-password>

# Backend
DATABASE_URL=mysql+pymysql://budget_user:<your-secure-password>@mariadb:3306/family_budget
DEBUG=1
PYTHONUNBUFFERED=1

# Frontend
VITE_API_URL=http://localhost:8000/api/v1
```

## 📦 Docker Services

### Service Definitions
```yaml
mariadb:    # Database
  Port: 3306
  Volume: mariadb_data

backend:    # FastAPI
  Port: 8000 (API)
  Port: 5678 (Debugger)
  Volume: ./backend (hot reload)

frontend:   # Vite + React
  Port: 5173
  Volume: ./frontend/src (hot reload)
```

## 🚨 Troubleshooting

### Database Connection Fails
```bash
# Check MariaDB is running
docker-compose ps

# Check logs
docker-compose logs mariadb

# Verify connection string in .env
```

### Frontend Can't Connect to API
```bash
# Check backend is running
docker-compose logs backend

# Verify VITE_API_URL in frontend env
# Should be http://backend:8000 in container
# http://localhost:8000 from browser
```

### Port Already in Use
```bash
# Change ports in docker-compose.yml
# Or kill conflicting processes:
lsof -i :5173  # Frontend
lsof -i :8000  # Backend
lsof -i :3306  # Database

# Then:
kill -9 <PID>
```

### Rebuild Everything
```bash
docker-compose down -v  # Remove volumes
docker-compose build --no-cache
docker-compose up
```

## 📈 Example Workflow

```bash
# 1. Start services
docker-compose up --build

# 2. Create account (via frontend or API)
curl -X POST http://localhost:8000/api/v1/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"My Checking","bank_name":"Bank A"}'

# 3. Upload CSV (from frontend)
# Navigate to http://localhost:5173 and upload file

# 4. Review predictions
# Click on Review page

# 5. Correct categories
# Click on predicted categories to update

# 6. See analytics
# Navigate to Analytics page
```

## 🎯 Next Steps / Future Enhancements

- [ ] Export transactions to CSV/PDF
- [ ] Budget planning & alerts
- [ ] Multi-user support with authentication
- [ ] Bank API integration (Plaid, etc.)
- [ ] Mobile app
- [ ] Advanced ML model deployment
- [ ] Data visualization improvements

## 📝 Project Structure

```
family_budget/
├── backend/
│   ├── app/
│   │   ├── api/           # Route handlers
│   │   ├── services/      # Business logic
│   │   ├── ml/            # ML pipelines
│   │   ├── db/            # Database
│   │   ├── models/        # SQLAlchemy + Pydantic
│   │   └── main.py        # FastAPI app
│   ├── requirements.txt    # Python dependencies
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/         # React pages
│   │   ├── components/    # Reusable components
│   │   ├── services/      # API clients
│   │   ├── store/         # Zustand state
│   │   └── App.tsx        # Main app
│   ├── package.json       # Node dependencies
│   └── Dockerfile
├── data/                  # Sample CSVs
├── docker-compose.yml     # Orchestration
└── README.md             # This file
```

## 💡 Tips

- Sample data is in `/data/` for testing
- Model predictions improve with corrections
- Duplicate detection prevents data duplication
- Transfer detection identifies account-to-account movements
- All data is in MariaDB (can backup with `mysqldump`)

---

**Built with**: FastAPI • React • SQLAlchemy • scikit-learn • Docker
**Version**: 1.0.0
**Last Updated**: May 2024
