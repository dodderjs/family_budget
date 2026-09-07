---
name: "Family Budget Project Instructions"
description: "Repo-wide context for Family Budget: a CSV-import + ML-categorization budget tracker. Loaded automatically for every Copilot Chat request in this workspace."
---

# Family Budget

FastAPI (Python 3.11) + SQLAlchemy/MariaDB backend, React/TypeScript/Vite frontend (MUI v9 + AG Grid Enterprise + Zustand), sklearn (TF-IDF + LogisticRegression) for transaction categorization. Full endpoint docs: [API_REFERENCE.md](../API_REFERENCE.md). Setup: [README.md](../README.md). Don't restate either here — read them.

Scoped, file-pattern-triggered guides live in [.github/instructions/](instructions/): `backend-api`, `frontend-react`, `database-schema`, `ml-categorization`, `testing`. They load automatically based on which file you're editing.

## Architecture

```
backend/app/
  api/transactions.py        # all routes, prefix /api/v1
  services/
    transaction_service.py   # CRUD, analytics, dedup, transfer flagging
    ml_service.py             # CategoryPredictor (sklearn)
    normalization.py          # CSV row -> standard transaction dict
    format_service.py         # bank CSV format registry + detection
  models/transaction.py       # SQLAlchemy: Account, Transaction, Category, TrainingData
  models/schemas.py           # Pydantic request/response models
  db/database.py              # engine, session, wait_for_db() retry loop
frontend/src/
  pages/{Upload,Review,Analytics}Page.tsx
  services/{api,transactionService,csvService}.ts
  store/transactionStore.ts   # Zustand
```

## Run & test

```bash
docker compose -f docker-compose.dev.yml up -d --build
docker exec family-budget-api python -m pytest -v   # backend: in-memory SQLite, no network
docker exec family-budget-web npm test              # frontend: vitest run
```

The frontend container is `family-budget-web`, not `family-budget-frontend` (that's just the npm package name).

The frontend suite is vitest + Testing Library + jsdom, in `frontend/src/__tests__/{services,utils}/*.test.ts` — it covers extracted logic, not rendered components. Neither suite proves a UI change renders; screenshot it to confirm:

```bash
docker exec family-budget-web node scripts/screenshot.mjs http://localhost:5173/ /app/.screenshot.png
```

`./frontend` is bind-mounted at `/app`, so the PNG appears at `frontend/.screenshot.png`. Don't hand-roll a Playwright script: the container is Alpine/musl, so Playwright's bundled Chromium won't execute, and the API is only reachable via the host-resolver mapping the script already sets.

## Supported CSV formats (real banks, not placeholders)

`revolut`, `curve`, `mbh` (covers both debit and credit-card exports — same column layout), `kh`, and a `generic` fallback. Defined in `format_service.py`. Real sample files for every format are in `/example` (Hungarian banks: semicolon or tab delimited, UTF-8 BOM, comma-decimal amounts like `"-1 165,00"`). `/data/*.csv` are minimal English fixtures for the `generic` path only — don't confuse the two when testing a parsing change.

## Known sharp edges (fixed once, don't reintroduce)

- **Delimiter detection**: don't reach for `csv.Sniffer()` — a comma inside one MBH header's parenthetical text fools it. Use `format_service.detect_format_and_delimiter`, which matches header signatures per known delimiter instead.
- **ML category encoding**: a model's predicted class index is a *position* in `model.classes_`/`predict_proba()` output, not directly a `CATEGORIES` index — those only coincide when `classes_` has no gaps, which isn't guaranteed. Always go through `CATEGORY_TO_INDEX` (encode) and `model.classes_[idx]` (decode), never `set(labels)` ordering or a raw `predicted_idx`.
- **`CategoryPredictor.retrain()`** always merges `SEED_DATA` with the user's corrections before fitting. Fitting on corrections alone can mean a single category (crashes `LogisticRegression.fit`, which needs ≥2 classes) and silently forgets categories the user hasn't corrected yet.
- **Transfers require different `account_id`s.** Same-account equal-and-opposite amounts (e.g. a purchase plus an unrelated refund) are not a transfer.
- **Analytics exclude `is_transfer=True` rows** so a flagged transfer isn't double-counted as both an expense and income.
- **Duplicate transactions raise `DuplicateTransactionError`**, a distinct type from the plain `ValueError` that `normalize_transaction` raises for malformed rows — the ingest loop's counters depend on telling these apart.

## Working style for this repo

For any bug/improvement: state the issue, find the root cause by reading the code (don't guess), propose the smallest fix, implement it, add/update a test, run the real suite. Ask before doing a larger redesign. Priority when triaging multiple issues: data correctness → transfer detection → categorization quality → correction feedback loop → frontend usability → dashboards → performance → cleanup.

No comments unless the WHY is non-obvious. Services pattern (route → service → model). Pydantic schemas for every request/response shape. Type hints everywhere. This project has known, *intentional* gaps (no auth, no DB migrations via Alembic in practice) — don't silently start "fixing" those unless asked.
