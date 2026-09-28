import { ZONE } from "@/lib/date";

/**
 * Only speaks up when a feed has stopped. A sync that quietly fails still leaves a
 * plausible-looking brief behind, built on stale data - which is the one failure
 * this system exists to prevent - so a stale feed has to be visible on the page.
 */
const STALE_HOURS = 26;

function describe(name: string, at: string | null, now: number) {
  if (!at) return `${name} has never synced.`;
  const hours = (now - Date.parse(at)) / 3_600_000;
  if (hours <= STALE_HOURS) return null;
  const when = new Date(at).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: ZONE,
  });
  return `${name} last synced ${when}.`;
}

/** Warn this far ahead of the data key expiring: enough time to make a new one. */
const EXPIRY_WARN_DAYS = 14;

export default function SyncStatus({
  hevySyncedAt,
  voltraSyncedAt,
  tokenExpiresAt = null,
  now = Date.now(),
}: {
  hevySyncedAt: string | null;
  voltraSyncedAt: string | null;
  tokenExpiresAt?: Date | null;
  now?: number;
}) {
  const problems = [describe("Hevy", hevySyncedAt, now), describe("Voltra", voltraSyncedAt, now)].filter(Boolean);
  const daysLeft = tokenExpiresAt ? Math.floor((tokenExpiresAt.getTime() - now) / 86_400_000) : null;
  const expiring = daysLeft !== null && daysLeft <= EXPIRY_WARN_DAYS;
  if (!problems.length && !expiring) return null;
  return (
    <>
      {problems.length > 0 && (
        <p className="sub syncwarn" role="status">
          {problems.join(" ")} Recent workouts may be missing from the streak and the brief.
        </p>
      )}
      {expiring && (
        <p className="sub syncwarn" role="status">
          The data key expires {daysLeft! <= 0 ? "today" : `in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}. Make a new
          fine-grained token for the data repo and set it as DATA_TOKEN in Vercel, or the app stops loading.
        </p>
      )}
    </>
  );
}
