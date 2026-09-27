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

async function call(path: string, init: RequestInit = {}) {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Voltra ${path}: ${res.status} ${text.slice(0, 300)}`);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
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

export type SessionItemDetail = {
  position: number;
  repCount: number;
  restTime: number;
  tag: 0 | 1 | 2;                    // Normal | Warm-up | Drop Set
  modeConfig: { baseValue: number; direction: 0 | 1 | 2 };
};

export type SessionItem = {
  itemGroupPosition: number;
  workoutMode: 1 | 2 | 3 | 4;        // Agent v1 exposes only 1..4
  actionId: number;
  actionModeConfig: Record<string, unknown>;
  itemDetails: SessionItemDetail[];
};

export type SessionPayload = {
  title: string;
  sessionConfig: Record<string, unknown>;
  blockList: Array<{ blockType: 1 | 2; itemList: SessionItem[] }>;
};

export async function listSessions() {
  const d = await call("/workout/me/sessions/v2/");
  return (d?.workoutSessions ?? d?.list ?? []) as Array<{ id: number; title: string }>;
}

export async function createSession(payload: SessionPayload) {
  return call("/workout/me/sessions/v2/", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateSession(id: number, payload: SessionPayload) {
  return call(`/workout/me/sessions/v2/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

/** Weight Training accepts 5-230 lb, per the payload validator. */
export function clampLoad(lb: number) {
  return Math.max(5, Math.min(230, Math.round(lb)));
}
