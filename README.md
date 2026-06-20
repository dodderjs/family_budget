# Family Budget - Financial Transaction Analysis System

A production-ready full-stack monorepo for analyzing bank transactions with ML-powered categorization and analytics.

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Git

### Setup & Run

```bash
# Clone and navigate
cd family_budget

# Create environment file
cp .env.example .env

# Start all services
docker-compose up --build

# Frontend: http://localhost:5173
# Backend API: http://localhost:8000
# Docs: http://localhost:8000/docs
```

## 📊 Architecture

### Backend (FastAPI)
- **API**: REST endpoints for uploads, transactions, analytics
- **Database**: MariaDB with SQLAlchemy ORM
- **ML**: sklearn-based transaction categorization
- **Migrations**: Alembic for schema versioning

### Frontend (React + Vite)
- **Pages**: Upload, Review, Validation, Analytics Dashboard
- **State**: Zustand for global state
- **Tables**: AG Grid for transaction review
- **Charts**: Recharts for analytics

### Database
- Accounts
- Transactions  
- Categories
- Training Data

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| [SETUP.md](SETUP.md) | Installation and initial setup |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Development environment guide |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Production deployment instructions |
| [API_REFERENCE.md](API_REFERENCE.md) | Complete API endpoint documentation |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System design, data model, and architecture |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | Common issues and solutions |
| [OPTIMIZATION.md](OPTIMIZATION.md) | Performance improvements and best practices |
| [QUICK_REFERENCE.md](QUICK_REFERENCE.md) | Essential commands and workflows |
| [CHECKLIST.md](CHECKLIST.md) | Production readiness checklist |

## 🎯 Features

- ✅ Multi-format CSV upload
- ✅ Transaction deduplication (hash fingerprints)
- ✅ ML categorization (TF-IDF + Logistic Regression)
- ✅ Transfer detection
- ✅ Analytics dashboard
- ✅ Category review & correction
- ✅ Hot reload development

## 📁 Project Structure

```
family_budget/
├── backend/
│   ├── app/
│   │   ├── api/          # Route handlers
│   │   ├── services/     # Business logic
│   │   ├── ml/           # ML pipelines
│   │   ├── db/           # Database connections
│   │   ├── models/       # SQLAlchemy models
│   │   └── main.py       # FastAPI app
│   ├── alembic/          # Database migrations
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/        # Route pages
│   │   ├── components/   # Reusable components
│   │   ├── store/        # Zustand stores
│   │   ├── services/     # API clients
│   │   ├── utils/        # Helpers
│   │   └── App.tsx
│   ├── package.json
│   └── Dockerfile
├── data/                 # Sample CSVs
└── docker-compose.yml
```

## 🔧 API Endpoints

### Upload & Normalization
- `POST /upload` - Upload CSV file
- `POST /transactions/normalize` - Normalize transaction format

### Transactions
- `GET /transactions` - List all transactions
- `GET /transactions/review` - Get transactions for review
- `PATCH /transactions/:id/category` - Update category

### Analytics
- `GET /analytics/summary` - Summary statistics
- `GET /analytics/charts` - Chart data

### ML
- `POST /ml/retrain` - Retrain categorization model

## 🗄️ Sample Data

Real-world bank/card exports for testing the importer against actual formats
(Revolut, Curve, MBH Bank, K&H Bank) are in `/example`.

`/data` also has two minimal CSVs (`bank_a_transactions.csv`,
`bank_b_transactions.csv`) with plain `date,amount,description`-style columns
that exercise the `generic` fallback format.

## 🐛 Debugging

### Backend Debugging
After starting docker-compose:
1. In VSCode: Run "Python: Attach using debugpy"
2. Set breakpoints
3. API requests will pause at breakpoints

### Database Access
```bash
docker-compose exec mariadb mysql -u budget_user -p family_budget
```

## 📝 Development Workflow

1. **Upload CSV** → Normalized & deduplicated
2. **ML Categorization** → Automatic classification
3. **Review & Validate** → User corrections
4. **Analytics** → Visualize trends

## 🔐 Tech Stack

- **Backend**: FastAPI + Python 3.11 + SQLAlchemy
- **Database**: MariaDB 11
- **Frontend**: React + TypeScript + Vite
- **ML**: scikit-learn + pandas
- **UI**: Mantine + AG Grid + Recharts
- **Docker**: Docker Compose for orchestration
