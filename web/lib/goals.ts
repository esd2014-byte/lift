import { parse } from "yaml";

/**
 * The athlete's goals, from athlete/profile.yaml, for the Coaching tab. Display
 * only: the routine reads the file itself.
 */
export type Goals = {
  primary: { statement: string; rate: [number, number] | null; horizonWeeks: [number, number] | null } | null;
  priorityMuscles: string[];
  secondary: string[];
};

const pair = (v: unknown): [number, number] | null =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === "number") ? [v[0], v[1]] : null;

export function parseGoals(raw: string | null): Goals | null {
  let doc: { goals?: Record<string, unknown> };
  try {
    doc = (parse(raw ?? "") ?? {}) as typeof doc;
  } catch {
    return null;
  }
  const g = doc.goals;
  if (!g) return null;
  const p = g.primary as Record<string, unknown> | undefined;
  return {
    primary: p?.statement
      ? {
          statement: String(p.statement),
          rate: pair(p.target_rate_lb_per_week),
          horizonWeeks: pair(p.horizon_weeks),
        }
      : null,
    priorityMuscles: Array.isArray(g.priority_muscles) ? g.priority_muscles.map(String) : [],
    secondary: Array.isArray(g.secondary)
      ? (g.secondary as Array<{ statement?: string }>).map((s) => String(s?.statement ?? "")).filter(Boolean)
      : [],
  };
}
