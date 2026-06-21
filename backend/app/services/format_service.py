import csv
import io
from typing import Dict, List, Optional

# Curve tags every transaction with its own category in the export. Keys are
# Curve's actual raw category text, lowercased (matches _map_category's
# raw_category.strip().lower() lookup) - e.g. real exports say "Eating Out",
# which lowercases to "eating out" with a space, not "eating_out". Values are
# our internal leaf category keys, used as a trusted default instead of an ML
# guess (see normalize_transaction's categoryField/categoryMap usage). Curve
# doesn't sub-categorize fees/interest/loans itself, so its blunt "Finance"
# tag maps to the generic "general_finance" leaf rather than one of the more
# specific finance leaves MBH/K&H's transaction-type columns can identify.
CURVE_CATEGORY_MAP = {
    "bills": "bills",
    "business services": "business_services",
    "eating out": "eating_out",
    "entertainment": "entertainment",
    "finance": "general_finance",
    "general": "general",
    "groceries": "groceries",
    "health": "health",
    "shopping": "shopping",
    "transport": "transport",
    "travel": "travel",
}

# MBH's "Megbízás típusa" (transaction type) column is unambiguous for bank
# fees / interest / loan-administrative rows - those rows don't have a real
# merchant, so the type itself is the best (and only) category signal. Only
# the types with one obvious category are mapped; "Vásárlás"/"Átutalás"/
# "Fogadott tétel" etc are genuinely ambiguous (any merchant/counterparty) and
# are deliberately left out so the ML model decides from merchant text instead.
MBH_CATEGORY_MAP = {
    "hitel (tőke) alapkamata": "loan_interest",
    "éves kártyadíj": "bank_fees",
    "tőketörlesztés": "loan_principal",
    "forgalmi jutalék": "bank_fees",
    "számlavezetés havi költsége": "bank_fees",
    "kamat": "interest",
    "kártya tranzakció díja": "bank_fees",
    "atm felvét": "cash_withdrawal",
}

# Same idea for K&H's "típus" column - only fee/interest/loan-administrative
# types, which have no real merchant either way.
KH_CATEGORY_MAP = {
    "tranzakciós költség": "bank_fees",
    "tranzakciós költség - készpénz": "bank_fees",
    "csomagdíj": "bank_fees",
    "csomagdíj visszatérítés": "bank_fees",
    "kamat": "interest",
    "mobilinfo üzenetdíj": "bank_fees",
    "prémium számlavezetési díj": "bank_fees",
    "hitel törlesztés": "loan_principal",
    "hitelkamat törlesztés": "loan_interest",
    "törlesztési biztosítási díj": "bank_fees",
    "végtörlesztési díj": "bank_fees",
    "konverziós átvezetés": "transfer",
    "készpénzfelvét k&h atm-ből": "cash_withdrawal",
    "készpénzfelvét belföldi atm-ből": "cash_withdrawal",
    "kp. felvét tranzakciós jutalék": "bank_fees",
}

# Real bank/card export formats, derived from samples in example/.
# Each format's headerSignature is the minimal set of column names (after
# whitespace/BOM stripping) that uniquely identifies it.
BANK_FORMATS = {
    "revolut": {
        "delimiter": ",",
        "headerSignature": {"Type", "Started Date", "Completed Date", "Currency"},
        "dateField": "Started Date",
        "dateFormat": "%Y-%m-%d %H:%M:%S",
        "amountField": "Amount",
        "amountLocale": "en",
        "descriptionFields": ["Description"],
        "merchantFields": ["Description"],
        "currencyField": "Currency",
        "signRule": "as_is",
        "stateField": "State",
        "skipStates": {"PENDING", "REVERTED"},
        "accountNumberField": None,  # not present in Revolut's export
        "displayName": "Revolut",
    },
    "curve": {
        "delimiter": ",",
        "headerSignature": {"Merchant", "Txn Amount (Funding Card)", "Txn Currency (Funding Card)"},
        "dateField": "Date (YYYY-MM-DD as UTC)",
        "dateFormat": "%Y-%m-%d",
        "amountField": "Txn Amount (Funding Card)",
        "amountLocale": "en",
        "descriptionFields": ["Merchant"],
        "merchantFields": ["Merchant"],
        "currencyField": "Txn Currency (Funding Card)",
        # Curve always reports the card amount as a positive number; the
        # actual direction is carried in "Type" (e.g. REFUNDED vs a normal spend).
        "signRule": "expense_unless_refund",
        "typeField": "Type",
        "refundValue": "REFUNDED",
        "accountNumberField": "Card Last 4 Digits",
        "categoryField": "Category",
        "categoryMap": CURVE_CATEGORY_MAP,
        "displayName": "Curve",
    },
    "mbh": {
        "delimiter": ";",
        "headerSignature": {"Számla", "Összeg", "Devizanem", "Tranzakció dátuma"},
        "dateField": "Tranzakció dátuma",
        "dateFormat": "%Y.%m.%d.",
        "amountField": "Összeg",
        "amountLocale": "hu",
        "descriptionFields": ["Megbízás típusa"],
        # "Ellenoldali számla tulajdonosa" (counterparty name) comes first -
        # for transfers/fees/incoming items it's the real merchant/payer
        # (e.g. "Morgan Stanley"). "Tranzakció helye" (transaction location)
        # is checked second since for those same row types it's just a
        # generic channel label ("MobilApp", "Kozpont", "Bankon kivulrol
        # erkezo") that would otherwise mask the real counterparty - it's
        # only the genuine merchant for card purchases, which have no counterparty.
        "merchantFields": ["Ellenoldali számla tulajdonosa", "Tranzakció helye"],
        "currencyField": "Devizanem",
        "signRule": "as_is",
        "accountNumberField": "Számla",
        "categoryField": "Megbízás típusa",
        "categoryMap": MBH_CATEGORY_MAP,
        "displayName": "MBH Bank",
    },
    "kh": {
        "delimiter": "\t",
        "headerSignature": {"könyvelés dátuma", "összeg", "összeg devizaneme", "típus"},
        "dateField": "könyvelés dátuma",
        "dateFormat": "%Y.%m.%d",
        "amountField": "összeg",
        "amountLocale": "hu",
        "descriptionFields": ["típus"],
        "merchantFields": ["partner elnevezése"],
        "currencyField": "összeg devizaneme",
        "signRule": "as_is",
        "accountNumberField": "könyvelési számla",
        "categoryField": "típus",
        "categoryMap": KH_CATEGORY_MAP,
        "displayName": "K&H Bank",
    },
    "generic": {
        "delimiter": ",",
        "headerSignature": set(),
        "dateField": "date",
        "dateFormat": None,
        "amountField": "amount",
        "amountLocale": "en",
        "descriptionFields": ["description"],
        "merchantFields": ["merchant"],
        "currencyField": "currency",
        "signRule": "as_is",
        "accountNumberField": None,
        "displayName": "New",
    },
}


def _clean_header(name: str) -> str:
    """Strip whitespace and a leading UTF-8 BOM from a CSV header name."""
    return name.strip().lstrip("﻿")


CANDIDATE_DELIMITERS = [",", ";", "\t"]


def detect_bank_format(headers: List[str]) -> str:
    """Auto-detect bank format from a list of (possibly dirty) CSV headers."""
    cleaned = {_clean_header(h) for h in headers if h is not None}

    for name, fmt in BANK_FORMATS.items():
        signature = fmt["headerSignature"]
        if signature and signature.issubset(cleaned):
            return name

    return "generic"


def detect_delimiter(sample_text: str) -> str:
    """Best-effort delimiter guess for an arbitrary/unrecognized CSV, based on
    which candidate splits the header line into the most columns. Prefer
    detect_format_and_delimiter() when a known bank format is expected, since
    csv.Sniffer is easily fooled by delimiter characters inside header text
    (e.g. a comma inside a parenthetical column name)."""
    header_line = sample_text.splitlines()[0] if sample_text else ""
    counts = {d: header_line.count(d) for d in CANDIDATE_DELIMITERS}
    best = max(counts, key=counts.get)
    return best if counts[best] > 0 else ","


def detect_format_and_delimiter(text: str) -> "tuple[str, str]":
    """Try each known delimiter against the header line and return the
    (format_name, delimiter) pair whose headers match a known bank signature.
    Falls back to a frequency-based delimiter guess with format 'generic'."""
    header_line = text.splitlines()[0] if text else ""

    for delimiter in CANDIDATE_DELIMITERS:
        headers = next(csv.reader([header_line], delimiter=delimiter), [])
        fmt = detect_bank_format(headers)
        if fmt != "generic":
            return fmt, delimiter

    return "generic", detect_delimiter(text)


def get_mapping_for_format(format_name: str) -> Dict:
    """Get mapping for a specific bank format"""
    return BANK_FORMATS.get(format_name, BANK_FORMATS["generic"])


def suggest_mapping(headers: List[str]) -> Dict:
    """Suggest a mapping based on CSV headers"""
    detected = detect_bank_format(headers) if headers else "generic"
    return {
        "detected_format": detected,
        "mapping": get_mapping_for_format(detected),
    }


def read_csv_rows(raw_bytes: bytes) -> List[dict]:
    """Decode+parse raw CSV bytes, auto-detecting encoding BOM and delimiter."""
    text = raw_bytes.decode("utf-8-sig")
    _, delimiter = detect_format_and_delimiter(text)

    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    reader.fieldnames = [_clean_header(h) for h in (reader.fieldnames or [])]
    return list(reader)
