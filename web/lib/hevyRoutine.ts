import { publicMessage } from "./errors";
import { parse } from "yaml";
import { readFile, writeFile } from "./store";
import {
  createExerciseTemplate,
  createRoutine,
  listExerciseTemplates,
  listRoutines,
  updateRoutine,
  type ExerciseTemplate,
  type Routine,
  type RoutineExercise,
} from "./hevy";
import { parseReps, libraryIds, lookupId } from "./voltraSession";
import { dayTitle, hevyTitle, isVoltraRow, voltraTitle, variantName } from "./session";
import type { BriefData, Row } from "./types";

/**
 * Today's Hevy routine: the variant you actually chose, with today's target weights.
 *
 * Hevy has no public link that opens a specific routine in the app, so "open the
 * right workout" becomes "make the right workout the obvious one": a single routine
 * titled "Today: …", rewritten every time a workout is started. The program's
 * per-day routines stay as they are.
 *
 * Voltra rows are left out on purpose. They're logged on the device, which records
 * force and velocity per rep; the routine's notes point there instead.
 */

const LB_PER_KG = 2.20462;
const STATE_PATH = "logs/hevy/today-routine.json";
/** Hevy template ids found outside the account's routines: title (lowercased) -> id. */
const TEMPLATES_PATH = "logs/hevy/templates.json";

type CustomSpec = { title: string; muscle_group: string; equipment_category: string };
type HevyMapping = {
  stock?: Record<string, string>;
  custom?: Record<string, CustomSpec>;
};

function cachedTemplates(raw: string | null): Record<string, string> {
  try {
    const v = JSON.parse(raw ?? "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export type TemplateApi = {
  list: () => Promise<ExerciseTemplate[]>;
  create: (spec: CustomSpec) => Promise<void>;
};

/**
 * Template ids for titles no routine in the account uses yet: a lift that isn't in
 * the program's per-day routines (a travel-only kettlebell lift, a new ABX exercise).
 * Looks in the full catalogue, creates a missing `custom:` exercise from the mapping,
 * and returns only what it newly found, for the cache. Runs only when something is
 * missing, so an ordinary push costs no extra calls.
 */
export async function resolveMissingTemplates(
  needed: string[],
  known: Map<string, string>,
  mappingRaw: string | null,
  api: TemplateApi
): Promise<Record<string, string>> {
  const missing = [...new Set(needed.map((t) => t.toLowerCase()))].filter((t) => !known.has(t));
  if (!missing.length) return {};
  const found: Record<string, string> = {};
  const take = (catalogue: ExerciseTemplate[]) => {
    for (const t of catalogue) {
      const k = t.title?.toLowerCase();
      if (k && missing.includes(k) && !found[k]) found[k] = t.id;
    }
  };
  take(await api.list());

  const custom = Object.values(((parse(mappingRaw ?? "") ?? {}) as HevyMapping).custom ?? {});
  const toCreate = custom.filter(
    (c) => c?.title && missing.includes(c.title.toLowerCase()) && !found[c.title.toLowerCase()]
  );
  if (toCreate.length) {
    for (const spec of toCreate) await api.create(spec);
    // Creating doesn't reliably return the id; read the catalogue again, as the sync script does.
    take(await api.list());
  }
  return found;
}

/** Library id -> the Hevy exercise title it's logged under. */
export function hevyTitles(mappingRaw: string | null): Map<string, string> {
  const m = (parse(mappingRaw ?? "") ?? {}) as HevyMapping;
  const out = new Map<string, string>();
  for (const [id, title] of Object.entries(m.stock ?? {})) out.set(id, title);
  for (const [id, spec] of Object.entries(m.custom ?? {})) if (spec?.title) out.set(id, spec.title);
  return out;
}

/**
 * Coaching notes without internal ids. "[nuobell]" and "[small_db]" meant something
 * to the program generator and nothing to a person holding a dumbbell.
 */
export function cleanNote(text: string | undefined): string {
  return (text ?? "")
    .split(/\s+—\s+/)
    .map((part) =>
      part
        .replace(/\[[a-z0-9_]+\]/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim()
    )
    .filter(Boolean)
    .join(" — ");
}

function exerciseNote(row: Row): string {
  const parts: string[] = [];
  if (row.rpe !== undefined && row.rpe !== null && row.rpe !== "") parts.push(`RPE ${row.rpe}`);
  parts.push(row.reps);
  if (row.calibration) parts.push(`CALIBRATION: ${row.load_lb} lb is a guess, adjust after set 1`);
  else if (typeof row.load_lb === "number") parts.push(`target ${row.load_lb} lb`);
  const note = cleanNote(row.note);
  if (note) parts.push(note);
  return parts.join(" · ");
}

export type BuildInput = {
  rows: Row[];
  /** Library display name (lowercased) -> library id. */
  libraryIds: Map<string, string>;
  /** Library id -> Hevy exercise title. */
  hevyTitles: Map<string, string>;
  /** Hevy exercise title -> template id, learned from the account's routines. */
  templateIds: Map<string, string>;
  /** Warm-up entries to lead with, copied from the program's routine for the day. */
  warmup: RoutineExercise[];
};

/** Pure: brief rows in, Hevy exercises out, plus what couldn't be mapped. */
export function buildExercises(input: BuildInput): { exercises: RoutineExercise[]; skipped: string[]; voltra: number } {
  const exercises: RoutineExercise[] = [...input.warmup];
  const skipped: string[] = [];
  let voltra = 0;

  // Superset letters -> Hevy superset ids, only for letters that keep 2+ exercises
  // once Voltra rows are removed. A lone exercise carrying a superset id renders as
  // a broken pair in Hevy.
  const iron = input.rows.filter((r) => {
    if (isVoltraRow(r)) {
      voltra++;
      return false;
    }
    return true;
  });
  const counts = new Map<string, number>();
  for (const r of iron) if (r.superset) counts.set(r.superset, (counts.get(r.superset) ?? 0) + 1);
  const ssIds = new Map<string, number>();
  for (const [letter, n] of counts) if (n > 1) ssIds.set(letter, ssIds.size);

  for (const row of iron) {
    const libId = lookupId(input.libraryIds, row.name);
    const title = libId ? input.hevyTitles.get(libId) : undefined;
    const templateId = title ? input.templateIds.get(title.toLowerCase()) : undefined;
    if (!templateId) {
      skipped.push(row.name);
      continue;
    }

    const { sets, reps } = parseReps(row.reps);
    const seconds = /(\d+)\s*(s|sec|secs|seconds)\b/i.exec(row.reps);
    const weightKg =
      typeof row.load_lb === "number" && row.load_lb > 0 ? Math.round((row.load_lb / LB_PER_KG) * 10) / 10 : null;

    exercises.push({
      exercise_template_id: templateId,
      superset_id: row.superset ? (ssIds.get(row.superset) ?? null) : null,
      notes: exerciseNote(row),
      sets: Array.from({ length: sets }, () =>
        seconds
          ? { type: "normal" as const, weight_kg: weightKg, reps: null, duration_seconds: Number(seconds[1]) }
          : { type: "normal" as const, weight_kg: weightKg, reps }
      ),
    });
  }
  return { exercises, skipped, voltra };
}

/** Hevy's GET returns fields its PUT rejects. Keep only what PUT accepts. */
function forWrite(e: Routine["exercises"][number]): RoutineExercise {
  return {
    exercise_template_id: e.exercise_template_id,
    superset_id: e.superset_id ?? null,
    notes: e.notes ?? "",
    sets: (e.sets ?? []).map((s) => ({
      type: s.type === "warmup" ? "warmup" : "normal",
      weight_kg: s.weight_kg ?? null,
      reps: s.reps ?? null,
      ...(s.duration_seconds != null ? { duration_seconds: s.duration_seconds } : {}),
    })),
  };
}

export type HevyPushResult = {
  ok: boolean;
  title?: string;
  action?: "created" | "updated" | "none";
  exercises?: number;
  skipped?: string[];
  error?: string;
};

export async function pushHevyRoutine(
  brief: BriefData,
  variantKey: string,
  dayNames: Record<string, string>
): Promise<HevyPushResult> {
  try {
    const variant = brief.variants?.[variantKey];
    if (!variant) return { ok: false, error: `no variant ${variantKey}` };

    const [libRaw, mappingRaw, stateRaw, templatesRaw, routines] = await Promise.all([
      readFile("library/exercises.yaml"),
      readFile("scripts/hevy_mapping.yaml"),
      readFile(STATE_PATH),
      readFile(TEMPLATES_PATH),
      listRoutines(),
    ]);

    const day = dayTitle(brief, variant, dayNames);
    const title = hevyTitle(day, variantKey, variant);
    const state = stateRaw ? (JSON.parse(stateRaw) as { id?: string }) : {};

    // Template ids come from the routines already in the account (the program's
    // per-day routines use most exercises the program calls for), then from the cache
    // of ones found before, and only then from the catalogue.
    const templateIds = new Map<string, string>(Object.entries(cachedTemplates(templatesRaw)));
    for (const r of routines) {
      if (r.id === state.id) continue;
      for (const e of r.exercises ?? []) {
        if (e.title && e.exercise_template_id) templateIds.set(e.title.toLowerCase(), e.exercise_template_id);
      }
    }

    // Lifts no routine uses yet: find (or create) them once, and remember the ids.
    const ids = libraryIds(libRaw);
    const titles = hevyTitles(mappingRaw);
    const needed = variant.rows
      .filter((r) => !isVoltraRow(r))
      .map((r) => titles.get(lookupId(ids, r.name) ?? ""))
      .filter((t): t is string => Boolean(t));
    try {
      const found = await resolveMissingTemplates(needed, templateIds, mappingRaw, {
        list: () => listExerciseTemplates(),
        create: (spec) => createExerciseTemplate(spec),
      });
      if (Object.keys(found).length) {
        for (const [t, id] of Object.entries(found)) templateIds.set(t, id);
        await writeFile(
          TEMPLATES_PATH,
          JSON.stringify({ ...cachedTemplates(templatesRaw), ...found }, null, 2) + "\n",
          `Hevy: remember ${Object.keys(found).length} exercise template id(s)`
        );
      }
    } catch (err) {
      // A missing lift is skipped and reported, as before; it never blocks the push.
      console.warn("hevy template lookup failed", err);
    }

    // Keep the day's warm-up: the program routine leads with it, the brief doesn't list it.
    const source = routines.find((r) => r.title === day);
    const warmup = (source?.exercises ?? []).filter((e) => /^\s*warm-?up/i.test(e.notes ?? "")).map(forWrite);

    const { exercises, skipped, voltra } = buildExercises({
      rows: variant.rows,
      libraryIds: ids,
      hevyTitles: titles,
      templateIds,
      warmup,
    });
    if (!exercises.length) return { ok: true, action: "none", exercises: 0, skipped };

    const notes = [
      `${variantName(variantKey)} · ${variant.duration} · written by Lift`,
      voltra
        ? `${voltra} cable exercise${voltra === 1 ? " is" : "s are"} on the Voltra: Beyond+ session "${voltraTitle(brief.date)}". Full running order is in Lift.`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
    const routine = { title, notes, exercises };

    let action: "created" | "updated" = "updated";
    let id = state.id;
    if (id && routines.some((r) => r.id === id)) {
      await updateRoutine(id, routine);
    } else {
      // First run, or the routine was deleted in Hevy: make a new one.
      id = (await createRoutine(routine)).id;
      action = "created";
    }
    if (id !== state.id) {
      await writeFile(STATE_PATH, JSON.stringify({ id }, null, 2) + "\n", "Hevy: track today's routine");
    }

    return { ok: true, title, action, exercises: exercises.length, skipped };
  } catch (err) {
    console.error("hevy routine push failed", err);
    return { ok: false, error: publicMessage(err) };
  }
}
