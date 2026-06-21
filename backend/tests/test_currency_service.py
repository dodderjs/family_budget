import httpx
import pytest

from app.services import currency_service
from app.services.currency_service import CurrencyService


class _FakeResponse:
    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json_data = json_data or {}

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("error", request=None, response=self)

    def json(self):
        return self._json_data


def test_convert_to_huf_returns_amount_and_rate_on_success(monkeypatch):
    def fake_get(url, params=None, **kwargs):
        assert params == {"from": "EUR", "to": "HUF"}
        return _FakeResponse(200, {"rates": {"HUF": 390.5}})

    monkeypatch.setattr(currency_service.httpx, "get", fake_get)

    result = CurrencyService.convert_to_huf(-7.99, "EUR", "2024-01-15")
    assert result == (-7.99 * 390.5, 390.5)


def test_convert_to_huf_preserves_sign_for_positive_amount(monkeypatch):
    monkeypatch.setattr(currency_service.httpx, "get", lambda *a, **k: _FakeResponse(200, {"rates": {"HUF": 400.0}}))
    converted_amount, rate = CurrencyService.convert_to_huf(100.0, "USD", "2024-01-15")
    assert converted_amount == 40000.0
    assert rate == 400.0


def test_convert_to_huf_returns_none_on_unknown_currency(monkeypatch):
    # Frankfurter 404s for a currency it doesn't recognize (e.g. Curve's
    # non-ISO "CPT" points balance).
    monkeypatch.setattr(currency_service.httpx, "get", lambda *a, **k: _FakeResponse(404, {}))
    assert CurrencyService.convert_to_huf(78.0, "CPT", "2024-01-15") is None


def test_convert_to_huf_returns_none_when_rate_missing_from_response(monkeypatch):
    monkeypatch.setattr(currency_service.httpx, "get", lambda *a, **k: _FakeResponse(200, {"rates": {}}))
    assert CurrencyService.convert_to_huf(10.0, "EUR", "2024-01-15") is None


def test_convert_to_huf_returns_none_on_network_failure(monkeypatch):
    def raise_error(*a, **k):
        raise httpx.ConnectError("network down")

    monkeypatch.setattr(currency_service.httpx, "get", raise_error)
    assert CurrencyService.convert_to_huf(10.0, "EUR", "2024-01-15") is None
