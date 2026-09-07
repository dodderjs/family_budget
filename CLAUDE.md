Family Budget: FastAPI + SQLAlchemy/MariaDB backend, React/TS/Vite frontend (MUI v9 + AG Grid Enterprise + Zustand), sklearn ML categorization. See [README.md](README.md) for setup and [API_REFERENCE.md](API_REFERENCE.md) for endpoints — don't duplicate those here, read them.

## Which doc answers what

13 markdown files, ~5.4k lines. Read the one row that matches — don't sweep the repo.

| File | Lines | Answers |
|---|---|---|
| [README.md](README.md) | 155 | Quick start, feature list, project layout. Start here. |
| [API_REFERENCE.md](API_REFERENCE.md) | 490 | Every endpoint: request/response shapes, error codes, category reference, bank-format detection. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 845 | Data model, backend/frontend structure, ML pipeline, data flow, and *why* decisions were made. ⚠️ stale UI stack |
| [DEVELOPMENT.md](DEVELOPMENT.md) | 266 | Running without Docker, backend debugging/debugpy, adding dependencies, git workflow. |
| [SETUP.md](SETUP.md) | 320 | First-run setup, configuration, upload flow walkthrough. Overlaps README. |
| [DEPLOYMENT.md](DEPLOYMENT.md) | 322 | Prod compose, DB backup/restore, env vars, scaling, disaster recovery. |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | 473 | Symptom-indexed fixes: Docker, backend, frontend, workflow. Check before debugging from scratch. |
| [DOCKER_FIX.md](DOCKER_FIX.md) | 323 | Post-mortem of one specific compose/startup failure. Historical — the fix is already in the compose files. |
| [OPTIMIZATION.md](OPTIMIZATION.md) | 877 | Performance/security recommendations. Mostly *unimplemented proposals*, not current state. ⚠️ stale UI stack |
| [QUICK_REFERENCE.md](QUICK_REFERENCE.md) | 388 | Command cheatsheet (docker, backend, frontend, common workflows). |
| [CHECKLIST.md](CHECKLIST.md) | 199 | Build-completion checkboxes. Historical snapshot. ⚠️ stale UI stack |
| [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md) | 384 | Narrative of what was built and when. Historical snapshot. ⚠️ stale UI stack |
| [data/SCHEMA.md](data/SCHEMA.md) | 49 | Hand-written SQL DDL sketch of the tables. `backend/app/models/transaction.py` is authoritative — prefer it. |

⚠️ **stale UI stack** = still describes the frontend as Mantine + Recharts. It's MUI v9 + AG Grid + `@mui/x-charts`. Discount UI claims in those files; everything else in them still holds. This file and `.github/` are the current source of truth.

## Run it

```bash
docker compose -f docker-compose.dev.yml up -d --build   # backend :8000, frontend :5173, mariadb :3306
docker logs family-budget-api --tail 50                  # check it actually started
```
Backend retries its DB connection on startup (`app/db/database.py:wait_for_db`) — no manual wait needed.

## Frontend package management

Always run npm commands inside the container — never on the host. The frontend container is named **`family-budget-web`** (`family-budget-frontend` is only the npm package name and is not a container — `docker exec` on it fails). This only applies to the dev container: `frontend/Dockerfile` is a multi-stage build, and `docker-compose.dev.yml` builds its `dev` target (Node, npm, Vite dev server), while `docker-compose.prod.yml` builds the `prod` target (nginx serving the static build, no Node/npm inside — `docker exec family-budget-web npm ...` fails there).

```bash
docker exec family-budget-web npm install <package>
docker exec family-budget-web npm uninstall <package>
docker exec family-budget-web npm run <script>
```

Running npm on the host modifies `package.json`/`node_modules` outside the container and won't be reflected in the running dev server.

## Test

```bash
docker exec family-budget-api python -m pytest -v      # backend
docker exec family-budget-web npm test                 # frontend (vitest run)
```

Backend: pure-Python/SQLite/in-memory — no network, runs in under a second. Always run it after touching `backend/app/`. If you can't reach Docker, the format/normalization tests have zero external deps and can run with bare `python3` outside any venv; DB- and ML-backed tests need `sqlalchemy`/`sklearn` installed.

Frontend: vitest + Testing Library + jsdom (`frontend/vitest.config.ts`, setup in `frontend/src/test/setup.ts`). Specs live in `frontend/src/__tests__/{services,utils}/*.test.ts` and cover extracted logic, not rendered components. Run it after touching `frontend/src/services/` or `frontend/src/utils/`.

Neither suite proves a UI change renders. To see it actually render, screenshot it:

```bash
docker exec family-budget-web node scripts/screenshot.mjs http://localhost:5173/ /app/.screenshot.png [--selector "css"] [--full]
# ./frontend is bind-mounted at /app, so the PNG lands at frontend/.screenshot.png — read it directly, no docker cp
```

Use this rather than the generic `run` or `webapp-testing` skills, and don't reinvent it: Playwright's bundled Chromium is glibc-only and won't execute on this Alpine/musl container, so the script points at apk's `/usr/bin/chromium-browser`; it also maps `localhost:8000` to `family-budget-api:8000` so the page's API calls resolve from inside the container. Both were painful to work out — see `frontend/scripts/screenshot.mjs` and `frontend/Dockerfile`. The script reports console/page errors on stderr, so check that output too. Don't claim a UI change works without seeing it render.

## Reset test data

```bash
docker exec -it family-budget-api python scripts/reset_data.py                   # prompts for both confirmations
docker exec -it family-budget-api python scripts/reset_data.py --yes --keep-training   # skip both, keep learned corrections (default-ish choice)
```
Always deletes all transactions and leaves accounts untouched. Separately asks whether to *also* delete learned corrections (training data) and revert the ML model to its bare seed baseline — default no, since the seed baseline has no real merchant vocabulary and answering yes means every re-imported transaction predicts close to randomly until you re-review everything. Only answer yes when testing categorization/ML logic itself, not when just re-importing the same data. Use this between manual test runs after a normalization/categorization/transfer-detection change instead of re-creating accounts by hand. This is a CLI script, not an API endpoint — see below.

## Refresh description/merchant + retrain after mapping changes

```bash
docker exec -it family-budget-api python scripts/migrate_description_merchant_and_retrain.py
docker exec -it family-budget-api python scripts/migrate_description_merchant_and_retrain.py --yes
```
Use this after changing `format_service` description/merchant field mappings: it re-normalizes stored transaction `description`/`merchant` from each row's `raw_source`, syncs `training_data` for finalized categories, and retrains the model from the updated corrections.

## Flow for fixing/improving things here

Established this session, keep following it:
1. State the issue, find the root cause (read the code, don't guess).
2. Propose the smallest viable fix — no drive-by refactors, no unrelated cleanup.
3. Implement it and ask user to run the *existing* test suite — don't write or update tests yet.
4. Let the user test the change themselves and confirm it actually works as expected.
5. Only after that approval, ask before adding/updating tests to cover it.
6. If the fix is large or changes architecture, explain and ask before doing it.

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
