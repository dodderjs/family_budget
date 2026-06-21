---
name: "Backend API Development"
description: "Use when: adding/modifying FastAPI endpoints, services, or business logic under backend/app/."
applyTo: "backend/app/**/*.py"
---

# Backend API Development

## Quick rules

1. Pydantic schemas for every request/response shape.
2. Type-hint all functions.
3. `Depends(get_db)` for sessions — never construct a `Session` directly in a route.
4. Routes (`api/transactions.py`) call services (`services/*.py`); no business logic in route handlers.
5. Real HTTP status codes via `HTTPException(status_code=..., detail=...)` — never a bare `raise Exception(...)`.

## Layout

`api/transactions.py` (routes, prefix `/api/v1`) → `services/{transaction,ml,normalization,format}_service.py` (logic) → `models/transaction.py` (SQLAlchemy) + `models/schemas.py` (Pydantic). Full endpoint list: [API_REFERENCE.md](../../API_REFERENCE.md).

## Adding an endpoint

1. Schema in `models/schemas.py` if the shape is new.
2. Logic as a `@staticmethod` on the relevant service class.
3. Thin route handler in `api/transactions.py` calling the service.
4. Exercise it via `/docs` (Swagger) or `curl`, then add a test.

## Exception conventions to know before touching transaction ingest

- `DuplicateTransactionError` (raised by `TransactionService.create_transaction`) is a distinct type from the plain `ValueError` `normalize_transaction` raises for malformed rows. The `/transactions/normalize` loop catches them separately on purpose — don't collapse them back into one `except`.
- `should_skip_row(row, mapping)` short-circuits format-specific exclusions (e.g. Revolut `PENDING`/`REVERTED`) before normalization even runs.

## Testing

`docker exec family-budget-api python -m pytest -v` — see [testing.instructions.md](testing.instructions.md).
