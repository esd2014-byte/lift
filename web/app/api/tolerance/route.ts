import { NextRequest, NextResponse } from "next/server";
import { logged } from "@/lib/log";
import { publicMessage } from "@/lib/errors";
import { requireAuth } from "@/lib/guard";
import { updateFile } from "@/lib/github";
import { applyTolerances, TOLERANCES } from "@/lib/tolerance";

export const dynamic = "force-dynamic";

const LIBRARY_PATH = "library/exercises.yaml";

/**
 * Save tolerance ratings.
 *
 * Batched on purpose: rating eight exercises after a session should be one commit,
 * not eight. The client accumulates and posts once.
 */
async function handlePOST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { updates } = (await req.json()) as { updates?: Record<string, string> };
    if (!updates || typeof updates !== "object" || !Object.keys(updates).length) {
      return NextResponse.json({ error: "no updates" }, { status: 400 });
    }
    for (const [id, value] of Object.entries(updates)) {
      if (!(TOLERANCES as readonly string[]).includes(value)) {
        return NextResponse.json({ error: `invalid tolerance for ${id}: ${value}` }, { status: 400 });
      }
    }

    const n = Object.keys(updates).length;
    const summary = Object.entries(updates)
      .map(([id, v]) => `${id}: ${v}`)
      .join(", ");
    let found = true;
    const { changed } = await updateFile(
      LIBRARY_PATH,
      (raw) => {
        if (!raw) {
          found = false;
          return null;
        }
        return applyTolerances(raw, updates);
      },
      `Rate ${n} exercise${n === 1 ? "" : "s"}\n\n${summary}\n\nRated from the phone.`
    );
    if (!found) return NextResponse.json({ error: "library not found" }, { status: 500 });
    if (!changed) return NextResponse.json({ ok: true, changed: 0 });

    return NextResponse.json({ ok: true, changed: n });
  } catch (err) {
    console.error("tolerance failed", err);
    return NextResponse.json({ error: publicMessage(err) }, { status: 500 });
  }
}

export const POST = logged("tolerance", handlePOST);
