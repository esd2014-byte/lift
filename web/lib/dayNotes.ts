/**
 * The athlete's own account of a day: what was actually done, and why.
 *
 * The digests say what the devices recorded, which isn't always what happened.
 * Beyond+ can't edit a saved session, so a calibration day turns into a pile of
 * half-sessions; pushups on the living-room floor never get logged at all. A note
 * says what the data means, and the morning routine reads it before it reads the
 * data. `trained` makes a day count toward the streak even when nothing synced.
 *
 * Several notes a day are fine: they're appended, never replaced.
 */

export type DayNote = {
  date: string;
  text: string;
  /** Count this date as a training day, whatever the logs say. */
  trained: boolean;
  logged_at: string;
};

export const MAX_NOTE_TEXT = 2000;

export function parseDayNotes(raw: string | null): DayNote[] {
  try {
    const list = JSON.parse(raw ?? "[]");
    return Array.isArray(list) ? list.filter((n) => n && typeof n.date === "string" && typeof n.text === "string") : [];
  } catch {
    return [];
  }
}

/** Append a note, keeping the file in date order. */
export function addDayNote(current: string | null, note: DayNote): string {
  const list = [...parseDayNotes(current), note].sort((a, b) =>
    a.date === b.date ? (a.logged_at < b.logged_at ? -1 : 1) : a.date < b.date ? -1 : 1
  );
  return JSON.stringify(list, null, 2) + "\n";
}

/** Days the athlete said they trained. They count toward the streak. */
export function noteTrainedDates(notes: DayNote[]): string[] {
  return [...new Set(notes.filter((n) => n.trained).map((n) => n.date))];
}
