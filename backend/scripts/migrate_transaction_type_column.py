#!/usr/bin/env python3
"""Add nullable `type` column and backfill it from raw_source when possible.

Run from the backend container:
    docker exec -it family-budget-api python scripts/migrate_transaction_type_column.py
"""
import json
import sys
from pathlib import Path

from sqlalchemy import text

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.database import SessionLocal, engine
from app.models.transaction import Transaction
from app.services.format_service import detect_bank_format, get_mapping_for_format
from app.services.normalization import _clean_row, _first_nonempty


def _extract_type_from_raw_source(raw_source: str) -> str | None:
    try:
        row = json.loads(raw_source)
    except Exception:
        return None

    if not isinstance(row, dict):
        return None

    row = _clean_row(row)
    format_name = detect_bank_format(list(row.keys()))
    mapping = get_mapping_for_format(format_name)

    type_field = mapping.get("typeField")
    transaction_type = _first_nonempty(row, [type_field]) if type_field else None
    if not transaction_type:
        transaction_type = mapping.get("defaultType")
    return transaction_type


def main() -> None:
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type VARCHAR(100) NULL"))

    db = SessionLocal()
    try:
        candidates = db.query(Transaction).filter(Transaction.type.is_(None)).all()
        updated = 0
        skipped = 0
        for txn in candidates:
            if not txn.raw_source:
                skipped += 1
                continue
            txn_type = _extract_type_from_raw_source(txn.raw_source)
            if txn_type:
                txn.type = txn_type
                updated += 1
            else:
                skipped += 1

        if updated:
            db.commit()
        else:
            db.rollback()

        remaining_null = db.query(Transaction).filter(Transaction.type.is_(None)).count()
        print("Migration completed: transactions.type ensured.")
        print(f"Backfill updated: {updated}")
        print(f"Backfill skipped: {skipped}")
        print(f"Remaining NULL type rows: {remaining_null}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
