#!/usr/bin/env python3
"""Add the indexes the analytics and review queries need.

The transactions table shipped with only PRIMARY(id), UNIQUE(hash_fingerprint)
and the two FK indexes, so every analytics filter and every review
count()/ORDER BY was a full table scan. create_all() does not add indexes to a
table that already exists, hence this script.

Idempotent - each index is checked against information_schema first.

Run from the backend container:
    docker exec -it family-budget-api python scripts/migrate_add_analytics_indexes.py
"""
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.database import engine

INDEXES = [
    ("ix_transactions_analytics", "transactions", "is_transfer, is_duplicate, date"),
    ("ix_transactions_account_date", "transactions", "account_id, date"),
    ("ix_transactions_date", "transactions", "date"),
    ("ix_transactions_category_final", "transactions", "category_final"),
    ("ix_transactions_category_confidence", "transactions", "category_confidence"),
    ("ix_transactions_merchant", "transactions", "merchant"),
]


def main() -> None:
    created, skipped = [], []
    with engine.begin() as conn:
        for name, table, columns in INDEXES:
            exists = conn.execute(text(
                "SELECT COUNT(*) FROM information_schema.STATISTICS "
                "WHERE table_schema = DATABASE() AND table_name = :table AND index_name = :name"
            ), {"table": table, "name": name}).scalar()
            if exists:
                skipped.append(name)
                continue
            conn.execute(text(f"CREATE INDEX {name} ON {table} ({columns})"))
            created.append(name)

    for name in created:
        print(f"created  {name}")
    for name in skipped:
        print(f"exists   {name}")
    print(f"\n{len(created)} index(es) created, {len(skipped)} already present.")


if __name__ == "__main__":
    main()
