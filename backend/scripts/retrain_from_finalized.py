#!/usr/bin/env python3
"""Reset model and retrain from finalized transactions without deleting DB data.

Flow:
1) Reset model files to baseline (seed data)
2) Rebuild training_data from transactions where category_final is set
3) Retrain model from seed + rebuilt training_data
4) Optionally re-predict unreviewed transactions

Run from the backend container:
    docker exec -it family-budget-api python scripts/retrain_from_finalized.py
    docker exec -it family-budget-api python scripts/retrain_from_finalized.py --yes --repredict-unreviewed
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.database import SessionLocal
from app.models.transaction import Account, TrainingData, Transaction
from app.services.ml_service import _merchant_key, predictor


def _build_samples(db) -> list[tuple[str, str, float, str]]:
    samples: list[tuple[str, str, float, str]] = []
    for td in db.query(TrainingData).all():
        if td.description:
            samples.append((td.description, td.corrected_label, td.amount, td.transaction_date))
    return samples


def _rebuild_training_data_from_finalized(db) -> tuple[int, int]:
    finalized = db.query(Transaction).filter(Transaction.category_final.isnot(None)).all()

    deleted_count = db.query(TrainingData).delete(synchronize_session=False)

    created_count = 0
    for txn in finalized:
        db.add(TrainingData(
            transaction_id=txn.id,
            description=txn.description,
            amount=txn.amount,
            transaction_date=txn.date,
            merchant_key=_merchant_key(txn.description or ""),
            original_label=txn.category_predicted or "unknown",
            corrected_label=txn.category_final,
        ))
        created_count += 1

    db.commit()
    return deleted_count, created_count


def _repredict_unreviewed(db) -> tuple[int, int]:
    candidates = db.query(Transaction).filter(Transaction.category_final.is_(None)).all()
    if not candidates:
        return 0, 0

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
    return len(candidates), changed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", "-y", action="store_true", help="Skip confirmation prompt")
    parser.add_argument(
        "--repredict-unreviewed",
        action="store_true",
        help="Recompute category_predicted/category_confidence for unreviewed transactions after retrain",
    )
    args = parser.parse_args()

    if not args.yes:
        answer = input(
            "This will reset model files and rebuild training_data from finalized transactions only. Type 'yes' to continue: "
        )
        if answer.strip().lower() != "yes":
            print("Aborted.")
            return

    db = SessionLocal()
    try:
        predictor.reset_to_baseline(db)
        deleted_count, rebuilt_count = _rebuild_training_data_from_finalized(db)

        samples = _build_samples(db)
        retrained = False
        if samples:
            predictor.retrain(db, samples)
            retrained = True

        repred_total = 0
        repred_changed = 0
        if args.repredict_unreviewed and retrained:
            repred_total, repred_changed = _repredict_unreviewed(db)

        print(f"TrainingData rows deleted: {deleted_count}")
        print(f"TrainingData rows rebuilt from finalized transactions: {rebuilt_count}")
        print(f"Model retrained: {'yes' if retrained else 'no'}")
        print(f"Training samples used: {len(samples)}")
        if args.repredict_unreviewed:
            print(f"Unreviewed transactions re-predicted: {repred_total}, changed category: {repred_changed}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
