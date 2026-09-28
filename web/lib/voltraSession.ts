import { publicMessage } from "./errors";
import { parse } from "yaml";
import { readFile } from "./github";
import { createSession, updateSession, listSessions, clampLoad, type SessionPayload, type SessionItem } from "./voltra";
import { dayTitle, shortDate, voltraTitle } from "./session";
import type { BriefData, Row } from "./types";

/**
 * Build today's Beyond+ session from the brief and push it to the device.
 *
 * The flow this serves: start the workout in Lift, and when the first cable
 * exercise comes up the session is already waiting on the device with the right
 * movements and loads, named after the program day. Nothing is programmed by hand.
 *
 * Only exercises present in scripts/voltra_mapping.yaml are pushed. An unmapped
 * exercise is skipped and reported, never guessed at - the action name is what makes
 * the logged workout identifiable later, and a wrong name is worse than a gap.
 *
 * Idempotent per day: a session already created for this date is updated, not
 * duplicated, even if the chosen variant changed the day it trains.
 */

type Mapping = {
  actions: Record<string, number>;
  defaults: { workout_mode: 1 | 2 | 3 | 4; rest_sec: number; tag: 0 | 1 | 2; direction: 0 | 1 | 2 };
};

/** "3 × 8-12" -> 3 sets of 8; "ramp to 1 × 8" -> 1 set of 8. Bottom of the range. */
export function parseReps(reps: string): { sets: number; reps: number } {
  const m = /(\d+)\s*[×x]\s*(\d+)/.exec(reps);
  if (m) return { sets: Number(m[1]), reps: Number(m[2]) };
  const single = /(\d+)/.exec(reps);
  return { sets: 3, reps: single ? Number(single[1]) : 8 };
}

const PLACEHOLDER_LB = 60;

/**
 * The load to program, and whether we actually knew it.
 *
 * `load_lb` is the contract (docs/brief-schema.md). Scraping prose is a fallback for
 * briefs written before the field existed; a guessed weight is reported so it can be
 * fixed rather than silently shipped to the device.
 */
function resolveLoad(row: Row): { lb: number; guessed: boolean } {
  if (typeof row.load_lb === "number" && Number.isFinite(row.load_lb)) {
    return { lb: row.load_lb, guessed: false };
  }
  const hay = `${row.note ?? ""} ${row.station ?? ""} ${row.reps}`;
  const m = /(\d+(?:\.\d+)?)\s*lb/i.exec(hay);
  if (m) return { lb: Number(m[1]), guessed: true };
  return { lb: PLACEHOLDER_LB, guessed: true };
}

/** Library display name -> library id, across every section of exercises.yaml. */
export function libraryIds(libRaw: string | null): Map<string, string> {
  const lib = parse(libRaw ?? "") as Record<string, unknown>;
  const byName = new Map<string, string>();
  for (const items of Object.values(lib ?? {})) {
    if (!Array.isArray(items)) continue;
    for (const ex of items as Array<Record<string, string>>) {
      if (ex?.id && ex?.name) byName.set(ex.name.toLowerCase(), ex.id);
    }
  }
  return byName;
}

export type VoltraPushResult = {
  ok: boolean;
  title?: string;
  action?: "created" | "updated" | "none";
  exercises?: number;
  skipped?: string[];
  guessedLoads?: string[];
  error?: string;
};

export async function pushVoltraSession(
  brief: BriefData,
  variantKey: string,
  dayNames: Record<string, string>
): Promise<VoltraPushResult> {
  try {
    const [mapRaw, libRaw] = await Promise.all([
      readFile("scripts/voltra_mapping.yaml"),
      readFile("library/exercises.yaml"),
    ]);
    if (!mapRaw) return { ok: false, error: "voltra_mapping.yaml missing" };
    const mapping = parse(mapRaw) as Mapping;
    const byName = libraryIds(libRaw);

    const variant = brief.variants?.[variantKey];
    const items: SessionItem[] = [];
    const skipped: string[] = [];
    const guessedLoads: string[] = [];
    let position = 1;

    for (const row of variant?.rows ?? []) {
      const exId = byName.get(row.name.toLowerCase());
      const actionId = exId ? mapping.actions[exId] : undefined;
      if (!actionId) {
        // Only report Voltra-looking rows; dumbbell work is skipped by design.
        if (/voltra|cable/i.test(`${row.name} ${row.station ?? ""}`)) skipped.push(row.name);
        continue;
      }
      const { sets, reps } = parseReps(row.reps);
      const { lb, guessed } = resolveLoad(row);
      const load = clampLoad(lb);
      if (guessed) guessedLoads.push(`${row.name} @ ${load} lb`);

      items.push({
        itemGroupPosition: position++,
        workoutMode: mapping.defaults.workout_mode,
        actionId,
        actionModeConfig: {},
        itemDetails: Array.from({ length: sets }, (_, i) => ({
          position: i + 1,
          repCount: reps,
          restTime: mapping.defaults.rest_sec,
          tag: mapping.defaults.tag,
          modeConfig: { baseValue: load, direction: mapping.defaults.direction },
        })),
      });
    }

    if (!items.length) return { ok: true, action: "none", exercises: 0, skipped };

    const title = voltraTitle(dayTitle(brief, variant, dayNames), brief.date);
    const payload: SessionPayload = { title, sessionConfig: {}, blockList: [{ blockType: 1, itemList: items }] };

    // Today's session, whatever it was called when first pushed: the day can change
    // with the variant, and older sessions were titled by date alone.
    const dateSuffix = `(${shortDate(brief.date)})`;
    const legacy = brief.date.replace(/-/g, ".");
    const existing = (await listSessions()).find(
      (s) => s.title === title || s.title.endsWith(dateSuffix) || s.title === legacy
    );
    if (existing) await updateSession(existing.id, payload);
    else await createSession(payload);

    return {
      ok: true,
      title,
      action: existing ? "updated" : "created",
      exercises: items.length,
      skipped,
      // Anything here means the brief omitted load_lb - fix the brief, not the device.
      guessedLoads,
    };
  } catch (err) {
    console.error("voltra session push failed", err);
    return { ok: false, error: publicMessage(err) };
  }
}
