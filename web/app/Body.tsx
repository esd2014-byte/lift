"use client";

import { useRef, useState } from "react";
import type { DayState } from "@/lib/brief";

/** Weekly cadence for tape and photos - due on day 7, overdue after. */
function dueState(daysSince: number | null) {
  if (daysSince === null) return { kind: "due" as const, text: "Never logged" };
  if (daysSince >= 7) return { kind: "due" as const, text: daysSince >= 10 ? `${daysSince} days overdue` : "Due now" };
  const left = 7 - daysSince;
  return { kind: "ok" as const, text: `Due in ${left} day${left === 1 ? "" : "s"}` };
}

export default function Body({ state }: { state: DayState }) {
  const bw = state.bodyweight;
  const [weight, setWeight] = useState("");
  const [bwState, setBwState] = useState<"idle" | "saving" | "done" | "skipped" | "error">(
    bw.logged !== null ? "done" : bw.skipped ? "skipped" : "idle"
  );
  const [result, setResult] = useState<{ weight: number; rolling7: number; n: number } | null>(
    bw.logged !== null && bw.rolling7 !== null ? { weight: bw.logged, rolling7: bw.rolling7, n: bw.days } : null
  );

  const [meas, setMeas] = useState({ waist: "", arm: "", shoulder: "" });
  const [measState, setMeasState] = useState<"idle" | "saving" | "done" | "error">("idle");

  const [photoState, setPhotoState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);

  const measDue = dueState(state.measurements.daysSince);
  const photoDue = dueState(state.photos.daysSince);

  async function postWeight(value: number | "skip") {
    setBwState("saving");
    try {
      const res = await fetch("/api/bodyweight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value === "skip" ? { skip: true } : { weight: value }),
      });
      if (!res.ok) throw new Error(await res.text());
      const json = await res.json();
      if (value === "skip") setBwState("skipped");
      else {
        setResult(json);
        setBwState("done");
      }
    } catch {
      setBwState("error");
    }
  }

  async function saveMeasurements() {
    if (!meas.waist && !meas.arm && !meas.shoulder) return;
    setMeasState("saving");
    try {
      const res = await fetch("/api/measurements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meas),
      });
      if (!res.ok) throw new Error(await res.text());
      setMeasState("done");
    } catch {
      setMeasState("error");
    }
  }

  /**
   * Downscale before upload. A phone photo is 3-5MB; the repo would bloat fast and
   * the API call would be slow on hotel wifi. 1200px wide at q0.8 is plenty for
   * judging a physique change week to week.
   */
  async function handleFile(file: File) {
    setPhotoState("saving");
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        const reader = new FileReader();
        reader.onload = () => {
          img.onload = () => {
            const scale = Math.min(1, 1200 / Math.max(img.width, img.height));
            const c = document.createElement("canvas");
            c.width = Math.round(img.width * scale);
            c.height = Math.round(img.height * scale);
            c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
            resolve(c.toDataURL("image/jpeg", 0.8));
          };
          img.onerror = reject;
          img.src = reader.result as string;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/photo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl }),
      });
      if (!res.ok) throw new Error(await res.text());
      setPhotoState("done");
    } catch {
      setPhotoState("error");
    }
  }

  return (
    <section>
      <div className="head">
        <h2>Body</h2>
        {bw.rolling7 !== null && (
          <span className="meta">
            7-day avg <span className="num">{bw.rolling7}</span> lb · {bw.days} of 7 days
          </span>
        )}
      </div>

      <div className="stack">
        {/* bodyweight */}
        <div className="card">
          {bwState === "done" && result ? (
            <>
              <p className="eyebrow">Bodyweight logged</p>
              <div className="bignum num" style={{ fontSize: "1.7rem" }}>{result.weight} lb</div>
              <p className="sub">
                7-day average <span className="num">{result.rolling7}</span> lb · {result.n} of 7 days
              </p>
            </>
          ) : bwState === "skipped" ? (
            <>
              <p className="eyebrow">Bodyweight</p>
              <p className="sub" style={{ margin: 0 }}>
                Skipped today.
                {bw.rolling7 !== null && (
                  <> The 7-day average holds at <span className="num">{bw.rolling7}</span> lb.</>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="eyebrow">Bodyweight this morning</p>
              <div className="field">
                <input
                  type="number"
                  id="bw"
                  inputMode="decimal"
                  step="0.1"
                  placeholder="152.0"
                  aria-label="Bodyweight in pounds"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                />
                <button
                  className="btn"
                  onClick={() => postWeight(Number(weight))}
                  disabled={bwState === "saving" || !weight}
                >
                  {bwState === "saving" ? "…" : "Log"}
                </button>
              </div>
              <div style={{ marginTop: 9, display: "flex", gap: 14, alignItems: "center" }}>
                <button className="linkish" onClick={() => postWeight("skip")}>Skip today</button>
                {bw.rolling7 !== null && (
                  <span className="sub" style={{ margin: 0 }}>
                    7-day avg <span className="num">{bw.rolling7}</span> lb
                  </span>
                )}
              </div>
              {bwState === "error" && <p className="note">Didn&apos;t save. Try again.</p>}
            </>
          )}
        </div>

        {/* measurements */}
        <div className="card">
          <p className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            Measurements <span className={`pill ${measDue.kind}`}>{measDue.text}</span>
          </p>
          {measState === "done" ? (
            <p className="sub" style={{ margin: 0 }}>Saved. Next one due in 7 days.</p>
          ) : (
            <>
              <div className="measure">
                {(["waist", "arm", "shoulder"] as const).map((f) => (
                  <div key={f}>
                    <label htmlFor={`m-${f}`}>{f[0].toUpperCase() + f.slice(1)}</label>
                    <input
                      type="number"
                      id={`m-${f}`}
                      inputMode="decimal"
                      step="0.1"
                      value={meas[f]}
                      onChange={(e) => setMeas({ ...meas, [f]: e.target.value })}
                    />
                  </div>
                ))}
              </div>
              <p className="guide">
                <b>Waist</b> at the navel, relaxed, at the end of an exhale — don&apos;t suck in.<br />
                <b>Arm</b> at the mid-bicep, flexed, elbow at 90°. Same arm every time.<br />
                <b>Shoulder</b> around the widest point across the delts, arms at your sides.
              </p>
              <button className="btn block quiet" onClick={saveMeasurements} disabled={measState === "saving"} style={{ marginTop: 11 }}>
                {measState === "saving" ? "Saving…" : "Save measurements"}
              </button>
              {measState === "error" && <p className="note">Didn&apos;t save. Try again.</p>}
            </>
          )}
        </div>

        {/* photo */}
        <div className="card">
          <p className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            Progress photo <span className={`pill ${photoDue.kind}`}>{photoDue.text}</span>
          </p>
          {photoState === "done" ? (
            <p className="sub" style={{ margin: 0 }}>Saved to the repo. Next one due in 7 days.</p>
          ) : (
            <>
              <div className="photobox">
                Front, side, back — mirror selfie, same spot and light each week
              </div>
              <div className="photorow" style={{ marginTop: 10 }}>
                <button className="btn quiet" onClick={() => camRef.current?.click()} disabled={photoState === "saving"}>
                  {photoState === "saving" ? "Uploading…" : "Take photo"}
                </button>
                <button className="btn quiet" onClick={() => libRef.current?.click()} disabled={photoState === "saving"}>
                  Choose photo
                </button>
              </div>
              <input
                ref={camRef} type="file" accept="image/*" capture="user" hidden
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              <input
                ref={libRef} type="file" accept="image/*" hidden
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              {photoState === "error" && <p className="note">Upload failed. Try again.</p>}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
