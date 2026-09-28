"use client";

/**
 * Anything the page itself didn't catch. Says what happened in plain words and
 * offers the two useful next steps: try again, or see which part is failing.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <header className="top">
      <h1 className="hype">Lift</h1>
      <div className="callout warn" style={{ marginTop: 16 }} role="alert">
        <b>Something went wrong loading this page.</b>
        <div style={{ marginTop: 6, fontSize: ".86rem" }}>
          It&apos;s usually brief. If it keeps happening, the diagnostics page shows which part is failing
          {error.digest ? ` (reference ${error.digest})` : ""}.
        </div>
      </div>
      <button className="btn block big" style={{ marginTop: 12 }} onClick={reset}>
        Try again
      </button>
      <p className="hint" style={{ textAlign: "center" }}>
        <a className="tap" href="/api/diagnostics">
          Open diagnostics
        </a>
      </p>
    </header>
  );
}
