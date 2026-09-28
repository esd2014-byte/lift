import type { DayState, Metrics } from "@/lib/metrics";

const STATE_LABEL: Record<DayState, string> = {
  done: "trained",
  rest: "planned rest",
  miss: "missed",
  today: "today",
  future: "upcoming",
};

/**
 * Contact: did you show up this week. Lives in the header on every tab, because
 * catching a slide early is the point of the whole app.
 */
export default function WeekStrip({ m }: { m: Metrics }) {
  const gap = m.daysSinceLast;
  return (
    <div className="card weekcard">
      <div className="weekhead">
        <p className="eyebrow" style={{ margin: 0 }}>
          This week
        </p>
        <span className="meta">
          <span className="num">{m.sessionsThisWeek}</span> of {m.weeklyTarget}
          {m.restThisWeek > 0 && <> · {m.restThisWeek} rest</>}
        </span>
      </div>
      <div className="weekdots">
        {m.week.map((d, i) => (
          <div
            key={i}
            className={`dot ${d.state}`}
            title={`${d.date}: ${STATE_LABEL[d.state]}`}
            aria-label={`${new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })}: ${STATE_LABEL[d.state]}`}
          >
            {d.state === "rest" ? "–" : d.letter}
          </div>
        ))}
      </div>
      <p className="sub">
        {m.lastSessionDate ? (
          <>
            Last session {new Date(`${m.lastSessionDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long" })}.{" "}
            {gap !== null && gap > 0 && (
              <span className={`pill ${gap >= 3 ? "bad" : gap >= 2 ? "due" : "ok"}`}>
                {gap} day{gap === 1 ? "" : "s"} off
              </span>
            )}
            {gap === 0 && <span className="pill ok">trained today</span>}
          </>
        ) : (
          <>No sessions logged yet.</>
        )}
      </p>
      <p className="sub" style={{ marginTop: 4 }}>
        <span className="num">{m.last7}</span> training day{m.last7 === 1 ? "" : "s"} in the last 7 ·{" "}
        <span className="num">{m.last28}</span> in 28
      </p>
    </div>
  );
}
