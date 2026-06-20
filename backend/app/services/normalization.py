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

def detect_transfers(transactions: list[dict]) -> list[tuple[str, str]]:
    """
    Detect transfers between accounts.
    Returns list of (transaction_id1, transaction_id2) pairs
    """
    transfers = []

    # Group by amount
    by_amount = {}
    for t in transactions:
        amount = abs(t.get("amount", 0))
        if amount not in by_amount:
            by_amount[amount] = []
        by_amount[amount].append(t)

    # Look for opposite sign transactions with same amount
    for amount, group in by_amount.items():
        if len(group) >= 2:
            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    t1 = group[i]
                    t2 = group[j]

                    # Check opposite signs and similar dates
                    if t1.get("amount", 0) * t2.get("amount", 0) < 0:  # Opposite signs
                        date1 = t1.get("date", "")
                        date2 = t2.get("date", "")

                        # Same date or within 1 day
                        if date1 == date2 or (date1[:7] == date2[:7]):  # Same month at minimum
                            transfers.append((t1.get("id"), t2.get("id")))

    return transfers
