---
name: "Testing & Quality Assurance"
description: "Use when: writing or running backend tests under backend/tests/ or frontend tests under frontend/src/__tests__/."
applyTo: "backend/tests/**/*.py,frontend/src/__tests__/**/*.test.ts,frontend/src/__tests__/**/*.test.tsx"
---

# Testing

**Backend**: pytest is configured (`backend/pytest.ini`, `pythonpath = .`), covering format detection, normalization, ML, transactions, accounts, categories, coverage, currency, reset, and database. Run:

```bash
docker exec family-budget-api python -m pytest -v
```

**Frontend**: vitest + Testing Library + jsdom (`frontend/vitest.config.ts`, setup in `frontend/src/test/setup.ts`). Specs are in `frontend/src/__tests__/{services,utils}/*.test.ts`. Run:

```bash
docker exec family-budget-web npm test
```

Note the container is `family-budget-web` (`family-budget-frontend` is the npm package name, not a container).

Neither suite proves a UI change renders — screenshot it with `docker exec family-budget-web node scripts/screenshot.mjs <url> /app/.screenshot.png` (lands at `frontend/.screenshot.png` via the bind mount).

## Conventions

- Pure-function tests (format detection, amount/date parsing, transfer matching) need zero fixtures — just call the function. These cover most of `normalization.py`/`format_service.py`.
- DB-touching tests use the `db_session` fixture (`conftest.py`): SQLite in-memory, `Base.metadata.create_all()`, no MariaDB/Docker required.
- ML tests (`test_ml_service.py`) monkeypatch `ml_service.MODEL_DIR` to `tmp_path` so they never write into the real `backend/app/ml/models/*.pkl` — always do this if a test trains a model.
- When testing CSV parsing, use real rows from `/example` (actual bank exports), not invented ones — that's what caught the `csv.Sniffer` delimiter bug and the BOM/whitespace header issues.
- `monkeypatch` over manual mocking libraries for swapping out collaborators (e.g. the ML predictor, `time.sleep`, `engine.connect`).
- Frontend tests target the extracted service/util layer (`frontend/src/services/`, `frontend/src/utils/`), not components — that's why logic worth testing gets pulled out of the page component first. Stub the axios client (`services/api.ts`) with `vi.mock`/`vi.fn` rather than hitting a live backend.
- Frontend specs are `.ts`, not `.tsx` — they import plain modules. Only use `.tsx` if a spec actually renders JSX.
