---
name: "Frontend Component Development"
description: "Use when: building React components/pages under frontend/src/, managing state with Zustand, or connecting to the API. Defines architecture, quality, testing, and Docker-first execution standards."
applyTo: "frontend/src/**/*.tsx"
---

# Frontend Development Standards

React 18 + TypeScript + Vite + Mantine 7 + Zustand + AG Grid + MUI X Charts.

Use a strict layered structure: utility -> service -> page -> component.

- Utilities: pure logic only, deterministic, no side effects, no React imports.
- Services: business orchestration and API composition, no UI imports.
- Pages: controller layer, wires services to view state and handles UX errors.
- Components: visual/presentational layer, rendering + callbacks only.

Default test focus is logic and service layers. Visual tests are optional and added only when logic cannot be validated through utility/service tests.

## Architecture and Layering Rules

1. Use functional components and hooks only.
2. Keep components focused and small; split when a component handles unrelated concerns.
3. Move reusable or non-trivial logic out of pages/components into `utils/` or `services/`.
4. Keep one-way data flow: service -> page state -> component props.
5. Services must never import components or depend on React runtime.
6. Components must never perform multi-step business orchestration.
7. Do not duplicate domain logic across pages; extract and reuse.

## TypeScript and Code Quality

1. Use explicit interfaces/types for props, service responses, and local domain models.
2. Avoid `any`; if unavoidable, keep scope narrow and justify with a short comment.
3. Prefer discriminated unions for UI states (for example loading/success/error branches).
4. Keep function signatures small and typed; avoid hidden global state dependencies.
5. Prefer early returns over deeply nested conditionals.
6. Maintain strict null handling and avoid non-null assertions unless guaranteed by control flow.

## State Management

1. Use Zustand (`store/transactionStore.ts`) for shared cross-page state only.
2. Keep page-local UI state (modal open, local form input, table selection) in `useState`.
3. Store actions should remain simple (setters/loaders), not page orchestration workflows.
4. Extract shared selectors and pure derivations to utility modules when reused.

## Services and API Integration

1. All HTTP calls go through `services/` wrappers around `services/api.ts`.
2. Do not call axios directly from pages/components.
3. Keep low-level endpoint wrappers thin in `transactionService.ts`.
4. Put multi-step workflows in focused domain services (for example `reviewService.ts`, `analyticsService.ts`, `accountFormService.ts`).
5. Services should throw readable errors; pages decide user-facing messaging.
6. Avoid silent failures; every async flow must handle and surface errors.

## Component and UI Standards

1. Prefer presentational components that receive data via props and emit typed callbacks.
2. Keep rendering and styling concerns in components; keep orchestration in pages/services.
3. Use semantic HTML and accessible labels with Mantine inputs and controls.
4. Preserve current design system usage and established page layout conventions.
5. Mantine v7 prop changes apply (`spacing` -> `gap` on `Stack` and related APIs).

## Hooks and Effects

1. Follow rules of hooks strictly.
2. Keep `useEffect` dependencies correct; avoid stale closures and hidden mutable state.
3. Use `useMemo`/`useCallback` only when they solve a measurable rerender or identity problem.
4. Always clean up subscriptions/listeners/async side effects where needed.

## Performance Guidelines

1. Avoid expensive work in render paths; precompute in utilities/services or memoized selectors.
2. Keep AG Grid heavy logic outside inline renderers when reusable.
3. For large page modules, extract column configs and helper renderers to dedicated files.
4. Prevent unnecessary global store updates that cause broad rerenders.

## Error Handling and UX Feedback

1. Never rely on `console.error` as final error handling.
2. Pages should show clear user-facing errors via Mantine `Alert`/notifications.
3. Preserve existing success/info feedback patterns for long-running operations.
4. Error messages should be actionable and, when possible, backend-detail aware.

## Security and Data Safety

1. Treat API values and CSV content as untrusted input.
2. Avoid injecting unsanitized values into HTML or URLs.
3. Do not store secrets in frontend source, state, or local storage.
4. Keep dependency additions minimal and justified.

## Pages

`UploadPage` (CSV upload, account selection, preview, normalize), `ReviewPage` (AG Grid of pending-category transactions, inline category correction → triggers `TrainingData` on the backend), `AnalyticsPage` (summary cards + MUI X Charts: PieChart, BarChart, LineChart).

Keep pages as controllers:

- Call services and map responses to UI state.
- Keep rendering concerns in components.
- Avoid embedding reusable business rules directly in page closures.

When a page exceeds maintainable complexity, first extract logic to utility/service modules, then split visual sections into child components.

## Testing defaults

- Priority: utilities and services.
- Unit-test pure logic and orchestration by default.
- Component/page tests are not required by default; add only for high-risk visual behavior.
- Always run manual UI smoke checks for page-level changes (Upload, Review, Analytics, Coverage).

## Development Workflow Standards

1. Implement in small, behavior-preserving steps.
2. Prefer refactor-first extraction (logic moves) before behavior changes.
3. Keep PR diffs focused by feature/domain area.
4. Do not mix unrelated cleanup with functional changes.
5. Validate every meaningful change with tests and build before completion.

## Execution environment

Docker-first is required for all project operations unless there is a clear blocker.

**npm commands must run inside the frontend container, not on the host:**

```bash
# Install a package
docker exec family-budget-frontend npm install <package>

# Uninstall a package
docker exec family-budget-frontend npm uninstall <package>

# Run any npm script
docker exec family-budget-frontend npm run <script>
```

Running npm directly on the host modifies `package.json` and `node_modules` outside the container's filesystem, which means the change won't be picked up by the running dev server and may produce inconsistent lock files.

1. Start and use the compose stack for development and verification.
2. Run installs, tests, and project commands inside containers whenever possible.
3. For backend-coupled validation from frontend tasks, execute commands in the backend container.
4. Host execution is fallback only; explicitly state the blocker when used.
5. Keep commands aligned with repository compose files and container naming.

Recommended patterns:

- Start stack: `docker compose -f docker-compose.dev.yml up -d --build`
- Backend tests: `docker exec family-budget-api python -m pytest -v`
- Frontend commands: prefer running via compose service/container shell rather than host `npm`.

If frontend container command wiring is missing, add/align compose service scripts first, then use containerized execution.

## CSV upload specifics

`csvService.parseFile` uses PapaParse with `header: true` and delimiter auto-detection (handles the comma/semicolon/tab variety across real bank exports). Send the **full** parsed row array to `transactionService.normalizeTransactions` — there was a bug where only a 5-row UI preview slice was sent, silently dropping the rest of every upload. Keep the full dataset and the preview slice in separate state.

## Definition of Done for Frontend Changes

1. Layer separation respected (utility/service/page/component).
2. New or changed logic is covered by utility/service tests by default.
3. Build succeeds.
4. Manual page smoke checks are completed when UI behavior is affected.
5. No unnecessary dependencies introduced.
