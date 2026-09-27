import { NextResponse } from "next/server";
import { listWorkouts } from "@/lib/hevy";
import { writeFile } from "@/lib/github";
import { localDateOf, todayISO } from "@/lib/date";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KG_TO_LB = 2.20462;

/**
 * Manual "refresh" from the app: re-pull Hevy and commit the digest.
 *
 * This is the same work the daily cron does, on demand. It does NOT regenerate the
 * brief - that's the cloud routine's job and it needs a model. So the app's stale
 * banner says plainly when the brief is old rather than implying this fixed it.
 */
export async function GET() {
  try {
    const workouts = await listWorkouts();
    workouts.sort((a, b) => (a.start_time < b.start_time ? 1 : -1));

    const sessions = workouts.slice(0, 40).map((w) => ({
      date: localDateOf(w.start_time),
      start: w.start_time,
      title: w.title,
      note: w.description || undefined,
      exercises: (w.exercises ?? []).map((e) => {
        const done = (e.sets ?? []).filter((s) => s.reps || s.duration_seconds);
        const top = done.reduce<(typeof done)[number] | null>(
          (best, s) => (!best || (s.weight_kg ?? 0) > (best.weight_kg ?? 0) ? s : best),
          null
        );
        return {
          name: e.title,
          sets: done.length,
          top: top
            ? {
                lb: top.weight_kg ? Math.round(top.weight_kg * KG_TO_LB) : null,
                reps: top.reps ?? null,
                rpe: top.rpe ?? null,
                seconds: top.duration_seconds ?? null,
              }
            : null,
          notes: e.notes || undefined,
        };
      }),
    }));

    const payload = {
      synced_at: new Date().toISOString(),
      local_date: todayISO(),
      workout_count: workouts.length,
      last_session: workouts[0] ? localDateOf(workouts[0].start_time) : null,
      sessions,
    };

    await writeFile(
      "logs/hevy/recent.json",
      JSON.stringify(payload, null, 2) + "\n",
      `Hevy sync ${todayISO()} (${workouts.length} workouts, manual refresh)`
    );
    return NextResponse.json({ ok: true, workouts: workouts.length, lastSession: payload.last_session });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
