"use client";

import { useMemo, useState } from "react";
import type { Exercise } from "@/lib/library";

const OPTIONS = [
  { value: "loved", label: "Love" },
  { value: "fine", label: "Fine" },
  { value: "disliked", label: "Dislike" },
  { value: "forbidden", label: "Never" },
] as const;

export default function RateList({ exercises }: { exercises: Exercise[] }) {
  const [pending, setPending] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
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
    try {
      const res = await fetch("/api/tolerance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates: pending }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSaved({ ...saved, ...pending });
      setPending({});
      setState("idle");
    } catch {
      setState("error");
    }
  }

  const unrated = exercises.filter((ex) => current(ex) === "untested").length;

  return (
    <>
      <p className="sub">
        {unrated} of {exercises.length} still unrated. This is what makes exercise
        selection yours rather than generic — rate them as you train.
      </p>

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="ghost" onClick={() => setOnlyUnrated(!onlyUnrated)}>
          {onlyUnrated ? "Show all" : "Show unrated only"}
        </button>
      </div>

      {shown.length === 0 && (
        <div className="card">
          <div className="empty">Nothing unrated. Tap &ldquo;Show all&rdquo; to revise.</div>
        </div>
      )}

      {shown.map((ex) => (
        <div className="card" key={ex.id}>
          <div style={{ fontWeight: 550, marginBottom: 2 }}>
            {ex.name}
            {ex.anchor && <span className="tag">anchor</span>}
          </div>
          <div className="label" style={{ marginBottom: 9 }}>
            {ex.section} {ex.station ? `· ${ex.station}` : ""}
          </div>
          <div className="choices">
            {OPTIONS.map((o) => {
              const active = current(ex) === o.value;
              return (
                <button
                  key={o.value}
                  className={active ? "choice active" : "choice"}
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

      {count > 0 && (
        <div className="savebar">
          <button onClick={save} disabled={state === "saving"}>
            {state === "saving" ? "Saving…" : `Save ${count}`}
          </button>
          {state === "error" && <span className="note">Didn&apos;t save. Try again.</span>}
        </div>
      )}
    </>
  );
}
