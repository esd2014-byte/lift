# Lift

A personal strength coach that plans each training day before you wake up, and a
phone-first web app to run it from.

Lift started from one observation: training consistency doesn't break, it erodes.
Several good months turned into roughly 15% fewer sessions a month, which nobody
noticed until training had stopped completely. So the system is built around two
things: catching that drift early, and making real progress visible enough to keep
going.

<p>
  <img src="docs/screenshots/today.jpg" width="200" alt="Today: the week strip, a trip in progress, and the coach's pick">
  <img src="docs/screenshots/session.jpg" width="200" alt="The session: a superset group and Voltra loads guessed from history as calibration">
  <img src="docs/screenshots/program.jpg" width="200" alt="Program: the rotation with each day's last date, where you are, and the last session">
  <img src="docs/screenshots/gym.jpg" width="200" alt="Gym: a planned trip with a session per day, and the exercises in rotation">
</p>

<sub>Screenshots from the demo (<code>npm run demo</code>), which runs on made-up data;
<code>npm run screenshots</code> retakes them.</sub>

## How it works

```mermaid
flowchart LR
  subgraph Devices
    V[Voltra cable machine<br/>via Beyond+]
    H[Hevy logger]
  end
  subgraph Vercel["Vercel (Hobby, $0)"]
    C[Daily cron<br/>/api/cron/*]
    A[Next.js app<br/>Today · Program · Progress · Gym · Injuries]
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

1. **Overnight (07:00 UTC).** Vercel Cron pulls recent workouts from Hevy and the
   Voltra API and commits a compact digest to the data repo.
2. **05:00 local, all year.** A scheduled Claude routine reads the program, the
   exercise library, the equipment, injury constraints and the digests, and writes
   the day's brief: which session, why, at what loads (only weights the gym actually
   has). Its cron is UTC, so it fires three times a morning and checks the local hour
   itself: it skips a run before 5am and any run after a valid brief landed, which
   makes the later runs retries. The brief has a prose part and a JSON part that follows
   [a documented schema](docs/brief-schema.md).
3. **At the gym.** The app shows the coach's pick and lets you swap variants (as
   planned, beast mode, quick, traveling, can't train) or pick any other program day:
   the coach's own version for full days, built by rule from the program for the rest
   ([ADR 0007](docs/adr/0007-coach-writes-full-days-app-builds-the-rest.md)). **Start** writes the
   routine into Hevy and the session onto the Voltra, with the weights, so both are
   waiting. **End** pulls the finished work back in.
4. **After.** A note says what the logs can't: a session split across apps, work
   that never got logged, and the app asks when the logs look ambiguous. Injuries are
   tracked as cards with updates until they resolve. The next morning's brief reads
   both before it reads the data.
5. **Around it.** The Gym tab holds the home equipment (the only weights the coach may
   prescribe) and which exercises are in rotation. A trip sets the dates away and the
   hotel's gym, proposes a session per day, and converts each one for that gym.
6. **Always.** The week strip counts distinct training days against a weekly
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

The reasoning behind each is written up as a short
[architecture decision record](docs/adr/README.md).

## Security

Single user: one secret, exchanged for a signed session cookie; every route checks it;
a per-request-nonce CSP; the model-written brief is treated as untrusted input. The full
model, and how to report a problem, is in [SECURITY.md](SECURITY.md).

## Running it

**Try it with no credentials.** The demo runs the whole app on made-up data, read-only:

```bash
cd web
npm ci
npm run demo                 # http://localhost:3100, password: demo
```

**Against your own data repo:**

```bash
cd web
cp .env.example .env.local   # fill in: see the comments for each variable
npm run dev
```

The app reads a data repo (`DATA_REPO`, `DATA_TOKEN`) laid out like
[`web/test/fixtures/data`](web/test/fixtures/data): `program/`, `library/`, `scripts/`
mappings, and `logs/`. Point `DATA_DIR` at a local folder instead to skip GitHub entirely.

**Checks** (the same ones CI runs):

```bash
npm run check                # typecheck, lint, format check, all tests
```

The tests use synthetic data only. The route tests run the real API handlers against a
temporary copy of the fixture data repo, with no network.

## Layout

```
web/                    Next.js app (App Router), API routes, crons
  lib/store.ts          the one door to the data: GitHub, or a local folder
  lib/metrics.ts        streak and strength-index computation
  lib/loadGuess.ts      calibration loads when the brief leaves one out
  lib/weights.ts        the loads that exist in the gym; guesses round down to one
  lib/programDay.ts     program days and their rule-built variants (incl. hotel conversion)
  lib/recent.ts         last session, last date per day, questions from the logs
  lib/gym.ts            equipment and exercise-rotation edits that keep the YAML's comments
  lib/trips.ts          trips: proposed sessions per day, overrides, home early
  lib/markdown.ts       brief renderer (the trust boundary for model output)
  test/                 unit and route tests; fixtures/data is a synthetic data repo
  scripts/demo-data.mjs builds the demo's made-up data
  scripts/screenshots.mjs retakes the README screenshots from the demo
scripts/                Python: rebuilds the program's routines in Hevy (run by hand)
docs/adr/               architecture decision records
docs/                   brief schema, architecture review, screenshots
```

## License

MIT
