import { NextRequest, NextResponse } from "next/server";
import { logged } from "@/lib/log";
import { publicMessage } from "@/lib/errors";
import { requireAuth } from "@/lib/guard";
import { updateFile } from "@/lib/store";
import { todayISO } from "@/lib/date";
import { addDayNote, MAX_NOTE_TEXT } from "@/lib/dayNotes";

export const dynamic = "force-dynamic";

function yesterday(today: string) {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Tell the coach what actually happened on a day, today or yesterday.
 *
 * The morning routine reads these before the device digests, so a messy Beyond+
 * history ("three half-sessions of calibration") or unlogged work ("pushups last
 * night") is read the way it was meant. `trained` counts the day toward the streak.
 */
async function handlePOST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { text?: string; when?: string; trained?: boolean };
    const text = String(body.text ?? "").trim();
    if (!text) return NextResponse.json({ error: "say what happened first" }, { status: 400 });
    if (text.length > MAX_NOTE_TEXT) return NextResponse.json({ error: "that's too long" }, { status: 400 });
    if (body.when !== undefined && body.when !== "today" && body.when !== "yesterday") {
      return NextResponse.json({ error: "when must be today or yesterday" }, { status: 400 });
    }
    const today = todayISO();
    const date = body.when === "yesterday" ? yesterday(today) : today;
    const note = { date, text, trained: body.trained === true, logged_at: new Date().toISOString() };
    await updateFile("logs/day-notes.json", (cur) => addDayNote(cur, note), `Day note ${date}: ${text.slice(0, 60)}`);
    return NextResponse.json({ ok: true, note });
  } catch (err) {
    console.error("day-note failed", err);
    return NextResponse.json({ error: publicMessage(err) }, { status: 500 });
  }
}

export const POST = logged("day-note", handlePOST);
