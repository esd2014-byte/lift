# Security

## Reporting a problem

Please report vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on this repository. Don't open a public issue.
You'll get an acknowledgement within a week.

In scope: the app in `web/` (auth, the API routes, how it handles the model-written
brief, how it talks to GitHub, Hevy and Beyond+). Out of scope: the third-party
services themselves, and denial of service against the free-tier hosting.

## The security model

Lift is single-user. The design is in [ADR 0002](docs/adr/0002-single-secret-signed-session.md)
and [ADR 0003](docs/adr/0003-public-code-private-data.md). In short:

- **Login.** One secret (`APP_SECRET`), typed into `/login` once per device and exchanged
  for an HMAC-signed session cookie (httpOnly, Secure, SameSite=Lax). The cookie is never
  the secret. Bumping `SESSION_VERSION` signs every device out. No secret set: nobody gets in.
- **Every route checks the session itself.** `proxy.ts` isn't the only gate, so a matcher
  mistake fails closed. Unauthenticated requests get a 404, not a 401.
- **Two public routes:** `/api/health` (returns `{ ok: true }`) and the cron routes, which
  check their own bearer secret (`CRON_SECRET`) in constant time.
- **Cross-site requests that change state are refused** (`Sec-Fetch-Site`, then `Origin`).
- **Content Security Policy with a per-request nonce**, so only scripts the app rendered
  run. `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy: same-origin`.
- **Model output is untrusted input.** The brief's JSON is shape-checked and bounded
  (`lib/briefCheck.ts`) before anything renders or pushes it. Its Markdown goes through a
  renderer that escapes everything and allows only `https:` links, with injection tests.
- **Errors don't echo third-party responses** to the browser (`lib/errors.ts`); details
  stay in the server logs, which never contain secrets or request bodies.
- **Least-privilege data access.** The app's GitHub token is fine-grained, scoped to the
  private data repo alone, with an expiry the app warns about.
- **Photos** are re-encoded in the browser before upload, which strips EXIF and GPS, and
  are capped at 3 MB.

## Secrets

All secrets are environment variables in Vercel (`APP_SECRET`, `CRON_SECRET`,
`DATA_TOKEN`, `HEVY_API_KEY`, `VOLTRA_API_KEY`). None are in the repo; `.gitignore`
covers `.env*` and key files. `web/.env.example` lists them without values.
