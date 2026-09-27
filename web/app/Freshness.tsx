"use client";

import { useState } from "react";

/**
 * Says whether what you're looking at is today's, and gives you a way to fix it
 * when it isn't. Refresh re-pulls Hevy; it can't regenerate the brief (that's the
 * cloud routine's job and it needs a model), so the copy doesn't pretend otherwise.
 */
export default function Freshness({
  stale,
  briefDate,
  generatedAt,
}: {
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
      const res = await fetch("/api/refresh");
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
        timeZone: "America/New_York",
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
        {busy ? "Refreshing…" : done ? "Refreshed" : failed ? <>Refresh failed · <u>Try again</u></> : <>Last written {label} · <u>Refresh</u></>}
      </span>
    </button>
  );
}
