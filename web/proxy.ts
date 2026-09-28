import { NextRequest, NextResponse } from "next/server";
import {
  LEGACY_COOKIE,
  isAuthed,
  issueSession,
  legacyValid,
  sameOrigin,
  sessionCookie,
  SESSION_COOKIE,
  verifySession,
} from "@/lib/auth";

/**
 * The front door. Single user, so no accounts: a signed session cookie, set by
 * typing APP_SECRET into /login once per device (see lib/auth.ts).
 *
 * This is the only gate the platform provides (Vercel Auth is off so the app opens
 * in one tap at the gym), so it fails closed: no APP_SECRET, no entry. Every route
 * that reads private data or changes state also checks the session itself
 * (lib/guard.ts), in case a request ever gets past here.
 *
 * It also sets the Content Security Policy, with a fresh nonce per request so only
 * scripts Next.js rendered can run - the brief is model-written HTML, and this is
 * the backstop if something ever slips through the renderer's escaping.
 */

const PUBLIC = new Set(["/login", "/api/login"]);

function csp(nonce: string) {
  const dev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are used throughout; nonces can't cover those.
    // Script is what matters for XSS, and that stays nonce-only.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function proxy(req: NextRequest) {
  if (!process.env.APP_SECRET?.trim()) {
    // Misconfiguration. Deny, and say so in the server log rather than the response.
    console.error("APP_SECRET is not set - denying all requests");
    return new NextResponse("Not found", { status: 404 });
  }

  // A signed-in browser still can't be driven by another site's form or script.
  if (!sameOrigin(req.method, req.headers)) {
    return new NextResponse("Cross-site request refused", { status: 403 });
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = csp(nonce);
  const pass = () => {
    const headers = new Headers(req.headers);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", policy);
    const res = NextResponse.next({ request: { headers } });
    res.headers.set("Content-Security-Policy", policy);
    return res;
  };

  if (PUBLIC.has(req.nextUrl.pathname)) return pass();

  if (!isAuthed(req.cookies)) {
    // 404 rather than 401: don't confirm that anything is here.
    return new NextResponse("Not found", { status: 404 });
  }

  const res = pass();
  // Upgrade the old cookie (which was the secret itself) to a signed session.
  if (!verifySession(req.cookies.get(SESSION_COOKIE)?.value) && legacyValid(req.cookies.get(LEGACY_COOKIE)?.value)) {
    res.cookies.set(sessionCookie(issueSession()));
    res.cookies.delete(LEGACY_COOKIE);
  }
  return res;
}

export const config = {
  // /api/health is exempt: it returns { ok: true } and nothing else.
  // /api/cron/* is exempt because Vercel Cron cannot carry a cookie; those routes
  // authenticate themselves with CRON_SECRET instead.
  // Both exemptions are anchored. An unanchored prefix would also exempt any future
  // route that happens to start with the same letters (/api/healthz, /api/cron-admin).
  matcher: ["/((?!_next/static/|_next/image|favicon\\.ico$|api/health$|api/cron/).*)"],
};
