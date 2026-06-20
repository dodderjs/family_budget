import pytest

from app.services.format_service import get_mapping_for_format
from app.services.normalization import normalize_transaction, should_skip_row


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


def test_generic_format_still_works():
    mapping = get_mapping_for_format("generic")
    row = {"date": "2024-01-15", "amount": "12.50", "description": "Coffee", "currency": "USD"}
    result = normalize_transaction(row, mapping, "acc-1")
    assert result["date"] == "2024-01-15"
    assert result["amount"] == 12.50


def test_malformed_amount_raises_value_error():
    mapping = get_mapping_for_format("revolut")
    row = {"Started Date": "2024-12-31 10:10:20", "Description": "Lidl", "Amount": "not-a-number", "Currency": "HUF"}
    with pytest.raises(ValueError):
        normalize_transaction(row, mapping, "acc-1")
