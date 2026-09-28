"use client";

import { useMemo, useState } from "react";
import type { Exercise } from "@/lib/library";
import { didntSave, postJson } from "@/lib/postJson";

const OPTIONS = [
  { value: "loved", label: "Love it" },
  { value: "fine", label: "Fine" },
  { value: "disliked", label: "Not for me" },
  { value: "forbidden", label: "Never program" },
] as const;

/** "voltra_platform" -> "Voltra platform". The library's ids are for the program, not for reading. */
const human = (id: string | undefined) => (id ? (id[0].toUpperCase() + id.slice(1)).replace(/_/g, " ") : "");

export default function RateList({ exercises }: { exercises: Exercise[] }) {
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [savedCount, setSavedCount] = useState(0);
  const [onlyUnrated, setOnlyUnrated] = useState(true);

  const current = (ex: Exercise) => pending[ex.id] ?? saved[ex.id] ?? ex.tolerance;

  const shown = useMemo(
    () => exercises.filter((ex) => !onlyUnrated || current(ex) === "untested" || pending[ex.id]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exercises, onlyUnrated, pending, saved]
  );

  const count = Object.keys(pending).length;

  async function save() {
    if (!count) return;
    setState("saving");
    setError(null);
    try {
      await postJson("/api/tolerance", { updates: pending });
      setSaved({ ...saved, ...pending });
      setSavedCount(count);
      setPending({});
      setState("idle");
    } catch (err) {
      setError(didntSave(err));
      setState("error");
    }
  }

  const unrated = exercises.filter((ex) => current(ex) === "untested").length;

  return (
    <>
      <p className="sub">
        {unrated} of {exercises.length} still unrated. This is what makes exercise selection yours rather than generic —
        rate them as you train.
      </p>

      <div style={{ margin: "10px 0 14px" }}>
        <button className="btn quiet" onClick={() => setOnlyUnrated(!onlyUnrated)}>
          {onlyUnrated ? "Show all" : "Show unrated only"}
        </button>
      </div>
      {savedCount > 0 && count === 0 && (
        <p className="callout accent" role="status" style={{ marginBottom: 14 }}>
          Saved {savedCount} rating{savedCount === 1 ? "" : "s"} ✓ The coach uses them from tomorrow&apos;s brief.
        </p>
      )}

      {shown.length === 0 && (
        <div className="card">
          <div className="empty">Nothing unrated. Tap &ldquo;Show all&rdquo; to revise.</div>
        </div>
      )}

      <div className="stack">
        {shown.map((ex) => (
          <div className="card" key={ex.id}>
            <div style={{ fontWeight: 550, marginBottom: 2 }}>
              {ex.name}
              {ex.anchor && <span className="tag">anchor</span>}
            </div>
            <div className="label" style={{ marginBottom: 9 }}>
              {human(ex.section)} {ex.station ? `· ${human(ex.station)}` : ""}
            </div>
            <div className="choices" role="group" aria-label={`Rate ${ex.name}`}>
              {OPTIONS.map((o) => {
                const active = current(ex) === o.value;
                return (
                  <button
                    key={o.value}
                    className={active ? "choice active" : "choice"}
                    aria-pressed={active}
                    onClick={() =>
                      setPending((p) => {
                        const next = { ...p };
                        if (active) delete next[ex.id];
                        else next[ex.id] = o.value;
                        return next;
                      })
                    }
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {count > 0 && (
        <div className="savebar">
          <button className="btn block big" onClick={save} disabled={state === "saving"}>
            {state === "saving" ? "Saving…" : `Save ${count} rating${count === 1 ? "" : "s"}`}
          </button>
          {error && (
            <p className="note" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
