from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.db.database import engine, Base, SessionLocal, wait_for_db
from app.api.transactions import router as transaction_router
from app.services.category_service import CategoryService

# Create app first
app = FastAPI(
    title="Family Budget API",
    description="Financial transaction analysis with ML categorization",
    version="1.0.0"
)

# Add CORS middleware FIRST, before routers
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # React dev server
        "http://localhost:3000",  # Alternative frontend port
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Wait for the DB to actually accept connections, then create tables
wait_for_db()
Base.metadata.create_all(bind=engine)

# Seed the default category hierarchy once at startup - idempotent, so this
# is a no-op on every restart after the first.
_startup_db = SessionLocal()
try:
    CategoryService.seed_defaults(_startup_db)
finally:
    _startup_db.close()

# Include routers AFTER middleware
app.include_router(transaction_router)

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "family-budget-api"}

@app.get("/")
def root():
    return {
        "service": "Family Budget API",
        "version": "1.0.0",
        "docs": "/docs"
    }
