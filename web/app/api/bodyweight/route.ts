import { NextRequest, NextResponse } from "next/server";
import { publicMessage } from "@/lib/errors";
import { requireAuth } from "@/lib/guard";
import { updateFile } from "@/lib/github";
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
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { weight, skip } = (await req.json()) as { weight?: number; skip?: boolean };
    // A skipped day is recorded explicitly, so the app can tell "not asked yet"
    // from "asked and declined" - and so a gap in the CSV means a gap, not a bug.
    if (!skip && (typeof weight !== "number" || !Number.isFinite(weight) || weight < 80 || weight > 400)) {
      return NextResponse.json({ error: "weight must be a number between 80 and 400" }, { status: 400 });
    }

    const path = "logs/bodyweight.csv";
    const today = todayISO();

    // One row per day - re-submitting replaces rather than appends.
    let kept: string[] = [];
    await updateFile(
      path,
      (cur) => {
        const rows = (cur ?? "date,weight_lb\n").trimEnd().split("\n");
        kept = rows.slice(1).filter((r) => r && !r.startsWith(`${today},`));
        kept.push(`${today},${skip ? "skip" : weight}`);
        kept.sort();
        return [rows[0], ...kept].join("\n") + "\n";
      },
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
    console.error("bodyweight failed", err);
    return NextResponse.json({ error: publicMessage(err) }, { status: 500 });
  }
}
