import pytest

from app.models.transaction import Account, Transaction, AccountCoverageFlag
from app.services.coverage_service import CoverageService, _month_range


def test_month_range_within_a_single_year():
    assert _month_range("2024-01", "2024-04") == ["2024-01", "2024-02", "2024-03", "2024-04"]


def test_month_range_crosses_a_year_boundary():
    assert _month_range("2023-11", "2024-02") == ["2023-11", "2023-12", "2024-01", "2024-02"]


def test_month_range_single_month():
    assert _month_range("2024-06", "2024-06") == ["2024-06"]


@pytest.fixture
def account(db_session):
    acc = Account(name="Test Account", account_number="****1234", type=None)
    db_session.add(acc)
    db_session.commit()
    return acc


def _add_transaction(db_session, account_id, date):
    db_session.add(Transaction(
        account_id=account_id, date=date, amount=-10.0, description="Test",
        hash_fingerprint=f"fp-{date}-{account_id}",
    ))
    db_session.commit()


def test_coverage_for_account_with_no_transactions_is_empty(db_session, account):
    coverage = CoverageService.get_account_coverage(db_session, account.id)
    assert coverage == {"account_id": account.id, "first_date": None, "last_date": None, "months": []}


def test_coverage_marks_months_with_transactions_as_covered(db_session, account):
    _add_transaction(db_session, account.id, "2024-01-15")
    _add_transaction(db_session, account.id, "2024-01-20")
    _add_transaction(db_session, account.id, "2024-03-05")

    coverage = CoverageService.get_account_coverage(db_session, account.id)

    assert coverage["first_date"] == "2024-01-15"
    assert coverage["last_date"] == "2024-03-05"
    months = {m["month"]: m for m in coverage["months"]}
    assert months["2024-01"]["status"] == "covered"
    assert months["2024-01"]["transaction_count"] == 2
    assert months["2024-02"]["status"] == "gap"
    assert months["2024-02"]["transaction_count"] == 0
    assert months["2024-03"]["status"] == "covered"


def test_coverage_reflects_a_missing_flag_on_a_gap_month(db_session, account):
    _add_transaction(db_session, account.id, "2024-01-15")
    _add_transaction(db_session, account.id, "2024-03-05")
    CoverageService.set_month_status(db_session, account.id, "2024-02", "missing")

    coverage = CoverageService.get_account_coverage(db_session, account.id)

    months = {m["month"]: m for m in coverage["months"]}
    assert months["2024-02"]["status"] == "missing"


def test_set_month_status_dismissed_then_reset_to_gap(db_session, account):
    _add_transaction(db_session, account.id, "2024-01-15")
    _add_transaction(db_session, account.id, "2024-03-05")

    CoverageService.set_month_status(db_session, account.id, "2024-02", "dismissed")
    coverage = CoverageService.get_account_coverage(db_session, account.id)
    assert {m["month"]: m["status"] for m in coverage["months"]}["2024-02"] == "dismissed"

    CoverageService.set_month_status(db_session, account.id, "2024-02", "gap")
    coverage = CoverageService.get_account_coverage(db_session, account.id)
    assert {m["month"]: m["status"] for m in coverage["months"]}["2024-02"] == "gap"
    assert db_session.query(AccountCoverageFlag).filter(
        AccountCoverageFlag.account_id == account.id, AccountCoverageFlag.month == "2024-02"
    ).first() is None


def test_set_month_status_upserts_rather_than_duplicating(db_session, account):
    CoverageService.set_month_status(db_session, account.id, "2024-02", "missing")
    CoverageService.set_month_status(db_session, account.id, "2024-02", "dismissed")

    flags = db_session.query(AccountCoverageFlag).filter(
        AccountCoverageFlag.account_id == account.id, AccountCoverageFlag.month == "2024-02"
    ).all()
    assert len(flags) == 1
    assert flags[0].status == "dismissed"


def test_a_covered_month_is_covered_even_if_a_stale_flag_exists(db_session, account):
    # A month flagged "missing" before the user later uploaded data for it
    # should show as covered, not missing - the flag becomes stale, it's not
    # cleared automatically, but the live transaction count always wins.
    CoverageService.set_month_status(db_session, account.id, "2024-02", "missing")
    _add_transaction(db_session, account.id, "2024-01-15")
    _add_transaction(db_session, account.id, "2024-02-10")
    _add_transaction(db_session, account.id, "2024-03-05")

    coverage = CoverageService.get_account_coverage(db_session, account.id)
    assert {m["month"]: m["status"] for m in coverage["months"]}["2024-02"] == "covered"
