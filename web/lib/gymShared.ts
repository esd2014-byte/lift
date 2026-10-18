/**
 * The Gym tab's shapes and small rules, safe to use in the browser (lib/gym.ts reads
 * and writes the files on the server).
 */

export type Equipment = {
  nuobell: { min: number; max: number; step: number } | null;
  fixedDumbbells: number[];
  kettlebells: number[];
  adjustableKb: { min: number; max: number; step: number; owned: boolean } | null;
  lists: Record<ListId, string[]>;
  /** Read-only lines for the rest of the file (rack, Voltra, bands). */
  other: string[];
};

export const LISTS = {
  voltra_attachments: { path: ["voltra", "attachments"], label: "Voltra attachments" },
  bench_attachments: { path: ["bench", "attachments"], label: "Bench attachments" },
  accessories: { path: ["accessories"], label: "Accessories" },
} as const;
export type ListId = keyof typeof LISTS;

export type ExerciseCard = {
  id: string;
  name: string;
  section: string;
  station?: string;
  /** The station in words ("Voltra pullup bar"). */
  stationName?: string;
  tolerance?: string;
  anchor: boolean;
  /** "active" unless the library says otherwise. */
  status: string;
  /** Why it can't be toggled from the app, when it can't ("forbidden", "parked: ..."). */
  locked?: string;
  last: { date: string; lb: number | null; reps: number; where: "Hevy" | "Voltra" } | null;
  /** Estimated one-rep max (Epley), when the last set had a weight. */
  e1rm: number | null;
};

export const INACTIVE = new Set(["inactive", "retired"]);
export const isActive = (c: Pick<ExerciseCard, "status" | "tolerance" | "locked">) =>
  !INACTIVE.has(c.status) && c.tolerance !== "forbidden" && !c.locked;
