"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { didntSave, postJson } from "@/lib/postJson";
import type { DayNote } from "@/lib/dayNotes";

const shortDay = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

/**
 * The athlete's account of the day, for the coach. The logs say what the devices
 * recorded; this says what it meant ("the three Beyond+ sessions were one calibration
 * run", "did 50 pushups last night, not logged anywhere"). Tomorrow's brief reads it
 * before it reads the logs.
 */
export default function DayNotes({ notes, today, yesterday }: { notes: DayNote[]; today: string; yesterday: string }) {
  const router = useRouter();
  const [when, setWhen] = useState<"today" | "yesterday">("today");
  const [text, setText] = useState("");
  const [trained, setTrained] = useState(false);
  const [state, setState] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<DayNote[]>([]);

  const recent = [...notes, ...saved]
    .filter((n) => n.date === today || n.date === yesterday)
    .sort((a, b) => (a.logged_at < b.logged_at ? 1 : -1));

  async function save() {
    if (!text.trim()) return setError("Say what happened first.");
    setError(null);
    setState("saving");
    try {
      const res = await postJson<{ note: DayNote }>("/api/day-note", { text: text.trim(), when, trained });
      setSaved((s) => [...s, res.note]);
      setText("");
      setTrained(false);
      // The streak and week strip are computed on the server; a trained day changes them.
      if (res.note.trained) router.refresh();
    } catch (err) {
      setError(didntSave(err));
    }
    setState("idle");
  }

  return (
    <section>
      <div className="head">
        <h2>What actually happened</h2>
      </div>
      <p className="sub" style={{ marginTop: 0 }}>
        Anything the logs get wrong or miss: a session split across apps, calibration sets, work you didn&apos;t log.
        The coach reads this before it reads Hevy and Beyond+, and plans the next day from it.
      </p>
      <div className="chips" role="group" aria-label="Which day">
        {(["today", "yesterday"] as const).map((w) => (
          <button key={w} type="button" className="chip" aria-pressed={when === w} onClick={() => setWhen(w)}>
            {w === "today" ? "Today" : "Yesterday"}
          </button>
        ))}
      </div>
      <label htmlFor="daynote" className="sr-only">
        What happened {when}
      </label>
      <textarea
        className="reason"
        style={{ marginTop: 9 }}
        id="daynote"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Started with weighted pull-ups on the Voltra, then kept calibrating: rows, shrugs, face pulls. Beyond+ saved it as four sessions; it was one workout, Day B."
      />
      <label className="check">
        <input type="checkbox" checked={trained} onChange={(e) => setTrained(e.target.checked)} />
        <span>Count {when} as a training day</span>
      </label>
      <button className="btn block quiet" onClick={save} disabled={state === "saving"} style={{ marginTop: 10 }}>
        {state === "saving" ? "Saving…" : "Tell the coach"}
      </button>
      {error && (
        <p className="note" role="alert">
          {error}
        </p>
      )}
      {recent.length > 0 && (
        <ul className="notelist" aria-label="Recent notes">
          {recent.map((n) => (
            <li key={n.logged_at}>
              <span className="eyebrow" style={{ margin: 0 }}>
                {n.date === today ? "Today" : shortDay(n.date)}
                {n.trained && <span className="tag">training day</span>}
              </span>
              <p>{n.text}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
