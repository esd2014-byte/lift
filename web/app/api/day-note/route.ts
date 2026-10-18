import { NextRequest, NextResponse } from "next/server";
import { logged } from "@/lib/log";
import { publicMessage } from "@/lib/errors";
import { requireAuth } from "@/lib/guard";
import { updateFile } from "@/lib/store";
import { todayISO } from "@/lib/date";
import { addDayNote, MAX_NOTE_TEXT } from "@/lib/dayNotes";
import { noteDates } from "@/lib/recent";

export const dynamic = "force-dynamic";

/**
 * Tell the coach what actually happened on a day: today or one of the two before.
 *
 * The morning routine reads these before the device digests, so a messy Beyond+
 * history ("three half-sessions of calibration") or unlogged work ("pushups last
 * night") is read the way it was meant. `trained` counts the day toward the streak.
 */
async function handlePOST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      text?: string;
      date?: string;
      when?: string;
      trained?: boolean;
      question?: string;
    };
    const text = String(body.text ?? "").trim();
    if (!text) return NextResponse.json({ error: "say what happened first" }, { status: 400 });
    if (text.length > MAX_NOTE_TEXT) return NextResponse.json({ error: "that's too long" }, { status: 400 });
    const today = todayISO();
    const allowed = noteDates(today);
    // `when` is the older form of the same thing.
    const date =
      body.date ?? (body.when === "yesterday" ? allowed[1] : body.when === "today" || !body.when ? today : "");
    if (!allowed.includes(date)) {
      return NextResponse.json({ error: "a note can only be for today or the two days before" }, { status: 400 });
    }
    const question = typeof body.question === "string" ? body.question.trim().slice(0, 300) : "";
    const note = {
      date,
      text,
      trained: body.trained === true,
      logged_at: new Date().toISOString(),
      ...(question ? { question } : {}),
    };
    await updateFile("logs/day-notes.json", (cur) => addDayNote(cur, note), `Day note ${date}: ${text.slice(0, 60)}`);
    return NextResponse.json({ ok: true, note });
  } catch (err) {
    console.error("day-note failed", err);
    return NextResponse.json({ error: publicMessage(err) }, { status: 500 });
  }
}

export const POST = logged("day-note", handlePOST);
