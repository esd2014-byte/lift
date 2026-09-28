/**
 * The rule four logs share: one entry per day, and submitting again replaces that
 * day's entry rather than adding a second. Kept sorted by date so the files read
 * well in the repo. Pure text in, text out - the routes do the I/O.
 */

/** A CSV with a header row and a leading date column. */
export function upsertCsvDay(
  current: string | null,
  header: string,
  date: string,
  row: string
): { text: string; rows: string[] } {
  const lines = (current ?? header + "\n").trimEnd().split("\n");
  const head = lines[0] || header;
  const rows = lines
    .slice(1)
    .filter((r) => r && !r.startsWith(`${date},`))
    .concat(`${date},${row}`)
    .sort();
  return { text: [head, ...rows].join("\n") + "\n", rows };
}

/** A JSON array of records that each carry a `date`. Unreadable content starts over. */
export function upsertJsonDay<T extends { date: string }>(current: string | null, record: T): string {
  let list: T[] = [];
  try {
    const parsed = JSON.parse(current ?? "[]");
    if (Array.isArray(parsed)) list = parsed;
  } catch {
    // A hand-edit that broke the JSON shouldn't block logging today.
  }
  list = list.filter((r) => r?.date !== record.date);
  list.push(record);
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return JSON.stringify(list, null, 2) + "\n";
}
