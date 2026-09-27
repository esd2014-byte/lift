/**
 * Everything in this app is anchored to Eli's local day, not UTC.
 *
 * This matters more than it looks: the cloud routine's cron is UTC-only, so in
 * winter the brief is generated at 6am local rather than 7am. The app must still
 * agree with him about what "today" is, wherever he happens to be training.
 */
const ZONE = "America/New_York";

export function todayISO(zone: string = ZONE): string {
  // en-CA gives YYYY-MM-DD directly.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function prettyDate(iso: string, zone: string = ZONE): string {
  // Parse as noon UTC so the date can't slip a day either way.
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(`${iso}T12:00:00Z`));
}

/**
 * The local calendar day a timestamp falls on.
 *
 * Both APIs return UTC. Slicing the first 10 characters puts anything after 8pm
 * Eastern on the next day, which breaks the streak exactly when evening sessions
 * happen. A timestamp with no offset is treated as UTC, which is what the Voltra
 * API sends.
 */
export function localDateOf(timestamp: string, zone: string = ZONE): string {
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(timestamp);
  const ms = Date.parse(hasOffset ? timestamp : `${timestamp}Z`);
  if (Number.isNaN(ms)) return timestamp.slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}
