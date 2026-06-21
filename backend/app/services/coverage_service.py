from sqlalchemy.orm import Session
from app.models.transaction import Transaction, AccountCoverageFlag


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


class CoverageService:
    @staticmethod
    def get_account_coverage(db: Session, account_id: str) -> dict:
        dates = [d for (d,) in db.query(Transaction.date).filter(Transaction.account_id == account_id).all()]
        if not dates:
            return {"account_id": account_id, "first_date": None, "last_date": None, "months": []}

        first_date, last_date = min(dates), max(dates)

        counts: dict[str, int] = {}
        for d in dates:
            month = d[:7]
            counts[month] = counts.get(month, 0) + 1

        flags = {
            f.month: f.status
            for f in db.query(AccountCoverageFlag).filter(AccountCoverageFlag.account_id == account_id).all()
        }

        months = []
        for month in _month_range(first_date[:7], last_date[:7]):
            count = counts.get(month, 0)
            status = "covered" if count > 0 else flags.get(month, "gap")
            months.append({"month": month, "transaction_count": count, "status": status})

        return {"account_id": account_id, "first_date": first_date, "last_date": last_date, "months": months}

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
