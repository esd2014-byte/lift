import { publicMessage } from "./errors";
import { parse } from "yaml";
import { readFile } from "./github";
import { createSession, updateSession, listSessions, clampLoad, type SessionPayload, type SessionItem } from "./voltra";
import { voltraTitle } from "./session";
import type { BriefData, Row } from "./types";

/**
 * Build today's Beyond+ session from the brief and push it to the device.
 *
 * The flow this serves: start the workout in Lift, and when the first cable
 * exercise comes up the session is already waiting on the device with the right
 * movements and loads, titled with the date ("2026.09.28"). Nothing is programmed
 * by hand.
 *
 * Only exercises present in scripts/voltra_mapping.yaml are pushed. An unmapped
 * exercise is skipped and reported, never guessed at - the action name is what makes
 * the logged workout identifiable later, and a wrong name is worse than a gap.
 *
 * Idempotent per day: a session already created for this date is updated, not
 * duplicated, even if the chosen variant changed.
 */

type Mapping = {
  actions: Record<string, number>;
  /** Library ids of one-arm movements. The device rejects these as bilateral. */
  unilateral?: string[];
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

const ABBREVIATIONS: Record<string, string> = {
  ohp: "overhead press",
  db: "dumbbell",
  dbs: "dumbbell",
  rdl: "romanian deadlift",
  ext: "extension",
  kb: "kettlebell",
};

/**
 * A name reduced to what identifies the movement. The brief writes "NUOBELL Seated
 * OHP" where the library says "NUOBELL Seated Overhead Press"; both become
 * "nuobell seated overhead press".
 */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((w) => ABBREVIATIONS[w] ?? w)
    .join(" ");
}

/** Library id for a brief row's name: exact first, then abbreviation-insensitive. */
export function lookupId(ids: Map<string, string>, name: string): string | undefined {
  return ids.get(name.toLowerCase()) ?? ids.get(normalizeName(name));
}

/** Library display name -> library id, across every section of exercises.yaml. */
export function libraryIds(libRaw: string | null): Map<string, string> {
  const lib = parse(libRaw ?? "") as Record<string, unknown>;
  const byName = new Map<string, string>();
  for (const items of Object.values(lib ?? {})) {
    if (!Array.isArray(items)) continue;
    for (const ex of items as Array<Record<string, string>>) {
      if (!ex?.id || !ex?.name) continue;
      byName.set(ex.name.toLowerCase(), ex.id);
      byName.set(normalizeName(ex.name), ex.id);
    }
  }
  return byName;
}

export type VoltraPushResult = {
  ok: boolean;
  title?: string;
  action?: "created" | "updated" | "kept" | "none";
  exercises?: number;
  skipped?: string[];
  guessedLoads?: string[];
  /** Something worth knowing that didn't stop the push. */
  note?: string;
  error?: string;
};

/** The create request around a list of items. Pure, so the contract is testable. */
export function sessionPayload(title: string, items: SessionItem[]): SessionPayload {
  return {
    title,
    sessionConfig: {},
    blockList: [{ blockType: 1, itemList: items }],
    originSessionId: null,
    accountRole: 0,
    connectionMode: 0,
    label: 0,
  };
}

export async function pushVoltraSession(
  brief: BriefData,
  variantKey: string
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
      const exId = lookupId(byName, row.name);
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

      const oneArm = mapping.unilateral?.includes(exId!) ?? false;
      items.push({
        itemGroupPosition: position++,
        workoutMode: mapping.defaults.workout_mode,
        handMode: oneArm ? 1 : 2,
        actionId,
        actionModeConfig: {},
        // A one-arm movement can't be sent as bilateral (direction 0): each set
        // becomes one per side, alternating.
        itemDetails: oneArm
          ? Array.from({ length: sets * 2 }, (_, i) => ({
              position: i + 1,
              repCount: reps,
              restTime: mapping.defaults.rest_sec,
              tag: mapping.defaults.tag,
              modeConfig: { baseValue: load, direction: (i % 2) + 1 as 1 | 2 },
            }))
          : Array.from({ length: sets }, (_, i) => ({
              position: i + 1,
              repCount: reps,
              restTime: mapping.defaults.rest_sec,
              tag: mapping.defaults.tag,
              modeConfig: { baseValue: load, direction: 0 },
            })),
      });
    }

    if (!items.length) return { ok: true, action: "none", exercises: 0, skipped };

    const title = voltraTitle(brief.date);
    const payload = sessionPayload(title, items);

    // One session per date. Beyond+ refuses a second session with the same title,
    // so a session already there for today (another variant, a second Start) is
    // updated instead.
    const before = await listSessions();
    const existing = before.sessions.find((s) => s.title === title);

    let action: "created" | "updated" | "kept" = "created";
    let reply: unknown;
    if (existing) {
      try {
        reply = await updateSession(existing.id, payload);
        action = "updated";
      } catch (err) {
        // Today's session is already on the device: use it as it is, and say the
        // refresh didn't happen.
        console.warn(`voltra session update failed; keeping "${title}"`, err);
        return { ok: true, title, action: "kept", exercises: items.length, skipped, guessedLoads, note: `couldn't update it (${publicMessage(err)})` };
      }
    } else {
      reply = await createSession(payload);
    }
    const replyText = JSON.stringify(reply ?? {}).slice(0, 300);
    console.info(`voltra session ${action} "${title}": ${replyText}`);

    // Read it back. The device API can answer a request it didn't act on with a
    // success status (a rejected payload looks like a normal reply), so the only
    // proof a session exists is finding it in the list.
    const after = await listSessions();
    const saved = after.sessions.some((s) => s.title === title);
    if (!saved) {
      console.error(
        `voltra session "${title}" not found after ${action}. ` +
          `Reply: ${replyText}. List had ${after.sessions.length} session(s) ` +
          `[${after.sessions.slice(0, 5).map((s) => s.title).join(" | ")}], shape ${after.shape}`
      );
      return {
        ok: false,
        title,
        error: `Beyond+ didn't save "${title}". It replied: ${replyText.slice(0, 160)}`,
        skipped,
        guessedLoads,
      };
    }

    return {
      ok: true,
      title,
      action,
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
