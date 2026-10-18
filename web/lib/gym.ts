import { isMap, isSeq, parse, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";
import { lastLogged, lastOnVoltra } from "./loadGuess";
import { hevyTitles } from "./hevyRoutine";
import type { DigestSession, VoltraSession } from "./metrics";
import { stationLabel } from "./programDay";
import { LISTS, type Equipment, type ExerciseCard, type ListId } from "./gymShared";

export { LISTS, INACTIVE, isActive } from "./gymShared";
export type { Equipment, ExerciseCard, ListId } from "./gymShared";

/**
 * The Gym tab: what's in the home gym (gym/equipment.yaml) and which exercises are
 * in rotation (library/exercises.yaml `status`).
 *
 * Both files are hand-written and heavily commented, so edits never round-trip the
 * whole file through a parser and back:
 *   - equipment edits go through yaml's Document API, which keeps comments and layout;
 *   - exercise status is a targeted text edit of one entry, like the tolerance editor.
 *
 * Nothing here touches history. Deactivating an exercise only stops it being
 * programmed; its sets stay in the logs and still count.
 */

// ---------------------------------------------------------------- equipment

const nums = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isFinite(n)) : []);
const text = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x)) : []);

type Doc = {
  dumbbells?: Array<Record<string, unknown>>;
  kettlebells?: { fixed_lb?: unknown; adjustable?: Record<string, unknown> };
  voltra?: { model?: string; resistance_lb?: unknown; attachments?: unknown; mounts?: Array<{ name?: string }> };
  bench?: { model?: string; attachments?: unknown };
  rack?: { model?: string };
  bands?: { loop?: Array<{ color?: string; lb?: unknown }>; tube_set?: { lb?: unknown } };
  accessories?: unknown;
};

export function readEquipment(raw: string | null): Equipment | null {
  let doc: Doc;
  try {
    doc = (parse(raw ?? "") ?? {}) as Doc;
  } catch {
    return null;
  }
  if (!doc.dumbbells && !doc.kettlebells && !doc.voltra) return null;
  const nuo = (doc.dumbbells ?? []).find((d) => d.increment_lb);
  const fixed = (doc.dumbbells ?? []).find((d) => Array.isArray(d.sizes_lb));
  const adj = doc.kettlebells?.adjustable;
  const other = [
    doc.rack?.model ? `Rack: ${doc.rack.model}` : "",
    doc.voltra?.model
      ? `Voltra: ${doc.voltra.model}${Array.isArray(doc.voltra.resistance_lb) ? `, ${doc.voltra.resistance_lb.join("-")} lb` : ""}${
          doc.voltra.mounts?.length ? `; mounts: ${doc.voltra.mounts.map((m) => m.name).join(", ")}` : ""
        }`
      : "",
    doc.bench?.model ? `Bench: ${doc.bench.model}` : "",
    doc.bands?.loop?.length
      ? `Bands: ${doc.bands.loop.map((b) => `${b.color} ${text(b.lb).join("-")}`).join(", ")}${
          doc.bands.tube_set ? `; tube set ${text(doc.bands.tube_set.lb).join("/")}` : ""
        }`
      : "",
  ].filter(Boolean);
  return {
    nuobell: nuo
      ? { min: Number(nuo.min_lb ?? nuo.increment_lb), max: Number(nuo.max_lb), step: Number(nuo.increment_lb) }
      : null,
    fixedDumbbells: nums(fixed?.sizes_lb),
    kettlebells: nums(doc.kettlebells?.fixed_lb),
    adjustableKb:
      adj && Array.isArray(adj.range_lb)
        ? {
            min: Number(adj.range_lb[0]),
            max: Number(adj.range_lb[1]),
            step: Number(adj.increment_lb),
            owned: (adj.status ?? "owned") === "owned",
          }
        : null,
    lists: {
      voltra_attachments: text(doc.voltra?.attachments),
      bench_attachments: text(doc.bench?.attachments),
      accessories: text(doc.accessories),
    },
    other,
  };
}

/** Library stations that can't be used with what's in the gym. */
export function missingStations(e: Equipment | null): Set<string> {
  const out = new Set<string>();
  if (!e) return out;
  if (!e.nuobell) out.add("nuobell");
  if (!e.fixedDumbbells.length) out.add("small_db");
  if (!e.kettlebells.length && !e.adjustableKb?.owned) out.add("kettlebell");
  return out;
}

export type EquipmentEdit =
  | { action: "nuobell"; min: number; max: number; step: number }
  | { action: "fixed_dumbbells"; sizes: number[] }
  | { action: "kettlebells"; sizes: number[] }
  | { action: "adjustable_kb"; min: number; max: number; step: number; owned: boolean }
  | { action: "list_add" | "list_remove"; list: ListId; item: string };

const okWeight = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 500;

/** Why an edit is unusable, in words, or null when it's fine. */
export function checkEdit(e: EquipmentEdit): string | null {
  switch (e.action) {
    case "nuobell":
    case "adjustable_kb":
      if (![e.min, e.max, e.step].every(okWeight)) return "weights must be numbers between 0 and 500";
      if (e.min > e.max) return "the lightest can't be heavier than the heaviest";
      return null;
    case "fixed_dumbbells":
    case "kettlebells":
      if (!Array.isArray(e.sizes) || e.sizes.length > 30 || !e.sizes.every(okWeight)) return "sizes must be weights";
      return null;
    case "list_add":
    case "list_remove":
      if (!(e.list in LISTS)) return "unknown list";
      if (!e.item?.trim() || e.item.length > 120) return "say what the item is";
      return null;
    default:
      return "unknown change";
  }
}

const sortedUnique = (xs: number[]) => [...new Set(xs)].sort((a, b) => a - b);

/** Apply one edit to equipment.yaml, keeping its comments. Throws when the shape is unexpected. */
export function editEquipment(raw: string, e: EquipmentEdit, today: string): string {
  const doc = parseDocument(raw);
  const dumbbells = doc.get("dumbbells") as YAMLSeq | undefined;
  const findDb = (key: string) =>
    isSeq(dumbbells) ? (dumbbells.items.find((m) => isMap(m) && m.has(key)) as YAMLMap | undefined) : undefined;
  const flow = (xs: number[]) => {
    const node = doc.createNode(sortedUnique(xs));
    node.flow = true;
    return node;
  };

  switch (e.action) {
    case "nuobell": {
      const m = findDb("increment_lb");
      if (!m) throw new Error("no adjustable dumbbells in the file");
      m.set("min_lb", e.min);
      m.set("max_lb", e.max);
      m.set("increment_lb", e.step);
      break;
    }
    case "fixed_dumbbells": {
      const m = findDb("sizes_lb");
      if (!m) throw new Error("no fixed dumbbells in the file");
      m.set("sizes_lb", flow(e.sizes));
      break;
    }
    case "kettlebells":
      doc.setIn(["kettlebells", "fixed_lb"], flow(e.sizes));
      break;
    case "adjustable_kb": {
      const range = doc.createNode([e.min, e.max]);
      range.flow = true;
      doc.setIn(["kettlebells", "adjustable", "range_lb"], range);
      doc.setIn(["kettlebells", "adjustable", "increment_lb"], e.step);
      doc.setIn(["kettlebells", "adjustable", "status"], e.owned ? "owned" : "not_owned");
      break;
    }
    case "list_add":
    case "list_remove": {
      const path = [...LISTS[e.list].path];
      let seq = doc.getIn(path) as YAMLSeq | undefined;
      if (!isSeq(seq)) {
        if (e.action === "list_remove") throw new Error("nothing to remove");
        doc.setIn(path, doc.createNode([]));
        seq = doc.getIn(path) as YAMLSeq;
      }
      const item = e.item.trim();
      const at = seq.items.findIndex((x) => String((x as { value?: unknown })?.value ?? x) === item);
      if (e.action === "list_add" && at === -1) seq.add(doc.createNode(item));
      if (e.action === "list_remove") {
        if (at === -1) throw new Error(`"${item}" isn't in the list`);
        seq.delete(at);
      }
      break;
    }
  }
  doc.setIn(["meta", "updated"], today);
  return doc.toString({ lineWidth: 0 });
}

// ---------------------------------------------------------------- exercises

/** The newest logged set of one Hevy exercise, weight or not. */
function lastHevy(sessions: DigestSession[], title: string | undefined) {
  if (!title) return null;
  const weighted = lastLogged(sessions, title);
  const want = title.toLowerCase();
  for (const s of [...sessions].sort((a, b) => (a.date < b.date ? 1 : -1))) {
    for (const e of s.exercises ?? []) {
      if (e.name?.toLowerCase() !== want || !e.top?.reps) continue;
      // Prefer a weighted set from the same day; otherwise this reps-only one.
      if (weighted && weighted.date === s.date) return { date: s.date, lb: weighted.lb, reps: weighted.reps };
      return { date: s.date, lb: e.top.lb && e.top.lb > 0 ? e.top.lb : null, reps: e.top.reps };
    }
  }
  return null;
}

export function exerciseCards(files: Record<string, string | null | undefined>): ExerciseCard[] {
  let lib: Record<string, unknown>;
  try {
    lib = (parse(files["library/exercises.yaml"] ?? "") ?? {}) as Record<string, unknown>;
  } catch {
    return [];
  }
  const mapping = (() => {
    try {
      return (parse(files["scripts/voltra_mapping.yaml"] ?? "") ?? {}) as { actions?: Record<string, number> };
    } catch {
      return {};
    }
  })();
  const titles = hevyTitles(files["scripts/hevy_mapping.yaml"] ?? null);
  const history = <T>(path: string): T[] => {
    try {
      return (JSON.parse(files[path] ?? "{}") as { sessions?: T[] }).sessions ?? [];
    } catch {
      return [];
    }
  };
  const hevy = history<DigestSession>("logs/hevy/recent.json");
  const voltra = history<VoltraSession>("logs/voltra/recent.json");

  const cards: ExerciseCard[] = [];
  for (const [section, items] of Object.entries(lib)) {
    if (!Array.isArray(items)) continue;
    for (const ex of items as Array<Record<string, unknown>>) {
      if (!ex?.id) continue;
      const id = String(ex.id);
      const name = String(ex.name ?? id);
      const h = lastHevy(hevy, titles.get(id));
      const action = mapping.actions?.[id];
      const v = action ? lastOnVoltra(voltra, action, name) : null;
      const last =
        v && (!h || v.date >= h.date)
          ? { date: v.date, lb: v.lb, reps: v.reps, where: "Voltra" as const }
          : h
            ? { ...h, where: "Hevy" as const }
            : null;
      cards.push({
        id,
        name,
        section,
        station: ex.station ? String(ex.station) : undefined,
        stationName: stationLabel(ex.station ? String(ex.station) : undefined),
        tolerance: ex.tolerance ? String(ex.tolerance) : undefined,
        anchor: ex.anchor === true,
        status: ex.status ? String(ex.status) : "active",
        ...(section === "parked"
          ? { locked: `parked: ${String(ex.blocked_on ?? "needs something first")}` }
          : ex.tolerance === "forbidden"
            ? { locked: "rated forbidden" }
            : {}),
        last,
        e1rm: last?.lb ? Math.round(last.lb * (1 + last.reps / 30)) : null,
      });
    }
  }
  return cards;
}

/**
 * Set one library entry's `status`, leaving every other byte of the file alone (the
 * same approach as lib/tolerance.ts). Activating removes the word "inactive" by
 * writing `status: active` where a status already exists.
 */
export function setExerciseStatus(raw: string, id: string, status: "active" | "inactive"): string {
  const idMatch = new RegExp(`(^|[\\s{])id:\\s*${escapeRegExp(id)}\\s*(,|$|\\n)`, "m").exec(raw);
  if (!idMatch) throw new Error(`exercise not found: ${id}`);
  const start = idMatch.index;
  const rest = raw.slice(start + 1);
  const nextItem = rest.search(/\n\s*-\s|\n\S|\n\s*\n\s*#/);
  const end = nextItem === -1 ? raw.length : start + 1 + nextItem;
  const entry = raw.slice(start, end);

  let replaced: string;
  if (/\bstatus:\s*[a-z_]+/.test(entry)) {
    replaced = entry.replace(/\bstatus:\s*[a-z_]+/, `status: ${status}`);
  } else if (status === "active") {
    return raw; // no status means active already
  } else if (/\{\s*$/.test(raw.slice(raw.lastIndexOf("\n", start) + 1, start + idMatch[1].length))) {
    // Flow entry: {id: x, ..., tolerance: fine}
    const close = entry.lastIndexOf("}");
    if (close === -1) throw new Error(`can't edit entry: ${id}`);
    replaced = `${entry.slice(0, close)}, status: ${status}${entry.slice(close)}`;
  } else {
    // Block entry: a new key line right after the id line, at the same indent as `name:`.
    const lines = entry.split("\n");
    const indent = /^(\s+)\S/.exec(lines[1] ?? "")?.[1] ?? "    ";
    lines.splice(1, 0, `${indent}status: ${status}`);
    replaced = lines.join("\n");
  }
  return raw.slice(0, start) + replaced + raw.slice(end);
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
