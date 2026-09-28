import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Single-user auth.
 *
 * APP_SECRET is typed once into /login. It never goes in the cookie: the cookie is
 * a signed session - "v<version>.<issued-ms>.<hmac>" - so a copied cookie is not
 * the password, and bumping SESSION_VERSION in Vercel logs every device out
 * without changing the secret. Sessions last a year.
 *
 * Fails closed: without APP_SECRET nothing verifies.
 */

export const SESSION_COOKIE = "pt_session";
/** The old cookie held the secret itself. Accepted once, then replaced by a session. */
export const LEGACY_COOKIE = "pt_auth";
export const SESSION_MAX_AGE_S = 60 * 60 * 24 * 365;

function secret(): string | null {
  return process.env.APP_SECRET?.trim() || null;
}

function version(): string {
  return process.env.SESSION_VERSION?.trim() || "1";
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

/** Constant-time string compare that doesn't leak length either (compares digests). */
export function sameSecret(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export function issueSession(now = Date.now()): string {
  const key = secret();
  if (!key) throw new Error("APP_SECRET is not set");
  const payload = `v${version()}.${now}`;
  return `${payload}.${sign(payload, key)}`;
}

export function verifySession(token: string | undefined, now = Date.now()): boolean {
  const key = secret();
  if (!key || !token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [v, issued, sig] = parts;
  if (v !== `v${version()}`) return false; // revoked by a version bump
  const at = Number(issued);
  if (!Number.isFinite(at) || at > now + 60_000 || now - at > SESSION_MAX_AGE_S * 1000) return false;
  const expected = Buffer.from(sign(`${v}.${issued}`, key));
  const got = Buffer.from(sig);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

/** The old cookie, which was the secret itself. */
export function legacyValid(value: string | undefined): boolean {
  const key = secret();
  return Boolean(key && value && sameSecret(value, key));
}

type CookieJar = { get(name: string): { value: string } | undefined };

export function isAuthed(cookies: CookieJar): boolean {
  return verifySession(cookies.get(SESSION_COOKIE)?.value) || legacyValid(cookies.get(LEGACY_COOKIE)?.value);
}

export const sessionCookie = (value: string) => ({
  name: SESSION_COOKIE,
  value,
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  maxAge: SESSION_MAX_AGE_S,
  path: "/",
});

/**
 * Is this state-changing request from our own page? Browsers send Sec-Fetch-Site
 * and Origin on cross-site requests; a form or fetch from another site gets refused
 * even though the session cookie would ride along.
 */
export function sameOrigin(method: string, headers: { get(name: string): string | null }): boolean {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;
  // Sec-Fetch-Site is set by the browser and can't be forged by a page, so when it's
  // present it decides. (Origin alone isn't enough: it can legitimately be "null",
  // e.g. a form post under a strict referrer policy.)
  const site = headers.get("sec-fetch-site");
  if (site) return site === "same-origin" || site === "none";
  const origin = headers.get("origin");
  if (!origin) return true; // non-browser clients; the session cookie still has to verify
  try {
    return new URL(origin).host === headers.get("host");
  } catch {
    return false;
  }
}
