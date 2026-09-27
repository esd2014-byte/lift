"use client";

import { useState } from "react";

/**
 * Long-form coaching, plus the injury-note field.
 *
 * The details block stays closed by default: at 7am the session matters more than
 * the reasoning behind it. But the injury field lives inside it deliberately -
 * that's where you go when something hurts, and it keeps the note next to the
 * existing injury context rather than floating on its own.
 */
export default function Coaching({ html, injuryHtml }: { html: string; injuryHtml: string }) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");

  async function save() {
    const text = note.trim();
    if (!text) return;
    setState("saving");
    try {
      const res = await fetch("/api/injury-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: text }),
      });
      if (!res.ok) throw new Error(await res.text());
      setState("done");
    } catch {
      setState("error");
    }
  }

  return (
    <section>
      <div className="head"><h2>Coaching</h2></div>
      <div className="coach" dangerouslySetInnerHTML={{ __html: html }} />

      <details className="coach-more">
        <summary>Injury notes &amp; frequency</summary>
        <div className="coach" style={{ marginTop: 8 }} dangerouslySetInnerHTML={{ __html: injuryHtml }} />

        {state === "done" ? (
          <div className="callout accent" style={{ marginTop: 12 }}>
            <b>Note saved.</b>
            <div style={{ marginTop: 6 }}>&ldquo;{note.trim()}&rdquo;</div>
            <div style={{ marginTop: 10, fontSize: ".84rem" }}>
              Tomorrow&apos;s brief reads this and proposes a change to the standing injury rules if
              one is warranted. It won&apos;t silently rewrite them.
            </div>
          </div>
        ) : (
          <div style={{ marginTop: 14 }}>
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
            <button className="btn block quiet" onClick={save} disabled={state === "saving" || !note.trim()} style={{ marginTop: 10 }}>
              {state === "saving" ? "Saving…" : "Add injury note"}
            </button>
            {state === "error" && <p className="note">Didn&apos;t save. Try again.</p>}
          </div>
        )}
      </details>
    </section>
  );
}
