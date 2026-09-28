"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { BriefData, Variant } from "@/lib/types";
import type { WorkoutEntry } from "@/lib/workouts";
import { dayTitle, hevyTitle, isVoltraRow, voltraTitle } from "@/lib/session";

const ORDER = ["full", "beast", "minimum", "travel"] as const;
const META: Record<string, { label: string; fallback: string }> = {
  full: { label: "Full", fallback: "as programmed" },
  beast: { label: "Beast mode", fallback: "bigger than planned" },
  minimum: { label: "Minimum", fallback: "the one that counts" },
  travel: { label: "Traveling", fallback: "hotel or no kit" },
};

type Push = { ok: boolean; title?: string; action?: string; error?: string; skipped?: string[]; note?: string };
type Sync = { source: string; ok: boolean; error?: string };

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${String(sec).padStart(2, "0")}`;
}

const weekday = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });

export default function Today({
  data,
  dayNames,
  today,
  stale,
  workouts,
  voltraUnnamedRecent,
  hevyLeftOpen,
}: {
  data: BriefData;
  dayNames: Record<string, string>;
  today: string;
  stale: boolean;
  workouts: WorkoutEntry[];
  /** Unnamed ("Free Exercises") Voltra sessions in the last two weeks. */
  voltraUnnamedRecent: number;
  /** Date of a recent Hevy workout that ran far too long (left open), if any. */
  hevyLeftOpen: string | null;
}) {
  const router = useRouter();
  const keys = ORDER.filter((k) => data.variants?.[k]);

  const running = workouts.filter((w) => !w.ended_at && !w.closed_unended).at(-1) ?? null;
  const runningToday = running && running.date === today ? running : null;
  const unfinished = running && running.date !== today ? running : null;
  const doneToday = workouts.filter((w) => w.date === today && (w.ended_at || w.closed_unended));

  // Tapping a variant PREVIEWS it. Nothing is recorded until Start: a tap is
  // browsing, and the coach used to read every tap as a decision.
  const [active, setActive] = useState<string>(runningToday?.variant ?? keys[0] ?? "full");
  const [restOpen, setRestOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [rest, setRest] = useState<"idle" | "saving" | "done" | "error">("idle");

  const [startedAt, setStartedAt] = useState<string | null>(runningToday?.started_at ?? null);
  const [phase, setPhase] = useState<"idle" | "starting" | "running" | "confirm-end" | "ending" | "ended">(
    runningToday ? "running" : "idle"
  );
  const [now, setNow] = useState(() => Date.now());
  const [pushes, setPushes] = useState<{ hevy?: Push; voltra?: Push } | null>(null);
  const [ended, setEnded] = useState<{ minutes: number | null; syncs: Sync[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (phase !== "running" && phase !== "confirm-end") return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [phase]);

  // Ending takes a second tap: one stray tap with a sweaty thumb shouldn't close
  // the workout.
  useEffect(() => {
    if (phase !== "confirm-end") return;
    const t = setTimeout(() => setPhase("running"), 4000);
    return () => clearTimeout(t);
  }, [phase]);

  const v: Variant | undefined = data.variants?.[active];
  const day = dayTitle(data, v, dayNames);
  // The card shows the brief's own name for the day ("Push + Day F finisher") unless
  // the variant trains a different day; the apps get the program's routine name.
  const cardTitle =
    day === `Day ${data.day} — ${dayNames[data.day] ?? data.day_name}` ? `Day ${data.day} — ${data.day_name}` : day;
  const hasLoads = (v?.rows ?? []).some((r) => typeof r.load_lb === "number");
  const calibrating = (v?.rows ?? []).filter((r) => r.calibration).length;
  const voltraRows = (v?.rows ?? []).filter(isVoltraRow).length;
  const hevyRows = (v?.rows ?? []).length - voltraRows;
  const hevyName = hevyTitle(day, active, v);
  const voltraName = voltraRows ? voltraTitle(data.date) : null;
  const isRunning = phase === "running" || phase === "confirm-end" || phase === "ending";

  async function post(body: Record<string, unknown>) {
    const res = await fetch("/api/workout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
    return json;
  }

  const reasonOf = (err: unknown) => String(err).replace(/^Error: /, "");

  async function startWorkout() {
    setError(null);
    setPhase("starting");
    try {
      const json = await post({ action: "start", variant: active, briefDate: data.date });
      setStartedAt(json.entry.started_at);
      setPushes({ hevy: json.hevy, voltra: json.voltra });
      setNow(Date.now());
      setPhase("running");
    } catch (err) {
      setError(`Couldn't start: ${reasonOf(err)}`);
      setPhase("idle");
    }
  }

  async function endWorkout() {
    if (phase === "running") return setPhase("confirm-end");
    setError(null);
    setPhase("ending");
    try {
      const json = await post({ action: "end" });
      setEnded({ minutes: json.entry?.minutes ?? null, syncs: json.syncs ?? [] });
      setPhase("ended");
      // Re-render the server parts (week strip, streak) with the fresh sync.
      router.refresh();
    } catch (err) {
      setError(`Couldn't end: ${reasonOf(err)}`);
      setPhase("running");
    }
  }

  async function closeUnfinished() {
    setError(null);
    try {
      await post({ action: "close" });
      router.refresh();
    } catch (err) {
      setError(`Couldn't close it: ${reasonOf(err)}`);
    }
  }

  function pick(k: string) {
    setActive(k);
    setRestOpen(false);
  }

  async function saveRest() {
    const text = reason.trim();
    if (!text) return;
    setRest("saving");
    try {
      const res = await fetch("/api/rest-day", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: text }),
      });
      if (!res.ok) throw new Error(await res.text());
      setRest("done");
    } catch {
      setRest("error");
    }
  }

  const pushLine = (p: Push | undefined, app: string) => {
    if (!p || p.action === "none") return null;
    if (!p.ok) return <span className="bad-text">{app} not updated: {p.error}. </span>;
    const extra = [p.skipped?.length ? `left out: ${p.skipped.join(", ")}` : "", p.note ?? ""].filter(Boolean).join("; ");
    const verb = p.action === "kept" ? "already there" : p.action;
    return <span>{app}: &ldquo;{p.title}&rdquo; {verb}{extra ? ` (${extra})` : ""}. </span>;
  };

  return (
    <section>
      <div className="head">
        <h2>Today&apos;s pumps</h2>
        <span className="meta">{v?.duration ?? ""}</span>
      </div>

      {unfinished && (
        <div className="callout warn" style={{ marginBottom: 12 }}>
          <b>You started a workout {weekday(unfinished.date)} and never ended it.</b>
          <div style={{ marginTop: 6, fontSize: ".84rem" }}>
            It still counts as a training day. Close it to start today&apos;s; no duration is recorded for it.
          </div>
          <button className="btn quiet" style={{ marginTop: 10 }} onClick={closeUnfinished}>
            Close it
          </button>
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <span className={`pill ${data.day_type === "short" ? "accent" : "ok"}`}>
            {data.day_type === "short" ? "Short day" : "Real day"}
          </span>
          {stale && <span className="pill due">{weekday(data.date)}&apos;s plan</span>}
        </div>
        <p className="session-title">{cardTitle}</p>
        <p className="variant-line">
          <b>{v?.label ?? META[active]?.label}</b>
          {v?.duration && <> · {v.duration}</>}
        </p>
        {stale ? (
          <p className="sub">
            Today&apos;s brief isn&apos;t written yet, so this is {weekday(data.date)}&apos;s plan. Still a good session.
          </p>
        ) : active === keys[0] ? (
          data.headline && <p className="sub">{data.headline}</p>
        ) : (
          v?.meta && <p className="sub">{v.meta}</p>
        )}
      </div>

      {!isRunning && phase !== "ended" && (
        <details className="adjust">
          <summary>
            Need to adjust?
            {active !== keys[0] && !restOpen && (
              <span className="pill accent" style={{ marginLeft: 8 }}>
                {data.variants[active]?.label ?? active}
              </span>
            )}
          </summary>
          <div className="variants" style={{ marginTop: 11 }}>
            {keys.map((k) => {
              const vv = data.variants[k];
              return (
                <button key={k} className="variant" data-v={k} aria-pressed={!restOpen && active === k} onClick={() => pick(k)}>
                  <span className="vname">{vv.label ?? META[k].label}</span>
                  <span className="vmeta">{vv.meta ?? META[k].fallback}</span>
                </button>
              );
            })}
            <button className="variant" data-v="rest" aria-pressed={restOpen} onClick={() => setRestOpen(true)}>
              <span className="vname">Can&apos;t train</span>
              <span className="vmeta">tell me why</span>
            </button>
          </div>

          {restOpen && rest !== "done" && (
            <div style={{ marginTop: 11 }}>
              <div className="callout warn">
                <b>This marks today as a planned rest day, not a miss.</b> Tell me what&apos;s in the way
                and tomorrow&apos;s brief adjusts around it.
              </div>
              <label htmlFor="reason" className="eyebrow" style={{ margin: "12px 0 7px", display: "block" }}>
                What&apos;s in the way?
              </label>
              <textarea
                className="reason"
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Traveling all week, offsite, fully programmed dawn to dark. Back Sunday night."
              />
              <button className="btn block" onClick={saveRest} disabled={rest === "saving" || !reason.trim()} style={{ marginTop: 11 }}>
                {rest === "saving" ? "Saving…" : "Log it"}
              </button>
              {rest === "error" && <p className="note">Didn&apos;t save. Try again.</p>}
            </div>
          )}

          {restOpen && rest === "done" && (
            <div className="callout accent" style={{ marginTop: 11 }}>
              <b>Logged as a rest day.</b>
              <div style={{ marginTop: 6 }}>&ldquo;{reason.trim()}&rdquo;</div>
              <div style={{ marginTop: 10, fontSize: ".84rem" }}>
                Today stops counting as a miss, the streak holds, and tomorrow&apos;s brief opens from
                what you said rather than from a silent gap.
              </div>
            </div>
          )}
        </details>
      )}

      {!restOpen && v && (
        <div style={{ marginTop: 16 }}>
          {/* ---- start / end ---- */}
          {phase === "ended" ? (
            <div className="callout accent" role="status">
              <b>
                Workout logged
                {ended?.minutes != null ? <>: <span className="num">{ended.minutes}</span> min</> : " (it ran too long to trust the time)"} 🔥
              </b>
              <div style={{ marginTop: 6, fontSize: ".84rem" }}>
                {(ended?.syncs ?? []).map((s) => (
                  <div key={s.source}>
                    {s.source === "hevy" ? "Hevy" : "Voltra"}: {s.ok ? "synced ✓" : `sync failed (${s.error}). The 6am sync will retry.`}
                  </div>
                ))}
              </div>
            </div>
          ) : isRunning ? (
            <>
              <div className="timer">
                <span className="eyebrow" style={{ margin: 0 }}>Elapsed</span>
                <span className="num timer-value">{startedAt ? clock(now - Date.parse(startedAt)) : "0:00"}</span>
              </div>
              <button
                className={`btn block big ${phase === "confirm-end" ? "danger" : "quiet"}`}
                onClick={endWorkout}
                disabled={phase === "ending"}
              >
                {phase === "ending" ? "Logging and syncing…" : phase === "confirm-end" ? "Tap again to end" : "End workout"}
              </button>
              {phase === "confirm-end" && (
                <p className="hint">Finish the workout in Hevy too. Hevy only syncs finished workouts.</p>
              )}
            </>
          ) : (
            <button className="btn block big" onClick={startWorkout} disabled={phase === "starting" || Boolean(unfinished)}>
              {phase === "starting" ? "Setting up Hevy and the Voltra…" : doneToday.length ? "Start another workout" : "Start workout"}
            </button>
          )}
          {error && <p className="note" role="alert">{error}</p>}

          {/* ---- where to log it ---- */}
          <div className="launch" style={{ marginTop: 10 }}>
            {hevyRows > 0 ? (
              <a className="launchbtn" href="hevy://" target="_blank" rel="noreferrer">
                <span className="lname">Hevy</span>
                <span className="lmeta">{hevyName}</span>
              </a>
            ) : (
              <div className="launchbtn off">
                <span className="lname">Hevy</span>
                <span className="lmeta">nothing to log there today</span>
              </div>
            )}
            {voltraName ? (
              <a className="launchbtn" href="beyondpower://" target="_blank" rel="noreferrer">
                <span className="lname">Voltra</span>
                <span className="lmeta">{voltraName}</span>
              </a>
            ) : (
              <div className="launchbtn off">
                <span className="lname">Voltra</span>
                <span className="lmeta">not needed today</span>
              </div>
            )}
          </div>
          <p className="hint">
            {phase === "ended" ? null : isRunning ? (
              pushes ? (
                <>
                  {pushLine(pushes.hevy, "Hevy")}
                  {pushLine(pushes.voltra, "Beyond+")}
                </>
              ) : (
                <>Look for these names in each app.</>
              )
            ) : (
              <>Start writes these into each app with today&apos;s weights, so they&apos;re waiting when you open it.</>
            )}
          </p>
          {hevyLeftOpen && (
            <p className="hint warn-text">
              Your Hevy workout on {weekday(hevyLeftOpen)} ran for hours, so it was probably left open. Finish
              workouts in Hevy when you&apos;re done, or they don&apos;t sync.
            </p>
          )}
          {voltraUnnamedRecent > 0 && (
            <p className="hint warn-text">
              {voltraUnnamedRecent} recent Voltra session{voltraUnnamedRecent === 1 ? " was" : "s were"} logged as
              &ldquo;Free Exercises&rdquo;: {voltraUnnamedRecent === 1 ? "it counts" : "they count"} as a training
              day, but not toward strength. Start from the named session instead of free mode.
            </p>
          )}

          {/* ---- the session ---- */}
          {v.note && (
            <div className={`callout ${v.note.kind}`} style={{ marginTop: 14 }}>
              {v.note.text}
            </div>
          )}
          {calibrating > 0 && (
            <div className="callout warn" style={{ marginTop: 10 }}>
              <b>Calibration day for {calibrating === 1 ? "one Voltra lift" : `${calibrating} Voltra lifts`}.</b> The brief
              didn&apos;t set {calibrating === 1 ? "its weight" : "their weights"}, so Lift guessed from your history. Each is
              marked below: treat set 1 as a feeler, adjust, and log what you finish on.
            </div>
          )}
          <p className="handoff">
            {hevyRows > 0 && voltraRows > 0 ? (
              <>
                <b>{hevyRows}</b> in Hevy, <b>{voltraRows}</b> on the Voltra. In a superset, do the cable set,
                then the dumbbell set during the Voltra&apos;s rest, and tick it in Hevy.
              </>
            ) : voltraRows > 0 ? (
              <>Everything today is on the Voltra.</>
            ) : (
              <>Everything today is logged in Hevy.</>
            )}
          </p>
          <div className="tablewrap">
            <table>
              <thead>
                <tr>
                  <th>Exercise</th>
                  {hasLoads && <th>Load</th>}
                  <th>Sets × reps</th>
                  <th>RPE</th>
                </tr>
              </thead>
              <tbody>
                {v.rows.map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.superset && <span className="ss">{r.superset}</span>} <span className="exname">{r.name}</span>
                      <div className="station">
                        <span className={`where ${isVoltraRow(r) ? "where-voltra" : "where-hevy"}`}>{isVoltraRow(r) ? "Voltra" : "Hevy"}</span>
                        {r.station && <> · {r.station}</>}
                      </div>
                      {r.calibration && (
                        <div className="calib">
                          <b>Calibration:</b> {r.load_lb} lb is a guess ({r.calibration.basis}). Target {r.calibration.reps}{" "}
                          at RPE {r.calibration.rpe}. After set 1, go up 5–10 lb if it felt easier than RPE{" "}
                          {r.calibration.rpe}, down if harder.
                        </div>
                      )}
                    </td>
                    {hasLoads && (
                      <td className="repcell">
                        {typeof r.load_lb === "number" ? `${r.load_lb} lb` : "—"}
                        {r.calibration && <div className="guess">guess</div>}
                      </td>
                    )}
                    <td className="repcell">{r.reps}</td>
                    <td className="repcell">{r.rpe ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
