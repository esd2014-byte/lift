"use client";

import { useState, useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

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

  // Say which zone the time is in when the phone is somewhere else (travel).
  // Read in the browser only: the server's zone isn't the phone's, and a guess
  // there would make the two renders disagree.
  const away = useSyncExternalStore(
    noSubscribe,
    () => Intl.DateTimeFormat().resolvedOptions().timeZone !== zone,
    () => false
  );
  const time = generatedAt
    ? new Date(generatedAt).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: zone,
        ...(away ? { timeZoneName: "short" as const } : {}),
      })
    : null;

  const label = briefDate
    ? new Date(`${briefDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
    : null;

  // A status line and a separate button: the line says how current things are, the
  // button pulls today's workouts in. Syncing can't write the brief (that's the
  // morning routine's job), so the button says what it does.
  return (
    <div className="freshrow">
      <p className={`freshness ${stale ? "stale" : "fresh"}`} role="status">
        <span className="fdot" aria-hidden="true" />
        <span>
          {!stale
            ? time
              ? `Written ${time} today`
              : "Today's brief"
            : label
              ? `Today's plan isn't written yet. Showing ${label}'s.`
              : "No plan yet."}
        </span>
      </p>
      <button className="btn quiet small" onClick={refresh} disabled={busy}>
        {busy ? "Syncing…" : done ? "Synced ✓" : failed ? "Sync failed. Try again" : "Sync workouts"}
      </button>
    </div>
  );
}
