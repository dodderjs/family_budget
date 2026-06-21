import pytest

from app.services.format_service import get_mapping_for_format
from app.services.normalization import detect_curve_duplicates, detect_transfers, normalize_transaction, should_skip_row


def test_revolut_card_payment_is_negative():
    mapping = get_mapping_for_format("revolut")
    row = {
        "Type": "Card Payment", "Product": "Current",
        "Started Date": "2024-12-31 10:10:20", "Completed Date": "2025-01-01 15:42:11",
        "Description": "Lidl", "Amount": "-17224.00", "Fee": "0.00",
        "Currency": "HUF", "State": "COMPLETED", "Balance": "23027.33",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["date"] == "2024-12-31"
    assert result["amount"] == -17224.00
    assert result["currency"] == "HUF"
    assert result["merchant"] == "Lidl"


def test_revolut_topup_is_positive():
    mapping = get_mapping_for_format("revolut")
    row = {
        "Type": "Topup", "Started Date": "2025-01-05 14:16:07",
        "Description": "Top-up by *0738", "Amount": "40000.00", "Currency": "HUF", "State": "COMPLETED",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["amount"] == 40000.00


def test_revolut_skips_pending_and_reverted():
    mapping = get_mapping_for_format("revolut")
    assert should_skip_row({"State": "PENDING"}, mapping) is True
    assert should_skip_row({"State": "REVERTED"}, mapping) is True
    assert should_skip_row({"State": "COMPLETED"}, mapping) is False


def test_curve_normal_spend_becomes_negative():
    mapping = get_mapping_for_format("curve")
    row = {
        "Export Format": "CSV", "Date (YYYY-MM-DD as UTC)": "2021-09-14", "Time (HH:MM:SS)": "17:27:32",
        "Merchant": "Otpmobl*Icsekk Applika", "Txn Amount (Funding Card)": "6805.00",
        "Txn Currency (Funding Card)": "HUF", "Type": "", "Category": "Bills",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["date"] == "2021-09-14"
    assert result["amount"] == -6805.00
    assert result["merchant"] == "Otpmobl*Icsekk Applika"


def test_curve_refund_stays_positive():
    mapping = get_mapping_for_format("curve")
    row = {
        "Date (YYYY-MM-DD as UTC)": "2021-09-20", "Merchant": "Some Shop",
        "Txn Amount (Funding Card)": "500.00", "Txn Currency (Funding Card)": "HUF", "Type": "REFUNDED",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["amount"] == 500.00


@pytest.mark.parametrize("curve_category,expected_hint", [
    ("Bills", "bills"),
    ("Business Services", "business_services"),
    ("Eating Out", "eating_out"),
    ("Entertainment", "entertainment"),
    ("Finance", "general_finance"),
    ("General", "general"),
    ("Groceries", "groceries"),
    ("Health", "health"),
    ("Shopping", "shopping"),
    ("Transport", "transport"),
    ("Travel", "travel"),
])
def test_curve_category_maps_to_new_dedicated_categories(curve_category, expected_hint):
    mapping = get_mapping_for_format("curve")
    row = {
        "Date (YYYY-MM-DD as UTC)": "2021-09-14", "Merchant": "Some Place",
        "Txn Amount (Funding Card)": "100.00", "Txn Currency (Funding Card)": "HUF",
        "Type": "", "Category": curve_category,
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["category_hint"] == expected_hint


def test_curve_unmapped_category_yields_no_hint():
    mapping = get_mapping_for_format("curve")
    row = {
        "Date (YYYY-MM-DD as UTC)": "2021-09-14", "Merchant": "Some Shop",
        "Txn Amount (Funding Card)": "100.00", "Txn Currency (Funding Card)": "HUF",
        "Type": "", "Category": "Some Unmapped Label",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["category_hint"] is None


def test_formats_without_category_field_have_no_hint():
    mapping = get_mapping_for_format("mbh")
    row = {"Tranzakció dátuma": "2021.09.14.", "Összeg": "100", "Devizanem": "HUF"}
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["category_hint"] is None


def test_curve_headers_with_leading_whitespace_are_tolerated():
    mapping = get_mapping_for_format("curve")
    row = {
        "Export Format": "CSV", " Date (YYYY-MM-DD as UTC)": "2021-09-14",
        " Merchant": "Mvm Next Energiak", " Txn Amount (Funding Card)": "1372.00",
        " Txn Currency (Funding Card)": "HUF", " Type": "",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["amount"] == -1372.00
    assert result["merchant"] == "Mvm Next Energiak"


def test_mbh_hungarian_amount_format():
    mapping = get_mapping_for_format("mbh")
    row = {
        "Számla": "10103726-75049100-01006009", "Megbízás típusa": "Átutalás",
        "Összeg": "-100 000,00", "Devizanem": "HUF", "Tranzakció dátuma": "2025.11.27.",
        "Tranzakció helye": "",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["amount"] == -100000.00
    assert result["date"] == "2025-11-27"


def test_mbh_merchant_falls_back_to_counterparty_when_no_location():
    mapping = get_mapping_for_format("mbh")
    row = {
        "Megbízás típusa": "Átutalás", "Összeg": "-100 000,00", "Devizanem": "HUF",
        "Tranzakció dátuma": "2025.11.27.", "Tranzakció helye": "",
        "Ellenoldali számla tulajdonosa": "Füri Anikó",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["merchant"] == "Füri Anikó"
    assert "Füri Anikó" in result["description"]


def test_mbh_card_purchase_with_location():
    mapping = get_mapping_for_format("mbh")
    row = {
        "Megbízás típusa": "Vásárlás", "Összeg": "-1 165,00", "Devizanem": "HUF",
        "Tranzakció dátuma": "2025.11.29.", "Tranzakció helye": "CRV*SIMPLE PARKOLS BUD Curve.com NL",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["amount"] == -1165.00
    assert result["merchant"] == "CRV*SIMPLE PARKOLS BUD Curve.com NL"


def test_mbh_merchant_prefers_counterparty_over_generic_channel_label():
    # Regression: "Tranzakció helye" isn't always a real merchant - for
    # transfers/incoming items MBH fills it with a generic channel label
    # ("MobilApp", "Bankon kivulrol erkezo") that used to mask the real
    # counterparty name when both fields were non-empty.
    mapping = get_mapping_for_format("mbh")
    row = {
        "Megbízás típusa": "Fogadott tétel", "Összeg": "1 165 214,00", "Devizanem": "HUF",
        "Tranzakció dátuma": "2025.11.26.",
        "Ellenoldali számla tulajdonosa": "Morgan Stanley Magyarország El",
        "Tranzakció helye": "Bankon kivulrol erkezo",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["merchant"] == "Morgan Stanley Magyarország El"


def test_mbh_category_hint_for_unambiguous_fee_types():
    mapping = get_mapping_for_format("mbh")
    row = {
        "Megbízás típusa": "Forgalmi jutalék", "Összeg": "-399,00", "Devizanem": "HUF",
        "Tranzakció dátuma": "2025.11.28.", "Tranzakció helye": "Kozpont",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["category_hint"] == "bank_fees"


def test_mbh_category_hint_is_none_for_ambiguous_types():
    # "Vásárlás" (purchase) and "Átutalás" (transfer) can be anything - the
    # ML model should decide from merchant text, not a forced hint.
    mapping = get_mapping_for_format("mbh")
    row = {
        "Megbízás típusa": "Vásárlás", "Összeg": "-1000,00", "Devizanem": "HUF",
        "Tranzakció dátuma": "2025.11.28.", "Tranzakció helye": "Lidl",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["category_hint"] is None


def test_mbh_card_hint_is_the_full_account_number():
    # MBH's accountNumberField is the bank account number (e.g.
    # "10100895-89248114-48556663", 26 chars) - longer than a card's last-4
    # digits. Transaction.card_hint must be sized to hold it (regression for
    # a "Data too long for column 'card_hint'" insert failure on every row).
    mapping = get_mapping_for_format("mbh")
    row = {
        "Számla": "10100895-89248114-48556663", "Megbízás típusa": "Vásárlás",
        "Összeg": "-15 534,00", "Devizanem": "HUF", "Tranzakció dátuma": "2025.11.29.",
        "Tranzakció helye": "ERZSEBET SORKERT PIZ GODOLLO",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["card_hint"] == "10100895-89248114-48556663"


def test_kh_plain_integer_amount():
    mapping = get_mapping_for_format("kh")
    row = {
        "könyvelés dátuma": "2021.12.31", "típus": "Vásárlás belföldi kereskedőnél",
        "partner elnevezése": "Kifli.hu", "összeg": "-21463", "összeg devizaneme": "HUF",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["amount"] == -21463.0
    assert result["date"] == "2021-12-31"
    assert result["merchant"] == "Kifli.hu"


def test_kh_positive_interest():
    mapping = get_mapping_for_format("kh")
    row = {
        "könyvelés dátuma": "2021.12.31", "típus": "Kamat", "összeg": "6", "összeg devizaneme": "HUF",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["amount"] == 6.0
    assert result["category_hint"] == "interest"


def test_kh_category_hint_is_none_for_ambiguous_purchase_type():
    mapping = get_mapping_for_format("kh")
    row = {
        "könyvelés dátuma": "2021.12.31", "típus": "Vásárlás belföldi kereskedőnél",
        "partner elnevezése": "Kifli.hu", "összeg": "-21463", "összeg devizaneme": "HUF",
    }
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["category_hint"] is None


def test_generic_format_still_works():
    mapping = get_mapping_for_format("generic")
    row = {"date": "2024-01-15", "amount": "12.50", "description": "Coffee", "currency": "USD"}
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["date"] == "2024-01-15"
    assert result["amount"] == 12.50
    assert result["currency"] == "USD"


def test_currency_defaults_to_huf_when_the_row_has_no_currency_value():
    # Almost everything in this app is a HUF transaction - HUF (not USD) is
    # the right fallback for a row whose currency column is blank/missing,
    # since create_transaction only attempts an FX conversion when currency
    # != HUF.
    mapping = get_mapping_for_format("generic")
    row = {"date": "2024-01-15", "amount": "12.50", "description": "Coffee"}
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["currency"] == "HUF"


def test_malformed_amount_raises_value_error():
    mapping = get_mapping_for_format("revolut")
    row = {"Started Date": "2024-12-31 10:10:20", "Description": "Lidl", "Amount": "not-a-number", "Currency": "HUF"}
    with pytest.raises(ValueError):
        normalize_transaction(row, mapping, "acc-1")


def test_detect_transfers_matches_cross_account_opposite_pair():
    transactions = [
        {"id": "t1", "account_id": "checking", "amount": -50000.0, "date": "2025-01-10"},
        {"id": "t2", "account_id": "savings", "amount": 50000.0, "date": "2025-01-10"},
    ]
    assert detect_transfers(transactions) == [("t1", "t2")]


def test_detect_transfers_ignores_same_account_pairs():
    # Same account, equal-and-opposite amount (e.g. a purchase + an unrelated
    # refund) must not be flagged as an inter-account transfer.
    transactions = [
        {"id": "t1", "account_id": "checking", "amount": -50000.0, "date": "2025-01-10"},
        {"id": "t2", "account_id": "checking", "amount": 50000.0, "date": "2025-01-10"},
    ]
    assert detect_transfers(transactions) == []


def test_detect_transfers_requires_opposite_signs():
    transactions = [
        {"id": "t1", "account_id": "checking", "amount": -50000.0, "date": "2025-01-10"},
        {"id": "t2", "account_id": "savings", "amount": -50000.0, "date": "2025-01-10"},
    ]
    assert detect_transfers(transactions) == []


def test_detect_transfers_respects_day_window():
    close = [
        {"id": "t1", "account_id": "checking", "amount": -1000.0, "date": "2025-01-10"},
        {"id": "t2", "account_id": "savings", "amount": 1000.0, "date": "2025-01-12"},
    ]
    assert detect_transfers(close, max_day_diff=2) == [("t1", "t2")]

    far = [
        {"id": "t1", "account_id": "checking", "amount": -1000.0, "date": "2025-01-01"},
        {"id": "t2", "account_id": "savings", "amount": 1000.0, "date": "2025-01-29"},
    ]
    assert detect_transfers(far, max_day_diff=2) == []


def test_detect_transfers_each_transaction_matched_at_most_once():
    transactions = [
        {"id": "t1", "account_id": "checking", "amount": -1000.0, "date": "2025-01-10"},
        {"id": "t2", "account_id": "savings", "amount": 1000.0, "date": "2025-01-10"},
        {"id": "t3", "account_id": "credit_card", "amount": 1000.0, "date": "2025-01-10"},
    ]
    pairs = detect_transfers(transactions)
    assert len(pairs) == 1
    matched_ids = {i for pair in pairs for i in pair}
    assert len(matched_ids) == 2


def test_detect_curve_duplicates_matches_via_card_suffix():
    # Curve's row card_hint ("9948") resolves to mbh's registered card, and
    # the amounts/dates/signs line up - same purchase, reported twice.
    transactions = [
        {"id": "mbh-1", "account_id": "mbh", "amount": -6805.0, "date": "2025-09-14", "card_hint": None},
        {"id": "curve-1", "account_id": "curve", "amount": -6805.0, "date": "2025-09-14", "card_hint": "9948"},
    ]
    cards = [{"account_id": "mbh", "card_number": "****9948"}]
    assert detect_curve_duplicates(transactions, cards) == [("mbh-1", "curve-1")]


def test_detect_curve_duplicates_requires_same_sign():
    # Opposite signs would mean a transfer, not a restated purchase - not this function's job.
    transactions = [
        {"id": "mbh-1", "account_id": "mbh", "amount": 6805.0, "date": "2025-09-14", "card_hint": None},
        {"id": "curve-1", "account_id": "curve", "amount": -6805.0, "date": "2025-09-14", "card_hint": "9948"},
    ]
    cards = [{"account_id": "mbh", "card_number": "****9948"}]
    assert detect_curve_duplicates(transactions, cards) == []


def test_detect_curve_duplicates_ignores_unregistered_card():
    transactions = [
        {"id": "mbh-1", "account_id": "mbh", "amount": -6805.0, "date": "2025-09-14", "card_hint": None},
        {"id": "curve-1", "account_id": "curve", "amount": -6805.0, "date": "2025-09-14", "card_hint": "0000"},
    ]
    cards = [{"account_id": "mbh", "card_number": "****9948"}]
    assert detect_curve_duplicates(transactions, cards) == []


def test_detect_curve_duplicates_ignores_same_account():
    # A card registered to the curve transaction's own account shouldn't self-match.
    transactions = [
        {"id": "curve-1", "account_id": "curve", "amount": -6805.0, "date": "2025-09-14", "card_hint": "9948"},
        {"id": "curve-2", "account_id": "curve", "amount": -6805.0, "date": "2025-09-14", "card_hint": "9948"},
    ]
    cards = [{"account_id": "curve", "card_number": "****9948"}]
    assert detect_curve_duplicates(transactions, cards) == []


def test_detect_curve_duplicates_respects_day_window():
    cards = [{"account_id": "mbh", "card_number": "****9948"}]
    close = [
        {"id": "mbh-1", "account_id": "mbh", "amount": -1000.0, "date": "2025-09-14", "card_hint": None},
        {"id": "curve-1", "account_id": "curve", "amount": -1000.0, "date": "2025-09-16", "card_hint": "9948"},
    ]
    assert detect_curve_duplicates(close, cards, max_day_diff=2) == [("mbh-1", "curve-1")]

    far = [
        {"id": "mbh-1", "account_id": "mbh", "amount": -1000.0, "date": "2025-09-01", "card_hint": None},
        {"id": "curve-1", "account_id": "curve", "amount": -1000.0, "date": "2025-09-29", "card_hint": "9948"},
    ]
    assert detect_curve_duplicates(far, cards, max_day_diff=2) == []


def test_detect_curve_duplicates_each_transaction_matched_at_most_once():
    cards = [{"account_id": "mbh", "card_number": "****9948"}]
    transactions = [
        {"id": "mbh-1", "account_id": "mbh", "amount": -1000.0, "date": "2025-09-14", "card_hint": None},
        {"id": "mbh-2", "account_id": "mbh", "amount": -1000.0, "date": "2025-09-14", "card_hint": None},
        {"id": "curve-1", "account_id": "curve", "amount": -1000.0, "date": "2025-09-14", "card_hint": "9948"},
    ]
    pairs = detect_curve_duplicates(transactions, cards)
    assert len(pairs) == 1
    matched_ids = {i for pair in pairs for i in pair}
    assert len(matched_ids) == 2
