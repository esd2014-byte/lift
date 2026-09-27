"use client";

import { useState } from "react";
import type { BriefData, Variant } from "@/lib/types";

const ORDER = ["full", "beast", "minimum", "travel"] as const;
const META: Record<string, { label: string; fallback: string }> = {
  full: { label: "Full", fallback: "as programmed" },
  beast: { label: "Beast mode", fallback: "bigger than planned" },
  minimum: { label: "Minimum", fallback: "the one that counts" },
  travel: { label: "Traveling", fallback: "hotel or no kit" },
};

export default function Today({
  data,
  dayNames,
}: {
  data: BriefData;
  dayNames: Record<string, string>;
}) {
  const keys = ORDER.filter((k) => data.variants?.[k]);
  const [active, setActive] = useState<string>(keys[0] ?? "full");
  const [restOpen, setRestOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [rest, setRest] = useState<"idle" | "saving" | "done" | "error">("idle");

  const v: Variant | undefined = data.variants?.[active];
  const hasLoads = (v?.rows ?? []).some((r) => typeof r.load_lb === "number");

  /**
   * Which Hevy routine to tap.
   *
   * `hevy_routine` on the variant is the contract. Briefs written before that field
   * existed don't carry it, and Beast mode promotes to a different day - so rather
   * than confidently naming the wrong routine, fall back to reading the promoted day
   * out of the variant's own text ("promote to Day E") and resolving its real title
   * from the program.
   */
  const routineFor = (variant: Variant | undefined): string => {
    if (variant?.hevy_routine) return variant.hevy_routine;
    const hay = `${variant?.meta ?? ""} ${variant?.note?.text ?? ""}`;
    const m = /\bDay\s+([A-F])\b/.exec(hay);
    if (m && m[1] !== data.day) {
      const name = dayNames[m[1]];
      return name ? `Day ${m[1]} — ${name}` : `Day ${m[1]}`;
    }
    return `Day ${data.day} — ${dayNames[data.day] ?? data.day_name}`;
  };
  const hevyRoutine = routineFor(v);

  // The Beyond+ session is created under today's date, but only when the chosen
  // variant actually has Voltra work in it.
  const hasVoltra = (v?.rows ?? []).some((r) =>
    /voltra|cable/i.test(`${r.name} ${r.station ?? ""}`)
  );
  const voltraSession = hasVoltra ? data.date.replace(/-/g, ".") : null;

  function pick(k: string) {
    setActive(k);
    setRestOpen(false);
    // Log the choice so the coach learns how often the full session survives the day.
    fetch("/api/variant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ variant: k }),
    }).catch(() => {});
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

  return (
    <section>
      <div className="head">
        <h2>Today&apos;s pumps</h2>
        <span className="meta">{v?.duration ?? ""}</span>
      </div>

      <div className="card">
        <span className={`pill ${data.day_type === "short" ? "accent" : "ok"}`}>
          {data.day_type === "short" ? "Short day" : "Real day"}
        </span>
        <p className="session-title">
          Day {data.day} — {data.day_name}
        </p>
        {data.headline && <p className="sub">{data.headline}</p>}
      </div>

      {/* Collapsed by default: most mornings the programmed session is the one he
          does, and the adjust controls are only in the way until they aren't. */}
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
              <button
                key={k}
                className="variant"
                data-v={k}
                aria-pressed={!restOpen && active === k}
                onClick={() => pick(k)}
              >
                <span className="vname">{vv.label ?? META[k].label}</span>
                <span className="vmeta">{vv.meta ?? META[k].fallback}</span>
              </button>
            );
          })}
          <button
            className="variant"
            data-v="rest"
            aria-pressed={restOpen}
            onClick={() => setRestOpen(true)}
          >
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

      {!restOpen && v && (
        <div style={{ marginTop: 18 }}>
          <p className="eyebrow">Begin selected workout</p>
          <div className="launch">
            <a className="launchbtn" href="hevy://" target="_blank" rel="noreferrer">
              <span className="lname">Hevy</span>
              <span className="lmeta">{hevyRoutine}</span>
            </a>
            {voltraSession ? (
              <a className="launchbtn" href="beyondpower://" target="_blank" rel="noreferrer">
                <span className="lname">Voltra</span>
                <span className="lmeta">{voltraSession}</span>
              </a>
            ) : (
              <div className="launchbtn off">
                <span className="lname">Voltra</span>
                <span className="lmeta">not needed today</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        {!restOpen && v && (
          <>
            {v.note && (
              <div className={`callout ${v.note.kind}`} style={{ marginTop: 11 }}>
                {v.note.text}
              </div>
            )}
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
                        {r.superset && <span className="ss">{r.superset}</span>}{" "}
                        <span className="exname">{r.name}</span>
                        {r.station && <div className="station">{r.station}</div>}
                      </td>
                      {hasLoads && (
                        <td className="repcell">
                          {typeof r.load_lb === "number" ? `${r.load_lb} lb` : "—"}
                        </td>
                      )}
                      <td className="repcell">{r.reps}</td>
                      <td className="repcell">{r.rpe ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
