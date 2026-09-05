#!/usr/bin/env python3
"""One-off re-tag for the new "eating_out" category.

Curve's "eating_out" tag used to collapse into our "entertainment" category
(CURVE_CATEGORY_MAP, before "eating_out" existed). Any Curve transaction already
imported under that old mapping is stuck as "entertainment" until re-tagged -
new imports use "eating_out" automatically, but history doesn't update itself.

Only touches rows where category_final is still unset, so a category the
user has already confirmed as "entertainment" is left alone.

Run from the backend container:
    docker exec -it family-budget-api python scripts/backfill_eating_out_category.py
    docker exec -it family-budget-api python scripts/backfill_eating_out_category.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.database import SessionLocal
from app.models.transaction import Transaction


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", "-y", action="store_true", help="Skip the confirmation prompt")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        candidates = db.query(Transaction).filter(
            Transaction.category_predicted == "entertainment",
            Transaction.category_final.is_(None),
            Transaction.raw_source.ilike("%eating_out%"),
        ).all()

        print(f"Found {len(candidates)} transaction(s) to re-tag entertainment -> eating_out.")
        if not candidates:
            return

        if not args.yes:
            answer = input("Type 'yes' to continue: ")
            if answer.strip().lower() != "yes":
                print("Aborted.")
                return

        for txn in candidates:
            txn.category_predicted = "eating_out"
        db.commit()
        print(f"Re-tagged {len(candidates)} transaction(s).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
