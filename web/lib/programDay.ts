import { parse } from "yaml";
import type { BriefData, Row } from "./types";

/**
 * Any program day, built straight from program/current.yaml.
 *
 * The brief is the coach's recommendation for today, and it stays the default. But
 * the athlete knows things the 7am brief doesn't (a strong pull day, sore shoulders,
 * pushups done yesterday that nobody logged), so every day of the rotation is also
 * available as written in the program. What these days DON'T have is the coach's
 * judgement for today: no injury swaps, no RPE caps beyond the program's own, no
 * disliked-exercise substitutions. The Today screen says so when one is picked.
 *
 * Loads come from history, the same way the brief's missing Voltra loads do
 * (lib/loadGuess.ts), so nothing here invents a number.
 */

export type ProgramBlock = {
  slot?: number;
  exercise?: string;
  superset?: string[];
  sets?: number;
  reps?: [number, number] | number;
  time_sec?: number;
  rpe?: number;
  anchor?: boolean;
  droppable?: boolean;
  note?: string;
};

export type ProgramDay = {
  id: string;
  name: string;
  type: "real" | "short";
  minutes: [number, number] | null;
  blocks: ProgramBlock[];
  note?: string;
};

export type Program = {
  meta: { version?: number; starts?: string; block?: string; block_length_weeks?: number };
  structure: { days_per_week?: number; real_days?: string[]; short_days?: string[] };
  days: ProgramDay[];
  nextTest: string | null;
};

type LibEntry = { name: string; station?: string; tolerance?: string };

/** Program days in rotation order, plus the block and testing context around them. */
export function parseProgram(raw: string | null): Program | null {
  let doc: Record<string, unknown>;
  try {
    doc = (parse(raw ?? "") ?? {}) as Record<string, unknown>;
  } catch {
    return null;
  }
  const days = Object.entries((doc.days ?? {}) as Record<string, Record<string, unknown>>)
    .filter(([id, d]) => /^[A-Z]$/.test(id) && d && typeof d === "object")
    .map(([id, d]) => {
      const minutes = Array.isArray(d.minutes) && d.minutes.length === 2 ? (d.minutes as [number, number]) : null;
      return {
        id,
        name: String(d.name ?? id),
        type: d.type === "short" ? "short" : "real",
        minutes,
        blocks: Array.isArray(d.blocks) ? (d.blocks as ProgramBlock[]) : [],
        note: typeof d.note === "string" ? d.note.trim() : undefined,
      } satisfies ProgramDay;
    })
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  if (!days.length) return null;
  const testing = (doc.testing ?? {}) as { next?: unknown };
  return {
    meta: (doc.meta ?? {}) as Program["meta"],
    structure: (doc.structure ?? {}) as Program["structure"],
    days,
    nextTest: testing.next ? String(testing.next).slice(0, 10) : null,
  };
}

/** Library id -> display name, station, tolerance, across every section. */
export function libraryEntries(raw: string | null): Map<string, LibEntry> {
  const out = new Map<string, LibEntry>();
  let doc: Record<string, unknown>;
  try {
    doc = (parse(raw ?? "") ?? {}) as Record<string, unknown>;
  } catch {
    return out;
  }
  for (const items of Object.values(doc)) {
    if (!Array.isArray(items)) continue;
    for (const ex of items as Array<Record<string, unknown>>) {
      if (!ex?.id) continue;
      out.set(String(ex.id), {
        name: String(ex.name ?? ex.id),
        station: ex.station ? String(ex.station) : undefined,
        tolerance: ex.tolerance ? String(ex.tolerance) : undefined,
      });
    }
  }
  return out;
}

const STATION_WORDS: Record<string, string> = { nuobell: "NUOBELL", abx: "ABX", db: "DB", kb: "KB" };

/** "voltra_pullup_bar" -> "Voltra pullup bar", in the brief's voice. */
export function stationLabel(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const words = id.split("_").map((w) => STATION_WORDS[w] ?? w);
  const first = words[0] ?? "";
  return [first === first.toLowerCase() ? first[0].toUpperCase() + first.slice(1) : first, ...words.slice(1)].join(" ");
}

/** "Day B — Pull": the same title the Hevy routines use. */
export const programDayTitle = (day: Pick<ProgramDay, "id" | "name">) => `Day ${day.id} — ${day.name}`;

function repsText(b: ProgramBlock): string {
  const sets = b.sets ?? 3;
  if (b.time_sec) return `${sets} × ${b.time_sec}s`;
  if (Array.isArray(b.reps))
    return b.reps[0] === b.reps[1] ? `${sets} × ${b.reps[0]}` : `${sets} × ${b.reps[0]}-${b.reps[1]}`;
  if (typeof b.reps === "number") return `${sets} × ${b.reps}`;
  return `${sets} sets`;
}

/** One row per exercise, supersets lettered A, B, C in program order. */
export function programRows(day: ProgramDay, library: Map<string, LibEntry>): Row[] {
  const rows: Row[] = [];
  let letter = 0;
  for (const b of day.blocks) {
    const ids = b.superset?.length ? b.superset : b.exercise ? [b.exercise] : [];
    const ss = ids.length > 1 ? String.fromCharCode(65 + letter++) : null;
    for (const id of ids) {
      const lib = library.get(id);
      // Never program what the athlete has ruled out, even off-plan.
      if (lib?.tolerance === "forbidden") continue;
      const notes = [
        b.anchor ? "anchor" : "",
        b.droppable ? "drop it if short on time" : "",
        lib?.tolerance === "disliked" ? "you rated this disliked: swap it if you like" : "",
        b.note ?? "",
      ].filter(Boolean);
      rows.push({
        superset: ss,
        name: lib?.name ?? id,
        station: stationLabel(lib?.station),
        reps: repsText(b),
        rpe: b.rpe ?? null,
        ...(notes.length ? { note: notes.join(" · ") } : {}),
      });
    }
  }
  return rows;
}

/** A program day in the brief's own shape, so Today, Hevy and Beyond+ handle it unchanged. */
export function programBrief(day: ProgramDay, library: Map<string, LibEntry>, date: string): BriefData {
  const duration = day.minutes ? `${day.minutes[0]}-${day.minutes[1]} min` : "";
  return {
    date,
    day: day.id,
    day_name: day.name,
    day_type: day.type,
    headline: "Straight from the program: the coach's adjustments for today aren't in it.",
    variants: {
      full: {
        label: "As planned",
        meta: "as the program writes it",
        duration,
        hevy_routine: programDayTitle(day),
        note: day.note ? { kind: "accent", text: day.note.replace(/\s+/g, " ") } : null,
        rows: programRows(day, library),
      },
    },
  };
}

/** Every program day, keyed by letter. */
export function programBriefs(programRaw: string | null, libraryRaw: string | null, date: string) {
  const program = parseProgram(programRaw);
  const library = libraryEntries(libraryRaw);
  const out: Record<string, BriefData> = {};
  for (const day of program?.days ?? []) out[day.id] = programBrief(day, library, date);
  return out;
}
