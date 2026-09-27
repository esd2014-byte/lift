import { parse } from "yaml";
import { readFile } from "./github";
import { TOLERANCES, type Tolerance } from "./tolerance";

export type Exercise = {
  id: string;
  name: string;
  section: string;
  station?: string;
  tolerance: Tolerance;
  anchor?: boolean;
  note?: string;
};

const LIBRARY_PATH = "library/exercises.yaml";

/** Read the library for display. Parsing is fine here - we only write via text edit. */
export async function loadLibrary(): Promise<{ exercises: Exercise[]; raw: string }> {
  const raw = await readFile(LIBRARY_PATH);
  if (!raw) throw new Error("library/exercises.yaml not found");
  const doc = parse(raw) as Record<string, unknown>;

  const exercises: Exercise[] = [];
  for (const [section, items] of Object.entries(doc)) {
    if (!Array.isArray(items)) continue;
    if (section === "parked") continue; // blocked on equipment, not on an opinion
    for (const ex of items as Array<Record<string, unknown>>) {
      if (!ex?.id) continue;
      exercises.push({
        id: String(ex.id),
        name: String(ex.name ?? ex.id),
        section,
        station: ex.station ? String(ex.station) : undefined,
        tolerance: (TOLERANCES as readonly string[]).includes(String(ex.tolerance))
          ? (ex.tolerance as Tolerance)
          : "untested",
        anchor: ex.anchor === true,
        note: ex.note ? String(ex.note) : undefined,
      });
    }
  }
  return { exercises, raw };
}

export { LIBRARY_PATH, TOLERANCES };
export type { Tolerance };
export { applyTolerances } from "./tolerance";
