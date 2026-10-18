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
import { VARIANT_ORDER, type BriefData } from "@/lib/types";
import { checkBrief } from "@/lib/briefCheck";
import { withGuessedLoads } from "@/lib/loadGuess";
import { upsertJsonDay } from "@/lib/dailyLog";
import { programBriefs } from "@/lib/programDay";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LOG = "logs/workouts.json";
const VARIANTS = "logs/variants.json";

/**
 * Start, end, or close a workout.
 *
 *   start   records the chosen variant (the coach's signal), then puts the workout
 *           where it will be done: a "Today" routine in Hevy with target weights,
 *           and the day's session on the Voltra. With `day`, the athlete overrode
 *           the coach's pick: that program day is built from the program instead
 *           of the brief, and the log says it was off-plan.
 *   end     records the elapsed time, then pulls Hevy and Voltra so today's work
 *           counts today rather than after tomorrow's early-morning sync.
 *   close   closes a workout that was never ended, without inventing a duration.
 *
 * The pushes and syncs report their own failures; neither can undo a start or end.
 */
async function handlePOST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      variant?: string;
      briefDate?: string;
      day?: string;
    };
    const now = new Date().toISOString();
    const json = (log: WorkoutEntry[]) => JSON.stringify(log, null, 2) + "\n";

    if (body.action === "start") {
      const variant = String(body.variant ?? "");
      if (!(VARIANT_ORDER as readonly string[]).includes(variant)) {
        return NextResponse.json({ error: "unknown variant" }, { status: 400 });
      }
      const today = todayISO();
      let brief: BriefData | null;
      let dayNames: Record<string, string>;
      if (body.day) {
        // A program day other than the coach's pick: the coach's own version of it
        // when today's brief wrote one, otherwise built by rule from the program.
        const date = /^\d{4}-\d{2}-\d{2}$/.test(body.briefDate ?? "") ? body.briefDate! : today;
        const [programRaw, libraryRaw, travelRaw, briefRaw] = await Promise.all([
          readFile("program/current.yaml"),
          readFile("library/exercises.yaml"),
          readFile("program/travel.yaml"),
          readFile(`logs/briefs/${date}.json`),
        ]);
        const checked = briefRaw ? checkBrief(JSON.parse(briefRaw)).brief : null;
        const plan = programBriefs(programRaw, libraryRaw, today, { brief: checked, travelRaw })[body.day];
        if (!plan) return NextResponse.json({ error: `no Day ${body.day} in the program` }, { status: 404 });
        if (!plan.variants[variant]) return NextResponse.json({ error: "variant not in that day" }, { status: 400 });
        brief = await withGuessedLoads({ ...plan, date: today }, { anyRow: plan.source === "program" });
        dayNames = parseDayNames(programRaw);
      } else {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(body.briefDate ?? "") ? body.briefDate! : today;
        const [briefRaw, programRaw] = await Promise.all([
          readFile(`logs/briefs/${date}.json`),
          readFile("program/current.yaml"),
        ]);
        if (!briefRaw) return NextResponse.json({ error: `no brief for ${date}` }, { status: 404 });
        const { brief: checked } = checkBrief(JSON.parse(briefRaw));
        brief = checked ? await withGuessedLoads(checked) : null;
        if (!brief) return NextResponse.json({ error: `the brief for ${date} couldn't be read` }, { status: 422 });
        if (!brief.variants?.[variant]) return NextResponse.json({ error: "variant not in brief" }, { status: 400 });
        dayNames = parseDayNames(programRaw);
      }

      const day = dayTitle(brief, brief.variants[variant], dayNames);
      const offPlan = body.day ? { off_plan: true } : {};
      const entry = { date: today, variant, day, started_at: now, ...offPlan };
      // Each log is re-read inside its update, so a concurrent write can't be lost.
      await Promise.all([
        updateFile(
          LOG,
          (cur) => json(start(parseLog(cur), entry)),
          `Workout started ${today}: ${body.day ? day : variant}`
        ),
        // The committed choice, in the file the coach already reads.
        updateFile(
          VARIANTS,
          (cur) => upsertJsonDay(cur, { date: today, variant, day, at: now, ...offPlan }),
          `Variant ${today}: ${body.day ? `${day} (off-plan)` : variant}`
        ),
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
