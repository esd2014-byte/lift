import { NextRequest, NextResponse } from "next/server";
import { logged } from "@/lib/log";
import { publicMessage } from "@/lib/errors";
import { requireAuth } from "@/lib/guard";
import { updateFile } from "@/lib/store";
import { todayISO } from "@/lib/date";
import { addInjury, addUpdate, setStatus, MAX_INJURY_TEXT, type Injury } from "@/lib/injuries";

export const dynamic = "force-dynamic";

const PATH = "logs/injuries.json";

/**
 * Report, update, resolve or reopen an injury.
 *
 *   create   {text}      a new active injury, from a free-text report
 *   update   {id, text}  something changed: better, worse, a new trigger
 *   resolve  {id}        no longer affecting training
 *   reopen   {id}        it came back
 *
 * The morning routine reads the active ones every day. The standing rules in
 * athlete/injuries.yaml are changed deliberately, by PR, never from here.
 */
async function handlePOST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string; id?: string; text?: string };
    const text = String(body.text ?? "").trim();
    const id = String(body.id ?? "");
    const now = new Date().toISOString();
    const needsText = body.action === "create" || body.action === "update";
    if (needsText && !text) return NextResponse.json({ error: "say what's going on first" }, { status: 400 });
    if (text.length > MAX_INJURY_TEXT) return NextResponse.json({ error: "that's too long" }, { status: 400 });

    let injury: Injury | null = null;
    let missing = false;
    const apply = (result: { text: string; injury: Injury } | null) => {
      if (!result) {
        missing = true;
        return null;
      }
      injury = result.injury;
      return result.text;
    };

    if (body.action === "create") {
      await updateFile(
        PATH,
        (cur) => apply(addInjury(cur, text, todayISO(), now)),
        `Injury reported: ${text.slice(0, 60)}`
      );
    } else if (body.action === "update") {
      await updateFile(PATH, (cur) => apply(addUpdate(cur, id, text, now)), `Injury update: ${id}`);
    } else if (body.action === "resolve" || body.action === "reopen") {
      const status = body.action === "resolve" ? "resolved" : "active";
      await updateFile(PATH, (cur) => apply(setStatus(cur, id, status, now)), `Injury ${status}: ${id}`);
    } else {
      return NextResponse.json({ error: "action must be create, update, resolve or reopen" }, { status: 400 });
    }
    if (missing) return NextResponse.json({ error: "no such injury" }, { status: 404 });
    return NextResponse.json({ ok: true, injury });
  } catch (err) {
    console.error("injuries failed", err);
    return NextResponse.json({ error: publicMessage(err) }, { status: 500 });
  }
}

export const POST = logged("injuries", handlePOST);
