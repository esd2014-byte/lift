import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "@/lib/github";
import { applyTolerances, TOLERANCES } from "@/lib/tolerance";

export const dynamic = "force-dynamic";

const LIBRARY_PATH = "library/exercises.yaml";

/**
 * Save tolerance ratings.
 *
 * Batched on purpose: rating eight exercises after a session should be one commit,
 * not eight. The client accumulates and posts once.
 */
export async function POST(req: NextRequest) {
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

    const raw = await readFile(LIBRARY_PATH);
    if (!raw) return NextResponse.json({ error: "library not found" }, { status: 500 });

    const edited = applyTolerances(raw, updates);
    if (edited === raw) return NextResponse.json({ ok: true, changed: 0 });

    const n = Object.keys(updates).length;
    const summary = Object.entries(updates)
      .map(([id, v]) => `${id}: ${v}`)
      .join(", ");
    await writeFile(
      LIBRARY_PATH,
      edited,
      `Rate ${n} exercise${n === 1 ? "" : "s"}\n\n${summary}\n\nRated from the phone.`
    );

    return NextResponse.json({ ok: true, changed: n });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
