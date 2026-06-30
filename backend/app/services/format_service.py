import csv
import io
from typing import Dict, List, Optional
from app.constants.category_maps import CURVE_CATEGORY_MAP, KH_CATEGORY_MAP, MBH_CATEGORY_MAP

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
        "typeField": "Type",
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
        "defaultType": "Card Payment",
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
        "descriptionFields": ["Közlemény", "Kiegészítő információ","Megbízás típusa"],
        # "Ellenoldali számla tulajdonosa" (counterparty name) comes first -
        # for transfers/fees/incoming items it's the real merchant/payer
        # (e.g. "Morgan Stanley"). "Tranzakció helye" (transaction location)
        # is checked second since for those same row types it's just a
        # generic channel label ("MobilApp", "Kozpont", "Bankon kivulrol
        # erkezo") that would otherwise mask the real counterparty - it's
        # only the genuine merchant for card purchases, which have no counterparty.
        "merchantFields": ["Ellenoldali számla tulajdonosa", "Ellenoldali számla száma","Tranzakció helye"],
        "currencyField": "Devizanem",
        "signRule": "as_is",
        "typeField": "Megbízás típusa",
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
        "descriptionFields": ["közlemény", "partner elnevezése", "partner számla", "partner másodlagos számlaazonosító", "típus"],
        "merchantFields": ["partner elnevezése", "partner számla", "partner másodlagos számlaazonosító"],
        "currencyField": "összeg devizaneme",
        "signRule": "as_is",
        "typeField": "típus",
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
