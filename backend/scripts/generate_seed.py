#!/usr/bin/env python3
"""Export finalized transactions to a reusable Python seed module.

Only includes transactions with category_final set (user-confirmed categories).
Detects conflicts where the same description has multiple different final categories.
Attempts to resolve conflicts using amount thresholds and description patterns.
Logs unresolvable conflicts for manual review.
"""

import argparse
import re
import statistics
import sys
import unicodedata
from collections import defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import select

from app.db.database import SessionLocal
from app.models.transaction import Transaction
from app.services.ml_service import _merchant_key


# Heuristics for resolving known conflicts based on description patterns and amounts
CONFLICT_RESOLVERS = {
    "ikea": lambda desc, cats, txns: _resolve_by_amount(cats, txns, {"furniture": 10000}),
    "mol": lambda desc, cats, txns: _resolve_mol(desc, cats, txns),
    "pepco": lambda desc, cats, txns: _resolve_by_majority(cats, txns),
    "temu": lambda desc, cats, txns: _resolve_by_majority(cats, txns),
    "simple": lambda desc, cats, txns: _resolve_simple(desc, cats, txns),
    "foxpost": lambda desc, cats, txns: _resolve_by_majority(cats, txns),
    "panarom": lambda desc, cats, txns: _resolve_by_majority(cats, txns),
    "revolut": lambda desc, cats, txns: _resolve_by_majority(cats, txns),
    "tesco": lambda desc, cats, txns: _resolve_by_majority(cats, txns),
    "apple com bill": lambda desc, cats, txns: _resolve_by_majority(cats, txns),
    "curve": lambda desc, cats, txns: _resolve_by_majority(cats, txns),
}


def _resolve_by_amount(categories_dict: dict, by_category: dict, thresholds: dict) -> str | None:
    """Resolve conflict by amount thresholds. thresholds maps category to threshold amount.
    Returns category with highest threshold that has transactions below it, else majority."""
    sorted_cats = sorted(thresholds.items(), key=lambda x: x[1], reverse=True)
    for category, threshold in sorted_cats:
        if category in by_category:
            transactions = by_category[category]
            if any(abs(t['amount']) < threshold for t in transactions):
                return category
    return _resolve_by_majority(categories_dict, by_category)


def _resolve_mol(desc: str, categories_dict: dict, by_category: dict) -> str | None:
    """MOL: 'Limo'/'Limitless Mobility' → transport, 'Hulladek' → bills, else fuel."""
    lower_desc = desc.lower()
    if "limo" in lower_desc or "limitless" in lower_desc:
        return "transport"
    if "hulladek" in lower_desc or "hulladék" in lower_desc:
        return "bills"
    return _resolve_by_majority(categories_dict, by_category)


def _resolve_simple(desc: str, categories_dict: dict, by_category: dict) -> str | None:
    """Simple: Parking app vs groceries. Check if 'parkol' in desc."""
    if "parkol" in desc.lower():
        return "parking"
    if "groceries" in categories_dict:
        return "groceries"
    return _resolve_by_majority(categories_dict, by_category)


def _resolve_by_majority(categories_dict: dict, by_category: dict) -> str | None:
    """Pick the category with the most transactions."""
    if not by_category:
        return None
    return max(by_category.items(), key=lambda x: len(x[1]))[0]


def _try_resolve_conflict(description: str, categories_dict: dict, by_category: dict) -> str | None:
    """Apply conflict resolution heuristics. Returns category if resolved, None if unresolvable."""
    for pattern, resolver in CONFLICT_RESOLVERS.items():
        if pattern.lower() in description.lower():
            resolved = resolver(description, categories_dict, by_category)
            if resolved and resolved in categories_dict:
                return resolved
    return None


def build_seed_rows() -> tuple[list[tuple[str, str, float]], dict, dict]:
    """
    Build seed rows from finalized transactions only, grouped by merchant_key.
    
    Consolidates duplicate/variant merchant descriptions (e.g. "Amzn Mktp De" and
    "Amzn Mktp De*1K01s2fh4") into single seed entries using normalized merchant keys.
    
    Returns:
        (clean_rows, resolved_conflicts, unresolved_conflicts) where:
        - clean_rows: list of (merchant_key, category, median_amount) tuples
        - resolved_conflicts: dict of {merchant_key: (resolved_category, info)}
        - unresolved_conflicts: dict of truly ambiguous conflicts
    """
    db = SessionLocal()
    try:
        # Query only finalized transactions
        rows = db.execute(
            select(
                Transaction.id,
                Transaction.description,
                Transaction.category_final,
                Transaction.amount,
                Transaction.date
            )
            .where(Transaction.category_final.isnot(None))
            .where(Transaction.description.isnot(None))
        ).all()
    finally:
        db.close()

    # Group by merchant_key to consolidate variants (e.g. "Amzn Mktp De" + "Amzn Mktp De*1K01s2fh4")
    by_merchant_key: dict[str, dict] = defaultdict(lambda: defaultdict(list))
    merchant_key_examples: dict[str, str] = {}  # merchant_key -> one example raw description
    
    for txn_id, description, category, amount, date_str in rows:
        desc_key = description.strip()
        if desc_key:
            merchant_key = _merchant_key(desc_key)
            if merchant_key:  # Skip if merchant_key is empty (non-merchant)
                by_merchant_key[merchant_key][category].append({
                    'amount': float(amount),
                    'date': date_str,
                    'id': txn_id
                })
                # Store one example raw description for logging
                if merchant_key not in merchant_key_examples:
                    merchant_key_examples[merchant_key] = desc_key

    clean_rows: list[tuple[str, str, float]] = []
    resolved_conflicts: dict = {}
    unresolved_conflicts: dict = {}

    for merchant_key, categories_dict in sorted(by_merchant_key.items()):
        # Check for conflicts: multiple categories for same merchant_key
        if len(categories_dict) > 1:
            # Try to resolve using heuristics
            resolved_category = _try_resolve_conflict(merchant_key, categories_dict, categories_dict)
            
            if resolved_category:
                # Conflict resolved: use all transactions for this merchant_key with resolved category
                all_transactions = []
                for txns in categories_dict.values():
                    all_transactions.extend(txns)
                amounts = [t['amount'] for t in all_transactions]
                median_amount = float(statistics.median(amounts))
                clean_rows.append((merchant_key, resolved_category, median_amount))
                
                # Log resolution for transparency
                conflict_info = []
                for category, transactions in sorted(categories_dict.items()):
                    dates = [t['date'] for t in transactions]
                    dates_sorted = sorted(dates)
                    date_range = f"{dates_sorted[0]} to {dates_sorted[-1]}" if len(dates_sorted) > 1 else dates_sorted[0]
                    conflict_info.append({
                        'category': category,
                        'count': len(transactions),
                        'date_range': date_range,
                        'sample_ids': [t['id'] for t in transactions[:3]]
                    })
                resolved_conflicts[merchant_key] = (resolved_category, conflict_info)
            else:
                # Unresolvable conflict: exclude and log
                conflict_info = []
                for category, transactions in sorted(categories_dict.items()):
                    dates = [t['date'] for t in transactions]
                    dates_sorted = sorted(dates)
                    date_range = f"{dates_sorted[0]} to {dates_sorted[-1]}" if len(dates_sorted) > 1 else dates_sorted[0]
                    conflict_info.append({
                        'category': category,
                        'count': len(transactions),
                        'date_range': date_range,
                        'sample_ids': [t['id'] for t in transactions[:3]]
                    })
                unresolved_conflicts[merchant_key] = conflict_info
        else:
            # No conflict: single category for this merchant_key
            category = list(categories_dict.keys())[0]
            transactions = categories_dict[category]
            amounts = [t['amount'] for t in transactions]
            median_amount = float(statistics.median(amounts))
            clean_rows.append((merchant_key, category, median_amount))

    return clean_rows, resolved_conflicts, unresolved_conflicts


def log_conflicts(resolved: dict, unresolved: dict, log_path: Path) -> None:
    """Write both resolved and unresolved conflicts to log file."""
    if not resolved and not unresolved:
        return

    log_path.parent.mkdir(parents=True, exist_ok=True)
    
    timestamp = datetime.utcnow().isoformat()
    with open(log_path, 'a', encoding='utf-8') as f:
        f.write(f"\n{'='*80}\n")
        f.write(f"Conflict Report: {timestamp}\n")
        f.write(f"{'='*80}\n\n")
        
        if resolved:
            f.write(f"RESOLVED ({len(resolved)} conflicts auto-resolved by heuristics):\n")
            f.write(f"{'-'*80}\n")
            for description, (resolved_category, conflict_list) in sorted(resolved.items()):
                f.write(f"Description: {description!r}\n")
                f.write(f"Resolved to: {resolved_category}\n")
                f.write(f"Conflicting categories ({len(conflict_list)}):\n")
                for conflict in conflict_list:
                    f.write(
                        f"  - {conflict['category']}: "
                        f"{conflict['count']} transactions ({conflict['date_range']}), "
                        f"sample IDs: {', '.join(conflict['sample_ids'][:3])}\n"
                    )
                f.write("\n")
        
        if unresolved:
            f.write(f"\nUNRESOLVED ({len(unresolved)} conflicts need manual review):\n")
            f.write(f"{'-'*80}\n")
            for description, conflict_list in sorted(unresolved.items()):
                f.write(f"Description: {description!r}\n")
                f.write(f"Conflicting categories ({len(conflict_list)}):\n")
                for conflict in conflict_list:
                    f.write(
                        f"  - {conflict['category']}: "
                        f"{conflict['count']} transactions ({conflict['date_range']}), "
                        f"sample IDs: {', '.join(conflict['sample_ids'][:3])}\n"
                    )
                f.write("\n")


def write_seed_file(output_path: Path, rows: list[tuple[str, str, float]]) -> None:
    """Write clean seed rows to output file.
    
    Note: Descriptions are normalized merchant keys (digits/IDs stripped, accent-folded, lowercased).
    This consolidates variants like "Amzn Mktp De" and "Amzn Mktp De*1K01s2fh4" into single entries.
    Conflicts resolved by heuristics (amount thresholds, description patterns).
    Unresolvable conflicts excluded; see seed_conflicts.log.
    """
    output_path.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Auto-generated by generate_seed.py; do not edit by hand.",
        "# Source: finalized transactions only (category_final IS NOT NULL).",
        "# Descriptions: normalized merchant keys (digits/IDs/accents removed, lowercased).",
        "# This consolidates variants like 'Amzn Mktp De' and 'Amzn Mktp De*1K01s2fh4'.",
        "# Conflicts resolved by heuristics (amount thresholds, description patterns).",
        "# Unresolvable conflicts excluded; see seed_conflicts.log.",
        "",
        "USER_SEED_DATA: list[tuple[str, str, float]] = [",
    ]
    for description, label, amount in rows:
        lines.append(f"    ({description!r}, {label!r}, {amount!r}),")
    lines.append("]")
    output_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--output",
        default=str(Path(__file__).resolve().parent.parent / "app" / "constants" / "user_seed.py"),
        help="Output path for generated seed file"
    )
    parser.add_argument(
        "--log",
        default=str(Path(__file__).resolve().parent / "seed_conflicts.log"),
        help="Log file path for conflicts"
    )
    args = parser.parse_args()

    clean_rows, resolved_conflicts, unresolved_conflicts = build_seed_rows()
    output_path = Path(args.output)
    log_path = Path(args.log)
    
    # Log all conflicts (resolved and unresolved)
    log_conflicts(resolved_conflicts, unresolved_conflicts, log_path)
    
    write_seed_file(output_path, clean_rows)
    
    # Calculate totals
    total_resolved = sum(
        sum(c['count'] for c in info[1])
        for info in resolved_conflicts.values()
    )
    total_unresolved = sum(
        sum(c['count'] for c in conflict_list)
        for conflict_list in unresolved_conflicts.values()
    )
    total_finalized = len(clean_rows) + total_resolved + total_unresolved
    
    print(f"Wrote {len(clean_rows)} seed row(s) to {output_path}")
    print(f"  Source: {total_finalized} finalized transactions")
    print(f"  Resolved conflicts: {len(resolved_conflicts)} ({total_resolved} transactions)")
    print(f"  Unresolved conflicts: {len(unresolved_conflicts)} ({total_unresolved} transactions)")
    if resolved_conflicts or unresolved_conflicts:
        print(f"  See {log_path} for details")


if __name__ == "__main__":
    main()