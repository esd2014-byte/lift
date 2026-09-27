# Lift

A personal strength coach that plans each training day before you wake up, and a
phone-first web app to run it from.

Lift started from one observation: training consistency doesn't break, it erodes.
Several good months turned into roughly 15% fewer sessions a month, which nobody
noticed until training had stopped completely. So the system is built around two
things: catching that drift early, and making real progress visible enough to keep
going.

## How it works

```mermaid
flowchart LR
  subgraph Devices
    V[Voltra cable machine<br/>via Beyond+]
    H[Hevy logger]
  end
  subgraph Vercel["Vercel (Hobby, $0)"]
    C[Daily cron<br/>/api/cron/*]
    A[Next.js app<br/>Today · Streak · Body]
  end
  R[Scheduled Claude routine<br/>writes the morning brief]
  D[(Private data repo<br/>program · logs · briefs)]

  V -- workouts --> C
  H -- workouts --> C
  C -- commit digests --> D
  R -- read history, commit brief --> D
  A -- read / write via GitHub API --> D
  A -. push today's session .-> V
```

1. **06:00.** Vercel Cron pulls recent workouts from Hevy and the Voltra API and
   commits a compact digest to the data repo.
2. **07:00.** A scheduled Claude routine reads the program, the exercise library,
   injury constraints and the digests, and writes the day's brief: which session,
   why, at what loads. The brief has a prose part and a JSON part that follows
   [a documented schema](docs/brief-schema.md).
3. **At the gym.** The app shows the session, lets you swap variants (full,
   minimum, traveling, can't train), and hands off to the logger.
4. **Always.** The Streak card counts distinct training days against a weekly
   target, and a Strength Index tracks estimated 1RM across four anchor lifts.

## Design decisions

- **Git as the database.** The data is small and mostly written once a day, and
  the routine already works through git. Every change is a readable, revertible
  commit, and there's nothing to run or pay for. See the
  [architecture review](docs/audits/architecture-audit.md) for the trade-offs and
  the point at which this should move to a real database.
- **Code public, data private.** The app reads and writes a separate private repo
  using a fine-grained token scoped to that repo only, so nothing holding the
  runtime credentials can push to the code that production deploys from.
- **Measured over typed.** Where the Voltra measures something (force, velocity per
  rep), it beats a number typed into a logger afterwards.
- **Computed, not stored.** Streaks and strength numbers are derived from the logs
  on every read, so they can't drift from what actually happened.
- **$0 a month.** Vercel Hobby, GitHub Actions and the device's free companion app.

## Security model

Single user. A shared secret is exchanged once for a year-long httpOnly cookie,
and the gate fails closed if the secret is unset. Only `/api/health` (which returns
`{ ok: true }` and nothing else) and the cron routes (which check their own bearer
secret) are reachable without the cookie. Model-written briefs are rendered by a
small Markdown renderer that escapes everything and allows only `https:` links,
with regression tests for injection.

## Running it

```bash
cd web
cp .env.example .env.local   # fill in: see the comments for each variable
npm ci
npm test                     # unit tests on synthetic fixtures, no credentials needed
npm run dev
```

The app needs a data repo to read from (`DATA_REPO`, `DATA_TOKEN`). Its layout is:
`program/`, `library/exercises.yaml`, `athlete/`, `logs/briefs/`, `logs/hevy/`,
`logs/voltra/`, `logs/bodyweight.csv`.

## Layout

```
web/                 Next.js app (App Router), API routes, crons
  lib/metrics.ts     streak and strength-index computation
  lib/markdown.ts    brief renderer (the trust boundary for model output)
  test/              unit tests on synthetic fixtures
scripts/             Python: program validation, Hevy routine sync
docs/                brief schema, architecture review
```

## License

MIT
