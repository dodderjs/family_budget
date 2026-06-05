from typing import Dict, List

# Bank-specific CSV format mappings
BANK_FORMATS = {
    "bank_a": {
        "dateField": "Transaction Date",
        "amountField": "Amount",
        "descriptionField": "Description",
        "merchantField": "Merchant",
        "currencyField": "Currency"
    },
    "bank_b": {
        "dateField": "Date",
        "amountField": "Debit/Credit",
        "descriptionField": "Transaction",
        "merchantField": "Vendor",
        "currencyField": None
    },
    "generic": {
        "dateField": "date",
        "amountField": "amount",
        "descriptionField": "description",
        "merchantField": None,
        "currencyField": None
    }
}

def detect_bank_format(csv_row: dict) -> str:
    """Auto-detect bank format from CSV headers"""
    keys = set(csv_row.keys())
    
    # Check for Bank A indicators
    if "Transaction Date" in keys and "Merchant" in keys:
        return "bank_a"
    
    # Check for Bank B indicators
    if "Debit/Credit" in keys and "Vendor" in keys:
        return "bank_b"
    
    # Default to generic
    return "generic"

def get_mapping_for_format(format_name: str) -> Dict:
    """Get mapping for a specific bank format"""
    return BANK_FORMATS.get(format_name, BANK_FORMATS["generic"])

def suggest_mapping(csv_rows: List[dict]) -> Dict:
    """Suggest a mapping based on CSV headers"""
    if not csv_rows:
        return get_mapping_for_format("generic")
    
    detected = detect_bank_format(csv_rows[0])
    return {
        "detected_format": detected,
        "mapping": get_mapping_for_format(detected)
    }
