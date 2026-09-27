import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Liveness only. Exempt from the auth gate so uptime can be checked without the
 * secret, which is exactly why it does no work and says nothing: no outbound calls
 * (an anonymous caller could otherwise spend the GitHub rate limit) and no facts
 * about training activity. The real wiring check is /api/diagnostics, behind auth.
 */
export function GET() {
  return NextResponse.json({ ok: true });
}
