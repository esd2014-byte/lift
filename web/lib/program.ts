import { parse } from "yaml";

/** Program day id -> name ("A" -> "Push"), from program/current.yaml. */
export function parseDayNames(programRaw: string | null): Record<string, string> {
  const dayNames: Record<string, string> = {};
  try {
    const program = parse(programRaw ?? "") as { days?: Record<string, { name?: string }> };
    for (const [id, d] of Object.entries(program?.days ?? {})) {
      if (d?.name) dayNames[id] = d.name;
    }
  } catch {
    // A malformed program shouldn't blank the page; titles fall back to the brief's own.
  }
  return dayNames;
}
