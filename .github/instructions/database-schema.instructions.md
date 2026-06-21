---
name: "Database & Schema Modifications"
description: "Use when: adding/changing tables or columns, or touching backend/app/models/transaction.py or backend/app/db/."
applyTo: "backend/app/models/transaction.py,backend/app/db/**/*.py,backend/alembic/**/*.py"
---

# Database & Schema

MariaDB 11 + SQLAlchemy. **Schema is created lazily** via `Base.metadata.create_all(bind=engine)` in `main.py` — there is no real Alembic migration history in `backend/alembic/versions/` despite `alembic` being installed. Don't assume migrations are the live source of truth; if you need to evolve the schema, either add a column to the model (picked up automatically on next `create_all`, which only adds *new* tables/columns, never alters existing ones) or raise introducing real migrations as a decision before doing it — that's an architecture change, not a routine edit.

## Current tables (`backend/app/models/transaction.py`)

- `Account`: id, name, account_number (unique), type (nullable — Checking/Credit/etc.), created_at
- `Transaction`: id, account_id (FK), date (`YYYY-MM-DD` string), amount (float, signed: + income / - expense), currency, description, merchant, raw_source (json), hash_fingerprint (unique, dedup key), category_predicted, category_confidence, category_final, is_transfer, transfer_match_id, created_at, updated_at
- `Category`: id, name (unique) — defined but currently unused; categories are plain strings on `Transaction`
- `TrainingData`: id, transaction_id (FK), original_label, corrected_label, created_at

## Rules

1. New columns: add to the model with a sensible default/nullable, so existing rows aren't broken by `create_all`'s additive-only behavior.
2. Always `db.commit()` after writes; `db.refresh(obj)` if you need DB-generated defaults (e.g. UUID `id`) back on the object.
3. Filter out flagged transfers in any new aggregation: `.filter(Transaction.is_transfer == False)` — see `get_analytics_summary` for the pattern.
4. Use `db.query(Model).filter(...).all()` / `.first()` — this codebase doesn't use `select()` 2.0-style queries.

## Testing against a real schema without MariaDB

`backend/tests/conftest.py`'s `db_session` fixture spins up SQLite in-memory and runs `Base.metadata.create_all()` against it — fast, no Docker/MariaDB needed. Use it for any service-layer test that touches the DB.
