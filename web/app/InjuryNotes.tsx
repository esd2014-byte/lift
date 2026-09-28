"use client";

import { useState } from "react";
import { didntSave, postJson } from "@/lib/postJson";

/**
 * Standing injury context from the brief, plus a field to report something new.
 * Its own tab, so it's open rather than tucked behind a disclosure: this is where
 * you go when something hurts.
 */
export default function InjuryNotes({ html }: { html: string }) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const text = note.trim();
    if (!text) return setError("Write what's going on first.");
    setError(null);
    setState("saving");
    try {
      await postJson("/api/injury-note", { note: text });
      setState("done");
    } catch (err) {
      setError(didntSave(err));
      setState("error");
    }
  }

  return (
    <section>
      <div className="head">
        <h2>Injury notes</h2>
      </div>
      {html.trim() ? (
        <div className="coach" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="empty">No injury flags in today&apos;s brief.</p>
      )}

      {state === "done" ? (
        <div className="callout accent" style={{ marginTop: 12 }}>
          <b>Note saved.</b>
          <div style={{ marginTop: 6 }}>&ldquo;{note.trim()}&rdquo;</div>
          <div style={{ marginTop: 10, fontSize: ".84rem" }}>
            Tomorrow&apos;s brief reads this and proposes a change to the standing injury rules if one is warranted. It
            won&apos;t silently rewrite them.
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 18 }}>
          <label htmlFor="injury" className="eyebrow" style={{ display: "block", marginBottom: 7 }}>
            Anything healing, or anything new?
          </label>
          <textarea
            className="reason"
            id="injury"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Left shoulder felt fine on incline today, first time in months. Right elbow a bit sore on curls — watch it."
          />
          <button className="btn block quiet" onClick={save} disabled={state === "saving"} style={{ marginTop: 10 }}>
            {state === "saving" ? "Saving…" : "Add injury note"}
          </button>
          {error && (
            <p className="note" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
