#!/usr/bin/env python3
"""Backfill description/merchant from raw source and retrain from finalized rows.

After changing format_service description/merchant field mappings, already
imported transactions still keep the old normalized values. This script
re-normalizes stored raw_source payloads with the current mapping, updates
transactions accordingly, then ensures finalized categories are represented in
training_data and retrains the model.

Run from the backend container:
    docker exec -it family-budget-api python scripts/migrate_description_merchant_and_retrain.py
    docker exec -it family-budget-api python scripts/migrate_description_merchant_and_retrain.py --yes
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.database import SessionLocal
from app.models.transaction import TrainingData, Transaction
from app.services.format_service import detect_bank_format, get_mapping_for_format
from app.services.ml_service import _merchant_key, predictor
from app.services.normalization import generate_fingerprint, normalize_transaction


def _build_retrain_samples(db) -> list[tuple[str, str, float, str]]:
    samples: list[tuple[str, str, float, str]] = []
    for td in db.query(TrainingData).all():
        description = td.description
        amount = td.amount
        date = td.transaction_date

        if not description and td.transaction_id:
            transaction = db.query(Transaction).filter(Transaction.id == td.transaction_id).first()
            if transaction:
                description = transaction.description
                amount = transaction.amount
                date = transaction.date

        if description:
            samples.append((description, td.corrected_label, amount, date))

    return samples


def _re_normalize_description_and_merchant(db):
    updated = 0
    skipped_invalid_raw = 0
    skipped_fingerprint_conflict = 0

    transactions = db.query(Transaction).all()
    for txn in transactions:
        if not txn.raw_source:
            skipped_invalid_raw += 1
            continue

        try:
            raw_row = json.loads(txn.raw_source)
            if not isinstance(raw_row, dict):
                skipped_invalid_raw += 1
                continue
        except Exception:
            skipped_invalid_raw += 1
            continue

        format_name = detect_bank_format(list(raw_row.keys()))
        mapping = get_mapping_for_format(format_name)

        try:
            normalized = normalize_transaction(raw_row, mapping, txn.account_id)
        except Exception:
            skipped_invalid_raw += 1
            continue

        new_description = normalized["description"]
        new_merchant = normalized.get("merchant")

        if txn.description == new_description and txn.merchant == new_merchant:
            continue

        new_fingerprint = generate_fingerprint(txn.date, txn.amount, new_description, txn.account_id)
        conflict = db.query(Transaction).filter(
            Transaction.hash_fingerprint == new_fingerprint,
            Transaction.id != txn.id,
        ).first()
        if conflict:
            skipped_fingerprint_conflict += 1
            continue

        txn.description = new_description
        txn.merchant = new_merchant
        txn.hash_fingerprint = new_fingerprint
        updated += 1

    db.flush()
    return updated, skipped_invalid_raw, skipped_fingerprint_conflict


def _sync_training_data_from_finalized_transactions(db):
    finalized = db.query(Transaction).filter(Transaction.category_final.isnot(None)).all()

    created = 0
    updated = 0

    for txn in finalized:
        training = db.query(TrainingData).filter(TrainingData.transaction_id == txn.id).order_by(
            TrainingData.created_at.desc()
        ).first()

        merchant_source = txn.merchant or txn.description
        merchant_key = _merchant_key(merchant_source or "")

        if training:
            changed = False
            if training.description != txn.description:
                training.description = txn.description
                changed = True
            if training.amount != txn.amount:
                training.amount = txn.amount
                changed = True
            if training.transaction_date != txn.date:
                training.transaction_date = txn.date
                changed = True
            if training.merchant_key != merchant_key:
                training.merchant_key = merchant_key
                changed = True
            if training.corrected_label != txn.category_final:
                training.corrected_label = txn.category_final
                changed = True
            if changed:
                updated += 1
            continue

        db.add(TrainingData(
            transaction_id=txn.id,
            description=txn.description,
            amount=txn.amount,
            transaction_date=txn.date,
            merchant_key=merchant_key,
            original_label=txn.category_predicted or "unknown",
            corrected_label=txn.category_final,
        ))
        created += 1

    db.flush()
    return len(finalized), created, updated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", "-y", action="store_true", help="Skip the confirmation prompt")
    args = parser.parse_args()

    if not args.yes:
        answer = input(
            "This updates transaction description/merchant/fingerprint, training_data, and retrains ML. Type 'yes' to continue: "
        )
        if answer.strip().lower() != "yes":
            print("Aborted.")
            return

    db = SessionLocal()
    try:
        updated_txn, skipped_invalid_raw, skipped_fingerprint_conflict = _re_normalize_description_and_merchant(db)
        finalized_count, training_created, training_updated = _sync_training_data_from_finalized_transactions(db)

        db.commit()

        retrained = False
        samples = _build_retrain_samples(db)
        if finalized_count > 0 and samples:
            predictor.retrain(db, samples)
            retrained = True

        print(
            "Transactions updated: "
            f"{updated_txn} "
            f"(invalid raw_source skipped: {skipped_invalid_raw}, "
            f"fingerprint conflicts skipped: {skipped_fingerprint_conflict})"
        )
        print(
            "Training data synced from finalized categories: "
            f"finalized={finalized_count}, created={training_created}, updated={training_updated}"
        )
        print(f"Model retrained: {'yes' if retrained else 'no'}")
    finally:
        db.close()


if __name__ == "__main__":
    main()