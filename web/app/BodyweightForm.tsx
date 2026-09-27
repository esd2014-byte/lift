"use client";

import { useState } from "react";

export default function BodyweightForm({ logged, rolling7 }: { logged: number | null; rolling7: number | null }) {
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [result, setResult] = useState<{ weight: number; rolling7: number; n: number } | null>(null);

  async function submit() {
    const weight = Number(value);
    if (!Number.isFinite(weight) || weight <= 0) return;
    setState("saving");
    try {
      const res = await fetch("/api/bodyweight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weight }),
      });
      if (!res.ok) throw new Error(await res.text());
      setResult(await res.json());
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done" && result) {
    return (
      <div className="card">
        <div className="label">Bodyweight logged</div>
        <div className="big">{result.weight} lb</div>
        <div className="note">
          7-day average {result.rolling7} lb{result.n < 7 ? ` (${result.n} day${result.n === 1 ? "" : "s"} so far)` : ""}
        </div>
      </div>
    );
  }

  if (logged !== null) {
    return (
      <div className="card">
        <div className="label">Bodyweight today</div>
        <div className="big">{logged} lb</div>
        {rolling7 !== null && <div className="note">7-day average {rolling7} lb</div>}
      </div>
    );
  }

  return (
    <div className="card">
      <div className="label">Bodyweight this morning</div>
      <div className="row">
        <input
          type="number"
          inputMode="decimal"
          step="0.1"
          placeholder="152.0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Bodyweight in pounds"
        />
        <button onClick={submit} disabled={state === "saving" || !value}>
          {state === "saving" ? "Saving" : "Log"}
        </button>
      </div>
      {state === "error" && <div className="note">Didn&apos;t save. Try again.</div>}
    </div>
  );
}
