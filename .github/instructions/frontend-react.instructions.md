---
name: "Frontend Component Development"
description: "Use when: building React components/pages under frontend/src/, managing state with Zustand, or connecting to the API."
applyTo: "frontend/src/**/*.tsx"
---

# Frontend Components

React 18 + TypeScript + Vite + Mantine 7 + Zustand + AG Grid + Recharts. No test suite yet — verify changes by running the dev server and loading the page, not just by reading the diff.

## Quick rules

1. Functional components + hooks, typed `Props` interfaces (no inline prop types, no untyped `any` unless justified).
2. Zustand (`store/transactionStore.ts`) for state shared across pages; `useState` for page-local state.
3. All API calls go through `services/transactionService.ts` (typed wrappers around `services/api.ts`'s axios instance) — don't call axios directly from a component.
4. Show errors to the user (Mantine `Alert`/notification), not just `console.error`.
5. Mantine v7 renamed several props (`spacing` → `gap` on `Stack`, etc.) — if you see a prop-not-found TS error on a Mantine component, check the v7 docs before assuming the prop name from an older example is right.

## Pages

`UploadPage` (CSV upload, account selection, preview, normalize), `ReviewPage` (AG Grid of pending-category transactions, inline category correction → triggers `TrainingData` on the backend), `AnalyticsPage` (summary cards + Recharts).

## CSV upload specifics

`csvService.parseFile` uses PapaParse with `header: true` and delimiter auto-detection (handles the comma/semicolon/tab variety across real bank exports). Send the **full** parsed row array to `transactionService.normalizeTransactions` — there was a bug where only a 5-row UI preview slice was sent, silently dropping the rest of every upload. Keep the full dataset and the preview slice in separate state.
