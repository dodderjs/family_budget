from sqlalchemy import func
from sqlalchemy.orm import Session
from app.models.transaction import Account, Transaction, AccountCoverageFlag


def _month_range(start: str, end: str) -> list[str]:
    """Every "YYYY-MM" from start to end, inclusive."""
    start_year, start_month = int(start[:4]), int(start[5:7])
    end_year, end_month = int(end[:4]), int(end[5:7])

    months = []
    year, month = start_year, start_month
    while (year, month) <= (end_year, end_month):
        months.append(f"{year:04d}-{month:02d}")
        month += 1
        if month > 12:
            month = 1
            year += 1
    return months


def _build_months(counts: dict[str, int], first_date: str, last_date: str, flags: dict[str, str]) -> list[dict]:
    """Expand a month->count map into every calendar month of the account's
    span. A month with transactions is always "covered" - a stale flag left
    over from before the data was uploaded never wins over the live count."""
    months = []
    for month in _month_range(first_date[:7], last_date[:7]):
        count = counts.get(month, 0)
        status = "covered" if count > 0 else flags.get(month, "gap")
        months.append({"month": month, "transaction_count": count, "status": status})
    return months


class CoverageService:
    @staticmethod
    def get_account_coverage(db: Session, account_id: str) -> dict:
        month_expr = func.substr(Transaction.date, 1, 7)
        rows = (
            db.query(month_expr, func.count(Transaction.id), func.min(Transaction.date), func.max(Transaction.date))
            .filter(Transaction.account_id == account_id)
            .group_by(month_expr)
            .all()
        )
        if not rows:
            return {"account_id": account_id, "first_date": None, "last_date": None, "months": []}

        counts = {month: count for month, count, _, _ in rows}
        first_date = min(row[2] for row in rows)
        last_date = max(row[3] for row in rows)

        flags = {
            f.month: f.status
            for f in db.query(AccountCoverageFlag).filter(AccountCoverageFlag.account_id == account_id).all()
        }

        return {
            "account_id": account_id,
            "first_date": first_date,
            "last_date": last_date,
            "months": _build_months(counts, first_date, last_date, flags),
        }

    @staticmethod
    def get_all_accounts_coverage(db: Session) -> list[dict]:
        """Coverage for every account in two grouped queries instead of one
        request per account. The dashboard only needs the per-status counts
        and the date span, so the month list is summarized here rather than
        shipped in full."""
        accounts = db.query(Account).all()
        if not accounts:
            return []

        month_expr = func.substr(Transaction.date, 1, 7)
        counts_by_account: dict[str, dict[str, int]] = {}
        span_by_account: dict[str, tuple[str, str]] = {}
        for account_id, month, count, first_date, last_date in (
            db.query(
                Transaction.account_id,
                month_expr,
                func.count(Transaction.id),
                func.min(Transaction.date),
                func.max(Transaction.date),
            )
            .group_by(Transaction.account_id, month_expr)
            .all()
        ):
            counts_by_account.setdefault(account_id, {})[month] = count
            existing = span_by_account.get(account_id)
            if existing is None:
                span_by_account[account_id] = (first_date, last_date)
            else:
                span_by_account[account_id] = (min(existing[0], first_date), max(existing[1], last_date))

        flags_by_account: dict[str, dict[str, str]] = {}
        for flag in db.query(AccountCoverageFlag).all():
            flags_by_account.setdefault(flag.account_id, {})[flag.month] = flag.status

        summaries = []
        for account in accounts:
            span = span_by_account.get(account.id)
            months = (
                _build_months(
                    counts_by_account.get(account.id, {}),
                    span[0],
                    span[1],
                    flags_by_account.get(account.id, {}),
                )
                if span
                else []
            )
            status_counts = {"covered": 0, "gap": 0, "missing": 0, "dismissed": 0}
            for month in months:
                status_counts[month["status"]] += 1

            summaries.append({
                "account_id": account.id,
                "account_name": account.name,
                "account_type": account.type,
                "first_date": span[0] if span else None,
                "last_date": span[1] if span else None,
                "transaction_count": sum(counts_by_account.get(account.id, {}).values()),
                **status_counts,
            })
        return summaries

    @staticmethod
    def set_month_status(db: Session, account_id: str, month: str, status: str) -> None:
        existing = db.query(AccountCoverageFlag).filter(
            AccountCoverageFlag.account_id == account_id, AccountCoverageFlag.month == month
        ).first()

        if status == "gap":
            if existing:
                db.delete(existing)
                db.commit()
            return

        if existing:
            existing.status = status
        else:
            db.add(AccountCoverageFlag(account_id=account_id, month=month, status=status))
        db.commit()
