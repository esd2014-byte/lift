import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "@/lib/github";
import { todayISO } from "@/lib/date";

export const dynamic = "force-dynamic";

/**
 * Record a day Eli couldn't train, with his own words for why.
 *
 * This matters more than it looks. Without it, a travel week reads to the coach as
 * four silent misses and it downgrades him to short days. With a reason, tomorrow's
 * brief opens from what actually happened, and the streak holds instead of resetting.
 */
export async function POST(req: NextRequest) {
  try {
    const { reason } = (await req.json()) as { reason?: string };
    const text = (reason ?? "").trim();
    if (!text) return NextResponse.json({ error: "reason is required" }, { status: 400 });
    if (text.length > 1000) return NextResponse.json({ error: "reason too long" }, { status: 400 });

    const path = "logs/rest-days.json";
    const existing = (await readFile(path)) ?? "[]";
    let log: Array<{ date: string; reason: string; logged_at: string }>;
    try {
      log = JSON.parse(existing);
    } catch {
      log = [];
    }

    const today = todayISO();
    log = log.filter((r) => r.date !== today); // one entry per day; re-submitting replaces
    log.push({ date: today, reason: text, logged_at: new Date().toISOString() });
    log.sort((a, b) => (a.date < b.date ? -1 : 1));

    await writeFile(path, JSON.stringify(log, null, 2) + "\n", `Rest day ${today}: ${text.slice(0, 60)}`);
    return NextResponse.json({ ok: true, date: today });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
