import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "@/lib/github";
import { todayISO } from "@/lib/date";

export const dynamic = "force-dynamic";

const FIELDS = ["waist", "arm", "shoulder"] as const;

/** Weekly tape measurements. Waist vs arm is what the lean-gain guardrail runs on. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const values: Record<string, number> = {};
    for (const f of FIELDS) {
      const v = Number(body[f]);
      if (body[f] === undefined || body[f] === "" || body[f] === null) continue;
      if (!Number.isFinite(v) || v <= 0 || v > 100) {
        return NextResponse.json({ error: `${f} must be inches, 0-100` }, { status: 400 });
      }
      values[f] = v;
    }
    if (!Object.keys(values).length) {
      return NextResponse.json({ error: "no measurements provided" }, { status: 400 });
    }

    const path = "logs/measurements.csv";
    const header = "date,waist_in,arm_in,shoulder_in";
    const existing = (await readFile(path)) ?? header + "\n";
    const today = todayISO();
    const rows = existing.trimEnd().split("\n").slice(1).filter((r) => r && !r.startsWith(`${today},`));
    rows.push(`${today},${values.waist ?? ""},${values.arm ?? ""},${values.shoulder ?? ""}`);
    rows.sort();

    await writeFile(path, [header, ...rows].join("\n") + "\n", `Measurements ${today}`);
    return NextResponse.json({ ok: true, date: today, values });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
