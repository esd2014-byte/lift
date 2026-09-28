# Architecture decision records

Short records of the decisions that shape Lift: the context at the time, what was
decided, and what it costs. A superseded decision gets a new record, not an edit.

| # | Decision | Status |
|---|---|---|
| [0001](0001-git-as-the-datastore.md) | Git (a private GitHub repo) is the database | Accepted |
| [0002](0002-single-secret-signed-session.md) | One shared secret, exchanged for a signed session | Accepted |
| [0003](0003-public-code-private-data.md) | Public code repo, private data repo | Accepted |
| [0004](0004-storage-behind-one-interface.md) | All data access through one store; a folder store for tests and the demo | Accepted |
| [0005](0005-python-only-for-program-sync.md) | TypeScript for the app; Python only for the manual Hevy program sync | Accepted |
| [0006](0006-guessed-loads-are-calibration.md) | A missing Voltra load is estimated from history and shown as calibration | Accepted |
