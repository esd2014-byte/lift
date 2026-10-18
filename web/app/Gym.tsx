"use client";

import { useState } from "react";
import { didntSave, postJson } from "@/lib/postJson";
import { isActive, LISTS, type Equipment, type ExerciseCard, type ListId } from "@/lib/gymShared";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};
const lb = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(1)}`;
const SECTION_NAMES: Record<string, string> = {
  anchors: "Anchors",
  push: "Push",
  pull: "Pull",
  lower: "Lower",
  core_prehab: "Core & prehab",
  parked: "Parked",
};

type Save = (body: Record<string, unknown>) => Promise<boolean>;

/**
 * The Gym tab. Home: what's in the basement. Active and Excluded: which exercises
 * the coach may program. Changes reach the coach's plan from tomorrow's brief, and
 * days the app builds itself right away. History is never touched.
 */
export default function Gym({ equipment, exercises }: { equipment: Equipment | null; exercises: ExerciseCard[] }) {
  const [eq, setEq] = useState(equipment);
  const [cards, setCards] = useState(exercises);
  const [error, setError] = useState<string | null>(null);

  const save: Save = async (body) => {
    setError(null);
    try {
      await postJson("/api/gym", body);
      return true;
    } catch (err) {
      setError(didntSave(err));
      return false;
    }
  };

  async function toggle(c: ExerciseCard) {
    const status = isActive(c) ? "inactive" : "active";
    if (await save({ action: "exercise", id: c.id, status })) {
      setCards((cs) => cs.map((x) => (x.id === c.id ? { ...x, status } : x)));
    }
  }

  const active = cards.filter(isActive);
  const excluded = cards.filter((c) => !isActive(c));

  return (
    <section>
      <div className="head">
        <h2>Gym</h2>
      </div>
      <p className="sub" style={{ marginTop: 0 }}>
        Changes here reach the coach&apos;s plan from tomorrow morning. Days the app builds itself follow them now.
      </p>
      {error && (
        <p className="note" role="alert">
          {error}
        </p>
      )}

      <details className="adjust gymsec" open>
        <summary>
          <span>Home</span>
          <span className="change">Show</span>
        </summary>
        {eq ? <Home eq={eq} setEq={setEq} save={save} /> : <p className="empty">No equipment list in the data repo.</p>}
      </details>

      <details className="adjust gymsec">
        <summary>
          <span>Active exercises</span>
          <span className="current">{active.length}</span>
          <span className="change">Show</span>
        </summary>
        <p className="hint">In rotation: the coach can program these.</p>
        <ExerciseList cards={active} onToggle={toggle} />
      </details>

      <details className="adjust gymsec">
        <summary>
          <span>Excluded exercises</span>
          <span className="current">{excluded.length}</span>
          <span className="change">Show</span>
        </summary>
        <p className="hint">Never programmed. Their history stays, and still counts.</p>
        <ExerciseList cards={excluded} onToggle={toggle} />
      </details>
    </section>
  );
}

function ExerciseList({ cards, onToggle }: { cards: ExerciseCard[]; onToggle: (c: ExerciseCard) => void }) {
  if (!cards.length) return <p className="empty">None.</p>;
  const sections = [...new Set(cards.map((c) => c.section))];
  return (
    <>
      {sections.map((s) => (
        <div key={s}>
          <p className="eyebrow" style={{ marginTop: 14 }}>
            {SECTION_NAMES[s] ?? s}
          </p>
          <ul className="excards">
            {cards
              .filter((c) => c.section === s)
              .map((c) => (
                <ExerciseCardView key={c.id} c={c} onToggle={onToggle} />
              ))}
          </ul>
        </div>
      ))}
    </>
  );
}

function ExerciseCardView({ c, onToggle }: { c: ExerciseCard; onToggle: (c: ExerciseCard) => void }) {
  const [busy, setBusy] = useState(false);
  const on = isActive(c);
  return (
    <li className="excard">
      <div className="excard-head">
        <span className="exname">{c.name}</span>
        {c.anchor && <span className="tag">anchor</span>}
      </div>
      <p className="station">
        {[c.stationName, c.tolerance && c.tolerance !== "untested" ? c.tolerance : ""].filter(Boolean).join(" · ")}
      </p>
      {c.last ? (
        <p className="exnums num">
          <b>{c.last.lb != null ? `${lb(c.last.lb)} lb × ${c.last.reps}` : `${c.last.reps} reps`}</b>
          <span className="sep"> · </span>
          {md(c.last.date)}
          {c.e1rm != null && (
            <>
              <span className="sep"> · </span>1RM ~<b>{c.e1rm}</b>
            </>
          )}
        </p>
      ) : (
        <p className="hint" style={{ margin: "4px 0 0" }}>
          No logged sets yet.
        </p>
      )}
      {c.locked ? (
        <p className="hint" style={{ margin: "6px 0 0" }}>
          {c.locked}
        </p>
      ) : (
        <button
          className="btn quiet block"
          style={{ marginTop: 8 }}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await onToggle(c);
            setBusy(false);
          }}
        >
          {busy ? "Saving…" : on ? "Deactivate" : "Activate"}
        </button>
      )}
    </li>
  );
}

function Home({ eq, setEq, save }: { eq: Equipment; setEq: (e: Equipment) => void; save: Save }) {
  return (
    <div className="gymhome">
      <p className="eyebrow" style={{ marginTop: 10 }}>
        Dumbbells
      </p>
      {eq.nuobell && (
        <RangeEditor
          label="NUOBELL adjustable"
          value={eq.nuobell}
          onSave={async (v) => {
            if (await save({ action: "nuobell", ...v })) setEq({ ...eq, nuobell: v });
          }}
        />
      )}
      <NumberChips
        label="Fixed pairs (the only ones that superset with the NUOBELLs)"
        values={eq.fixedDumbbells}
        onChange={async (sizes) => {
          if (await save({ action: "fixed_dumbbells", sizes })) setEq({ ...eq, fixedDumbbells: sizes });
        }}
      />

      <p className="eyebrow" style={{ marginTop: 16 }}>
        Kettlebells
      </p>
      <NumberChips
        label="Fixed bells"
        values={eq.kettlebells}
        onChange={async (sizes) => {
          if (await save({ action: "kettlebells", sizes })) setEq({ ...eq, kettlebells: sizes });
        }}
      />
      {eq.adjustableKb && (
        <RangeEditor
          label="Adjustable bell"
          value={eq.adjustableKb}
          owned={eq.adjustableKb.owned}
          onSave={async (v, owned) => {
            const next = { ...v, owned: owned ?? true };
            if (await save({ action: "adjustable_kb", ...next })) setEq({ ...eq, adjustableKb: next });
          }}
        />
      )}

      {(Object.keys(LISTS) as ListId[]).map((id) => (
        <TextList
          key={id}
          label={LISTS[id].label}
          items={eq.lists[id]}
          onAdd={async (item) => {
            if (await save({ action: "list_add", list: id, item }))
              setEq({ ...eq, lists: { ...eq.lists, [id]: [...eq.lists[id], item] } });
          }}
          onRemove={async (item) => {
            if (await save({ action: "list_remove", list: id, item }))
              setEq({ ...eq, lists: { ...eq.lists, [id]: eq.lists[id].filter((x) => x !== item) } });
          }}
        />
      ))}

      {eq.other.length > 0 && (
        <>
          <p className="eyebrow" style={{ marginTop: 16 }}>
            Also in the gym
          </p>
          <ul className="facts">
            {eq.other.map((o) => (
              <li key={o}>{o}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function RangeEditor({
  label,
  value,
  owned,
  onSave,
}: {
  label: string;
  value: { min: number; max: number; step: number };
  owned?: boolean;
  onSave: (v: { min: number; max: number; step: number }, owned?: boolean) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState({ min: String(value.min), max: String(value.max), step: String(value.step) });
  const [own, setOwn] = useState(owned ?? true);
  if (!editing)
    return (
      <div className="gymrow">
        <span>
          <b>{label}</b>
          <span className="num">
            {" "}
            {lb(value.min)}–{lb(value.max)} lb by {lb(value.step)}
          </span>
          {owned === false && <span className="tag">not owned</span>}
        </span>
        <button type="button" className="linkish" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
    );
  return (
    <div className="gymedit">
      <b>{label}</b>
      <div className="gymfields">
        {(["min", "max", "step"] as const).map((k) => (
          <label key={k}>
            <span className="label">{k === "min" ? "lightest" : k === "max" ? "heaviest" : "step"}</span>
            <input
              inputMode="decimal"
              value={v[k]}
              onChange={(e) => setV({ ...v, [k]: e.target.value })}
              aria-label={`${label} ${k}`}
            />
          </label>
        ))}
      </div>
      {owned !== undefined && (
        <label className="check">
          <input type="checkbox" checked={own} onChange={(e) => setOwn(e.target.checked)} />
          <span>Owned</span>
        </label>
      )}
      <div className="photorow" style={{ marginTop: 8 }}>
        <button className="btn quiet" onClick={() => setEditing(false)}>
          Cancel
        </button>
        <button
          className="btn"
          onClick={async () => {
            await onSave({ min: Number(v.min), max: Number(v.max), step: Number(v.step) }, own);
            setEditing(false);
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}

function NumberChips({
  label,
  values,
  onChange,
}: {
  label: string;
  values: number[];
  onChange: (v: number[]) => Promise<void>;
}) {
  const [add, setAdd] = useState("");
  return (
    <div className="gymlist">
      <p className="hint" style={{ margin: "8px 0 6px" }}>
        {label}
      </p>
      <div className="chips">
        {values.map((n, i) => (
          <button
            key={`${n}-${i}`}
            type="button"
            className="chip removable"
            aria-label={`Remove ${n} lb`}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            {lb(n)} lb ×
          </button>
        ))}
        <span className="chipadd">
          <input
            inputMode="decimal"
            value={add}
            onChange={(e) => setAdd(e.target.value)}
            placeholder="lb"
            aria-label={`Add to ${label}`}
          />
          <button
            type="button"
            className="chip"
            onClick={async () => {
              const n = Number(add);
              if (!(n > 0)) return;
              await onChange([...values, n].sort((a, b) => a - b));
              setAdd("");
            }}
          >
            Add
          </button>
        </span>
      </div>
    </div>
  );
}

function TextList({
  label,
  items,
  onAdd,
  onRemove,
}: {
  label: string;
  items: string[];
  onAdd: (item: string) => Promise<void>;
  onRemove: (item: string) => Promise<void>;
}) {
  const [add, setAdd] = useState("");
  return (
    <div className="gymlist">
      <p className="eyebrow" style={{ marginTop: 16 }}>
        {label}
      </p>
      <ul className="textlist">
        {items.map((it) => (
          <li key={it}>
            <span>{it}</span>
            <button type="button" className="linkish" aria-label={`Remove ${it}`} onClick={() => onRemove(it)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="chipadd wide">
        <input
          value={add}
          onChange={(e) => setAdd(e.target.value)}
          placeholder="Add an item"
          aria-label={`Add to ${label}`}
        />
        <button
          type="button"
          className="chip"
          onClick={async () => {
            if (!add.trim()) return;
            await onAdd(add.trim());
            setAdd("");
          }}
        >
          Add
        </button>
      </div>
    </div>
  );
}
