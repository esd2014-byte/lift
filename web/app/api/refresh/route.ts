import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/guard";
import { syncAll } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Manual refresh: re-pull Hevy and Voltra now instead of waiting for the daily cron.
 *
 * POST, because it commits: a GET that changes state can be triggered by any link.
 * It does NOT regenerate the brief - that's the cloud routine's job and it needs a
 * model - so the app says plainly when the brief is old rather than implying this
 * fixed it.
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const results = await syncAll("manual refresh");
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 502 });
}
