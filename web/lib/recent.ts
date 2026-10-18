import type { DigestSession, VoltraSession } from "./metrics";
import type { WorkoutEntry } from "./workouts";
import type { DayNote } from "./dayNotes";

/**
 * Small read-only views of the recent logs for the Program tab: when each program
 * day was last trained, what the last session was, and what in the last few days
 * the logs can't explain on their own. Pure functions over data already loaded.
 */

/** "Day B — Pull", "Today: Day B — Pull · Beast mode" -> "B" */
export function dayLetter(title: string | undefined): string | null {
  const m = /\bDay\s+([A-Z])\b/.exec(title ?? "");
  return m ? m[1] : null;
}

/** Newest date each program day was trained, from Lift's own log and Hevy's titles. */
export function lastTrainedByDay(workouts: WorkoutEntry[], hevy: DigestSession[], today: string) {
  const out: Record<string, string> = {};
  const see = (letter: string | null, date: string) => {
    if (letter && date <= today && (!out[letter] || date > out[letter])) out[letter] = date;
  };
  for (const w of workouts) see(dayLetter(w.day), w.date);
  for (const s of hevy) see(dayLetter(s.title), s.date);
  return out;
}

export type LastSession = {
  date: string;
  minutes: number | null;
  day: string | null;
  lines: string[];
  more: number;
};

const MAX_LINES = 6;

/** The most recent training day before or on today, summed across Hevy, Voltra and Lift. */
export function lastSession(
  hevy: DigestSession[],
  voltra: VoltraSession[],
  workouts: WorkoutEntry[],
  today: string
): LastSession | null {
  const dates = [...hevy.map((s) => s.date), ...voltra.map((v) => v.date), ...workouts.map((w) => w.date)]
    .filter((d) => d <= today)
    .sort();
  const date = dates.at(-1);
  if (!date) return null;

  const h = hevy.filter((s) => s.date === date);
  const v = voltra.filter((s) => s.date === date);
  const w = workouts.filter((x) => x.date === date);

  const lines: string[] = [];
  for (const s of h) {
    for (const e of s.exercises ?? []) {
      const t = e.top;
      if (t?.lb && t.reps) lines.push(`${e.name}: ${t.lb} lb × ${t.reps}`);
      else if (t?.reps) lines.push(`${e.name}: ${t.reps} reps`);
      else if (t?.seconds) lines.push(`${e.name}: ${t.seconds}s`);
      else lines.push(e.name);
    }
  }
  for (const s of v) {
    if (s.unnamed) lines.push(`Voltra free session: ${s.sets} sets`);
    else
      for (const name of s.actions)
        lines.push(
          `${name}: ${s.sets} × ${Math.max(1, Math.round(s.reps / Math.max(1, s.sets)))}${s.max_force_lb ? `, peak ${Math.round(s.max_force_lb)} lb` : ""}`
        );
  }

  const liftMinutes = w.map((x) => x.minutes).find((m) => typeof m === "number") ?? null;
  const hevyMinutes = h.reduce((n, s) => n + ((s as { minutes?: number }).minutes ?? 0), 0) || null;
  const day = w.at(-1)?.day ?? h.find((s) => dayLetter(s.title))?.title?.replace(/^Today:\s*/, "") ?? null;
  return {
    date,
    minutes: liftMinutes ?? hevyMinutes,
    day,
    lines: lines.slice(0, MAX_LINES),
    more: Math.max(0, lines.length - MAX_LINES),
  };
}

export type Question = { date: string; text: string };

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

/** The dates a note can be written for: today and the two days before. */
export function noteDates(today: string, n = 3): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - i);
    return d.toISOString().slice(0, 10);
  });
}

/**
 * What the last few days of logs can't settle on their own, as plain questions.
 * A day that already has a note is taken as explained.
 */
export function questions(
  hevy: DigestSession[],
  voltra: VoltraSession[],
  workouts: WorkoutEntry[],
  notes: DayNote[],
  today: string
): Question[] {
  const out: Question[] = [];
  for (const date of noteDates(today)) {
    if (notes.some((n) => n.date === date)) continue;
    const day = date === today ? "today" : weekday(date);
    const h = hevy.filter((s) => s.date === date);
    const v = voltra.filter((s) => s.date === date);
    const w = workouts.filter((x) => x.date === date);

    const named = v.filter((s) => !s.unnamed);
    if (named.length > 1)
      out.push({ date, text: `Beyond+ saved ${named.length} sessions ${on(day)}. One workout, or separate ones?` });
    if (v.some((s) => s.unnamed)) out.push({ date, text: `A "Free Exercises" session ${on(day)}: what did you do?` });
    if (h.some((s) => (s as { left_open?: boolean }).left_open))
      out.push({ date, text: `Your Hevy workout ${on(day)} was left open. Roughly how long did you train?` });

    // Finished workouts only: one still running today hasn't had a chance to sync.
    const done = w.filter((x) => x.ended_at || x.closed_unended);
    if (done.length && !h.length && !v.length)
      out.push({
        date,
        text: `You started ${done.at(-1)!.day} in Lift ${on(day)}, but nothing synced. Did it happen?`,
      });

    const started = dayLetter(w.at(-1)?.day);
    const logged = h.map((s) => dayLetter(s.title)).find(Boolean);
    if (started && logged && started !== logged)
      out.push({
        date,
        text: `You started Day ${started} in Lift ${on(day)} but logged Day ${logged} in Hevy. Which was it?`,
      });
  }
  return out;
}

const on = (day: string) => (day === "today" ? "today" : `on ${day}`);
