import hashlib
import json
from typing import Optional

def generate_fingerprint(date: str, amount: float, description: str, account_id: str) -> str:
    """Generate hash fingerprint for deduplication"""
    content = f"{date}|{amount}|{description}|{account_id}"
    return hashlib.sha256(content.encode()).hexdigest()

def normalize_transaction(row: dict, mapping: dict, account_id: str) -> dict:
    """
    Normalize a raw transaction row to standard schema.
    
    mapping should contain:
    {
        "dateField": "date_column_name",
        "amountField": "amount_column_name",
        "descriptionField": "description_column_name",
        "merchantField": "merchant_column_name (optional)",
        "currencyField": "currency_column_name (optional)"
    }
    """
    try:
        # Extract fields with mapping
        date_str = str(row.get(mapping.get("dateField", "date"), "")).strip()
        amount_str = str(row.get(mapping.get("amountField", "amount"), "0")).strip()
        description = str(row.get(mapping.get("descriptionField", "description"), "")).strip()
        merchant = str(row.get(mapping.get("merchantField", "merchant"), "")).strip() or None
        currency = str(row.get(mapping.get("currencyField", "currency"), "USD")).strip().upper()
        
        # Parse amount
        amount = float(amount_str.replace(",", ".").replace("$", "").strip())
        
        # Normalize date (basic YYYY-MM-DD format)
        if "-" in date_str:
            date = date_str[:10]  # Assume ISO if present
        elif "/" in date_str:
            parts = date_str.split("/")
            if len(parts) == 3:
                month, day, year = parts
                year = "20" + year if len(year) == 2 else year
                date = f"{year}-{month.zfill(2)}-{day.zfill(2)}"
            else:
                date = date_str
        else:
            date = date_str
        
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
