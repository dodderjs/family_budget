#!/usr/bin/env python3
"""One-off re-prediction for transactions stuck with a stale category guess.

A long-running API process keeps the ML model in memory; resetting/retraining
it (reset_data.py, /ml/retrain) only takes effect for *new* predictions in
that process - it can't retroactively fix category_predicted on transactions
that were already created under a since-corrected model. This re-runs
prediction for every transaction that hasn't been reviewed yet (category_final
is unset) AND whose current prediction came from the raw model rather than a
deterministic bank-format category hint (category_confidence < 1.0 - a hint
always sets exactly 1.0, see transaction_service.create_transaction), so
neither confirmed categorizations nor trustworthy hint-based ones are touched.

Run from the backend container:
    docker exec -it family-budget-api python scripts/repredict_unreviewed.py
    docker exec -it family-budget-api python scripts/repredict_unreviewed.py --yes
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.database import SessionLocal
from app.models.transaction import Account, Transaction
from app.services.ml_service import predictor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", "-y", action="store_true", help="Skip the confirmation prompt")
    args = parser.parse_args()

    db = SessionLocal()
    try:
        candidates = db.query(Transaction).filter(
            Transaction.category_final.is_(None),
            Transaction.category_confidence < 1.0,
        ).all()
        print(f"Found {len(candidates)} unreviewed, non-hinted transaction(s) to re-predict.")
        if not candidates:
            return

        if not args.yes:
            answer = input("Type 'yes' to continue: ")
            if answer.strip().lower() != "yes":
                print("Aborted.")
                return

        account_types = {a.id: a.type for a in db.query(Account).all()}

        changed = 0
        for txn in candidates:
            category, confidence = predictor.predict(
                db, txn.description, txn.amount, account_types.get(txn.account_id), txn.date
            )
            if category != txn.category_predicted:
                changed += 1
            txn.category_predicted = category
            txn.category_confidence = confidence
        db.commit()
        print(f"Re-predicted {len(candidates)} transaction(s), {changed} category changed.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
