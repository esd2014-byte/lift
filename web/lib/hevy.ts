/**
 * Hevy API client.
 *
 * This lives in the Vercel app rather than the cloud routine because the routine
 * runs in a sandbox with no access to Eli's secrets. Vercel holds the key, syncs
 * the data into the repo, and the routine reads the repo. One secret, one place.
 */
const BASE = "https://api.hevyapp.com/v1";

function key() {
  const k = process.env.HEVY_API_KEY?.trim();
  if (!k) throw new Error("HEVY_API_KEY is not set");
  return k;
}

async function get(path: string, params: Record<string, string | number> = {}) {
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { "api-key": key() }, cache: "no-store" });
  if (!res.ok) throw new Error(`Hevy ${path}: ${res.status}`);
  return res.json();
}

/**
 * Walk every page. Hevy caps pageSize at 10 and returns page_count; asking for
 * page_count+1 is a hard 404, so stop on it rather than on a short page.
 */
async function paginate(path: string, key: string, maxPages = 30) {
  const items: unknown[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const result = await get(path, { page, pageSize: 10 });
    const batch = (result?.[key] ?? []) as unknown[];
    items.push(...batch);
    const pageCount = result?.page_count;
    if (typeof pageCount === "number" && page >= pageCount) break;
    if (batch.length < 10) break;
  }
  return items;
}

export type Workout = {
  id: string;
  title: string;
  start_time: string;
  end_time?: string;
  description?: string;
  exercises: Array<{
    title: string;
    notes?: string;
    sets: Array<{ weight_kg?: number | null; reps?: number | null; rpe?: number | null; duration_seconds?: number | null }>;
  }>;
};

export async function listWorkouts(): Promise<Workout[]> {
  return (await paginate("/workouts", "workouts")) as Workout[];
}

async function send(method: "POST" | "PUT", path: string, body: unknown) {
  const res = await fetch(BASE + path, {
    method,
    headers: { "api-key": key(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`Hevy ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

export type RoutineSet = {
  type: "normal" | "warmup";
  weight_kg: number | null;
  reps: number | null;
  duration_seconds?: number | null;
};

export type RoutineExercise = {
  exercise_template_id: string;
  superset_id: number | null;
  rest_seconds?: number | null;
  notes: string;
  sets: RoutineSet[];
};

export type Routine = {
  id: string;
  title: string;
  exercises: Array<RoutineExercise & { title: string }>;
};

export async function listRoutines(): Promise<Routine[]> {
  return (await paginate("/routines", "routines")) as Routine[];
}

export async function createRoutine(routine: { title: string; notes: string; exercises: RoutineExercise[] }) {
  const d = await send("POST", "/routines", { routine: { ...routine, folder_id: null } });
  // The API has returned both { routine: {...} } and { routine: [{...}] }.
  const r = Array.isArray(d?.routine) ? d.routine[0] : d?.routine;
  return r as { id: string };
}

export async function updateRoutine(id: string, routine: { title: string; notes: string; exercises: RoutineExercise[] }) {
  return send("PUT", `/routines/${id}`, { routine });
}
