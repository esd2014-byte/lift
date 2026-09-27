import { NextRequest, NextResponse } from "next/server";
import { listWorkouts } from "@/lib/voltra";
import { writeFile } from "@/lib/github";
import { localDateOf, todayISO } from "@/lib/date";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Pull Voltra training history and commit a digest to the repo.
 *
 * Mirrors the Hevy sync. Between them the repo holds the whole picture, which
 * neither app does on its own: Hevy has the iron, Beyond+ has the cable work.
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
    workouts.sort((a, b) => (a.startTime < b.startTime ? 1 : -1));

    const sessions = workouts.slice(0, 60).map((w) => ({
      date: localDateOf(w.startTime),
      start: w.startTime,
      id: w.id,
      // "Free Exercises" means nothing was selected on the device, so the movement
      // is unknown. Flag it rather than guessing from the force profile.
      actions: w.actionNames ?? [],
      unnamed: !w.actionNames?.length || w.actionNames.every((n) => /free exercise/i.test(n)),
      sets: w.setCount,
      reps: w.repCount,
      duration_sec: w.durationSec,
      avg_force_lb: w.avgPullForceLbs ?? null,
      max_force_lb: w.maxPullForceLbs ?? null,
      avg_power_w: w.avgPullPowerW ?? null,
      max_power_w: w.maxPullPowerW ?? null,
      avg_velocity_mm_s: w.avgPullVelocityMmS ?? null,
      volume_lb: w.totalPullVolumeLbs ?? null,
    }));

    const payload = {
      synced_at: new Date().toISOString(),
      local_date: todayISO(),
      workout_count: workouts.length,
      last_session: sessions[0]?.date ?? null,
      unnamed_count: sessions.filter((s) => s.unnamed).length,
      sessions,
    };

    await writeFile(
      "logs/voltra/recent.json",
      JSON.stringify(payload, null, 2) + "\n",
      `Voltra sync ${todayISO()} (${workouts.length} workouts)`
    );

    return NextResponse.json({
      ok: true,
      workouts: workouts.length,
      lastSession: payload.last_session,
      unnamed: payload.unnamed_count,
    });
  } catch (err) {
    console.error("voltra-sync failed", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
