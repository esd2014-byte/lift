import { publicMessage } from "./errors";
import { listWorkouts as listHevy, workoutCount } from "./hevy";
import { listWorkouts as listVoltra } from "./voltra";
import { writeFile } from "./store";
import { localDateOf, todayISO } from "./date";

/**
 * Pull each source and commit a compact digest to the data repo.
 *
 * One implementation, three callers: the daily crons, the Refresh button, and
 * ending a workout in the app (so today's session counts today, not tomorrow).
 * The cloud routine reads these digests and never needs either API key.
 */

const KG_TO_LB = 2.20462;

/** A workout that ran this long was almost certainly left open, not trained. */
export const LEFT_OPEN_MINUTES = 240;

export type SyncResult = { source: "hevy" | "voltra"; ok: boolean; workouts?: number; error?: string };

export async function syncHevy(why: string): Promise<SyncResult> {
  try {
    const [workouts, total] = await Promise.all([listHevy(40), workoutCount().catch(() => null)]);
    workouts.sort((a, b) => (a.start_time < b.start_time ? 1 : -1));

    // A readable digest, not the raw dump: the routine reads this with an LLM, so
    // compactness and legibility matter more than completeness. Full detail stays
    // in Hevy, which remains the system of record.
    const sessions = workouts.map((w) => {
      const minutes = w.end_time ? Math.round((Date.parse(w.end_time) - Date.parse(w.start_time)) / 60000) : null;
      return {
        date: localDateOf(w.start_time),
        start: w.start_time,
        minutes,
        // Hevy's timer keeps running until the workout is finished in the app. A
        // 16-hour "session" is a workout left open overnight - flag it so nothing
        // treats that duration as real.
        ...(minutes !== null && minutes > LEFT_OPEN_MINUTES ? { left_open: true } : {}),
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
      };
    });

    const payload = {
      synced_at: new Date().toISOString(),
      local_date: todayISO(),
      workout_count: total ?? workouts.length,
      last_session: sessions[0]?.date ?? null,
      sessions,
    };
    await writeFile(
      "logs/hevy/recent.json",
      JSON.stringify(payload, null, 2) + "\n",
      `Hevy sync ${todayISO()} (${payload.workout_count} workouts, ${why})`
    );
    return { source: "hevy", ok: true, workouts: payload.workout_count };
  } catch (err) {
    console.error("hevy sync failed", err);
    return { source: "hevy", ok: false, error: publicMessage(err) };
  }
}

export async function syncVoltra(why: string): Promise<SyncResult> {
  try {
    const workouts = await listVoltra();
    workouts.sort((a, b) => (a.startTime < b.startTime ? 1 : -1));

    const sessions = workouts.slice(0, 60).map((w) => ({
      date: localDateOf(w.startTime),
      start: w.startTime,
      id: w.id,
      // "Free Exercises" means nothing was selected on the device, so the movement
      // is unknown. Flag it rather than guessing from the force profile.
      actions: w.actionNames ?? [],
      // Ids too: they're what scripts/voltra_mapping.yaml speaks, so a lift's history
      // can be found without matching names.
      action_ids: w.actionIds ?? [],
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
      `Voltra sync ${todayISO()} (${workouts.length} workouts, ${why})`
    );
    return { source: "voltra", ok: true, workouts: workouts.length };
  } catch (err) {
    console.error("voltra sync failed", err);
    return { source: "voltra", ok: false, error: publicMessage(err) };
  }
}

/** Both, in parallel. Each reports on its own; one failing doesn't stop the other. */
export function syncAll(why: string) {
  return Promise.all([syncHevy(why), syncVoltra(why)]);
}
