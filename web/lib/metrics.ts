/**
 * Streak and strength numbers, derived from the Hevy and Voltra digests in the repo.
 *
 * Deliberately computed from logged sessions rather than stored: a stored counter
 * drifts from reality the moment anything is logged or deleted in Hevy, and the
 * whole point of this number is that the athlete trusts it.
 */

export type AnchorProgress = {
  id: string;
  name: string;
  current: string | null;
  /** Change in estimated 1RM since the first logged set, in lb. */
  delta: string | null;
  since: string | null;
  trend: "up" | "down" | "flat" | "none";
};

export type DayState = "done" | "rest" | "miss" | "today" | "future";

export type Metrics = {
  sessionsThisWeek: number;
  weeklyTarget: number;
  restThisWeek: number;
  /** Distinct training days, not sessions - one day logged in two apps is still one day. */
  last7: number;
  last28: number;
  daysSinceLast: number | null;
  lastSessionDate: string | null;
  week: Array<{ letter: string; date: string; state: DayState }>;
  anchors: AnchorProgress[];
  strengthIndex: number | null;
  indexNote: string;
};

const WEEKLY_TARGET = 6;

// The four anchors. Two are logged in Hevy (iron), two on the device (cable).
// The device is authoritative for anything it measures: Beyond+ records force and
// velocity per rep, Hevy records what someone typed.
//
// Names are matched exactly and the source is enforced: a loose /deadlift/ once
// scored a dumbbell RDL from Hevy against a barbell deadlift and showed a 35 lb
// regression that never happened.
const ANCHORS: Array<{ id: string; name: string; match: RegExp; source: "hevy" | "voltra" }> = [
  // Anchor swapped 2026-09-25: a single Voltra can't drive a two-handed press well,
  // and that lift was rated disliked. DB flat bench has real history behind it.
  { id: "flat_press", name: "DB Flat Bench", match: /^bench press \(dumbbell\)$/i, source: "hevy" },
  { id: "belt_squat", name: "Voltra Belt Squat", match: /^voltra belt squat$/i, source: "voltra" },
  { id: "deadlift", name: "Voltra Deadlift", match: /^voltra deadlift( harness)?$/i, source: "voltra" },
  { id: "pullup", name: "Weighted Pull-up", match: /^pull up \(weighted\)$/i, source: "hevy" },
];

export type VoltraSession = {
  date: string;
  actions: string[];
  /** Beyond+ action ids, parallel to `actions`. Absent in digests written before 2026-09-28. */
  action_ids?: number[];
  unnamed: boolean;
  sets: number;
  reps: number;
  avg_force_lb: number | null;
  max_force_lb: number | null;
};

/**
 * Fold Voltra sessions into the same shape as Hevy sessions so one code path
 * computes everything. Max pull force stands in for load; it is a measurement
 * rather than a number typed after the fact, which is the point.
 *
 * "Free Exercises" names no movement, so it carries no exercises and can't feed a
 * strength number - but it is still a training day, so it counts toward the streak.
 */
export function mergeSources(
  hevy: DigestSession[],
  voltra: VoltraSession[],
  liftDates: string[] = []
): DigestSession[] {
  const asSessions: DigestSession[] = voltra.map((v) => ({
    date: v.date,
    source: "voltra",
    title: v.unnamed ? "Voltra — unnamed" : `Voltra — ${v.actions.join(", ")}`,
    exercises: v.unnamed
      ? []
      : v.actions.map((name) => ({
          name,
          sets: v.sets,
          top: {
            lb: v.max_force_lb ? Math.round(v.max_force_lb) : null,
            reps: v.sets > 0 ? Math.max(1, Math.round(v.reps / v.sets)) : v.reps,
            rpe: null,
            seconds: null,
          },
        })),
  }));
  const fromHevy = hevy.map((s) => ({ ...s, source: "hevy" as const }));
  // A workout started in Lift is first-hand evidence of a training day, even before
  // (or without) either sync picking it up. It carries no sets, so no strength data.
  const fromLift: DigestSession[] = liftDates.map((date) => ({
    date,
    source: "lift",
    title: "Lift workout",
    exercises: [],
  }));
  return [...fromHevy, ...asSessions, ...fromLift].sort((a, b) => (a.date < b.date ? 1 : -1));
}

const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

function isoDaysAgo(iso: string, today: string) {
  const a = Date.parse(`${iso}T12:00:00Z`);
  const b = Date.parse(`${today}T12:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** Monday-start week containing `today`. */
function weekDates(today: string): string[] {
  const d = new Date(`${today}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(d);
  monday.setUTCDate(d.getUTCDate() - dow);
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(monday);
    x.setUTCDate(monday.getUTCDate() + i);
    return x.toISOString().slice(0, 10);
  });
}

/** Epley, extended by RPE - the same formula used on the Juggernaut import. */
function e1rm(lb: number, reps: number, rpe?: number | null) {
  const rir = rpe ? Math.max(0, 10 - rpe) : 2;
  return lb * (1 + (reps + rir) / 30);
}

type DigestSession = {
  date: string;
  source?: "hevy" | "voltra" | "lift";
  title: string;
  exercises: Array<{
    name: string;
    sets: number;
    top: { lb: number | null; reps: number | null; rpe: number | null; seconds: number | null } | null;
  }>;
};

export function computeMetrics(sessions: DigestSession[], today: string, restDays: string[] = []): Metrics {
  const past = sessions.filter((s) => s.date <= today);
  const trained = new Set(past.map((s) => s.date));
  const rest = new Set(restDays);
  const days = weekDates(today);

  const week = days.map((date, i) => {
    let state: DayState;
    if (trained.has(date)) state = "done";
    else if (rest.has(date) && date <= today) state = "rest";
    else if (date === today) state = "today";
    else if (date > today) state = "future";
    else state = "miss";
    return { letter: DAY_LETTERS[i], date, state };
  });

  const daysWithin = (n: number) => [...trained].filter((d) => isoDaysAgo(d, today) < n).length;
  const lastSessionDate = [...trained].sort().at(-1) ?? null;

  // Anchor progress: first logged working set vs the most recent one.
  type Hit = { date: string; lb: number; reps: number; rpe: number | null };
  const hitsFor = (a: (typeof ANCHORS)[number]): Hit[] => {
    const hits: Hit[] = [];
    for (const s of past) {
      if ((s.source ?? "hevy") !== a.source) continue;
      for (const ex of s.exercises) {
        // No load on a weighted anchor means the load wasn't recorded, not that it
        // was zero. Scoring it as 0 lb invents a regression.
        if (!a.match.test(ex.name) || !ex.top?.reps || !ex.top.lb) continue;
        hits.push({ date: s.date, lb: ex.top.lb, reps: ex.top.reps, rpe: ex.top.rpe });
      }
    }
    return hits.sort((x, y) => (x.date < y.date ? -1 : 1));
  };
  const hitsByAnchor = ANCHORS.map(hitsFor);

  const anchors: AnchorProgress[] = ANCHORS.map((a, i) => {
    const hits = hitsByAnchor[i];
    const base = { id: a.id, name: a.name };
    if (!hits.length) return { ...base, current: null, delta: null, since: null, trend: "none" };

    const first = hits[0];
    const last = hits.at(-1)!;
    const current = `${last.lb} lb × ${last.reps}`;
    if (hits.length === 1) return { ...base, current, delta: "baseline", since: first.date, trend: "flat" };

    const d = Math.round(e1rm(last.lb, last.reps, last.rpe) - e1rm(first.lb, first.reps, first.rpe));
    return {
      ...base,
      current,
      delta: d === 0 ? "±0 lb" : `${d > 0 ? "+" : "−"}${Math.abs(d)} lb`,
      since: first.date,
      trend: d > 0 ? "up" : d < 0 ? "down" : "flat",
    };
  });

  // The index only means something once every anchor has a baseline.
  const missing = anchors.filter((a) => a.trend === "none").map((a) => a.name);
  let strengthIndex: number | null = null;
  let indexNote = `Calibrating: ${ANCHORS.length - missing.length} of ${ANCHORS.length} anchors. Still needed: ${missing.join(", ")}.`;
  if (!missing.length) {
    let base = 0;
    let now = 0;
    for (const hits of hitsByAnchor) {
      const f = hits[0];
      const l = hits.at(-1)!;
      base += e1rm(f.lb, f.reps, f.rpe);
      now += e1rm(l.lb, l.reps, l.rpe);
    }
    strengthIndex = Math.round((now / base) * 100);
    const gain = strengthIndex - 100;
    indexNote = gain === 0 ? "at calibration baseline" : `${gain > 0 ? "+" : ""}${gain} since calibration`;
  }

  // A logged rest day is a planned day off, not a miss: it comes out of the target.
  const restThisWeek = week.filter((d) => d.state === "rest").length;

  return {
    sessionsThisWeek: week.filter((d) => d.state === "done").length,
    weeklyTarget: Math.max(0, WEEKLY_TARGET - restThisWeek),
    restThisWeek,
    last7: daysWithin(7),
    last28: daysWithin(28),
    daysSinceLast: lastSessionDate ? isoDaysAgo(lastSessionDate, today) : null,
    lastSessionDate,
    week,
    anchors,
    strengthIndex,
    indexNote,
  };
}

export type { DigestSession };
