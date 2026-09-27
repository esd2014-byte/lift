import { NextRequest, NextResponse } from "next/server";
import { listWorkouts } from "@/lib/hevy";
import { writeFile } from "@/lib/github";
import { localDateOf, todayISO } from "@/lib/date";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KG_TO_LB = 2.20462;

/**
 * Pull Hevy and commit a digest into the repo.
 *
 * This exists so the cloud routine never needs the Hevy key. It reads the repo
 * instead, which it can already clone. The secret stays in exactly one place.
 *
 * Triggered by Vercel Cron, which sends Authorization: Bearer $CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("CRON_SECRET is not set - refusing to run");
    return new NextResponse("Not found", { status: 404 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const workouts = await listWorkouts();
    workouts.sort((a, b) => (a.start_time < b.start_time ? 1 : -1));

    // A readable digest, not the raw dump: the routine reads this with an LLM, so
    // compactness and legibility matter more than completeness. Full detail stays
    // in Hevy, which remains the system of record.
    const digest = workouts.slice(0, 40).map((w) => ({
      date: localDateOf(w.start_time),
      start: w.start_time,
      title: w.title,
      note: w.description || undefined,
      exercises: (w.exercises ?? []).map((e) => {
        const done = (e.sets ?? []).filter((s) => s.reps || s.duration_seconds);
        const top = done.reduce<(typeof done)[number] | null>(
          (best, s) =>
            !best || (s.weight_kg ?? 0) > (best.weight_kg ?? 0) ? s : best,
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
      sessions: digest,
    };

    await writeFile(
      "logs/hevy/recent.json",
      JSON.stringify(payload, null, 2) + "\n",
      `Hevy sync ${todayISO()} (${workouts.length} workouts)`
    );

    return NextResponse.json({
      ok: true,
      workouts: workouts.length,
      lastSession: payload.last_session,
    });
  } catch (err) {
    console.error("hevy-sync failed", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
