# 0002. One shared secret, exchanged for a signed session

**Status:** Accepted

## Context
A single user on a couple of devices. Accounts, passwords and an identity provider
would be more moving parts than the rest of the app.

## Decision
`APP_SECRET` is typed into `/login` once per device and exchanged for an HMAC-signed,
year-long `pt_session` cookie (httpOnly, Secure, SameSite=Lax). The cookie is never the
secret. Bumping `SESSION_VERSION` revokes every session. Unset secret means nobody gets
in. Every route re-checks the session; `proxy.ts` is not the only gate.

## Consequences
- No user table, no password reset flow, nothing to leak but one secret.
- Anyone with the secret is the user. It must be long and random.
- Not multi-user. A second user means real accounts.
