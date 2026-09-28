# 0004. All data access through one store

**Status:** Accepted

## Context
Routes and page loaders called the GitHub API module directly, so nothing could run
without a live token: no route tests, no local development, no demo.

## Decision
`web/lib/store.ts` is the only way to read or write data. It delegates to the GitHub
store in production, or to a folder on disk (`web/lib/fsStore.ts`) when `DATA_DIR` is
set. The folder store has the same contract (a missing file reads as null) and refuses
paths that escape the folder. `DATA_READONLY=1` refuses writes, for the demo.

Rules shared by several routes live in plain functions (`lib/dailyLog.ts`,
`lib/workouts.ts`, `lib/loadGuess.ts`), so they can be tested without any store.

## Consequences
- `web/test/routes.test.ts` runs the real route handlers against a temp copy of a
  synthetic data repo, with no network.
- `npm run demo` runs the whole app on made-up data, no credentials.
- One more layer to keep in step with the GitHub store's behaviour; the route tests
  are what keep the two honest.
