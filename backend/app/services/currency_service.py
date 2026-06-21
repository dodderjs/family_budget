from typing import Optional

import httpx

HUF = "HUF"
# frankfurter.app redirects here as of 2026 - call the current host directly
# rather than relying on every conversion paying for a 301 round trip.
FRANKFURTER_BASE_URL = "https://api.frankfurter.dev/v1"


class CurrencyService:
    @staticmethod
    def convert_to_huf(amount: float, currency: str, date: str) -> Optional[tuple[float, float]]:
        """Convert `amount` (in `currency`) to HUF using the historical rate
        for `date` (YYYY-MM-DD), via the free Frankfurter/ECB rate API.

        Returns (converted_amount, rate) where rate is HUF per 1 unit of
        `currency`, or None if no rate could be found - an unknown/non-ISO
        currency code (e.g. Curve's "CPT" points balance), a network failure,
        or a missing HUF rate for that date. Callers should keep the original
        amount/currency untouched in that case rather than fail the import.
        """
        try:
            response = httpx.get(
                f"{FRANKFURTER_BASE_URL}/{date}", params={"from": currency, "to": HUF},
                timeout=5.0, follow_redirects=True,
            )
            response.raise_for_status()
            rate = response.json().get("rates", {}).get(HUF)
            if not rate:
                return None
            return amount * rate, rate
        except Exception:
            return None
