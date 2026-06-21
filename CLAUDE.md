Family Budget: FastAPI + SQLAlchemy/MariaDB backend, React/TS/Vite/Mantine frontend, sklearn ML categorization. See [README.md](README.md) for setup and [API_REFERENCE.md](API_REFERENCE.md) for endpoints — don't duplicate those here, read them.

## Run it

```bash
docker compose -f docker-compose.dev.yml up -d --build   # backend :8000, frontend :5173, mariadb :3306
docker logs family-budget-api --tail 50                  # check it actually started
```
Backend retries its DB connection on startup (`app/db/database.py:wait_for_db`) — no manual wait needed.

## Test

```bash
docker exec family-budget-api python -m pytest -v
```
70+ tests, pure-Python/SQLite/in-memory — no network, runs in under a second. Always run this after touching `backend/app/`. If you can't reach Docker, the format/normalization tests have zero external deps and can run with bare `python3` outside any venv; DB- and ML-backed tests need `sqlalchemy`/`sklearn` installed.

There's no frontend test suite yet. Verify frontend changes by actually loading http://localhost:5173 (or use the `run` skill) — don't claim a UI change works without seeing it render.

## Reset test data

```bash
docker exec -it family-budget-api python scripts/reset_data.py                   # prompts for both confirmations
docker exec -it family-budget-api python scripts/reset_data.py --yes --keep-training   # skip both, keep learned corrections (default-ish choice)
```
Always deletes all transactions and leaves accounts untouched. Separately asks whether to *also* delete learned corrections (training data) and revert the ML model to its bare seed baseline — default no, since the seed baseline has no real merchant vocabulary and answering yes means every re-imported transaction predicts close to randomly until you re-review everything. Only answer yes when testing categorization/ML logic itself, not when just re-importing the same data. Use this between manual test runs after a normalization/categorization/transfer-detection change instead of re-creating accounts by hand. This is a CLI script, not an API endpoint — see below.

## Flow for fixing/improving things here

Established this session, keep following it:
1. State the issue, find the root cause (read the code, don't guess).
2. Propose the smallest viable fix — no drive-by refactors, no unrelated cleanup.
3. Implement, add/update a test, run the real test suite.
4. If the fix is large or changes architecture, explain and ask before doing it.

Priority order when several things are wrong (highest first): data correctness → transfer-detection accuracy → categorization quality → user-correction feedback loop → frontend usability → dashboard insights → performance → code cleanup.

## Things that bit us already (don't reintroduce)

- **CSV formats are real, not fictional.** Supported: `revolut`, `curve`, `mbh` (debit+credit share one mapping), `kh`, `generic`. Defined in `backend/app/services/format_service.py`. Real samples are in `example/` (Hungarian banks, semicolon/tab delimited, BOM, comma-decimal amounts) — use those for any CSV-parsing change, not synthetic data. `data/*.csv` are minimal English fixtures for the `generic` fallback only.
- **`csv.Sniffer` is unreliable** for delimiter detection here — a literal comma inside one MBH header's parenthetical text fools it. `format_service.detect_format_and_delimiter` tries each known delimiter against header signatures instead.
- **ML category encoding must go through `CATEGORY_TO_INDEX`/`model.classes_`**, never a raw `predicted_idx` or `set(labels)` ordering — both are non-deterministic/positional and silently mismap predictions to the wrong category name (see `ml_service.py`).
- **`retrain()` always merges `SEED_DATA`** with corrections. Don't fit on corrections alone — a single-category correction set crashes `LogisticRegression.fit()`, and dropping the baseline makes the model forget categories the user hasn't corrected yet.
- **Transfers are cross-account by definition.** `detect_transfers` requires different `account_id`s — same-account equal-and-opposite amounts (e.g. purchase + unrelated refund) must not be flagged.
- **Analytics queries exclude `is_transfer=True`** rows (`transaction_service.py`) so a flagged transfer isn't counted as both income and expense.
- **Duplicates raise `DuplicateTransactionError`**, they don't return the existing row — the API loop counts on that exception type specifically, not a generic `ValueError` (which `normalize_transaction` also raises, for a different reason: malformed rows).
- **Destructive maintenance/testing operations (wiping transactions, resetting the model) are CLI scripts in `backend/scripts/`, not API endpoints.** An HTTP route for this would be reachable by anything that can hit the backend port, with no auth in front of it. Service logic (e.g. `reset_service.py`) can still be shared between a script and routes — it's specifically the unauthenticated HTTP route for destructive ops that's the problem.

## Conventions

No comments unless the WHY is non-obvious. No backwards-compat shims. Services pattern (route → service → model), Pydantic schemas for all request/response shapes, type hints everywhere. Don't add auth, migrations, or other "before production" infra unless asked — this is a known-gaps list, not a backlog to silently work through.
