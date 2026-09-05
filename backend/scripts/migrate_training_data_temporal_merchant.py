#!/usr/bin/env python3
"""One-off schema sync for the temporal + merchant-memory ML features.

The categorizer now learns day-of-month/day-of-week (needs the corrected
transaction's date) and answers from a per-user merchant memory keyed on a
normalized merchant string (see ml_service._merchant_key). Both need columns
denormalized onto training_data so a correction keeps working after its
transaction is deleted - mirrors migrate_training_data_description.py.

Adds training_data.transaction_date and training_data.merchant_key (+ an index
on the latter, since predict() queries by it on every prediction), then
backfills existing rows: transaction_date from the still-present transaction,
merchant_key from the stored description via the same runtime normalizer. All
additive - no existing data is at risk. Safe to re-run.

Run from the backend container:
    docker exec -it family-budget-api python scripts/migrate_training_data_temporal_merchant.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from app.db.database import engine
from app.services.ml_service import _merchant_key


def _ensure_merchant_key_index(conn):
    """ADD INDEX has no IF NOT EXISTS in MariaDB, so check the catalog first to
    keep this script re-runnable."""
    exists = conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.statistics "
        "WHERE table_schema = DATABASE() AND table_name = 'training_data' "
        "AND index_name = 'ix_training_data_merchant_key'"
    )).scalar()
    if not exists:
        conn.execute(text(
            "ALTER TABLE training_data ADD INDEX ix_training_data_merchant_key (merchant_key)"
        ))


def main():
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE training_data ADD COLUMN IF NOT EXISTS transaction_date VARCHAR(10)"))
        conn.execute(text("ALTER TABLE training_data ADD COLUMN IF NOT EXISTS merchant_key VARCHAR(255)"))
        _ensure_merchant_key_index(conn)

        # Backfill transaction_date from the joined transaction where the link
        # still exists and the column hasn't already been filled.
        conn.execute(text(
            "UPDATE training_data td JOIN transactions t ON td.transaction_id = t.id "
            "SET td.transaction_date = t.date "
            "WHERE td.transaction_date IS NULL"
        ))

        # Backfill merchant_key in Python (the normalization isn't expressible
        # in SQL) for every row that has a description but no key yet.
        rows = conn.execute(text(
            "SELECT id, description FROM training_data "
            "WHERE merchant_key IS NULL AND description IS NOT NULL"
        )).fetchall()
        filled = 0
        for row_id, description in rows:
            key = _merchant_key(description or "")
            if key:
                conn.execute(
                    text("UPDATE training_data SET merchant_key = :key WHERE id = :id"),
                    {"key": key, "id": row_id},
                )
                filled += 1

    print(f"training_data: transaction_date/merchant_key columns + index ensured, "
          f"merchant_key backfilled for {filled} row(s).")


if __name__ == "__main__":
    main()
