import { NextRequest, NextResponse } from "next/server";
import { logged } from "@/lib/log";
import { publicMessage } from "@/lib/errors";
import { requireAuth } from "@/lib/guard";
import { updateFile } from "@/lib/store";
import { todayISO } from "@/lib/date";

export const dynamic = "force-dynamic";

/**
 * Append an injury note - something healing, something new.
 *
 * Written to its own log rather than edited into athlete/injuries.yaml. That file
 * holds the standing rules that veto exercise selection, and those should change
 * deliberately, not by appending a note from a phone at 7am. The morning routine
 * reads this log, reasons about it, and proposes changes to the rules.
 */
async function handlePOST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { note } = (await req.json()) as { note?: string };
    const text = (note ?? "").trim();
    if (!text) return NextResponse.json({ error: "note is required" }, { status: 400 });
    if (text.length > 2000) return NextResponse.json({ error: "note too long" }, { status: 400 });

    const path = "logs/injury-notes.md";
    const header =
      "# Injury notes\n\nAppended from the app. The morning routine reads these and proposes\nchanges to `athlete/injuries.yaml` - it does not edit the standing rules directly.\n";
    const today = todayISO();
    const entry = `\n## ${today}\n\n${text}\n`;
    await updateFile(path, (cur) => (cur ?? header).trimEnd() + "\n" + entry, `Injury note ${today}`);

    return NextResponse.json({ ok: true, date: today });
  } catch (err) {
    console.error("injury-note failed", err);
    return NextResponse.json({ error: publicMessage(err) }, { status: 500 });
  }
}

export const POST = logged("injury-note", handlePOST);
