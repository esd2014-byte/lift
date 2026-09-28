import { NextRequest, NextResponse } from "next/server";
import { logged } from "@/lib/log";
import { publicMessage } from "@/lib/errors";
import { requireAuth } from "@/lib/guard";
import { readFile, updateFile } from "@/lib/store";
import { todayISO } from "@/lib/date";
import { parseDayNames } from "@/lib/program";
import { dayTitle } from "@/lib/session";
import { pushVoltraSession } from "@/lib/voltraSession";
import { pushHevyRoutine } from "@/lib/hevyRoutine";
import { syncAll } from "@/lib/sync";
import { closeUnended, end, parseLog, start, type WorkoutEntry } from "@/lib/workouts";
import { VARIANT_ORDER } from "@/lib/types";
import { checkBrief } from "@/lib/briefCheck";
import { withGuessedLoads } from "@/lib/loadGuess";
import { upsertJsonDay } from "@/lib/dailyLog";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOG = "logs/workouts.json";
const VARIANTS = "logs/variants.json";

/**
 * Start, end, or close a workout.
 *
 *   start   records the chosen variant (the coach's signal), then puts the workout
 *           where it will be done: a "Today" routine in Hevy with target weights,
 *           and the day's session on the Voltra.
 *   end     records the elapsed time, then pulls Hevy and Voltra so today's work
 *           counts today rather than after tomorrow's 6am sync.
 *   close   closes a workout that was never ended, without inventing a duration.
 *
 * The pushes and syncs report their own failures; neither can undo a start or end.
 */
async function handlePOST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as { action?: string; variant?: string; briefDate?: string };
    const now = new Date().toISOString();
    const json = (log: WorkoutEntry[]) => JSON.stringify(log, null, 2) + "\n";

    if (body.action === "start") {
      const variant = String(body.variant ?? "");
      if (!(VARIANT_ORDER as readonly string[]).includes(variant)) {
        return NextResponse.json({ error: "unknown variant" }, { status: 400 });
      }
      const date = /^\d{4}-\d{2}-\d{2}$/.test(body.briefDate ?? "") ? body.briefDate! : todayISO();
      const [briefRaw, programRaw] = await Promise.all([
        readFile(`logs/briefs/${date}.json`),
        readFile("program/current.yaml"),
      ]);
      if (!briefRaw) return NextResponse.json({ error: `no brief for ${date}` }, { status: 404 });
      const { brief: checked } = checkBrief(JSON.parse(briefRaw));
      const brief = checked ? await withGuessedLoads(checked) : null;
      if (!brief) return NextResponse.json({ error: `the brief for ${date} couldn't be read` }, { status: 422 });
      if (!brief.variants?.[variant]) return NextResponse.json({ error: "variant not in brief" }, { status: 400 });
      const dayNames = parseDayNames(programRaw);

      const today = todayISO();
      const entry = { date: today, variant, day: dayTitle(brief, brief.variants[variant], dayNames), started_at: now };
      // Each log is re-read inside its update, so a concurrent write can't be lost.
      await Promise.all([
        updateFile(LOG, (cur) => json(start(parseLog(cur), entry)), `Workout started ${today}: ${variant}`),
        // The committed choice, in the file the coach already reads.
        updateFile(VARIANTS, (cur) => upsertJsonDay(cur, { date: today, variant, at: now }), `Variant ${today}: ${variant}`),
      ]);

      const [hevy, voltra] = await Promise.all([
        pushHevyRoutine(brief, variant, dayNames),
        pushVoltraSession(brief, variant),
      ]);
      return NextResponse.json({ ok: true, entry, hevy, voltra });
    }

    if (body.action === "end") {
      let entry: WorkoutEntry | null = null;
      await updateFile(
        LOG,
        (cur) => {
          const ended = end(parseLog(cur), now);
          entry = ended.entry;
          return ended.entry ? json(ended.log) : null;
        },
        `Workout ended ${todayISO()}`
      );
      if (!entry) return NextResponse.json({ error: "no workout is running" }, { status: 409 });
      const syncs = await syncAll("workout ended");
      return NextResponse.json({ ok: true, entry, syncs });
    }

    if (body.action === "close") {
      await updateFile(LOG, (cur) => json(closeUnended(parseLog(cur))), "Workout closed without an end time");
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "action must be start, end or close" }, { status: 400 });
  } catch (err) {
    console.error("workout failed", err);
    return NextResponse.json({ error: publicMessage(err) }, { status: 500 });
  }
}

export const POST = logged("workout", handlePOST);
