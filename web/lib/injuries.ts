/**
 * Injuries as things that happen over time: each one starts, gets updates, and
 * eventually resolves. Stored as one JSON list in logs/injuries.json.
 *
 * The morning routine reads the ACTIVE ones as live context for programming. The
 * detailed standing rules (what's allowed, cautioned, forbidden) stay in
 * athlete/injuries.yaml, keyed by the same id, and only apply while that injury is
 * active here. Resolving a card is how the athlete tells the coach it's over.
 *
 * Pure text in, text out: the route does the I/O, so these are easy to test.
 */

export type InjuryUpdate = { at: string; text: string };

export type Injury = {
  id: string;
  /** Short name for the card, taken from the first sentence of the report. */
  title: string;
  /** The day it was reported (or, for older ones, roughly when it started). */
  started: string | null;
  status: "active" | "resolved";
  resolved_at?: string | null;
  /** Oldest first. The first entry is the original report. */
  updates: InjuryUpdate[];
};

export const MAX_INJURY_TEXT = 2000;

export function parseInjuries(raw: string | null): Injury[] {
  try {
    const list = JSON.parse(raw ?? "[]");
    if (!Array.isArray(list)) return [];
    return list.filter(
      (i): i is Injury => i && typeof i.id === "string" && typeof i.title === "string" && Array.isArray(i.updates)
    );
  } catch {
    // A hand-edit that broke the JSON shouldn't blank the tab.
    return [];
  }
}

const serialize = (list: Injury[]) => JSON.stringify(list, null, 2) + "\n";

/** "Left elbow sore on curls. Worse on the..." -> "Left elbow sore on curls" */
export function titleFrom(text: string): string {
  const first = text
    .trim()
    .split(/(?<=[.!?])\s|\n/)[0]
    .replace(/[.!?]+$/, "");
  if (first.length <= 60) return first;
  const cut = first.slice(0, 60);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 30 ? cut.lastIndexOf(" ") : 60)}…`;
}

/** A new active injury from a free-text report. Returns the new file text and the injury. */
export function addInjury(current: string | null, text: string, date: string, now: string) {
  const list = parseInjuries(current);
  const taken = new Set(list.map((i) => i.id));
  let n = 1;
  while (taken.has(`${date}-${n}`)) n++;
  const injury: Injury = {
    id: `${date}-${n}`,
    title: titleFrom(text),
    started: date,
    status: "active",
    updates: [{ at: now, text: text.trim() }],
  };
  return { text: serialize([...list, injury]), injury };
}

/** Apply `change` to one injury. Null when there's no such injury, so the route can 404. */
function edit(current: string | null, id: string, change: (i: Injury) => Injury) {
  const list = parseInjuries(current);
  const found = list.find((i) => i.id === id);
  if (!found) return null;
  const next = change(found);
  return { text: serialize(list.map((i) => (i === found ? next : i))), injury: next };
}

export const addUpdate = (current: string | null, id: string, text: string, now: string) =>
  edit(current, id, (i) => ({ ...i, updates: [...i.updates, { at: now, text: text.trim() }] }));

export const setStatus = (current: string | null, id: string, status: Injury["status"], now: string) =>
  edit(current, id, (i) => ({
    ...i,
    status,
    resolved_at: status === "resolved" ? now : null,
    updates: [...i.updates, { at: now, text: status === "resolved" ? "Marked resolved." : "Reopened." }],
  }));
