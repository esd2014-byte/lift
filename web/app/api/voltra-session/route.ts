import { NextRequest, NextResponse } from "next/server";
import { parse } from "yaml";
import { readFile } from "@/lib/github";
import { createSession, updateSession, listSessions, clampLoad, type SessionPayload, type SessionItem } from "@/lib/voltra";
import { todayISO } from "@/lib/date";
import type { BriefData, Row } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Build today's Beyond+ session from the brief, named YYYY.MM.DD.
 *
 * The flow this serves: Eli opens the Lift app, starts the Hevy routine for the iron
 * work, and when he reaches a Voltra exercise the session is already waiting on the
 * device with the right movements and loads. He never programs it by hand.
 *
 * Only exercises present in scripts/voltra_mapping.yaml are pushed. An unmapped
 * exercise is skipped and reported, never guessed at - the action name is what makes
 * the logged workout identifiable later, and a wrong name is worse than a gap.
 *
 * Idempotent: a session already titled with today's date is updated, not duplicated.
 */

type Mapping = {
  actions: Record<string, number>;
  defaults: { workout_mode: 1 | 2 | 3 | 4; rest_sec: number; tag: 0 | 1 | 2; direction: 0 | 1 | 2 };
};

/** "3 × 8-12" -> 3 sets of 8; "ramp to 1 × 8" -> 1 set of 8. Bottom of the range. */
function parseReps(reps: string): { sets: number; reps: number } {
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

export async function POST(req: NextRequest) {
  try {
    const { variant = "full", date } = (await req.json().catch(() => ({}))) as {
      variant?: string;
      date?: string;
    };
    const day = date ?? todayISO();

    const [briefRaw, mapRaw, libRaw] = await Promise.all([
      readFile(`logs/briefs/${day}.json`),
      readFile("scripts/voltra_mapping.yaml"),
      readFile("library/exercises.yaml"),
    ]);
    if (!briefRaw) return NextResponse.json({ error: `no brief for ${day}` }, { status: 404 });
    if (!mapRaw) return NextResponse.json({ error: "voltra_mapping.yaml missing" }, { status: 500 });

    const brief = JSON.parse(briefRaw) as BriefData;
    const mapping = parse(mapRaw) as Mapping;
    const lib = parse(libRaw ?? "") as Record<string, unknown>;

    // Resolve a brief row (which carries display names) back to a library id.
    const byName = new Map<string, string>();
    for (const items of Object.values(lib)) {
      if (!Array.isArray(items)) continue;
      for (const ex of items as Array<Record<string, string>>) {
        if (ex?.id && ex?.name) byName.set(ex.name.toLowerCase(), ex.id);
      }
    }

    const rows = brief.variants?.[variant]?.rows ?? [];
    const items: SessionItem[] = [];
    const skipped: string[] = [];
    const guessedLoads: string[] = [];
    let position = 1;

    for (const row of rows) {
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

    if (!items.length) {
      return NextResponse.json({
        ok: true,
        created: false,
        reason: "no Voltra exercises in this variant",
        skipped,
      });
    }

    const title = day.replace(/-/g, ".");
    const payload: SessionPayload = {
      title,
      sessionConfig: {},
      blockList: [{ blockType: 1, itemList: items }],
    };

    const existing = (await listSessions()).find((s) => s.title === title);
    const result = existing
      ? await updateSession(existing.id, payload)
      : await createSession(payload);

    return NextResponse.json({
      ok: true,
      title,
      action: existing ? "updated" : "created",
      exercises: items.length,
      skipped,
      // Anything here means the brief omitted load_lb - fix the brief, not the device.
      guessedLoads,
      result,
    });
  } catch (err) {
    console.error("voltra-session failed", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
