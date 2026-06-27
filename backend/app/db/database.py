import time
from sqlalchemy import create_engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import sessionmaker, declarative_base
from app.config import settings

engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    connect_args={"charset": "utf8mb4"}
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def wait_for_db(max_retries: int = settings.DB_MAX_RETRIES, delay_seconds: float = settings.DB_RETRY_DELAY) -> None:
    """
    Retry the initial DB connection on startup instead of crashing. MariaDB's
    container healthcheck can report healthy slightly before it's actually
    ready to authenticate new users/grants, so depends_on alone isn't enough.
    """
    for attempt in range(1, max_retries + 1):
        try:
            with engine.connect():
                return
        except OperationalError as e:
            if attempt == max_retries:
                raise
            print(f"Database not ready yet (attempt {attempt}/{max_retries}): {e}")
            time.sleep(delay_seconds)
