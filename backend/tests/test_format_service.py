from app.services.format_service import (
    detect_bank_format,
    detect_delimiter,
    detect_format_and_delimiter,
    get_mapping_for_format,
    read_csv_rows,
)


def test_detects_revolut():
    headers = ["Type", "Product", "Started Date", "Completed Date", "Description", "Amount", "Fee", "Currency", "State", "Balance"]
    assert detect_bank_format(headers) == "revolut"


def test_detects_curve_with_bom_and_whitespace():
    # Curve headers have a leading space after each comma, and the first
    # header can carry a UTF-8 BOM depending on how the file was decoded.
    headers = ["﻿Export Format", " Date (YYYY-MM-DD as UTC)", " Time (HH:MM:SS)", " Merchant",
               " Txn Amount (Funding Card)", " Txn Currency (Funding Card)"]
    assert detect_bank_format(headers) == "curve"


def test_detects_mbh():
    headers = ["﻿Számla", "Megbízás típusa", "Összeg", "Devizanem", "Eredeti összeg",
               "Közlemény", "Tranzakció dátuma", "Tranzakció helye", "Könyvelési dátum"]
    assert detect_bank_format(headers) == "mbh"


def test_detects_kh():
    headers = ["könyvelés dátuma", "tranzakció azonosító", "típus", "könyvelési számla",
               "partner számla", "partner elnevezése", "összeg", "összeg devizaneme", "közlemény"]
    assert detect_bank_format(headers) == "kh"


def test_unknown_headers_fall_back_to_generic():
    assert detect_bank_format(["foo", "bar"]) == "generic"


def test_detect_delimiter_semicolon():
    assert detect_delimiter("a;b;c\n1;2;3") == ";"


def test_detect_delimiter_tab():
    assert detect_delimiter("a\tb\tc\n1\t2\t3") == "\t"


def test_detect_delimiter_comma_default():
    assert detect_delimiter("a,b,c\n1,2,3") == ","


def test_get_mapping_for_unknown_format_returns_generic():
    assert get_mapping_for_format("does_not_exist") == get_mapping_for_format("generic")


def test_mbh_header_with_comma_inside_column_name_is_not_mistaken_for_csv():
    # "Kereskedői eszköz (POS, pénztárgép) azonosító" contains a literal comma,
    # which fools csv.Sniffer into picking ',' as the delimiter for a
    # semicolon-delimited file. detect_format_and_delimiter must not be fooled.
    header_line = (
        "Számla;Megbízás típusa;Összeg;Devizanem;Eredeti összeg;"
        "Kereskedői eszköz (POS, pénztárgép) azonosító;Tranzakció dátuma"
    )
    fmt, delimiter = detect_format_and_delimiter(header_line + "\n1;Vásárlás;-100,00;HUF;;;2025.01.01.")
    assert (fmt, delimiter) == ("mbh", ";")


def test_read_csv_rows_handles_bom_and_semicolons():
    raw = (
        "﻿Számla;Megbízás típusa;Összeg;Devizanem;Tranzakció dátuma\n"
        "111;Vásárlás;-1 165,00;HUF;2025.11.29.\n"
    ).encode("utf-8")
    rows = read_csv_rows(raw)
    assert len(rows) == 1
    assert rows[0]["Számla"] == "111"
    assert detect_bank_format(list(rows[0].keys())) == "mbh"
