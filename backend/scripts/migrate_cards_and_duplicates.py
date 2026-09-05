#!/usr/bin/env python3
"""One-off schema sync for the card-history / Curve-duplicate-detection feature.

Base.metadata.create_all() (called at app startup) only creates tables that
don't exist yet - it never alters an existing table, so the new columns on
`transactions` need an explicit ALTER. Purely additive (nullable/defaulted
columns, a new table) - no existing data is touched or at risk. Safe to
re-run (uses ADD COLUMN IF NOT EXISTS, supported since MariaDB 10.0.2).

Run from the backend container:
    docker exec -it family-budget-api python scripts/migrate_cards_and_duplicates.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from app.db.database import engine, Base
import app.models.transaction  # noqa: F401 - registers all models on Base.metadata


def main():
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS card_hint VARCHAR(100)"))
        conn.execute(text("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS is_duplicate BOOLEAN NOT NULL DEFAULT FALSE"))
        conn.execute(text("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS duplicate_of_id VARCHAR(36)"))
        # card_hint was originally VARCHAR(20) - too narrow for formats (MBH,
        # K&H) that put a full account number here instead of a short card
        # hint, causing every insert to fail with "Data too long". Widen on
        # already-migrated DBs too; MODIFY is safe to re-run.
        conn.execute(text("ALTER TABLE transactions MODIFY COLUMN card_hint VARCHAR(100)"))
    print("transactions: card_hint, is_duplicate, duplicate_of_id columns ensured.")

    Base.metadata.create_all(bind=engine)
    print("cards table ensured.")


if __name__ == "__main__":
    main()
