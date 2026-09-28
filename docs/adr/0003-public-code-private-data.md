# 0003. Public code, private data

**Status:** Accepted

## Context
The code is worth showing; the data (training logs, bodyweight, photos, injuries) is
personal health information. At first they shared one repo.

## Decision
Two repositories. `lift` (this one, public) holds the code. A private data repo holds
everything personal. The app reaches the data repo with a fine-grained token scoped to
that repo alone (`DATA_REPO`, `DATA_TOKEN`, `DATA_TOKEN_EXPIRES`).

## Consequences
- Nothing that holds runtime credentials can push to the code production deploys from.
- Data commits don't trigger code builds.
- Tests and the demo can't use real data, so they run on synthetic fixtures
  (`web/test/fixtures/data`). See 0004.
- The token expires; the app warns ahead of expiry using `DATA_TOKEN_EXPIRES`.
