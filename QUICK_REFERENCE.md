# Quick Reference Guide

Essential commands and workflows for the Family Budget application.

## Docker Commands

### Build & Run
```bash
# Build all images
docker-compose build

# Start services
docker-compose up

# Start in background
docker-compose up -d

# Stop services
docker-compose down

# Clean up (removes containers and volumes)
docker-compose down -v

# Rebuild and start
docker-compose up --build

# View logs
docker-compose logs

# Follow logs for specific service
docker-compose logs -f backend
docker-compose logs -f frontend
docker-compose logs -f mariadb

# Check service status
docker-compose ps
```

### Debugging

```bash
# Get shell access to container
docker exec -it family-budget-api bash
docker exec -it family-budget-web sh
docker exec -it family-budget-db bash

# View resource usage
docker stats

# Inspect container
docker inspect family-budget-api

# View past logs
docker logs family-budget-api | tail -100
```

---

## Backend Development

### Local Development (no Docker)

```bash
# Setup virtual environment
cd backend/
python -m venv venv
source venv/bin/activate  # Linux/Mac
# or
venv\Scripts\activate  # Windows

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export DATABASE_URL="mysql+pymysql://budget_user:<your-password>@localhost:3306/family_budget"
export PYTHONPATH=$PWD:$PYTHONPATH
export DEBUG=1

# Run development server
uvicorn app.main:app --reload

# Run with debugger
python -m debugpy --listen 5678 -m uvicorn app.main:app --reload
```

### Common Development Tasks

```bash
# Run tests (if test suite exists)
pytest

# Run with specific logging
DEBUG=1 uvicorn app.main:app --reload --log-level debug

# Check code syntax
python -m py_compile app/**/*.py

# Format code
black app/
isort app/

# Lint code
flake8 app/
pylint app/
```

### Database Management

```bash
# Connect to database (via Docker)
docker exec -it family-budget-db mysql -u budget_user -p<your-password> family_budget

# Useful SQL commands
SHOW TABLES;
DESCRIBE transactions;
SELECT COUNT(*) FROM transactions;
SELECT DISTINCT category FROM transactions;
SELECT * FROM transactions LIMIT 5;

# Create backup
docker exec family-budget-db mysqldump -u budget_user -p<your-password> family_budget > backup.sql

# Restore backup
docker exec -i family-budget-db mysql -u budget_user -p<your-password> family_budget < backup.sql
```

### API Testing

```bash
# View interactive documentation
curl http://localhost:8000/docs

# Create account
curl -X POST http://localhost:8000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"name":"Main Account","account_number":"****1234"}'

# Get accounts
curl http://localhost:8000/api/accounts

# Upload CSV
curl -X POST http://localhost:8000/api/upload \
  -F "file=@data/bank_a_transactions.csv" \
  -F "account_id=123"

# Get transactions
curl "http://localhost:8000/api/transactions?account_id=123&limit=10"

# Get analytics
curl "http://localhost:8000/api/analytics/summary/123"

# Retrain ML model
curl -X POST http://localhost:8000/ml/retrain \
  -H "Content-Type: application/json" \
  -d '{"sample_size":100}'
```

---

## Frontend Development

### Local Development (no Docker)

```bash
# Install dependencies
cd frontend/
npm install --legacy-peer-deps

# Run development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Run linting
npm run lint

# Format code
npm run format
```

### Common Frontend Tasks

```bash
# Clear node_modules and reinstall
rm -rf node_modules package-lock.json
npm install --legacy-peer-deps

# Update dependencies
npm update

# Check for security vulnerabilities
npm audit

# Fix vulnerabilities automatically
npm audit fix

# View bundle size
npm run build
ls -lh dist/

# Analyze bundle composition
npm run build -- --analyze
```

### Browser DevTools

```bash
# In browser console for API testing
fetch('/api/accounts').then(r => r.json()).then(console.log)

# Check environment
console.log(import.meta.env.VITE_API_URL)

# Check Zustand store state
import { useStore } from './store/transactionStore'
useStore.subscribe(state => console.log(state))
```

---

## File Structure Reference

```
family_budget/
├── backend/
│   ├── app/
│   │   ├── api/
│   │   │   └── transactions.py           # All REST endpoints
│   │   ├── db/
│   │   │   └── database.py              # SQLAlchemy setup
│   │   ├── models/
│   │   │   ├── transaction.py           # ORM models
│   │   │   └── schemas.py               # Pydantic schemas
│   │   ├── services/
│   │   │   ├── transaction_service.py   # Business logic
│   │   │   ├── ml_service.py            # ML categorization
│   │   │   ├── normalization.py         # CSV parsing
│   │   │   └── format_service.py        # Bank format detection
│   │   ├── main.py                      # FastAPI app entry
│   │   └── ml/models/                   # ML model storage
│   ├── requirements.txt
│   └── Dockerfile
│
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── UploadPage.tsx           # CSV upload interface
│   │   │   ├── ReviewPage.tsx           # Transaction review grid
│   │   │   └── AnalyticsPage.tsx        # Dashboard visualizations
│   │   ├── components/
│   │   │   └── [Optional UI components]
│   │   ├── store/
│   │   │   └── transactionStore.ts      # Zustand state
│   │   ├── services/
│   │   │   └── api.ts                   # API client
│   │   ├── App.tsx                      # Main component
│   │   └── main.tsx                     # React entry
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── Dockerfile
│
├── data/
│   ├── bank_a_transactions.csv          # Sample test data
│   └── bank_b_transactions.csv
│
├── docker-compose.yml
├── README.md
├── SETUP.md
├── DEVELOPMENT.md
├── DEPLOYMENT.md
├── API_REFERENCE.md
├── CHECKLIST.md
├── TROUBLESHOOTING.md
└── OPTIMIZATION.md
```

---

## Common Workflows

### Workflow: Add New API Endpoint

1. Add schema in `backend/app/models/schemas.py`
2. Add route in `backend/app/api/transactions.py`
3. Add business logic in `backend/app/services/transaction_service.py`
4. Test with curl or Postman
5. Update frontend API client in `frontend/src/services/api.ts`
6. Update frontend components to call new endpoint

### Workflow: Add New Database Table

1. Add ORM model in `backend/app/models/transaction.py`
2. Import in `backend/app/db/database.py` 
3. Restart backend (tables auto-created on startup)
4. Verify with: `docker exec family-budget-db mysql -e "SHOW TABLES;"`

### Workflow: Deploy to Production

1. Set production environment variables
2. Update `docker-compose.yml` with production settings
3. Build images: `docker-compose build`
4. Push to registry: `docker push myregistry/family-budget-backend:latest`
5. Deploy on server with `docker-compose up -d`
6. Verify health: `docker-compose ps`

### Workflow: Debug Production Issue

1. Check logs: `docker-compose logs backend | tail -100`
2. Connect to database: `docker exec -it family-budget-db bash`
3. Check data: `SELECT * FROM transactions WHERE created_at > NOW() - INTERVAL 1 DAY;`
4. Restart service: `docker-compose restart backend`
5. Monitor: `docker stats`

---

## Environment Variables

```bash
# Backend
DATABASE_URL=mysql+pymysql://budget_user:<your-secure-password>@mariadb:3306/family_budget
PYTHONUNBUFFERED=1          # Immediate stdout flushing
DEBUG=0                     # False in production
SECRET_KEY=your-secret-key
ALLOWED_HOSTS=localhost,yourdomain.com
LOG_LEVEL=INFO

# Frontend
VITE_API_URL=http://localhost:8000/api/v1    # Local dev
VITE_API_URL=http://backend:8000      # Docker
VITE_API_URL=https://api.yourdomain.com  # Production

# MariaDB
MYSQL_ROOT_PASSWORD=rootpassword
MYSQL_DATABASE=family_budget
MYSQL_USER=budget_user
MYSQL_PASSWORD=budget_password
```

---

## Performance Tips

### Backend
- ✅ Use connection pooling (configured)
- ✅ Add database indexes for frequent queries
- ⏳ Implement caching for analytics
- ⏳ Use async/await for I/O operations
- ☐ Monitor slow queries in production

### Frontend
- ✅ Virtual scrolling enabled in AG Grid
- ✅ Component memoization where needed
- ⏳ Code splitting by route
- ⏳ Image optimization
- ☐ Service worker for offline support

### Infrastructure
- ✅ Multi-stage Docker builds
- ✅ Resource limits configured
- ✅ Health checks enabled
- ⏳ Add monitoring/observability
- ☐ Set up CI/CD pipeline

---

## Useful Links

- **API Docs (local)**: http://localhost:8000/docs
- **API Docs (interactive)**: http://localhost:8000/redoc
- **Frontend (local)**: http://localhost:5173
- **FastAPI Docs**: https://fastapi.tiangolo.com
- **React Docs**: https://react.dev
- **Docker Docs**: https://docs.docker.com

---

## Getting Help

1. Check [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for common issues
2. Review logs: `docker-compose logs -f`
3. Inspect containers: `docker exec -it CONTAINER bash`
4. Check [API_REFERENCE.md](API_REFERENCE.md) for endpoint details
5. See [DEVELOPMENT.md](DEVELOPMENT.md) for development setup
