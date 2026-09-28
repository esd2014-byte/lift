/**
 * Shown while the page's data loads (one GitHub read; seconds on hotel Wi-Fi). The
 * shapes match the real header and session card, so nothing jumps when it arrives.
 */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Loading today's plan">
      <header className="top">
        <div className="skeleton" style={{ height: 34, width: "70%" }} />
        <div className="skeleton" style={{ height: 30, width: "55%", marginTop: 8 }} />
        <div className="skeleton" style={{ height: 28, width: 160, marginTop: 12, borderRadius: 999 }} />
        <div className="card weekcard">
          <div className="skeleton" style={{ height: 12, width: 90 }} />
          <div className="weekdots" style={{ marginTop: 10 }}>
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="dot skeleton" />
            ))}
          </div>
        </div>
      </header>
      <section>
        <div className="card">
          <div className="skeleton" style={{ height: 22, width: "60%" }} />
          <div className="skeleton" style={{ height: 14, width: "40%", marginTop: 10 }} />
        </div>
        <div className="skeleton" style={{ height: 56, marginTop: 16, borderRadius: 12 }} />
      </section>
    </div>
  );
}
