/**
 * Pure text editing for tolerance values in library/exercises.yaml.
 *
 * Deliberately dependency-free so it can be unit-tested in isolation: this function
 * rewrites the source of truth for the whole program, and exercises.yaml is heavily
 * commented (station rules, injury rationale, why each anchor was chosen). A
 * parse/stringify round-trip would delete all of that silently. So we find each
 * entry by id and rewrite only its `tolerance:` value, leaving every other byte alone.
 *
 * Handles both shapes the file uses: block entries (`- id: foo` across several lines)
 * and flow entries (`- {id: foo, ..., tolerance: untested}`).
 */

export const TOLERANCES = ["loved", "fine", "untested", "disliked", "forbidden"] as const;
export type Tolerance = (typeof TOLERANCES)[number];

export function applyTolerances(raw: string, updates: Record<string, string>): string {
  let out = raw;

  for (const [id, value] of Object.entries(updates)) {
    if (!(TOLERANCES as readonly string[]).includes(value)) {
      throw new Error(`invalid tolerance: ${value}`);
    }

    const idMatch = new RegExp(`(^|[\\s{])id:\\s*${escapeRegExp(id)}\\s*(,|$|\\n)`, "m").exec(out);
    if (!idMatch) throw new Error(`exercise not found: ${id}`);

    const start = idMatch.index;
    const rest = out.slice(start + 1);
    const nextItem = rest.search(/\n\s*-\s/);
    const end = nextItem === -1 ? out.length : start + 1 + nextItem;

    const entry = out.slice(start, end);
    const replaced = entry.replace(
      /tolerance:\s*(loved|fine|untested|disliked|forbidden)/,
      `tolerance: ${value}`
    );
    if (replaced === entry) throw new Error(`no tolerance field found for: ${id}`);

    out = out.slice(0, start) + replaced + out.slice(end);
  }

  // Once anything has been rated, the file is no longer un-reviewed.
  return out.replace(/tolerance_reviewed_by_eli:\s*false/, "tolerance_reviewed_by_eli: true");
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
