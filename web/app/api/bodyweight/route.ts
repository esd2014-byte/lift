import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "@/lib/github";
import { todayISO } from "@/lib/date";
import { rollingAverage } from "@/lib/bodyweight";

export const dynamic = "force-dynamic";

/**
 * Append today's bodyweight to logs/bodyweight.csv in the repo.
 *
 * Daily bodyweight is the input Eli asked for, and it's the one the lean-gain
 * guardrail depends on - a 7-day rolling average is the only reading of
 * bodyweight that means anything.
 */
export async function POST(req: NextRequest) {
  try {
    const { weight, skip } = (await req.json()) as { weight?: number; skip?: boolean };
    // A skipped day is recorded explicitly, so the app can tell "not asked yet"
    // from "asked and declined" - and so a gap in the CSV means a gap, not a bug.
    if (!skip && (typeof weight !== "number" || !Number.isFinite(weight) || weight < 80 || weight > 400)) {
      return NextResponse.json({ error: "weight must be a number between 80 and 400" }, { status: 400 });
    }

    const path = "logs/bodyweight.csv";
    const existing = (await readFile(path)) ?? "date,weight_lb\n";
    const today = todayISO();

    // One row per day - re-submitting replaces rather than appends.
    const rows = existing.trimEnd().split("\n");
    const header = rows[0];
    const kept = rows.slice(1).filter((r) => r && !r.startsWith(`${today},`));
    kept.push(`${today},${skip ? "skip" : weight}`);
    kept.sort();

    await writeFile(
      path,
      [header, ...kept].join("\n") + "\n",
      skip ? `Bodyweight ${today}: skipped` : `Bodyweight ${today}: ${weight} lb`
    );

    const { avg, n } = rollingAverage(kept, today);

    return NextResponse.json({
      ok: true,
      date: today,
      weight: skip ? null : weight,
      skipped: Boolean(skip),
      rolling7: avg,
      n,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
