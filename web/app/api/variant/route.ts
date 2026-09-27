import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "@/lib/github";
import { todayISO } from "@/lib/date";

export const dynamic = "force-dynamic";

/**
 * Record which variant was actually chosen.
 *
 * Right now this is just a log - the coach reads it to learn the pattern (how often
 * the full session survives contact with a Tuesday). Pushing the swapped routine
 * into Hevy is the next step and will hang off this same endpoint.
 */
export async function POST(req: NextRequest) {
  try {
    const { variant } = (await req.json()) as { variant?: string };
    const v = (variant ?? "").trim();
    if (!["full", "beast", "minimum", "travel"].includes(v)) {
      return NextResponse.json({ error: "unknown variant" }, { status: 400 });
    }

    const path = "logs/variants.json";
    const existing = (await readFile(path)) ?? "[]";
    let log: Array<{ date: string; variant: string; at: string }>;
    try {
      log = JSON.parse(existing);
    } catch {
      log = [];
    }
    const today = todayISO();
    log = log.filter((r) => r.date !== today);
    log.push({ date: today, variant: v, at: new Date().toISOString() });
    log.sort((a, b) => (a.date < b.date ? -1 : 1));

    await writeFile(path, JSON.stringify(log, null, 2) + "\n", `Variant ${today}: ${v}`);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
