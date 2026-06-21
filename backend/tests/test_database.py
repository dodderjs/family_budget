import pytest
from sqlalchemy.exc import OperationalError

from app.db import database


def _operational_error():
    return OperationalError("SELECT 1", {}, Exception("connection refused"))


def test_wait_for_db_retries_until_connection_succeeds(monkeypatch):
    monkeypatch.setattr(database.time, "sleep", lambda _: None)

    class FakeConnection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            return False

    attempts = {"count": 0}

    def fake_connect():
        attempts["count"] += 1
        if attempts["count"] < 3:
            raise _operational_error()
        return FakeConnection()

    monkeypatch.setattr(database.engine, "connect", fake_connect)

    database.wait_for_db(max_retries=5, delay_seconds=0)

    assert attempts["count"] == 3


def test_wait_for_db_raises_after_exhausting_retries(monkeypatch):
    monkeypatch.setattr(database.time, "sleep", lambda _: None)

    def always_fail():
        raise _operational_error()

    monkeypatch.setattr(database.engine, "connect", always_fail)

    with pytest.raises(OperationalError):
        database.wait_for_db(max_retries=3, delay_seconds=0)
