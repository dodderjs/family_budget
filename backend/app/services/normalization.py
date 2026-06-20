import hashlib
import json
from datetime import datetime
from typing import List, Optional

def generate_fingerprint(date: str, amount: float, description: str, account_id: str) -> str:
    """Generate hash fingerprint for deduplication"""
    content = f"{date}|{amount}|{description}|{account_id}"
    return hashlib.sha256(content.encode()).hexdigest()


def _clean_row(row: dict) -> dict:
    """Strip whitespace/BOM from keys so lookups are robust regardless of
    which parser (frontend PapaParse or backend csv.DictReader) produced the row."""
    return {(k.strip().lstrip("﻿") if isinstance(k, str) else k): v for k, v in row.items()}


def _first_nonempty(row: dict, fields: List[str]) -> Optional[str]:
    for field in fields:
        value = str(row.get(field, "")).strip()
        if value:
            return value
    return None


def _parse_amount(raw: str, locale: str) -> float:
    raw = raw.strip().replace("$", "").replace("€", "").replace("£", "")
    if locale == "hu":
        # Hungarian formatting: space (or nbsp) as thousands separator, comma as decimal separator
        raw = raw.replace("\xa0", "").replace(" ", "").replace(",", ".")
    else:
        # en-style formatting: comma as thousands separator, dot as decimal separator
        raw = raw.replace(",", "")
    return float(raw)


def _parse_date(raw: str, date_format: Optional[str]) -> str:
    raw = raw.strip()
    if date_format:
        return datetime.strptime(raw, date_format).strftime("%Y-%m-%d")

    # Fallback heuristic for the generic/manually-mapped format
    if "-" in raw:
        return raw[:10]
    if "/" in raw:
        parts = raw.split("/")
        if len(parts) == 3:
            month, day, year = parts
            year = "20" + year if len(year) == 2 else year
            return f"{year}-{month.zfill(2)}-{day.zfill(2)}"
    return raw


def _apply_sign(value: float, row: dict, mapping: dict) -> float:
    rule = mapping.get("signRule", "as_is")
    if rule == "as_is":
        return value

    if rule == "expense_unless_refund":
        type_field = mapping.get("typeField")
        refund_value = mapping.get("refundValue")
        type_value = str(row.get(type_field, "")).strip()
        magnitude = abs(value)
        return magnitude if type_value == refund_value else -magnitude

    return value


def should_skip_row(row: dict, mapping: dict) -> bool:
    """True if this row represents a non-final state (e.g. a pending/reverted
    Revolut transaction) that shouldn't be ingested yet."""
    row = _clean_row(row)
    state_field = mapping.get("stateField")
    skip_states = mapping.get("skipStates")
    if not state_field or not skip_states:
        return False
    return str(row.get(state_field, "")).strip() in skip_states


def normalize_transaction(row: dict, mapping: dict, account_id: str) -> dict:
    """
    Normalize a raw transaction row to standard schema, using one of the
    per-bank mappings defined in app.services.format_service.BANK_FORMATS.
    """
    try:
        row = _clean_row(row)

        date_raw = str(row.get(mapping["dateField"], "")).strip()
        date = _parse_date(date_raw, mapping.get("dateFormat"))

        amount_raw = str(row.get(mapping["amountField"], "0")).strip()
        amount = _parse_amount(amount_raw, mapping.get("amountLocale", "en"))
        amount = _apply_sign(amount, row, mapping)

        description = _first_nonempty(row, mapping.get("descriptionFields", ["description"])) or ""
        merchant = _first_nonempty(row, mapping.get("merchantFields", ["merchant"]))
        if merchant and merchant not in description:
            description = f"{description} {merchant}".strip()
        if not description:
            description = "Unknown transaction"

        currency_field = mapping.get("currencyField")
        currency = str(row.get(currency_field, "USD")).strip().upper() if currency_field else "USD"
        if not currency:
            currency = "USD"

        fingerprint = generate_fingerprint(date, amount, description, account_id)

        return {
            "date": date,
            "amount": amount,
            "currency": currency,
            "description": description,
            "merchant": merchant,
            "hash_fingerprint": fingerprint,
            "account_id": account_id,
            "raw_source": json.dumps(row)
        }
    except Exception as e:
        raise ValueError(f"Failed to normalize row {row}: {str(e)}")

def _dates_within(date1: str, date2: str, max_days: int) -> bool:
    try:
        d1 = datetime.strptime(date1, "%Y-%m-%d")
        d2 = datetime.strptime(date2, "%Y-%m-%d")
    except ValueError:
        return date1 == date2
    return abs((d1 - d2).days) <= max_days


def detect_transfers(transactions: List[dict], max_day_diff: int = 2) -> List[tuple]:
    """
    Detect transfer pairs between DIFFERENT accounts: equal absolute amount,
    opposite sign, dated within `max_day_diff` days of each other (banks often
    post the two sides of a transfer a day apart). Each transaction is
    matched to at most one counterpart.

    transactions: list of dicts with "id", "account_id", "amount", "date" (YYYY-MM-DD)
    Returns list of (transaction_id1, transaction_id2) pairs.
    """
    by_amount: dict = {}
    for t in transactions:
        by_amount.setdefault(abs(t.get("amount", 0)), []).append(t)

    matched_ids = set()
    transfers = []

    for amount, group in by_amount.items():
        if amount == 0 or len(group) < 2:
            continue
        for i in range(len(group)):
            t1 = group[i]
            if t1.get("id") in matched_ids:
                continue
            for j in range(i + 1, len(group)):
                t2 = group[j]
                if t2.get("id") in matched_ids:
                    continue
                if t1.get("account_id") == t2.get("account_id"):
                    continue  # transfers are between different accounts by definition
                if t1.get("amount", 0) * t2.get("amount", 0) >= 0:
                    continue  # need opposite signs
                if not _dates_within(t1.get("date", ""), t2.get("date", ""), max_day_diff):
                    continue

                transfers.append((t1.get("id"), t2.get("id")))
                matched_ids.add(t1.get("id"))
                matched_ids.add(t2.get("id"))
                break  # t1 is matched; move on to the next candidate

    return transfers
