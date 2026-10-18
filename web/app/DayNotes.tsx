"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { didntSave, postJson } from "@/lib/postJson";
import type { DayNote } from "@/lib/dayNotes";
import type { Question } from "@/lib/recent";

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

/**
 * The athlete's account of a recent day, for the coach. The logs say what the devices
 * recorded; this says what it meant. Questions on top are what the app couldn't work
 * out from the logs. Tomorrow's brief reads the notes before it reads the logs.
 */
export default function DayNotes({
  notes,
  dates,
  questions,
}: {
  notes: DayNote[];
  /** Dates a note can be for, newest first: today and the two days before. */
  dates: string[];
  questions: Question[];
}) {
  const router = useRouter();
  const box = useRef<HTMLTextAreaElement>(null);
  const [date, setDate] = useState(dates[0]);
  const [question, setQuestion] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [trained, setTrained] = useState(false);
  const [state, setState] = useState<"idle" | "saving">("idle");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<DayNote[]>([]);

  const label = (d: string) => (d === dates[0] ? "Today" : d === dates[1] ? "Yesterday" : weekday(d));
  const all = [...notes, ...saved];
  const open = questions.filter((q) => !saved.some((n) => n.date === q.date));
  const recent = all.filter((n) => dates.includes(n.date)).sort((a, b) => (a.logged_at < b.logged_at ? 1 : -1));

  function answer(q: Question) {
    setQuestion(q.text);
    setDate(q.date);
    box.current?.focus();
  }

  async function save() {
    if (!text.trim()) return setError("Say what happened first.");
    setError(null);
    setState("saving");
    try {
      const res = await postJson<{ note: DayNote }>("/api/day-note", {
        text: text.trim(),
        date,
        trained,
        ...(question ? { question } : {}),
      });
      setSaved((s) => [...s, res.note]);
      setText("");
      setTrained(false);
      setQuestion(null);
      // The streak and week strip are computed on the server; a trained day changes them.
      if (res.note.trained) router.refresh();
    } catch (err) {
      setError(didntSave(err));
    }
    setState("idle");
  }

  return (
    <>
      <p className="eyebrow" style={{ marginTop: 22 }}>
        What actually happened
      </p>
      {open.length > 0 && (
        <ul className="questions" aria-label="Questions from your logs">
          {open.map((q) => (
            <li key={q.date + q.text}>
              <button type="button" className="question" aria-pressed={question === q.text} onClick={() => answer(q)}>
                {q.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chips" role="group" aria-label="Which day">
        {dates.map((d) => (
          <button key={d} type="button" className="chip" aria-pressed={date === d} onClick={() => setDate(d)}>
            {label(d)}
          </button>
        ))}
      </div>
      {question && (
        <p className="hint" style={{ marginTop: 9 }}>
          Answering: {question}{" "}
          <button type="button" className="linkish" onClick={() => setQuestion(null)}>
            clear
          </button>
        </p>
      )}
      <label htmlFor="daynote" className="sr-only">
        What happened {label(date).toLowerCase()}
      </label>
      <textarea
        ref={box}
        className="reason"
        style={{ marginTop: 9 }}
        id="daynote"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What happened that the logs won't show?"
      />
      <label className="check">
        <input type="checkbox" checked={trained} onChange={(e) => setTrained(e.target.checked)} />
        <span>Count {label(date).toLowerCase()} as a training day</span>
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
                {label(n.date)}
                {n.trained && <span className="tag">training day</span>}
              </span>
              {n.question && <p className="sub">{n.question}</p>}
              <p>{n.text}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
