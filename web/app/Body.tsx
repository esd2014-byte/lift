"use client";

import { useRef, useState } from "react";
import type { DayState } from "@/lib/brief";
import { MAX_PHOTO_BYTES, base64Bytes } from "@/lib/limits";
import { didntSave, postJson } from "@/lib/postJson";
import { shortDate } from "@/lib/session";

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

  const [bwError, setBwError] = useState<string | null>(null);

  const [meas, setMeas] = useState({ waist: "", arm: "", shoulder: "" });
  const [measState, setMeasState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [measError, setMeasError] = useState<string | null>(null);

  const [photoState, setPhotoState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [photoError, setPhotoError] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const libRef = useRef<HTMLInputElement>(null);

  const measDue = dueState(state.measurements.daysSince);
  const photoDue = dueState(state.photos.daysSince);

  // Log stays tappable: a button that silently does nothing reads as broken. The
  // check happens on tap, and says what's wrong.
  async function postWeight(value: number | "skip") {
    if (value !== "skip" && !(value >= 80 && value <= 400)) {
      setBwError("Enter a weight between 80 and 400 lb.");
      return;
    }
    setBwError(null);
    setBwState("saving");
    try {
      const json = await postJson<{ weight: number; rolling7: number; n: number }>(
        "/api/bodyweight",
        value === "skip" ? { skip: true } : { weight: value }
      );
      if (value === "skip") setBwState("skipped");
      else {
        setResult(json);
        setBwState("done");
      }
    } catch (err) {
      setBwError(didntSave(err));
      setBwState("error");
    }
  }

  async function saveMeasurements() {
    if (!meas.waist && !meas.arm && !meas.shoulder) {
      setMeasError("Enter at least one measurement.");
      return;
    }
    setMeasError(null);
    setMeasState("saving");
    try {
      await postJson("/api/measurements", meas);
      setMeasState("done");
    } catch (err) {
      setMeasError(didntSave(err));
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
            // 1200px at q0.8 is usually ~300 KB. If a photo still comes out over the
            // server's limit, step down until it fits rather than failing the upload.
            for (const [edge, quality] of [
              [1200, 0.8],
              [1200, 0.6],
              [900, 0.6],
              [700, 0.5],
            ] as const) {
              const scale = Math.min(1, edge / Math.max(img.width, img.height));
              const c = document.createElement("canvas");
              c.width = Math.round(img.width * scale);
              c.height = Math.round(img.height * scale);
              c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
              const url = c.toDataURL("image/jpeg", quality);
              if (base64Bytes(url.slice(url.indexOf(",") + 1)) <= MAX_PHOTO_BYTES) return resolve(url);
            }
            reject(new Error("photo too large"));
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
      if (!res.ok)
        throw new Error(
          ((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? `the server said ${res.status}`
        );
      setPhotoState("done");
    } catch (err) {
      setPhotoError(
        err instanceof TypeError
          ? "Upload failed: no connection."
          : `Upload failed: ${err instanceof Error ? err.message : err}.`
      );
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
              <div className="bignum num" style={{ fontSize: "1.7rem" }}>
                {result.weight} lb
              </div>
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
                  <>
                    {" "}
                    The 7-day average holds at <span className="num">{bw.rolling7}</span> lb.
                  </>
                )}
              </p>
            </>
          ) : (
            <>
              <label className="eyebrow" htmlFor="bw" style={{ display: "block" }}>
                Bodyweight this morning
              </label>
              <div className="field">
                <input
                  type="number"
                  id="bw"
                  inputMode="decimal"
                  step="0.1"
                  placeholder="lb"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                />
                <button className="btn" onClick={() => postWeight(Number(weight))} disabled={bwState === "saving"}>
                  {bwState === "saving" ? "Saving…" : "Log"}
                </button>
                <button className="btn quiet" onClick={() => postWeight("skip")} disabled={bwState === "saving"}>
                  Skip
                </button>
              </div>
              {bw.last && (
                <p className="hint">
                  Last: <span className="num">{bw.last.weight}</span> lb on {shortDate(bw.last.date)}
                </p>
              )}
              {bwError && (
                <p className="note" role="alert">
                  {bwError}
                </p>
              )}
            </>
          )}
        </div>

        {/* measurements */}
        <div className="card">
          <p className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            Measurements <span className={`pill ${measDue.kind}`}>{measDue.text}</span>
          </p>
          {measState === "done" ? (
            <p className="sub" style={{ margin: 0 }}>
              Saved. Next one due in 7 days.
            </p>
          ) : (
            <>
              <div className="measure">
                {(["waist", "arm", "shoulder"] as const).map((f) => (
                  <div key={f}>
                    <label htmlFor={`m-${f}`}>{f[0].toUpperCase() + f.slice(1)} (in)</label>
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
              <details className="guide">
                <summary>How to measure</summary>
                <b>Waist</b> at the navel, relaxed, at the end of an exhale — don&apos;t suck in.
                <br />
                <b>Arm</b> at the mid-bicep, flexed, elbow at 90°. Same arm every time.
                <br />
                <b>Shoulder</b> around the widest point across the delts, arms at your sides.
              </details>
              <button
                className="btn block quiet"
                onClick={saveMeasurements}
                disabled={measState === "saving"}
                style={{ marginTop: 11 }}
              >
                {measState === "saving" ? "Saving…" : "Save measurements"}
              </button>
              {measError && (
                <p className="note" role="alert">
                  {measError}
                </p>
              )}
            </>
          )}
        </div>

        {/* photo */}
        <div className="card">
          <p className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            Progress photo <span className={`pill ${photoDue.kind}`}>{photoDue.text}</span>
          </p>
          {photoState === "done" ? (
            <p className="sub" style={{ margin: 0 }}>
              Saved privately. Next one due in 7 days.
            </p>
          ) : (
            <>
              <div className="photobox">Front, side, back — mirror selfie, same spot and light each week</div>
              <div className="photorow" style={{ marginTop: 10 }}>
                <button
                  className="btn quiet"
                  onClick={() => camRef.current?.click()}
                  disabled={photoState === "saving"}
                >
                  {photoState === "saving" ? "Uploading…" : "Take photo"}
                </button>
                <button
                  className="btn quiet"
                  onClick={() => libRef.current?.click()}
                  disabled={photoState === "saving"}
                >
                  Choose photo
                </button>
              </div>
              <input
                ref={camRef}
                type="file"
                accept="image/*"
                capture="user"
                hidden
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              <input
                ref={libRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
              />
              {photoError && photoState === "error" && (
                <p className="note" role="alert">
                  {photoError}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
