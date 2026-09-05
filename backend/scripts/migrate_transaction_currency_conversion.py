#!/usr/bin/env python3
"""One-off schema sync for foreign-currency-to-HUF conversion.

Adds original_amount/exchange_rate to `transactions` so a non-HUF row keeps
its pre-conversion amount and the rate used, while `amount` itself becomes
the HUF-equivalent that ML/analytics/duplicate-detection already assume.
Purely additive (nullable columns) - no existing data is touched. Safe to
re-run (uses ADD COLUMN IF NOT EXISTS, supported since MariaDB 10.0.2).

Run from the backend container:
    docker exec -it family-budget-api python scripts/migrate_transaction_currency_conversion.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import text
from app.db.database import engine


def main():
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS original_amount FLOAT"))
        conn.execute(text("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS exchange_rate FLOAT"))
    print("transactions: original_amount, exchange_rate columns ensured.")


if __name__ == "__main__":
    main()
