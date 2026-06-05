# Code Optimization Guide

This guide documents optimization strategies, best practices, and production-ready improvements for the Family Budget application.

## Table of Contents
1. [Backend Optimizations](#backend-optimizations)
2. [Database Optimizations](#database-optimizations)
3. [Frontend Optimizations](#frontend-optimizations)
4. [Infrastructure & Deployment](#infrastructure--deployment)
5. [Security Best Practices](#security-best-practices)
6. [Performance Monitoring](#performance-monitoring)

---

## Backend Optimizations

### 1. Async Request Handling

**Current State**: FastAPI uses synchronous database operations via pymysql.

**Optimization**: Migrate to async database operations:

```python
# Before (app/db/database.py)
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

engine = create_engine(DATABASE_URL, echo=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# After (async version)
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker

engine = create_async_engine(
    DATABASE_URL.replace("mysql+pymysql", "mysql+aiomysql"),
    echo=True,
    pool_pre_ping=True,
    pool_recycle=3600
)
SessionLocal = sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)

# Update routes to use async
@router.post("/transactions")
async def create_transaction(trans: TransactionCreate, db: AsyncSession = Depends(get_db)):
    # Uses async/await
    pass
```

**Impact**: 
- 2-5x faster under high concurrency
- Better resource utilization
- Non-blocking I/O

**Effort**: Medium (requires ORM refactor)

---

### 2. Connection Pooling Optimization

**Current State**: Default SQLAlchemy pool settings.

**Optimization**:

```python
# In app/db/database.py
engine = create_engine(
    DATABASE_URL,
    pool_size=20,              # Main pool connections
    max_overflow=10,           # Additional overflow connections
    pool_pre_ping=True,        # Verify connections before reuse
    pool_recycle=3600,         # Recycle connections every hour
    echo_pool=True,            # Log pool events
    connect_args={
        "connect_timeout": 10,
        "server_settings": {"application_name": "family_budget_app"}
    }
)
```

**Impact**:
- Prevents stale connection errors
- Better resource utilization under load
- Reduces database reconnection overhead

---

### 3. Query Optimization with Eager Loading

**Current State**: Lazy loading relationships in transactions.

**Optimization**:

```python
# In app/services/transaction_service.py
from sqlalchemy.orm import joinedload

# Before: N+1 query problem
transactions = db.query(Transaction).all()
for t in transactions:
    _ = t.account.name  # Additional query per transaction

# After: Single query with JOIN
transactions = db.query(Transaction).options(
    joinedload(Transaction.account),
    joinedload(Transaction.category)
).all()
```

**Impact**: 
- 10-100x faster for relationship-heavy queries
- Reduces database round trips

---

### 4. Caching Strategy

**Current State**: No caching layer.

**Optimization**: Add in-memory caching for frequently accessed data:

```python
# app/services/cache_service.py
from functools import lru_cache
from datetime import datetime, timedelta
import redis

class CacheService:
    def __init__(self):
        self.redis = redis.Redis(host='localhost', port=6379, db=0)
        self.ttl = 3600  # 1 hour
    
    def get_analytics_summary(self, account_id: str):
        cache_key = f"analytics:{account_id}"
        
        # Check cache first
        cached = self.redis.get(cache_key)
        if cached:
            return json.loads(cached)
        
        # Compute if not cached
        summary = self._compute_analytics(account_id)
        
        # Store in cache
        self.redis.setex(
            cache_key,
            self.ttl,
            json.dumps(summary, default=str)
        )
        
        return summary
    
    def invalidate_cache(self, account_id: str):
        self.redis.delete(f"analytics:{account_id}")
```

**Integration in routes**:

```python
from app.services.cache_service import CacheService

cache_service = CacheService()

@router.get("/analytics/summary/{account_id}")
def get_analytics_summary(account_id: str):
    return cache_service.get_analytics_summary(account_id)

@router.post("/transactions")
def create_transaction(trans: TransactionCreate):
    # ... create transaction ...
    # Invalidate cache
    cache_service.invalidate_cache(trans.account_id)
    return result
```

**Impact**:
- 100-1000x faster for read-heavy workloads
- Reduced database load

**Deployment**: Add Redis service to docker-compose.yml

---

### 5. Pagination for Large Result Sets

**Current State**: Returns all transactions in single request.

**Optimization**:

```python
# app/models/schemas.py
from pydantic import BaseModel, Field

class PaginationParams(BaseModel):
    skip: int = Field(0, ge=0, description="Number of records to skip")
    limit: int = Field(100, ge=1, le=1000, description="Records to return")

# app/api/transactions.py
@router.get("/transactions", response_model=Page[TransactionRead])
def get_transactions(
    account_id: str,
    pagination: PaginationParams = Depends(),
    db: Session = Depends(get_db)
):
    total = db.query(Transaction).filter(
        Transaction.account_id == account_id
    ).count()
    
    items = db.query(Transaction).filter(
        Transaction.account_id == account_id
    ).offset(pagination.skip).limit(pagination.limit).all()
    
    return Page(
        items=items,
        total=total,
        skip=pagination.skip,
        limit=pagination.limit
    )
```

**Frontend integration**:

```typescript
// frontend/src/services/api.ts
export async function getTransactions(
  accountId: string,
  skip: number = 0,
  limit: number = 100
) {
  const response = await fetch(
    `/api/transactions?account_id=${accountId}&skip=${skip}&limit=${limit}`
  );
  return response.json();
}
```

**Impact**:
- Reduced memory usage
- Faster response times for large datasets
- Better UX with progressive loading

---

### 6. Batch Processing for CSV Imports

**Current State**: Processes transactions in chunks of 10K.

**Optimization**: Add batch insert with bulk operations:

```python
# app/services/transaction_service.py
from sqlalchemy.dialects.mysql import insert

def batch_create_transactions(
    transactions: List[TransactionCreate],
    db: Session,
    batch_size: int = 5000
):
    """Batch insert transactions for performance"""
    
    for i in range(0, len(transactions), batch_size):
        batch = transactions[i:i + batch_size]
        
        # Use bulk insert for speed
        stmt = insert(Transaction).values([
            {
                'account_id': t.account_id,
                'date': t.date,
                'amount': t.amount,
                'description': t.description,
                'category': t.category,
                'hash_fingerprint': generate_fingerprint(t)
            }
            for t in batch
        ])
        
        # Ignore duplicates
        stmt = stmt.on_duplicate_key_update(
            id=stmt.inserted.id
        )
        
        db.execute(stmt)
        db.commit()
    
    return len(transactions)
```

**Impact**:
- 10x faster for large imports
- Reduced memory overhead

---

### 7. Async Background Tasks

**Current State**: Model retraining blocks request.

**Optimization**: Use Celery for async tasks:

```python
# app/tasks.py
from celery import Celery
from app.services.ml_service import ml_service

celery_app = Celery('family_budget')
celery_app.conf.broker_url = "redis://localhost:6379/0"
celery_app.conf.result_backend = "redis://localhost:6379/0"

@celery_app.task
def retrain_model_async(sample_size: int = 100):
    """Retrain ML model in background"""
    return ml_service.retrain(sample_size)

# In app/api/transactions.py
@router.post("/ml/retrain")
def retrain_model(params: RetrainParams):
    # Send to background task
    task = retrain_model_async.delay(params.sample_size)
    return {"task_id": task.id, "status": "processing"}

@router.get("/ml/retrain/{task_id}")
def get_retrain_status(task_id: str):
    """Check background task status"""
    task = retrain_model_async.AsyncResult(task_id)
    return {
        "task_id": task_id,
        "status": task.status,
        "result": task.result if task.ready() else None
    }
```

**Impact**:
- Endpoints return immediately
- Non-blocking long-running operations
- Better UX

---

## Database Optimizations

### 1. Add Strategic Indexes

```sql
-- In SCHEMA.md or migration script
ALTER TABLE transactions ADD INDEX idx_account_date 
    (account_id, created_at DESC);

ALTER TABLE transactions ADD INDEX idx_category 
    (category, created_at DESC);

ALTER TABLE transactions ADD INDEX idx_hash_fingerprint 
    (hash_fingerprint) UNIQUE;

ALTER TABLE training_data ADD INDEX idx_category 
    (category);

-- Composite index for analytics queries
ALTER TABLE transactions ADD INDEX idx_analytics 
    (account_id, category, created_at);
```

**Impact**:
- 10-100x faster on indexed columns
- Better analytics query performance

---

### 2. Query Analysis & EXPLAIN

```python
# app/utils/db_debug.py
from sqlalchemy import event
from sqlalchemy.engine import Engine
import logging

logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)

@event.listens_for(Engine, "before_cursor_execute")
def receive_before_cursor_execute(conn, cursor, statement, params, context, executemany):
    if "SELECT" in statement:
        explain = f"EXPLAIN {statement}"
        cursor.execute(explain, params)
        execution_plan = cursor.fetchall()
        cursor.execute(statement, params)
        logging.info(f"EXECUTION PLAN: {execution_plan}")
```

Use this to identify slow queries during development.

---

### 3. Connection & Resource Limits

```sql
-- In MariaDB docker-compose or my.cnf
SET GLOBAL max_connections = 1000;           # Allow more connections
SET GLOBAL connect_timeout = 10;
SET GLOBAL wait_timeout = 28800;             # 8 hours
SET SESSION sql_mode = '';                   # Compatibility
SET GLOBAL innodb_buffer_pool_size = 256M;   # Increase buffer pool
```

---

## Frontend Optimizations

### 1. Code Splitting & Lazy Loading

**Current State**: Single bundle loaded at startup.

**Optimization**: Split by route using React.lazy:

```typescript
// frontend/src/App.tsx
import { lazy, Suspense } from 'react';
import Loading from './components/Loading';

const UploadPage = lazy(() => import('./pages/UploadPage'));
const ReviewPage = lazy(() => import('./pages/ReviewPage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));

export function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/upload" element={<UploadPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
      </Routes>
    </Suspense>
  );
}
```

**Impact**:
- Initial bundle 40% smaller
- Faster initial page load
- Progressive loading

---

### 2. AG Grid Optimization

**Already implemented but can enhance**:

```typescript
// frontend/src/pages/ReviewPage.tsx
// Current: Virtual scrolling enabled
// Enhancement: Add row grouping

<AgGridReact
  rowData={transactions}
  columnDefs={columnDefs}
  pagination={true}
  paginationPageSize={50}
  rowGroupPanelShow="always"
  autoGroupColumnDef={{
    minWidth: 200,
  }}
  groupRowAggNodes={true}
/>
```

**Impact**: Better memory usage for large datasets

---

### 3. Mantine Component Optimization

```typescript
// frontend/src/components/Dashboard.tsx
import { useMemo } from 'react';

export function Dashboard() {
  // Expensive computation cached
  const processedChartData = useMemo(() => {
    return transactions
      .filter(t => t.date > cutoffDate)
      .reduce((acc, t) => {
        // Process data
        return acc;
      }, {});
  }, [transactions, cutoffDate]);

  return <Recharts data={processedChartData} />;
}
```

**Impact**: Prevents unnecessary re-renders

---

### 4. Image & Asset Optimization

```typescript
// frontend/vite.config.ts
export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['react', 'react-dom', 'zustand'],
          'ui': ['@mantine/core', '@mantine/hooks'],
          'charting': ['recharts'],
          'grid': ['ag-grid-react'],
        }
      }
    },
    // Minify inline SVGs
    minify: 'terser',
    terserOptions: {
      compress: { drop_console: true }
    }
  }
});
```

---

### 5. Bundle Size Analysis

```bash
# Analyze bundle
npm run build
npm install --save-dev webpack-bundle-analyzer

# In vite.config.ts
import { visualizer } from 'rollup-plugin-visualizer';

plugins: [
  visualizer({
    open: true,
    gzipSize: true,
    brotliSize: true,
  })
]

# Run and check dist/stats.html
```

---

## Infrastructure & Deployment

### 1. Multi-Stage Docker Builds

**Backend** (already optimized but example):

```dockerfile
# Stage 1: Builder
FROM python:3.11-slim as builder
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --user --no-cache-dir -r requirements.txt

# Stage 2: Runtime
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    mariadb-client && rm -rf /var/lib/apt/lists/*

# Copy only necessary files from builder
COPY --from=builder /root/.local /root/.local
ENV PATH=/root/.local/bin:$PATH

COPY . .
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python -c "import requests; requests.get('http://localhost:8000/docs')"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

**Impact**:
- Runtime image 40% smaller
- Reduced deploy time
- Better security (no build tools in runtime)

---

### 2. Resource Limits

```yaml
# docker-compose.yml
services:
  backend:
    # ... rest of config ...
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
        reservations:
          cpus: '1'
          memory: 512M

  frontend:
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M

  mariadb:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

---

### 3. Health Checks

**Already implemented** - current config:

```yaml
healthcheck:
  test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
  interval: 5s
  timeout: 20s
  retries: 15
  start_period: 30s
```

**For backend** (add if not present):

```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 5s
```

---

## Security Best Practices

### 1. Environment Variables

```bash
# .env (git-ignored)
DATABASE_URL=mysql+pymysql://budget_user:SECURE_PASSWORD@mariadb:3306/family_budget
SECRET_KEY=your-very-secure-random-key-here
DEBUG=0  # Always False in production
ALLOWED_HOSTS=localhost,yourdomain.com
```

```python
# app/config.py
from pydantic import BaseSettings

class Settings(BaseSettings):
    DATABASE_URL: str
    SECRET_KEY: str
    DEBUG: bool = False
    ALLOWED_HOSTS: List[str] = ["localhost"]

settings = Settings()
```

---

### 2. Input Validation

**Already implemented** with Pydantic - ensure all inputs validated:

```python
# app/models/schemas.py
from pydantic import BaseModel, EmailStr, validator

class TransactionCreate(BaseModel):
    account_id: str = Field(..., min_length=1, max_length=100)
    description: str = Field(..., min_length=1, max_length=500)
    amount: float = Field(..., gt=0)
    category: str = Field(..., regex="^[a-z_]+$")  # Only alphanumeric + underscore
    
    @validator('category')
    def validate_category(cls, v):
        valid_categories = ['groceries', 'rent', 'salary', 'utilities', 'transport', 'entertainment', 'other']
        if v not in valid_categories:
            raise ValueError(f'Invalid category: {v}')
        return v
```

---

### 3. CORS & Security Headers

```python
# app/main.py
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware

app.add_middleware(
    TrustedHostMiddleware,
    allowed_hosts=settings.ALLOWED_HOSTS
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Production: specific origin
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
    expose_headers=["X-Total-Count"]
)
```

---

### 4. Rate Limiting

```python
# app/middleware/rate_limit.py
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

# In main.py
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# On endpoints
@router.post("/upload")
@limiter.limit("5/minute")
def upload_csv(request: Request, file: UploadFile):
    # Rate limited to 5 requests per minute
    pass
```

---

## Performance Monitoring

### 1. Application Metrics

```python
# app/middleware/metrics.py
from prometheus_client import Counter, Histogram, generate_latest
import time

request_count = Counter('requests_total', 'Total requests', ['method', 'endpoint'])
request_duration = Histogram('request_duration_seconds', 'Request duration', ['endpoint'])
db_query_duration = Histogram('db_query_duration_seconds', 'Database query duration')

@app.middleware("http")
async def add_metrics(request: Request, call_next):
    start = time.time()
    response = await call_next(request)
    duration = time.time() - start
    
    request_count.labels(method=request.method, endpoint=request.url.path).inc()
    request_duration.labels(endpoint=request.url.path).observe(duration)
    
    response.headers["X-Process-Time"] = str(duration)
    return response

@router.get("/metrics")
def get_metrics():
    return Response(generate_latest(), media_type='text/plain')
```

---

### 2. Logging Strategy

```python
# app/logger.py
import logging
import json

class JSONFormatter(logging.Formatter):
    def format(self, record):
        log_data = {
            'timestamp': self.formatTime(record),
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
            'module': record.module,
            'function': record.funcName,
            'line': record.lineno,
        }
        if record.exc_info:
            log_data['exception'] = self.formatException(record.exc_info)
        return json.dumps(log_data)

# Configure
handler = logging.StreamHandler()
handler.setFormatter(JSONFormatter())
logger = logging.getLogger('family_budget')
logger.addHandler(handler)
logger.setLevel(logging.INFO)
```

---

### 3. Frontend Performance Monitoring

```typescript
// frontend/src/utils/performance.ts
export function measureComponentRender() {
  // Using React.Profiler
  return (
    <Profiler
      id="ReviewPage"
      onRender={(id, phase, actualDuration) => {
        console.log(`${id} (${phase}) took ${actualDuration}ms`);
        // Send to analytics service
        analytics.trackEvent('component_render', {
          component: id,
          phase,
          duration: actualDuration
        });
      }}
    >
      <ReviewPage />
    </Profiler>
  );
}

// Web Vitals
import { getCLS, getFID, getFCP, getLCP, getTTFB } from 'web-vitals';

getCLS(console.log);
getFID(console.log);
getFCP(console.log);
getLCP(console.log);
getTTFB(console.log);
```

---

## Summary of Priority Optimizations

| Priority | Area | Effort | Impact | Time |
|----------|------|--------|--------|------|
| **High** | Database indexes | Low | 10-100x | 1 hour |
| **High** | Async operations | Medium | 2-5x | 4 hours |
| **High** | Pagination | Medium | 3-10x | 2 hours |
| **Medium** | Caching layer | Medium | 10-100x | 3 hours |
| **Medium** | Code splitting | Low | 2-3x | 1 hour |
| **Low** | Async tasks | Medium | UX improvement | 2 hours |
| **Low** | Monitoring | Low | Operational | 1 hour |

**Recommended Phase 1** (< 8 hours):
1. ✅ Database indexes
2.✅ Pagination for transactions
3. ✅ Code splitting in frontend

**Recommended Phase 2** (< 12 hours):
4. Async database operations
5. Caching layer with Redis
6. Comprehensive monitoring

---

## References

- FastAPI Performance: https://fastapi.tiangolo.com/advanced/performance/
- SQLAlchemy Query Optimization: https://docs.sqlalchemy.org/
- React Performance: https://react.dev/reference/react/useMemo
- Docker Best Practices: https://docs.docker.com/develop/dev-best-practices/
