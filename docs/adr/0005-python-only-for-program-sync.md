# 0005. TypeScript for the app; Python only for the manual Hevy program sync

**Status:** Accepted

## Context
The project started as Python scripts. The app is TypeScript. The audit found logic
duplicated across the two (digests, session building, validation) and drifting.

## Decision
- Everything the app does is TypeScript, once.
- `validate.py` lives in the **data repo**, next to the data it checks. The morning
  routine runs it there, and a CI job runs it when the program changes. The public
  repo keeps no copy.
- `scripts/sync_program_to_hevy.py` stays Python in this repo. It runs by hand, rarely,
  when the program changes, to rebuild the per-day routines in Hevy. Porting it buys
  nothing. Its only dependency is pinned in `scripts/requirements.txt`, and it reads
  `HEVY_API_KEY` and `DATA_DIR` like the app does.
- Superseded Python (the Hevy/Voltra digests, the session builder, `hevy_recent.py`)
  is deleted; the app's own sync replaced it.

## Consequences
- One implementation of each rule the app runs.
- Two languages in the public repo still, but the Python is small, isolated and
  documented. If the program sync ever runs on a schedule, port it to TypeScript.
