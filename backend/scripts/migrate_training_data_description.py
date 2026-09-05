#!/usr/bin/env python3
"""One-off schema sync so TrainingData can outlive its original transaction.

reset_data.py can now clear transactions while keeping learned corrections
(see reset_service.reset_all_transaction_data's reset_training flag) - that
requires training_data.transaction_id to allow NULL, and denormalized
`description`/`amount` columns so retrain() doesn't need the transaction to
still exist (amount also feeds the model's amount-magnitude feature - see
ml_service.py). All purely additive/relaxing changes - no existing data is
at risk. Safe to re-run.

Run from the backend container:
    docker exec -it family-budget-api python scripts/migrate_training_data_description.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from app.db.database import engine


def main():
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE training_data ADD COLUMN IF NOT EXISTS description VARCHAR(500)"))
        conn.execute(text("ALTER TABLE training_data ADD COLUMN IF NOT EXISTS amount FLOAT"))
        conn.execute(text("ALTER TABLE training_data MODIFY COLUMN transaction_id VARCHAR(36) NULL"))
    print("training_data: description/amount columns ensured, transaction_id made nullable.")


if __name__ == "__main__":
    main()
