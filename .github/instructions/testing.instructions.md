---
name: "Testing & Quality Assurance"
description: "Use when: writing or running backend tests under backend/tests/."
applyTo: "backend/tests/**/*.py,frontend/src/__tests__/**/*.test.tsx"
---

# Testing

**Backend**: pytest is configured (`backend/pytest.ini`, `pythonpath = .`) with 45 tests across `test_format_service.py`, `test_normalization.py`, `test_ml_service.py`, `test_transaction_service.py`, `test_database.py`. Run:

```bash
docker exec family-budget-api python -m pytest -v
```

**Frontend**: no test suite exists yet. Verify UI changes by running the dev server and loading the page.

## Conventions

- Pure-function tests (format detection, amount/date parsing, transfer matching) need zero fixtures — just call the function. These cover most of `normalization.py`/`format_service.py`.
- DB-touching tests use the `db_session` fixture (`conftest.py`): SQLite in-memory, `Base.metadata.create_all()`, no MariaDB/Docker required.
- ML tests (`test_ml_service.py`) monkeypatch `ml_service.MODEL_DIR` to `tmp_path` so they never write into the real `backend/app/ml/models/*.pkl` — always do this if a test trains a model.
- When testing CSV parsing, use real rows from `/example` (actual bank exports), not invented ones — that's what caught the `csv.Sniffer` delimiter bug and the BOM/whitespace header issues.
- `monkeypatch` over manual mocking libraries for swapping out collaborators (e.g. the ML predictor, `time.sleep`, `engine.connect`).
