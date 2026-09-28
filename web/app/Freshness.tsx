"use client";

import { useState } from "react";

/**
 * Says whether what you're looking at is today's, and gives you a way to fix it
 * when it isn't. Refresh re-pulls Hevy and the Voltra; it can't write the brief
 * (that's the morning routine's job and it needs a model), so the copy says which.
 */
export default function Freshness({
  zone,
  stale,
  briefDate,
  generatedAt,
}: {
  /** The app's time zone. Passed in: this runs in the browser, which can't read server settings. */
  zone: string;
  stale: boolean;
  briefDate: string | null;
  generatedAt: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [failed, setFailed] = useState(false);

  // A failed refresh must not reload as if it worked.
  async function refresh() {
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch("/api/refresh", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      setDone(true);
      window.location.reload();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  const time = generatedAt
    ? new Date(generatedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: zone,
      })
    : null;

  if (!stale) {
    return (
      <div className="freshness fresh">
        <span className="fdot" />
        <span>{time ? `Written ${time} today` : "Today's brief"}</span>
      </div>
    );
  }

  const label = briefDate
    ? new Date(`${briefDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long" })
    : "never";

  return (
    <button className="freshness stale" onClick={refresh} disabled={busy}>
      <span className="fdot" />
      <span>
        {busy ? (
          "Syncing Hevy and Voltra…"
        ) : done ? (
          "Synced"
        ) : failed ? (
          <>
            Sync failed · <u>Try again</u>
          </>
        ) : briefDate ? (
          <>
            Today&apos;s plan isn&apos;t written yet · showing {label}&apos;s · <u>Sync workouts</u>
          </>
        ) : (
          <>
            No plan yet · <u>Sync workouts</u>
          </>
        )}
      </span>
    </button>
  );
}
