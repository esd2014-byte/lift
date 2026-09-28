/**
 * Beyond Power (Voltra) API client.
 *
 * Talks to the same HTTPS API the `voltra` CLI wraps, so none of this depends on
 * Eli's Mac being awake. Endpoints and the auth scheme were confirmed directly
 * against the API (Authorization: Bearer -> 200; x-api-key and api-key -> 401).
 *
 * The device is the source of truth for anything it measures. Beyond+ captures
 * force, power and velocity per rep; Hevy records what someone typed. Where both
 * describe the same work, this wins.
 */

const BASE = "https://api.beyond-power.com/agent";

function key() {
  const k = process.env.VOLTRA_API_KEY?.trim();
  if (!k) throw new Error("VOLTRA_API_KEY is not set");
  return k;
}

/** Per call. A slow device API must fail fast enough to leave the request its time. */
const TIMEOUT_MS = 15_000;

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((err: unknown): never => {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new Error(timedOut ? `Beyond+ didn't answer within ${TIMEOUT_MS / 1000}s (${path})` : `Couldn't reach Beyond+ (${path})`);
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Voltra ${path}: ${res.status} ${text.slice(0, 300)}`);
  if (!text) return { _status: res.status, _empty: true };
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

/**
 * The first array of sessions in a reply, wherever the API put it. Replies have
 * come back both bare and wrapped in `data`, and the key has varied; reading only
 * one shape made a real list look empty.
 */
export function sessionsIn(d: unknown): Array<{ id: number; title: string }> {
  const seen = new Set<unknown>();
  const walk = (v: unknown, depth: number): Array<{ id: number; title: string }> | null => {
    if (!v || typeof v !== "object" || seen.has(v) || depth > 3) return null;
    seen.add(v);
    if (Array.isArray(v)) {
      return v.every((x) => x && typeof x === "object" && "title" in x) ? (v as Array<{ id: number; title: string }>) : null;
    }
    const o = v as Record<string, unknown>;
    for (const k of ["workoutSessions", "sessions", "list", "records", "items", "data"]) {
      const found = walk(o[k], depth + 1);
      if (found) return found;
    }
    return null;
  };
  return walk(d, 0) ?? [];
}

/** Top-level shape of a reply, for logs: keys and array sizes, never values. */
export function shapeOf(d: unknown): string {
  if (!d || typeof d !== "object") return typeof d;
  if (Array.isArray(d)) return `array(${d.length})`;
  return `{${Object.entries(d as Record<string, unknown>)
    .map(([k, v]) => (Array.isArray(v) ? `${k}:array(${v.length})` : v && typeof v === "object" ? `${k}:${shapeOf(v)}` : k))
    .join(", ")}}`;
}

export type VoltraWorkout = {
  id: number;
  startTime: string;
  endTime: string;
  actionNames?: string[];
  actionIds?: number[];
  repCount: number;
  setCount: number;
  durationSec: number;
  avgPullForceLbs?: number;
  maxPullForceLbs?: number;
  avgPullPowerW?: number;
  maxPullPowerW?: number;
  avgPullVelocityMmS?: number;
  maxPullVelocityMmS?: number;
  totalPullVolumeLbs?: number;
  totalPullDistanceMm?: number;
  workoutTypeName?: string;
};

export async function listWorkouts(): Promise<VoltraWorkout[]> {
  const d = await call("/workout/list");
  return (d?.list ?? d?.data?.list ?? []) as VoltraWorkout[];
}

export type VoltraAction = { id: number; name: string };

export async function listActions(): Promise<VoltraAction[]> {
  const d = await call("/workout/me/actions");
  const items = d?.list ?? d?.data?.list ?? d?.actions ?? [];
  return (items as Array<Record<string, unknown>>).map((a) => ({
    id: Number(a.id),
    name: String(a.name ?? a.actionName ?? ""),
  }));
}

// ---- session templates (the daily plan pushed to the device) --------------

// ---- Session Agent Contract v1 ------------------------------------------------
// From Beyond's Cortex docs: skills/voltra-device-training/references/
// session-schema-reference.md. The backend does NOT fill in omitted defaults - it
// stores them as null, which is how a session saves "successfully" with nothing
// usable in it. So every configuration object is sent in full, with the canonical
// values from that reference.

type Nullable3 = { eccentricValue: null; chainsValue: null; inverseChainsValue: null };

export type SessionSet = {
  position: number;                  // 1..N within the item
  repCount: number;                  // 1..99
  restTime: number;                  // seconds, multiple of 10
  tag: 0 | 1 | 2;                    // Normal | Warm-up | Drop Set
  // Bilateral items use direction 0; one-arm items alternate 1 (Left) and 2 (Right).
  modeConfig: { baseValue: number; direction: 0 | 1 | 2; assistantSwitch: null } & Nullable3;
};

export type ActionModeConfig = {
  baseValue: number;
  handMode: 1 | 2;                   // 1 Unilateral | 2 Bilateral
  restTime: number;
  assistMode: 0;
  resistanceExperience: 0;
  resistanceMode: 0;
  resistanceCurve: 0;
  rangeOfMotion: 0;
  bandLength: 0;
  eccentricConstantResistance: 0;
  eccentricIsokinetic: 0;
  maxEccentricLoad: 0;
  eccentricInputType: 0;
  smartLoadValue: 0;
  // Drop sets are off. The CLI sends these as explicit nulls; so do we.
  dropSetHoldingTime: null;
  dropSetTargetReps: null;
  dropSetZeroPosition: null;
} & Nullable3;

export type SessionItem = {
  itemGroupPosition: number;         // 1..N within the block
  workoutMode: 1;                    // Weight Training; the only mode this app writes
  actionId: number;
  actionModeConfig: ActionModeConfig;
  itemDetails: SessionSet[];
};

export type SessionConfig = {
  autoUnloadHoldingTime: number;     // seconds, 0..10
  targetRepUnload: boolean;
  zeroUnload: boolean;
  smartLoadValue: 1 | 2 | 3;         // Normal | Auto | Off
};

/**
 * The create request. The four fixed fields say: a personal (not coach) session,
 * one device (not Twin), made by an agent, not copied from another session.
 */
export type SessionPayload = {
  title: string;                     // 1..50 characters, unique per account
  accountRole: 0;
  connectionMode: 0;
  label: 0;
  sessionConfig: SessionConfig;
  originSessionId: null;
  blockList: Array<{ blockType: 1; itemList: SessionItem[] }>;
};

const DISABLED: Nullable3 = { eccentricValue: null, chainsValue: null, inverseChainsValue: null };

export const SESSION_CONFIG: SessionConfig = { autoUnloadHoldingTime: 3, targetRepUnload: false, zeroUnload: false, smartLoadValue: 3 };

/** Rest the contract accepts: whole tens of seconds, 0..290. */
export function clampRest(sec: number) {
  return Math.max(0, Math.min(290, Math.round(sec / 10) * 10));
}

/** Weight Training accepts 5-230 lb. */
export function clampLoad(lb: number) {
  return Math.max(5, Math.min(230, Math.round(lb)));
}

/**
 * One exercise. A one-arm movement is Unilateral: each set becomes one per side,
 * alternating left and right.
 */
export function sessionItem(o: {
  position: number;
  actionId: number;
  lb: number;
  sets: number;
  reps: number;
  restSec: number;
  oneArm: boolean;
}): SessionItem {
  const baseValue = clampLoad(o.lb);
  const restTime = clampRest(o.restSec);
  const repCount = Math.max(1, Math.min(99, Math.round(o.reps)));
  const sets = Math.max(1, Math.round(o.sets)) * (o.oneArm ? 2 : 1);
  return {
    itemGroupPosition: o.position,
    workoutMode: 1,
    actionId: o.actionId,
    actionModeConfig: {
      baseValue,
      handMode: o.oneArm ? 1 : 2,
      restTime,
      ...DISABLED,
      assistMode: 0,
      resistanceExperience: 0,
      resistanceMode: 0,
      resistanceCurve: 0,
      rangeOfMotion: 0,
      bandLength: 0,
      eccentricConstantResistance: 0,
      eccentricIsokinetic: 0,
      maxEccentricLoad: 0,
      eccentricInputType: 0,
      smartLoadValue: 0,
      dropSetHoldingTime: null,
      dropSetTargetReps: null,
      dropSetZeroPosition: null,
    },
    itemDetails: Array.from({ length: sets }, (_, i) => ({
      position: i + 1,
      repCount,
      restTime,
      tag: 0,
      modeConfig: { baseValue, direction: o.oneArm ? (((i % 2) + 1) as 1 | 2) : 0, assistantSwitch: null, ...DISABLED },
    })),
  };
}

/** The create request around a list of items. */
export function sessionPayload(title: string, items: SessionItem[]): SessionPayload {
  return {
    title: title.trim().slice(0, 50),
    accountRole: 0,
    connectionMode: 0,
    label: 0,
    sessionConfig: SESSION_CONFIG,
    originSessionId: null,
    blockList: [{ blockType: 1, itemList: items }],
  };
}

// Endpoints:
//   GET  /workout/me/sessions            the list: { code, msg, data: { workoutSessions } }
//   POST /workout/me/custom-session/v2   create (documented in the Cortex schema reference)
//   PUT  /workout/me/sessions/v2/{id}    update: title, sessionConfig, blockList,
//                                        connectionMode only. The backend replaces the
//                                        session, so its id changes.
// Both write paths, and the body shape, were checked against what `voltra session
// create/update` (CLI 0.2.25) actually sends, captured on a local listener via
// VOLTRA_CLI_API_BASE_URL. The CLI's base URL omits "/agent" and adds it itself.
// Paths this API doesn't know answer 204 with no body; a wrong method on a known
// path answers 405.
const SESSIONS = "/workout/me/sessions";
const CREATE = "/workout/me/custom-session/v2";
const UPDATE = "/workout/me/sessions/v2";

export async function listSessions(): Promise<{ sessions: Array<{ id: number; title: string }>; shape: string }> {
  const d = await call(SESSIONS);
  return { sessions: sessionsIn(d), shape: shapeOf(d) };
}

/**
 * A write only counts if Beyond+ says so. An empty 204 means it didn't recognise
 * the request; a { code, msg } reply with a non-success code means it refused.
 */
function writeResult(what: string, d: Record<string, unknown>) {
  if (d?._empty && d._status !== 200 && d._status !== 201) {
    throw new Error(`Beyond+ ignored the ${what} (HTTP ${d._status}, no reply)`);
  }
  const code = d?.code;
  const ok = code === undefined || code === 0 || code === 200 || code === "0" || code === "200";
  if (!ok) throw new Error(`Beyond+ refused the ${what}: ${String(d?.msg ?? "no message")} (code ${String(code)})`);
  return d;
}

export async function createSession(payload: SessionPayload) {
  return writeResult("new session", await call(CREATE, { method: "POST", body: JSON.stringify(payload) }));
}

/** An update carries only what can change; the fixed create-only fields stay out. */
export async function updateSession(id: number, payload: SessionPayload) {
  const { title, sessionConfig, blockList, connectionMode } = payload;
  return writeResult(
    "session update",
    await call(`${UPDATE}/${id}`, { method: "PUT", body: JSON.stringify({ title, sessionConfig, blockList, connectionMode }) })
  );
}


/**
 * Read-only: one session's full detail, raw, from each path that might serve it.
 * For comparing a session the app made with one made in Beyond+.
 */
export async function sessionDetail(id: number): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const path of [`${SESSIONS}/${id}`, `${UPDATE}/${id}`]) {
    try {
      out[path] = await call(path);
    } catch (err) {
      out[path] = { error: err instanceof Error ? err.message : String(err) };
    }
  }
  return out;
}

/**
 * Read-only: what a GET to `path` returns - status, shape (keys and array sizes,
 * never values) and how many sessions it holds. For finding the right endpoint
 * from /api/diagnostics?probe=voltra.
 */
export async function probe(path: string): Promise<{ path: string; status: number | string; shape: string; sessions: number }> {
  try {
    const res = await fetch(BASE + path, {
      headers: { Authorization: `Bearer ${key()}` },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = "non-JSON";
    }
    return { path, status: res.status, shape: text ? shapeOf(body) : "empty", sessions: sessionsIn(body).length };
  } catch (err) {
    return { path, status: err instanceof Error ? err.name : "error", shape: "-", sessions: 0 };
  }
}
