from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "mysql+pymysql://budget_user:budget_password@localhost:3306/family_budget"
    CORS_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:4173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:4173",
        "http://127.0.0.1:3000",
    ]
    ML_MODEL_DIR: Path = Path(__file__).resolve().parent / "ml" / "models"
    DB_MAX_RETRIES: int = 30
    DB_RETRY_DELAY: float = 2.0
    ML_AMOUNT_LOG_SCALE: float = 15.0
    ML_AUTO_RETRAIN_FINALIZED_THRESHOLD: int = 250
    ML_AUTO_RETRAIN_FINALIZED_STEP: int = 50

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()