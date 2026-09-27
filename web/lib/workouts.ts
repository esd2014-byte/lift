/**
 * The workout log Lift keeps itself: logs/workouts.json in the data repo.
 *
 * Start records the variant actually chosen (previewing one doesn't) and when.
 * End records how long it took. That makes Lift a first-hand source for "did I
 * train today" - the streak no longer depends on a sync having run - and gives the
 * coach the committed choice rather than every tap.
 */

export type WorkoutEntry = {
  date: string;
  variant: string;
  /** Program day title the variant trains, e.g. "Day A — Push". */
  day: string;
  started_at: string;
  ended_at?: string | null;
  /** Elapsed minutes. Null when it can't be trusted (left open, or closed unended). */
  minutes?: number | null;
  /** Set when a workout ran implausibly long, i.e. End was never pressed in time. */
  left_open?: boolean;
  /** Set when an unfinished workout was closed without a duration. */
  closed_unended?: boolean;
};

/** Longer than this and the timer was left running, not trained through. */
export const MAX_MINUTES = 240;

export function parseLog(raw: string | null): WorkoutEntry[] {
  if (!raw) return [];
  try {
    const log = JSON.parse(raw);
    return Array.isArray(log) ? (log as WorkoutEntry[]) : [];
  } catch {
    return [];
  }
}

/** The workout currently running, if any: the latest one never ended. */
export function openWorkout(log: WorkoutEntry[]): WorkoutEntry | null {
  const open = log.filter((w) => !w.ended_at && !w.closed_unended);
  return open.at(-1) ?? null;
}

export function start(log: WorkoutEntry[], entry: Omit<WorkoutEntry, "ended_at" | "minutes">): WorkoutEntry[] {
  const open = openWorkout(log);
  if (!open) return [...log, { ...entry }];
  // Starting again while one is running today (a double tap, or switching variant
  // before the first set) replaces it rather than stacking a second open workout.
  if (open.date === entry.date) return [...log.filter((w) => w !== open), { ...entry }];
  // One left open on an earlier day is kept - it was still a training day - but
  // closed without a duration.
  return [...closeUnended(log), { ...entry }];
}

export function end(log: WorkoutEntry[], endedAt: string): { log: WorkoutEntry[]; entry: WorkoutEntry | null } {
  const open = openWorkout(log);
  if (!open) return { log, entry: null };
  const minutes = Math.round((Date.parse(endedAt) - Date.parse(open.started_at)) / 60000);
  const entry: WorkoutEntry =
    minutes > MAX_MINUTES
      ? { ...open, ended_at: endedAt, minutes: null, left_open: true }
      : { ...open, ended_at: endedAt, minutes: Math.max(0, minutes) };
  return { log: log.map((w) => (w === open ? entry : w)), entry };
}

/** Close a workout that was never ended, without inventing a duration for it. */
export function closeUnended(log: WorkoutEntry[]): WorkoutEntry[] {
  const open = openWorkout(log);
  if (!open) return log;
  return log.map((w) => (w === open ? { ...w, ended_at: null, minutes: null, closed_unended: true } : w));
}

/** Days with a workout that was started in Lift. They count toward the streak. */
export function trainedDates(log: WorkoutEntry[]): string[] {
  return [...new Set(log.map((w) => w.date))];
}
