"use client";

import { useEffect, useState } from "react";
import { didntSave, postJson } from "@/lib/postJson";
import type { Injury } from "@/lib/injuries";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-09-29" or an ISO timestamp -> "Sep 29" */
const md = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};
const daysSince = (iso: string, today: string) =>
  Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${iso.slice(0, 10)}T12:00:00Z`)) / 86400000);

type Act = (body: Record<string, string>) => Promise<void>;

/**
 * Injuries as cards: report one in plain words, add updates as it changes, resolve
 * it when it stops affecting training. The coach reads the active ones every morning
 * and plans around them.
 */
export default function Injuries({ initial, today }: { initial: Injury[]; today: string }) {
  const [list, setList] = useState(initial);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every change goes through one call, and the server's copy replaces ours.
  const act: Act = async (body) => {
    const res = await postJson<{ injury: Injury }>("/api/injuries", body);
    setList((cur) =>
      cur.some((i) => i.id === res.injury.id)
        ? cur.map((i) => (i.id === res.injury.id ? res.injury : i))
        : [...cur, res.injury]
    );
  };

  async function report() {
    if (!text.trim()) return setError("Say what's going on first.");
    setError(null);
    setSaving(true);
    try {
      await act({ action: "create", text: text.trim() });
      setText("");
    } catch (err) {
      setError(didntSave(err));
    }
    setSaving(false);
  }

  const active = list.filter((i) => i.status === "active");
  const resolved = list.filter((i) => i.status === "resolved");

  return (
    <section>
      <div className="head">
        <h2>Injuries</h2>
      </div>
      <label htmlFor="new-injury" className="eyebrow" style={{ display: "block", marginBottom: 7 }}>
        Something new?
      </label>
      <textarea
        className="reason"
        id="new-injury"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Right elbow sore on the inside after curls. Fine at rest, sharp at the bottom of the rep."
      />
      <button className="btn block" onClick={report} disabled={saving} style={{ marginTop: 10 }}>
        {saving ? "Saving…" : "Add injury"}
      </button>
      {error && (
        <p className="note" role="alert">
          {error}
        </p>
      )}

      <p className="eyebrow" style={{ marginTop: 22 }}>
        Affecting training · {active.length}
      </p>
      {active.length ? (
        active.map((i) => <InjuryCard key={i.id} injury={i} today={today} act={act} />)
      ) : (
        <p className="empty">Nothing active. The program runs without injury adjustments.</p>
      )}
      <p className="hint">
        The coach reads these every morning and plans around the active ones. Resolving one tells it to stop.
      </p>

      {resolved.length > 0 && (
        <details className="adjust" style={{ marginTop: 16 }}>
          <summary>
            <span>Resolved</span>
            <span className="current">{resolved.length}</span>
            <span className="change">Show</span>
          </summary>
          <div style={{ marginTop: 10 }}>
            {resolved.map((i) => (
              <InjuryCard key={i.id} injury={i} today={today} act={act} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function InjuryCard({ injury: i, today, act }: { injury: Injury; today: string; act: Act }) {
  const [update, setUpdate] = useState("");
  const [busy, setBusy] = useState<null | "update" | "status">(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isActive = i.status === "active";

  // Resolving takes a second tap, like ending a workout.
  useEffect(() => {
    if (!confirm) return;
    const t = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(t);
  }, [confirm]);

  async function run(kind: "update" | "status", body: Record<string, string>) {
    setError(null);
    setBusy(kind);
    try {
      await act(body);
      if (kind === "update") setUpdate("");
    } catch (err) {
      setError(didntSave(err));
    }
    setBusy(null);
    setConfirm(false);
  }

  function toggle() {
    if (isActive && !confirm) return setConfirm(true);
    run("status", { action: isActive ? "resolve" : "reopen", id: i.id });
  }

  const n = i.started ? daysSince(i.started, today) : null;
  const since = i.started
    ? `since ${md(i.started)}${n !== null && n > 0 ? ` · ${n} day${n === 1 ? "" : "s"}` : ""}`
    : "ongoing";

  return (
    <article className={`card injury${isActive ? "" : " resolved"}`}>
      <div className="injury-head">
        <h3>{i.title}</h3>
        <span className={`pill ${isActive ? "due" : "ok"}`}>{isActive ? "active" : "resolved"}</span>
      </div>
      <p className="sub" style={{ marginTop: 2 }}>
        {isActive ? since : `resolved ${i.resolved_at ? md(i.resolved_at) : ""}`}
      </p>
      <ol className="timeline">
        {[...i.updates].reverse().map((u, k) => (
          <li key={k}>
            <span className="when num">{md(u.at)}</span>
            <span>{u.text}</span>
          </li>
        ))}
      </ol>
      {isActive && (
        <>
          <label htmlFor={`upd-${i.id}`} className="sr-only">
            Update on {i.title}
          </label>
          <textarea
            className="reason small"
            id={`upd-${i.id}`}
            value={update}
            onChange={(e) => setUpdate(e.target.value)}
            placeholder="How is it now?"
          />
          <button
            className="btn block quiet"
            style={{ marginTop: 8 }}
            disabled={busy !== null || !update.trim()}
            onClick={() => run("update", { action: "update", id: i.id, text: update.trim() })}
          >
            {busy === "update" ? "Saving…" : "Add update"}
          </button>
        </>
      )}
      <button
        className={`btn block ${confirm ? "danger" : "quiet"}`}
        style={{ marginTop: 8 }}
        disabled={busy !== null}
        onClick={toggle}
      >
        {busy === "status"
          ? "Saving…"
          : isActive
            ? confirm
              ? "Tap again: no longer affecting training"
              : "Mark resolved"
            : "Reopen"}
      </button>
      {error && (
        <p className="note" role="alert">
          {error}
        </p>
      )}
    </article>
  );
}
