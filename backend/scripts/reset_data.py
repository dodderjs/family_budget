#!/usr/bin/env python3
"""Reset all transactions, keeping accounts intact.

Use this when testing a change to normalization/categorization/transfer logic
and you want a clean slate without re-creating every account by hand, or
before a clean re-import of the same data.

Separately asks whether to also wipe learned corrections (training data) and
revert the categorization model to its bare seed baseline. Default is no:
months of review corrections teach the model real merchant vocabulary that
the seed data doesn't have, so keeping them means freshly re-imported
transactions still get reasonable predictions instead of starting from zero.
Only say yes if you're specifically testing categorization/ML logic itself.

Run from the backend container:
    docker exec -it family-budget-api python scripts/reset_data.py
    docker exec -it family-budget-api python scripts/reset_data.py --yes              # skip the transactions prompt
    docker exec -it family-budget-api python scripts/reset_data.py --keep-training    # skip the training-data prompt, keep it
    docker exec -it family-budget-api python scripts/reset_data.py --reset-training   # skip the training-data prompt, wipe it
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.db.database import SessionLocal
from app.services.reset_service import reset_all_transaction_data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes", "-y", action="store_true", help="Skip the transactions confirmation prompt")
    training_group = parser.add_mutually_exclusive_group()
    training_group.add_argument(
        "--keep-training", action="store_true",
        help="Keep learned corrections and the current model (skip that prompt)"
    )
    training_group.add_argument(
        "--reset-training", action="store_true",
        help="Also wipe learned corrections and revert the model to its seed baseline (skip that prompt)"
    )
    args = parser.parse_args()

    if not args.yes:
        answer = input("This deletes ALL transactions. Accounts are kept.\nType 'yes' to continue: ")
        if answer.strip().lower() != "yes":
            print("Aborted.")
            return

    if args.keep_training:
        reset_training = False
    elif args.reset_training:
        reset_training = True
    else:
        answer = input(
            "Also delete learned corrections (training data) and reset the "
            "categorization model to its bare seed baseline? Usually no - "
            "keeping corrections means re-imported transactions still get "
            "decent predictions instead of starting from scratch.\n"
            "Type 'yes' to also reset training data, anything else to keep it: "
        )
        reset_training = answer.strip().lower() == "yes"

    db = SessionLocal()
    try:
        result = reset_all_transaction_data(db, reset_training=reset_training)
    finally:
        db.close()

    print(f"Deleted {result['transactions_deleted']} transaction(s).")
    if reset_training:
        print(f"Deleted {result['training_data_deleted']} training record(s). Categorization model reset to seed baseline.")
    else:
        print("Learned corrections and the categorization model were kept.")


if __name__ == "__main__":
    main()
