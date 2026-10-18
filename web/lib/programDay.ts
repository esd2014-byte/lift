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

type LibEntry = { name: string; station?: string; tolerance?: string; status?: string; location?: string };

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
        status: ex.status ? String(ex.status) : undefined,
        location: ex.location ? String(ex.location) : undefined,
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

type RowOpts = {
  anchorExtraSets?: number;
  sets?: number;
  unavailable?: Set<string>;
  /** Away from home: `location: travel_only` lifts are allowed. */
  away?: boolean;
};

/** One row per exercise, supersets lettered A, B, C in program order. */
export function programRows(blocks: ProgramBlock[], library: Map<string, LibEntry>, opts: RowOpts = {}): Row[] {
  return programItems(blocks, library, opts).map((x) => x.row);
}

/** The same rows, each with the library id it came from. */
function programItems(blocks: ProgramBlock[], library: Map<string, LibEntry>, opts: RowOpts = {}) {
  const rows: Array<{ id: string; row: Row }> = [];
  let letter = 0;
  for (const b0 of blocks) {
    const sets = opts.sets ?? (b0.sets ?? 3) + (b0.anchor ? (opts.anchorExtraSets ?? 0) : 0);
    const b = { ...b0, sets };
    const ids = b.superset?.length ? b.superset : b.exercise ? [b.exercise] : [];
    const ss = ids.length > 1 ? String.fromCharCode(65 + letter++) : null;
    for (const id of ids) {
      const lib = library.get(id);
      // Never program what the athlete has ruled out, even off-plan.
      // Never program what the athlete has taken out of rotation, or what the gym can't do.
      if (lib?.tolerance === "forbidden" || lib?.status === "inactive" || lib?.status === "retired") continue;
      if (lib?.station && opts.unavailable?.has(lib.station)) continue;
      // The basement can't take an overhead lockout (84 in ceiling).
      if (lib?.location === "travel_only" && !opts.away) continue;
      const notes = [
        b.anchor ? "anchor" : "",
        b.droppable ? "drop it if short on time" : "",
        lib?.tolerance === "disliked" ? "you rated this disliked: swap it if you like" : "",
        b.note ?? "",
      ].filter(Boolean);
      rows.push({
        id,
        row: {
          superset: ss,
          name: lib?.name ?? id,
          station: stationLabel(lib?.station),
          reps: repsText(b),
          rpe: b.rpe ?? null,
          ...(notes.length ? { note: notes.join(" · ") } : {}),
        },
      });
    }
  }
  return rows;
}

/** The kind of hotel gym a Traveling session is converted for. */
export type HotelGym = "machines_cardio" | "full_gym" | "db_only" | "bodyweight";
export const HOTEL_GYMS: Record<HotelGym, string> = {
  machines_cardio: "Machines + cardio",
  full_gym: "Full gym",
  db_only: "Dumbbells only",
  bodyweight: "Bodyweight only",
};

/** What a hotel gym has: its kind, its heaviest dumbbell, and whether it has kettlebells. */
export type Hotel = { type: HotelGym; db_max_lb: number | null; kettlebells: boolean };
/** Until a trip says otherwise: the most common hotel gym. */
export const DEFAULT_HOTEL: Hotel = { type: "machines_cardio", db_max_lb: null, kettlebells: false };

/** program/travel.yaml: library id -> { hotel gym type -> substitute }. */
export function parseTravel(raw: string | null): Record<string, Partial<Record<HotelGym, string>>> {
  try {
    const doc = (parse(raw ?? "") ?? {}) as { substitution_map?: Record<string, Partial<Record<HotelGym, string>>> };
    return doc.substitution_map ?? {};
  } catch {
    return {};
  }
}

const HOTEL_HINT: Record<HotelGym, string> = {
  machines_cardio: "the nearest machine or cable station",
  full_gym: "the barbell or cable version",
  db_only: "a dumbbell version",
  bodyweight: "a bodyweight or band version",
};

/**
 * A program day converted for a hotel gym. Lifts with a mapped substitute take it;
 * other Voltra lifts become the plain movement, done on whatever the hotel has;
 * dumbbell and kettlebell lifts say what to do when the hotel can't match them. No
 * loads: different equipment, so the first set finds the weight.
 */
export function travelRows(
  day: ProgramDay,
  library: Map<string, LibEntry>,
  travel: Record<string, Partial<Record<HotelGym, string>>>,
  hotel: Hotel = DEFAULT_HOTEL
): Row[] {
  return programItems(day.blocks, library, { away: true }).map(({ id, row: r }) => {
    const station = library.get(id)?.station ?? "";
    const sub = travel[id]?.[hotel.type];
    const voltra = /voltra/i.test(`${r.name} ${station}`);
    const dumbbell = station === "nuobell" || station === "small_db";
    const hints = [
      dumbbell && hotel.type === "bodyweight" ? `no dumbbells: use ${HOTEL_HINT.bodyweight}` : "",
      dumbbell && hotel.db_max_lb && hotel.type !== "bodyweight" ? `hotel dumbbells go to ${hotel.db_max_lb} lb` : "",
      station === "kettlebell" && !hotel.kettlebells ? "no kettlebells: use a dumbbell" : "",
    ].filter(Boolean);
    if (!sub && !voltra) {
      return {
        ...r,
        load_lb: undefined,
        ...(hints.length ? { note: [...hints, r.note].filter(Boolean).join(" · ") } : {}),
      };
    }
    const name = sub
      ? sub.replace(/\s*-\s*PREFERRED.*$/i, "").replace(/^./, (c) => c.toUpperCase())
      : r.name.replace(/^Voltra\s+/i, "");
    return {
      ...r,
      name,
      station: "Hotel gym",
      load_lb: undefined,
      note: [sub ? `in place of ${r.name}` : `use ${HOTEL_HINT[hotel.type]}`, r.note].filter(Boolean).join(" · "),
    };
  });
}

/**
 * A program day in the brief's own shape, with every variant built by rule, so
 * Today, Hevy and Beyond+ handle it unchanged. Used for the short days, and for any
 * day the coach didn't write out:
 *   As planned  the program as written
 *   Beast mode  +1 set on the anchors, everything kept, plus a short day's opener
 *   Quick       the first block, 3 sets
 *   Traveling   converted for a hotel gym (program/travel.yaml)
 */
export function programBrief(
  day: ProgramDay,
  library: Map<string, LibEntry>,
  date: string,
  extra: {
    program?: Program | null;
    travel?: Record<string, Partial<Record<HotelGym, string>>>;
    hotel?: Hotel;
    /** Home stations the gym can't serve right now (lib/gym.ts missingStations). */
    unavailable?: Set<string>;
  } = {}
): BriefData {
  const duration = day.minutes ? `${day.minutes[0]}-${day.minutes[1]} min` : "";
  const routine = programDayTitle(day);
  const finisherDay = extra.program?.days.find((d) => d.type === "short" && d.id !== day.id && d.blocks.length);
  const beastRows = [
    ...programRows(day.blocks, library, { anchorExtraSets: 1, unavailable: extra.unavailable }),
    ...(day.type === "real" && finisherDay
      ? programRows(finisherDay.blocks.slice(0, 1), library, { unavailable: extra.unavailable }).map((r) => ({
          ...r,
          superset: r.superset ? "Z" : null,
          note: [`finisher from Day ${finisherDay.id}`, r.note].filter(Boolean).join(" · "),
        }))
      : []),
  ];
  const quickRows = programRows(day.blocks.slice(0, 1), library, { sets: 3, unavailable: extra.unavailable });
  const longer = day.minutes ? `${day.minutes[1]}-${day.minutes[1] + 15} min` : "";
  return {
    date,
    day: day.id,
    day_name: day.name,
    day_type: day.type,
    source: "program",
    headline: "Straight from the program: the coach's adjustments for today aren't in it.",
    variants: {
      full: {
        label: "As planned",
        meta: "as the program writes it",
        duration,
        hevy_routine: routine,
        note: day.note ? { kind: "accent", text: day.note.replace(/\s+/g, " ") } : null,
        rows: programRows(day.blocks, library, { unavailable: extra.unavailable }),
      },
      beast: {
        label: "Beast mode",
        meta:
          finisherDay && day.type === "real"
            ? `+1 set on anchors, Day ${finisherDay.id} opener to finish`
            : "+1 set on anchors",
        duration: longer,
        hevy_routine: routine,
        note: null,
        rows: beastRows,
      },
      minimum: {
        label: "Quick",
        meta: "the first block, 3 sets",
        duration: "15 min",
        hevy_routine: routine,
        note: null,
        rows: quickRows,
      },
      travel: {
        label: "Traveling",
        meta: `converted for ${extra.hotel ? HOTEL_GYMS[extra.hotel.type].toLowerCase() : "a hotel gym"}`,
        duration,
        hevy_routine: routine,
        note: null,
        rows: travelRows(day, library, extra.travel ?? {}, extra.hotel),
      },
    },
  };
}

/** The coach's alternate for a day, in the brief's shape, tagged as the coach's. */
function coachBrief(brief: BriefData, id: string, day: ProgramDay | undefined): BriefData | null {
  const alt = brief.alternates?.[id];
  if (!alt || !Object.keys(alt.variants).length) return null;
  const routine = day ? programDayTitle(day) : `Day ${id}`;
  const variants = Object.fromEntries(
    Object.entries(alt.variants).map(([k, v]) => [k, { ...v, hevy_routine: v.hevy_routine ?? routine }])
  );
  return {
    date: brief.date,
    day: id,
    day_name: alt.day_name || day?.name || `Day ${id}`,
    day_type: alt.day_type ?? day?.type ?? "real",
    source: "coach",
    ...(alt.headline ? { headline: alt.headline } : {}),
    variants,
  };
}

/**
 * Every program day as a full set of variants: the coach's alternate when the brief
 * wrote one (the full days), otherwise built by rule from the program.
 */
export function programBriefs(
  programRaw: string | null,
  libraryRaw: string | null,
  date: string,
  {
    brief = null,
    travelRaw = null,
    unavailable,
    hotel,
  }: { brief?: BriefData | null; travelRaw?: string | null; unavailable?: Set<string>; hotel?: Hotel } = {}
) {
  const program = parseProgram(programRaw);
  const library = libraryEntries(libraryRaw);
  const travel = parseTravel(travelRaw);
  const out: Record<string, BriefData> = {};
  for (const day of program?.days ?? []) {
    out[day.id] =
      (brief && coachBrief(brief, day.id, day)) ??
      programBrief(day, library, date, { program, travel, unavailable, hotel });
  }
  return out;
}
