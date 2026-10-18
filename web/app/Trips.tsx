"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { didntSave, postJson } from "@/lib/postJson";
import type { Trip } from "@/lib/trips";

const GYMS = [
  ["machines_cardio", "Machines + cardio"],
  ["full_gym", "Full gym"],
  ["db_only", "Dumbbells only"],
  ["bodyweight", "Bodyweight only"],
] as const;
const gymName = (type: string) => GYMS.find(([k]) => k === type)?.[1] ?? type;

const day = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

/**
 * The Hotel section: plan a trip (dates, what the hotel gym has), see the session
 * proposed for each day, change any of them, or come home early. The coach plans
 * each trip morning from this; Today opens on Traveling while you're away.
 */
export default function Trips({
  initial,
  today,
  dayNames,
}: {
  initial: Trip[];
  today: string;
  /** { A: "Push", ... } in rotation order. */
  dayNames: Record<string, string>;
}) {
  const router = useRouter();
  const [trips, setTrips] = useState(initial);
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const upcoming = trips.filter((t) => t.to >= today).sort((a, b) => (a.from < b.from ? -1 : 1));

  async function act(body: Record<string, unknown>, id?: string) {
    setError(null);
    try {
      const res = await postJson<{ trip: Trip | null }>("/api/trips", body);
      setTrips((cur) => {
        const rest = cur.filter((t) => t.id !== (res.trip?.id ?? id));
        return res.trip ? [...rest, res.trip] : rest;
      });
      // Today and the streak read trips on the server.
      router.refresh();
      return true;
    } catch (err) {
      setError(didntSave(err));
      return false;
    }
  }

  return (
    <div>
      {upcoming.map((t) => (
        <TripCard key={t.id} trip={t} today={today} dayNames={dayNames} act={act} />
      ))}
      {!upcoming.length && !planning && <p className="sub">No trips planned. The program runs at home.</p>}
      {planning ? (
        <PlanTrip
          today={today}
          onCancel={() => setPlanning(false)}
          onSave={async (b) => (await act(b)) && setPlanning(false)}
        />
      ) : (
        <button className="btn block quiet" style={{ marginTop: 10 }} onClick={() => setPlanning(true)}>
          Plan a trip
        </button>
      )}
      {error && (
        <p className="note" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

function PlanTrip({
  today,
  onSave,
  onCancel,
}: {
  today: string;
  onSave: (body: Record<string, unknown>) => Promise<unknown>;
  onCancel: () => void;
}) {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [place, setPlace] = useState("");
  const [type, setType] = useState<string>("machines_cardio");
  const [dbMax, setDbMax] = useState("");
  const [kb, setKb] = useState(false);
  const [saving, setSaving] = useState(false);

  return (
    <div className="gymedit" style={{ marginTop: 10 }}>
      <b>Plan a trip</b>
      <div className="gymfields two">
        <label>
          <span className="label">leaving</span>
          <input type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          <span className="label">back</span>
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <label style={{ display: "block", marginTop: 8 }}>
        <span className="label">where (optional)</span>
        <input
          className="wideinput"
          value={place}
          onChange={(e) => setPlace(e.target.value)}
          placeholder="City or hotel"
        />
      </label>
      <p className="label" style={{ marginTop: 12 }}>
        What&apos;s in the hotel gym?
      </p>
      <div className="chips" role="group" aria-label="Hotel gym">
        {GYMS.map(([k, label]) => (
          <button key={k} type="button" className="chip" aria-pressed={type === k} onClick={() => setType(k)}>
            {label}
          </button>
        ))}
      </div>
      {type !== "bodyweight" && (
        <label style={{ display: "block", marginTop: 10 }}>
          <span className="label">heaviest dumbbell (lb, if you know)</span>
          <input className="wideinput" inputMode="decimal" value={dbMax} onChange={(e) => setDbMax(e.target.value)} />
        </label>
      )}
      {type !== "bodyweight" && (
        <label className="check">
          <input type="checkbox" checked={kb} onChange={(e) => setKb(e.target.checked)} />
          <span>It has kettlebells</span>
        </label>
      )}
      <div className="photorow" style={{ marginTop: 10 }}>
        <button className="btn quiet" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn"
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            await onSave({
              action: "create",
              from,
              to,
              ...(place.trim() ? { place: place.trim() } : {}),
              gym: {
                type,
                db_max_lb: Number(dbMax) > 0 ? Number(dbMax) : null,
                kettlebells: type !== "bodyweight" && kb,
              },
            });
            setSaving(false);
          }}
        >
          {saving ? "Planning…" : "Propose sessions"}
        </button>
      </div>
    </div>
  );
}

function TripCard({
  trip: t,
  today,
  dayNames,
  act,
}: {
  trip: Trip;
  today: string;
  dayNames: Record<string, string>;
  act: (body: Record<string, unknown>, id?: string) => Promise<boolean>;
}) {
  const [confirm, setConfirm] = useState(false);
  const active = t.from <= today;
  useEffect(() => {
    if (!confirm) return;
    const timer = setTimeout(() => setConfirm(false), 4000);
    return () => clearTimeout(timer);
  }, [confirm]);

  const gym = [
    gymName(t.gym.type),
    t.gym.db_max_lb ? `dumbbells to ${t.gym.db_max_lb} lb` : "",
    t.gym.kettlebells ? "kettlebells" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="card trip">
      <div className="injury-head">
        <h3>{t.place || "Trip"}</h3>
        <span className={`pill ${active ? "due" : "ok"}`}>{active ? "away now" : "upcoming"}</span>
      </div>
      <p className="sub" style={{ marginTop: 2 }}>
        {day(t.from)} – {day(t.to)} · {gym}
      </p>
      <ol className="tripdays">
        {t.days.map((d) => (
          <li key={d.date} className={d.date === today ? "now" : d.date < today ? "past" : ""}>
            <span className="num">{day(d.date)}</span>
            <select
              value={d.day}
              disabled={d.date < today}
              aria-label={`Session on ${day(d.date)}`}
              onChange={(e) => act({ action: "set_day", id: t.id, date: d.date, day: e.target.value })}
            >
              {Object.entries(dayNames).map(([id, name]) => (
                <option key={id} value={id}>
                  Day {id} — {name}
                </option>
              ))}
              <option value="rest">Rest day</option>
            </select>
          </li>
        ))}
      </ol>
      <p className="hint">
        Sessions are converted for the hotel gym. Change any day; the coach plans each morning from this.
      </p>
      <button
        className={`btn block ${confirm ? "danger" : "quiet"}`}
        onClick={() => (confirm ? act({ action: "end", id: t.id }, t.id) : setConfirm(true))}
      >
        {confirm ? "Tap again to confirm" : active ? "Back home early" : "Cancel trip"}
      </button>
    </article>
  );
}
