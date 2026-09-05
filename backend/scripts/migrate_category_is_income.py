#!/usr/bin/env python3
"""Add nullable `is_income` column to categories and backfill from `sign`.

True  = income  (sign = 'positive')
False = expense (sign = 'negative')
NULL  = unconstrained (sign = NULL, e.g. Transfers, Other)

Run from the backend container:
    docker exec -it family-budget-api python scripts/migrate_category_is_income.py
"""
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.database import engine


def main() -> None:
    with engine.begin() as conn:
        conn.execute(text(
            "ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_income BOOLEAN NULL"
        ))
        result = conn.execute(text(
            "UPDATE categories SET is_income = 1 WHERE sign = 'positive'"
        ))
        income_updated = result.rowcount
        result = conn.execute(text(
            "UPDATE categories SET is_income = 0 WHERE sign = 'negative'"
        ))
        expense_updated = result.rowcount

    print(f"Column added (or already existed).")
    print(f"Backfilled: {income_updated} income rows (sign=positive), "
          f"{expense_updated} expense rows (sign=negative).")
    print("Rows with sign=NULL remain is_income=NULL (unconstrained).")


if __name__ == "__main__":
    main()
