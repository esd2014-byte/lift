import { NextRequest, NextResponse } from "next/server";

/**
 * Single-user gate. The app holds Eli's training log and bodyweight, so it isn't
 * public - but it also doesn't warrant real auth. One shared secret, set once on
 * the phone via ?k=..., then kept in a year-long httpOnly cookie.
 *
 * This is the ONLY gate: Vercel Auth was deliberately turned off (2026-09-21) so
 * the app opens in one tap at the gym. That makes failing closed non-negotiable -
 * an unset APP_SECRET must lock the app, never open it.
 */
export function middleware(req: NextRequest) {
  const secret = process.env.APP_SECRET;

  if (!secret) {
    // Misconfiguration. Deny, and say so in the server log rather than the response.
    console.error("APP_SECRET is not set - denying all requests");
    return new NextResponse("Not found", { status: 404 });
  }

  const cookie = req.cookies.get("pt_auth")?.value;
  if (cookie && timingSafeEqual(cookie, secret)) return NextResponse.next();

  const key = req.nextUrl.searchParams.get("k");
  if (key && timingSafeEqual(key, secret)) {
    // Strip the secret from the URL so it doesn't linger in history or referrers.
    const url = req.nextUrl.clone();
    url.searchParams.delete("k");
    const res = NextResponse.redirect(url);
    res.cookies.set("pt_auth", secret, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });
    return res;
  }

  // 404 rather than 401: don't confirm that anything is here.
  return new NextResponse("Not found", { status: 404 });
}

/** Constant-time compare, so the response time doesn't leak the secret. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  // /api/health is exempt: it returns { ok: true } and nothing else.
  // /api/cron/* is exempt because Vercel Cron cannot carry a cookie; those routes
  // authenticate themselves with CRON_SECRET instead.
  // Both exemptions are anchored. An unanchored prefix would also exempt any future
  // route that happens to start with the same letters (/api/healthz, /api/cron-admin).
  matcher: ["/((?!_next/static/|_next/image|favicon\\.ico$|api/health$|api/cron/).*)"],
};
