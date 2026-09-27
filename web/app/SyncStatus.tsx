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
    timeZone: "America/New_York",
  });
  return `${name} last synced ${when}.`;
}

export default function SyncStatus({
  hevySyncedAt,
  voltraSyncedAt,
  now = Date.now(),
}: {
  hevySyncedAt: string | null;
  voltraSyncedAt: string | null;
  now?: number;
}) {
  const problems = [describe("Hevy", hevySyncedAt, now), describe("Voltra", voltraSyncedAt, now)].filter(Boolean);
  if (!problems.length) return null;
  return (
    <p className="sub syncwarn" role="status">
      {problems.join(" ")} Recent workouts may be missing from the streak and the brief.
    </p>
  );
}
