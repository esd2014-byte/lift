import { VARIANT_ORDER, type BriefData, type Row, type Variant } from "./types";

/**
 * The brief's JSON is written by a model every morning. Treat it like any other
 * input from outside: check its shape and bound every field before the app acts on
 * it (renders it, pushes it to Hevy and the Voltra).
 *
 * Lenient where it can be: a bad row or variant is dropped with a note, not the
 * whole brief. Strict where it must be: no date, day or usable variant means no
 * structured session, and the page falls back to the prose.
 */

const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

function row(v: unknown): Row | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  const name = str(r.name, 80);
  const reps = str(r.reps, 40) ?? (typeof r.reps === "number" ? String(r.reps) : undefined);
  if (!name || !reps) return null;
  const load = typeof r.load_lb === "number" && Number.isFinite(r.load_lb) && r.load_lb >= 0 && r.load_lb <= 1000 ? r.load_lb : null;
  const rpe = typeof r.rpe === "number" && r.rpe >= 0 && r.rpe <= 10 ? r.rpe : str(r.rpe, 10) ?? null;
  return {
    name,
    reps,
    ...(str(r.station, 80) ? { station: str(r.station, 80) } : {}),
    superset: typeof r.superset === "string" && /^[A-Z]$/.test(r.superset) ? r.superset : null,
    rpe,
    load_lb: load,
    ...(str(r.note, 300) ? { note: str(r.note, 300) } : {}),
  };
}

function variant(v: unknown, problems: string[], key: string): Variant | null {
  if (!v || typeof v !== "object") return null;
  const x = v as Record<string, unknown>;
  const rowsIn = Array.isArray(x.rows) ? x.rows.slice(0, 30) : [];
  const rows = rowsIn.map(row).filter((r): r is Row => r !== null);
  if (rows.length < rowsIn.length) problems.push(`${key}: ${rowsIn.length - rows.length} unreadable row(s) dropped`);
  if (!rows.length) return null;
  const note = x.note as Record<string, unknown> | null | undefined;
  return {
    label: str(x.label, 40) ?? key,
    meta: str(x.meta, 200) ?? "",
    duration: str(x.duration, 40) ?? "",
    ...(str(x.hevy_routine, 80) ? { hevy_routine: str(x.hevy_routine, 80) } : {}),
    note: note && (note.kind === "accent" || note.kind === "warn") && str(note.text, 600) ? { kind: note.kind, text: str(note.text, 600)! } : null,
    rows,
  };
}

export function checkBrief(raw: unknown): { brief: BriefData | null; problems: string[] } {
  const problems: string[] = [];
  if (!raw || typeof raw !== "object") return { brief: null, problems: ["not a JSON object"] };
  const b = raw as Record<string, unknown>;

  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
  // A program day letter, or "rest": a scheduled rest day can still offer optional
  // work (a bonus day, the cuff minimum), and that work is still startable.
  const day = typeof b.day === "string" && (/^[A-Z]$/.test(b.day) || b.day === "rest") ? b.day : null;
  if (!date) problems.push("missing or malformed date");
  if (!day) problems.push("missing or malformed day");

  const variants: Record<string, Variant> = {};
  const vIn = (b.variants && typeof b.variants === "object" ? b.variants : {}) as Record<string, unknown>;
  for (const k of VARIANT_ORDER) {
    if (!(k in vIn)) continue;
    const v = variant(vIn[k], problems, k);
    if (v) variants[k] = v;
    else problems.push(`${k}: unusable, dropped`);
  }
  if (!Object.keys(variants).length) problems.push("no usable variants");
  if (!date || !day || !Object.keys(variants).length) return { brief: null, problems };

  return {
    brief: {
      date,
      day,
      day_name: str(b.day_name, 80) ?? (day === "rest" ? "Rest day" : `Day ${day}`),
      day_type: b.day_type === "short" || b.day_type === "rest" ? b.day_type : "real",
      ...(str(b.generated_at, 40) ? { generated_at: str(b.generated_at, 40) } : {}),
      ...(str(b.headline, 300) ? { headline: str(b.headline, 300) } : {}),
      injury_flag: str(b.injury_flag, 300) ?? null,
      variants,
    },
    problems,
  };
}
