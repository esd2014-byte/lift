# 0001. Git is the database

**Status:** Accepted

## Context
One athlete. The data is small (YAML program, a few CSV and JSON logs, one brief a
day) and mostly written once a day. The morning brief is written by a Claude routine
that already works in a git checkout.

## Decision
Keep all data in a private GitHub repository. The app reads it through the GitHub
GraphQL API (one batched request per page view) and writes with read-modify-write
commits through the REST contents API, retrying on conflicts.

## Consequences
- Every change is a readable, revertible commit. Nothing to run, back up or pay for.
- The routine, the app and a person with a text editor share one source of truth.
- Writes are slow (a commit each) and rate-limited. Fine for a handful a day, wrong for
  anything chatty.
- **Revisit** if writes grow past dozens a day, if more than one person uses it, or if
  queries need joins across months of data. Then a real database (e.g. Postgres) wins.
