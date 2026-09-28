import { NextRequest, NextResponse } from "next/server";
import { logged } from "@/lib/log";
import { issueSession, sameSecret, sessionCookie } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Exchange APP_SECRET for a signed session cookie. A POST from the /login form, so
 * the secret never appears in a URL (and so never in history, referrers or the
 * request log - which is where the old ?k= link put it).
 */
async function handlePOST(req: NextRequest) {
  const key = process.env.APP_SECRET?.trim();
  const form = await req.formData().catch(() => null);
  const given = String(form?.get("secret") ?? "");

  if (!key || !given || !sameSecret(given, key)) {
    // Slow down guessing. The secret is long and random, so this is belt and braces.
    await new Promise((r) => setTimeout(r, 600));
    return NextResponse.redirect(new URL("/login?e=1", req.url), 303);
  }
  const res = NextResponse.redirect(new URL("/", req.url), 303);
  res.cookies.set(sessionCookie(issueSession()));
  return res;
}

export const POST = logged("login", handlePOST);
