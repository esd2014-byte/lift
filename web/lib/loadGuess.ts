import { parse } from "yaml";
import { readMany } from "./github";
import { hevyTitles } from "./hevyRoutine";
import { libraryIds, lookupId } from "./voltraSession";
import type { BriefData, Row } from "./types";
import type { DigestSession, VoltraSession } from "./metrics";

/**
 * A starting weight for Voltra rows the brief left without `load_lb`.
 *
 * The device needs a number, and a made-up one is worse than a reasoned one. So a
 * missing load is estimated from what's actually been lifted, and the row is marked
 * as a calibration row: the weight is a first guess to adjust on the first set, and
 * the rep range and RPE are the real target.
 *
 * Where the guess comes from, best first:
 *   1. history   - the last time this exercise was done: on the Voltra itself (its
 *                  average cable force is the weight that was set) or logged in
 *                  Hevy, whichever is newer. Adjusted to today's reps and RPE.
 *   2. related   - a related lift's last logged weight, scaled by the ratio in
 *                  scripts/voltra_mapping.yaml `estimate_from`.
 *   3. note      - a number in the coach's note.
 *   4. none      - a deliberately light start.
 * Every estimate rounds DOWN to 5 lb: a calibration set that's too light costs a set;
 * one that's too heavy costs a shoulder.
 */

export type Calibration = {
  /** The guessed starting weight, in lb. Also written to the row's load_lb. */
  lb: number;
  source: "history" | "related" | "note" | "none";
  /** Where the number came from, in words. */
  basis: string;
  /** The target: rep range and RPE, as the brief wrote them. */
  reps: string;
  rpe: number;
};

export type GuessInputs = {
  /** Library display name -> library id. */
  libraryIds: Map<string, string>;
  /** Library id -> Voltra actionId; only these rows go to the device. */
  voltraActions: Record<string, number>;
  /** Library id -> { lift: library id, ratio }. */
  estimateFrom: Record<string, { lift: string; ratio: number }>;
  /** Library id -> Hevy exercise title. */
  hevyTitles: Map<string, string>;
  /** Hevy history, any order. */
  sessions: DigestSession[];
  /** Voltra history, any order. */
  voltraSessions: VoltraSession[];
};

const DEFAULT_RPE = 8;
const LIGHT_START_LB = 30;

/** "3 × 8-12" -> { lo: 8, hi: 12 }; "4 × 6" -> { lo: 6, hi: 6 }. */
export function repRange(reps: string): { lo: number; hi: number } {
  const range = /[×x]\s*(\d+)\s*[-–]\s*(\d+)/.exec(reps);
  if (range) return { lo: Number(range[1]), hi: Number(range[2]) };
  const single = /[×x]\s*(\d+)/.exec(reps) ?? /(\d+)/.exec(reps);
  const n = single ? Number(single[1]) : 8;
  return { lo: n, hi: n };
}

/** Rounded down to a 5 lb step, within what the Voltra can load (5-230). */
export function floor5(lb: number) {
  return Math.max(5, Math.min(230, Math.floor(lb / 5) * 5));
}

/**
 * The weight for `reps` reps with `rir` reps left in the tank, from a set of
 * `w` x `r` (Epley). Aims at the TOP of the range, so the guess starts light.
 */
export function carryOver(w: number, r: number, reps: number, rir: number) {
  const e1rm = w * (1 + r / 30);
  return e1rm / (1 + (reps + rir) / 30);
}

/** The most recent logged set with a weight, for one Hevy exercise title. */
export function lastLogged(sessions: DigestSession[], title: string | undefined) {
  if (!title) return null;
  const want = title.toLowerCase();
  const newest = [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const s of newest) {
    for (const e of s.exercises ?? []) {
      const lb = e.top?.lb;
      const reps = e.top?.reps;
      if (e.name?.toLowerCase() === want && typeof lb === "number" && lb > 0 && typeof reps === "number" && reps > 0) {
        return { lb, reps, date: s.date, title };
      }
    }
  }
  return null;
}

/**
 * The most recent Voltra session of just this movement. A session holding several
 * movements can't say which force belonged to which, so it doesn't count.
 */
export function lastOnVoltra(sessions: VoltraSession[], actionId: number, name: string) {
  const newest = [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1));
  for (const s of newest) {
    const ids = s.action_ids ?? [];
    if (s.unnamed || ids.length !== 1 || ids[0] !== actionId) continue;
    if (!s.avg_force_lb || !s.sets || !s.reps) continue;
    return { lb: Math.round(s.avg_force_lb), reps: Math.max(1, Math.round(s.reps / s.sets)), date: s.date, title: `${name} on the Voltra` };
  }
  return null;
}

function rpeOf(row: Row): number {
  const n = typeof row.rpe === "number" ? row.rpe : Number.parseFloat(String(row.rpe ?? ""));
  return Number.isFinite(n) && n >= 5 && n <= 10 ? n : DEFAULT_RPE;
}

/** The calibration for one row, or null if it has a load or isn't a Voltra row. */
export function guessRow(row: Row, input: GuessInputs): Calibration | null {
  if (typeof row.load_lb === "number" && Number.isFinite(row.load_lb)) return null;
  const id = lookupId(input.libraryIds, row.name);
  if (!id || !input.voltraActions[id]) return null;

  const rpe = rpeOf(row);
  const rir = 10 - rpe;
  const { hi } = repRange(row.reps);
  const base = { reps: row.reps, rpe };

  const hevy = lastLogged(input.sessions, input.hevyTitles.get(id));
  const voltra = lastOnVoltra(input.voltraSessions, input.voltraActions[id], row.name);
  const own = hevy && voltra ? (voltra.date >= hevy.date ? voltra : hevy) : (hevy ?? voltra);
  if (own) {
    return {
      ...base,
      lb: floor5(carryOver(own.lb, own.reps, hi, rir)),
      source: "history",
      basis: `your last ${own.title}: ${own.lb} lb × ${own.reps} on ${own.date}`,
    };
  }

  const rel = input.estimateFrom[id];
  if (rel && rel.ratio > 0) {
    const theirs = lastLogged(input.sessions, input.hevyTitles.get(rel.lift));
    if (theirs) {
      return {
        ...base,
        lb: floor5(carryOver(theirs.lb, theirs.reps, hi, rir) * rel.ratio),
        source: "related",
        basis: `no history for this one; ${Math.round(rel.ratio * 100)}% of your ${theirs.title} (${theirs.lb} lb × ${theirs.reps} on ${theirs.date})`,
      };
    }
  }

  const noted = /(\d+(?:\.\d+)?)\s*lb/i.exec(row.note ?? "");
  if (noted) {
    return { ...base, lb: floor5(Number(noted[1])), source: "note", basis: "no history; the number in the coach's note" };
  }
  return { ...base, lb: LIGHT_START_LB, source: "none", basis: "no history for this or a related lift; a light start" };
}

/** The brief with every Voltra row given a load: its own, or a calibration guess. */
export function fillLoads(brief: BriefData, input: GuessInputs): BriefData {
  const variants: BriefData["variants"] = {};
  for (const [key, v] of Object.entries(brief.variants ?? {})) {
    variants[key] = {
      ...v,
      rows: v.rows.map((row) => {
        const calibration = guessRow(row, input);
        return calibration ? { ...row, load_lb: calibration.lb, calibration } : row;
      }),
    };
  }
  return { ...brief, variants };
}

export const GUESS_PATHS = [
  "library/exercises.yaml",
  "scripts/voltra_mapping.yaml",
  "scripts/hevy_mapping.yaml",
  "logs/hevy/recent.json",
  "logs/voltra/recent.json",
] as const;

/** Guess inputs from the data repo files in GUESS_PATHS. */
export function guessInputs(files: Record<string, string | null | undefined>): GuessInputs {
  const mapping = (parse(files["scripts/voltra_mapping.yaml"] ?? "") ?? {}) as {
    actions?: Record<string, number>;
    estimate_from?: Record<string, { lift: string; ratio: number }>;
  };
  // No history reads as no history: every guess falls through to the later tiers.
  const history = <T,>(path: string): T[] => {
    try {
      return (JSON.parse(files[path] ?? "{}") as { sessions?: T[] }).sessions ?? [];
    } catch {
      return [];
    }
  };
  return {
    libraryIds: libraryIds(files["library/exercises.yaml"] ?? null),
    voltraActions: mapping.actions ?? {},
    estimateFrom: mapping.estimate_from ?? {},
    hevyTitles: hevyTitles(files["scripts/hevy_mapping.yaml"] ?? null),
    sessions: history<DigestSession>("logs/hevy/recent.json"),
    voltraSessions: history<VoltraSession>("logs/voltra/recent.json"),
  };
}

/** For routes that read the brief themselves: one extra batched read. */
export async function withGuessedLoads(brief: BriefData): Promise<BriefData> {
  const { files } = await readMany([...GUESS_PATHS], []);
  return fillLoads(brief, guessInputs(files));
}
