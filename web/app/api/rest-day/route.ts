import { NextRequest, NextResponse } from "next/server";
import { logged } from "@/lib/log";
import { publicMessage } from "@/lib/errors";
import { requireAuth } from "@/lib/guard";
import { updateFile } from "@/lib/store";
import { todayISO } from "@/lib/date";
import { upsertJsonDay } from "@/lib/dailyLog";

export const dynamic = "force-dynamic";

/**
 * Record a day the athlete couldn't train, in their own words.
 *
 * This matters more than it looks. Without it, a travel week reads to the coach as
 * four silent misses and it downgrades him to short days. With a reason, tomorrow's
 * brief opens from what actually happened, and the streak holds instead of resetting.
 */
async function handlePOST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { reason } = (await req.json()) as { reason?: string };
    const text = (reason ?? "").trim();
    if (!text) return NextResponse.json({ error: "reason is required" }, { status: 400 });
    if (text.length > 1000) return NextResponse.json({ error: "reason too long" }, { status: 400 });

    const path = "logs/rest-days.json";
    const today = todayISO();
    await updateFile(
      path,
      // One entry per day; re-submitting replaces.
      (cur) => upsertJsonDay(cur, { date: today, reason: text, logged_at: new Date().toISOString() }),
      `Rest day ${today}: ${text.slice(0, 60)}`
    );
    return NextResponse.json({ ok: true, date: today });
  } catch (err) {
    console.error("rest-day failed", err);
    return NextResponse.json({ error: publicMessage(err) }, { status: 500 });
  }
}

export const POST = logged("rest-day", handlePOST);
