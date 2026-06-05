# Troubleshooting Guide

This guide helps resolve common issues when developing, building, and running the Family Budget application.

## Docker Issues

### Docker Build Fails: "npm ci can only install with an existing package-lock.json"

**Problem**: Frontend Docker image fails to build because `npm ci` strict mode requires a `package-lock.json` file.

**Root Cause**: The `package-lock.json` is not committed to version control by design (manages lock file locally), but Docker needs it for reproducible builds.

**Solution**:
1. Generate `package-lock.json` locally:
   ```bash
   cd frontend/
   npm install --legacy-peer-deps
   ```

2. Verify the file is created:
   ```bash
   ls -la package-lock.json
   ```

3. Rebuild Docker image:
   ```bash
   docker-compose build
   ```

**Prevention**: The `package-lock.json` is now included in the repository root, so this shouldn't occur on subsequent checkouts.

---

### Docker Services Start But MariaDB Is Unhealthy

**Problem**: `docker-compose up` shows "dependency failed to start: container family-budget-db is unhealthy"

**Root Cause**: MariaDB needs 30-60 seconds on first startup to initialize. The default healthcheck was timing out too quickly.

**Solution**:
1. Wait longer for MariaDB initialization (30+ seconds):
   ```bash
   docker-compose down
   docker-compose up --wait  # Built-in timeout handling (if Docker v2.1+)
   ```

2. Manual approach with delayed check:
   ```bash
   docker-compose down
   docker-compose up -d
   sleep 30
   docker-compose ps
   ```

3. Verify database connectivity:
   ```bash
   docker exec family-budget-db mysqladmin ping -h localhost
   ```

**Prevention**: The `docker-compose.yml` now includes `start_period: 30s` for MariaDB healthchecks.

---

### "Can't connect to MySQL server" in Backend Logs

**Problem**: Backend startup shows "Can't connect to MySQL server on 'mariadb:3306'"

**Root Cause**: 
- Backend starts before database is truly ready (despite healthcheck passing)
- MariaDB user/password mismatch
- Docker network not properly connected

**Solutions**:

*Option 1 - Wait for database*:
```bash
docker-compose down
docker-compose up -d
sleep 10  # Extra buffer beyond healthcheck
docker-compose logs backend
```

*Option 2 - Verify credentials*:
```bash
# Check docker-compose.yml has matching credentials
cat docker-compose.yml | grep -A2 'MYSQL_'
cat docker-compose.yml | grep 'DATABASE_URL'

# Should match: mysql+pymysql://budget_user:budget_password@mariadb:3306/family_budget
```

*Option 3 - Check network connectivity*:
```bash
docker exec family-budget-api ping -c 3 mariadb
```

---

### Port Conflicts

**Problem**: `docker-compose up` shows "port is already allocated"

**Solution**: Check which application is using the port:

```bash
# Find process on port 3306 (MariaDB)
lsof -i :3306

# Find process on port 8000 (Backend)
lsof -i :8000

# Find process on port 5173 (Frontend)
lsof -i :5173

# Kill process (if needed)
kill -9 <PID>

# Or use different ports in docker-compose.yml
# Change: "8005:8000" for backend, "5174:5173" for frontend, etc.
```

---

## Backend Issues

### "ModuleNotFoundError: No module named 'app'"

**Problem**: When running backend locally, Python can't find the app module.

**Solution**:

*For development*:
```bash
cd backend/
export PYTHONPATH=$PWD:$PYTHONPATH
uvicorn app.main:app --reload
```

*With poetry/pipenv*:
```bash
poetry run uvicorn app.main:app --reload
# or
pipenv run uvicorn app.main:app --reload
```

---

### "No tables in database" / SQLAlchemy Error

**Problem**: Backend starts but encounters errors like "Table 'family_budget.account' doesn't exist"

**Root Cause**: SQLAlchemy table creation failed or database connection not established.

**Solution**:

1. Verify database exists:
   ```bash
   docker exec family-budget-db mysql -u budget_user -p<your-password> family_budget -e "SHOW TABLES;"
   ```

2. If no tables, manually trigger creation:
   ```bash
   docker exec family-budget-api python -c "from app.db.database import engine; from app.models.transaction import Base; Base.metadata.create_all(bind=engine)"
   ```

3. Check backend logs for SQL errors:
   ```bash
   docker-compose logs backend | grep -i error
   ```

---

### ML Model Not Loading / Categorization Always Returns None

**Problem**: Transaction categorization returns `None` or default category.

**Root Cause**: ML model file not found in `/app/ml/models/`

**Solution**:

1. Check model directory exists and has files:
   ```bash
   docker exec family-budget-api ls -la app/ml/models/
   ```

2. Force model retrain:
   ```bash
   # Via API
   curl -X POST http://localhost:8000/ml/retrain \
     -H "Content-Type: application/json" \
     -d '{"sample_size": 50}'
   
   # Or via frontend: Review page → "Retrain Model" button
   ```

3. Verify training data exists:
   ```bash
   docker exec family-budget-db mysql -u budget_user -p<your-password> family_budget \
     -e "SELECT COUNT(*) FROM training_data;"
   ```

---

### CSV Upload Fails / Empty File After Upload

**Problem**: Upload completes but transactions don't appear or file is truncated.

**Root Cause**:
- Network timeout (large files)
- Missing bank format detection
- Duplicate transaction filtering

**Solutions**:

1. Check file size limit (set in `.env` or backend config):
   ```bash
   # Default is 100MB via Docker volumes
   # Increase by modifying docker-compose.yml volumes or backend app config
   ```

2. Verify CSV format:
   ```bash
   head -5 yourfile.csv | cat -A  # Show all characters
   ```

3. Force complete reprocessing:
   ```bash
   # Clear duplicate cache
   docker exec family-budget-db mysql -u budget_user -pbudget_password family_budget \
     -e "DELETE FROM training_data WHERE id IS NOT NULL; DELETE FROM transactions WHERE id IS NOT NULL;"
   
   # Re-upload file
   ```

---

## Frontend Issues

### "Vite server failed to start" / Port 5173 Error

**Problem**: Frontend container exits or shows network errors.

**Solution**:

1. Check if port is in use:
   ```bash
   lsof -i :5173
   ```

2. Check frontend logs:
   ```bash
   docker-compose logs frontend
   ```

3. Rebuild with verbose output:
   ```bash
   docker-compose build --no-cache frontend
   docker-compose up frontend
   ```

---

### "Cannot GET /" / Blank White Page

**Problem**: Browser shows blank page or "Cannot GET /" error.

**Root Cause**: Vite development server not responding or CORS/API endpoint issues.

**Solutions**:

1. Verify Vite is running:
   ```bash
   docker-compose logs frontend | grep "Local:"
   ```

2. Check API connectivity:
   ```bash
   # From browser console
   fetch('http://localhost:8000/health').then(r => r.json()).then(console.log)
   ```

3. Check CORS configuration in backend/app/main.py:
   ```python
   # Should allow frontend origin
   allow_origins=["http://localhost:5173", "http://localhost:80"]
   ```

---

### "GET /api/... failed" in Network Tab

**Problem**: API calls from frontend return 404 or connection refused.

**Root Cause**: Backend not accessible or API endpoints missing trailing slashes.

**Solution**:

1. Verify backend is running:
   ```bash
   curl -s http://localhost:8000/docs | head -20
   ```

2. Check frontend environment variable:
   ```bash
   # In frontend/.env or docker-compose.yml
   VITE_API_URL=http://backend:8000/api/v1  # Docker compose network
   VITE_API_URL=http://localhost:8000/api/v1  # Local development
   ```

3. Rebuild frontend with correct API URL:
   ```bash
   docker-compose build frontend
   ```

---

## Development Workflow Issues

### "Hot Reload Not Working" / Changes Don't Reflect

**Problem**: Modifying code doesn't automatically refresh in browser or container.

**Root Cause**: Volumes not properly mounted or watch feature disabled.

**Solution**:

1. Verify volumes in docker-compose.yml:
   ```yaml
   volumes:
     - ./frontend:/app           # Front-end source
     - /app/node_modules         # Exclude dependencies
     - ./backend:/app            # Back-end source
   ```

2. Restart containers:
   ```bash
   docker-compose down
   docker-compose up --build
   ```

3. For npm dependencies changes:
   ```bash
   # Rebuild and ensure node_modules are fresh
   docker-compose build --no-cache frontend
   ```

---

### Local Development (Without Docker)

**Setup**:

1. Backend:
   ```bash
   cd backend/
   python -m venv venv
   source venv/bin/activate  # or venv\Scripts\activate on Windows
   pip install -r requirements.txt
   
   # Set database URL
   export DATABASE_URL="mysql+pymysql://root:<your-password>@127.0.0.1:3306/family_budget"
   
   # Run
   uvicorn app.main:app --reload --port 8000
   ```

2. Frontend:
   ```bash
   cd frontend/
   npm install --legacy-peer-deps
   npm run dev  # Runs on http://localhost:5173
   ```

3. Database:
   ```bash
   # Install MariaDB or MySQL locally, then create database
   mysql -u root -p < /dev/null << EOF
   CREATE DATABASE family_budget CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   CREATE USER 'budget_user'@'localhost' IDENTIFIED BY '<your-secure-password>';
   GRANT ALL PRIVILEGES ON family_budget.* TO 'budget_user'@'localhost';
   FLUSH PRIVILEGES;
   EOF
   ```

---

## Performance & Optimization

### Backend Slow / High CPU Usage

**Causes**:
- ML model vectorization on every request
- Unindexed database queries
- Large CSV imports without pagination

**Optimizations**:

1. Cache ML model in memory:
   ```python
   # In backend/app/services/ml_service.py
   # Model is already cached after first load
   # Verify with: docker-compose logs backend | grep "Loading model"
   ```

2. Add database indexes:
   ```sql
   ALTER TABLE transactions ADD INDEX idx_account_date (account_id, created_at);
   ALTER TABLE transactions ADD INDEX idx_category (category);
   ```

3. Paginate large uploads:
   - Current implementation splits at 10K rows
   - Modify in `backend/app/services/normalization.py` if needed

---

### Frontend Slow / High Memory Usage

**Causes**:
- AG Grid loading millions of rows
- Unoptimized Recharts re-renders
- Large bundle size

**Solutions**:

1. Implement pagination in Review page:
   ```typescript
   // Modify frontend/src/pages/ReviewPage.tsx
   // Currently loads all transactions - add limit=1000
   ```

2. Optimize bundle:
   ```bash
   npm run build
   # Check dist/ size
   ls -lh frontend/dist/
   ```

3. Enable virtualization in AG Grid (already configured)

---

## Additional Resources

- **FastAPI Documentation**: https://fastapi.tiangolo.com
- **React Documentation**: https://react.dev
- **Docker Documentation**: https://docs.docker.com
- **MariaDB Documentation**: https://mariadb.com/kb/en/
- **Scikit-learn ML**: https://scikit-learn.org

---

## Getting Help

If issues persist:

1. Collect full logs:
   ```bash
   docker-compose logs > logs.txt 2>&1
   ```

2. Check system resources:
   ```bash
   docker stats
   df -h
   free -h
   ```

3. Review application configuration in:
   - `backend/app/main.py` - FastAPI setup
   - `backend/.env` - Environment variables
   - `frontend/.env` - Frontend configuration
   - `docker-compose.yml` - Service configuration
