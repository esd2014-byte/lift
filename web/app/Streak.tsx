import type { DayState, Metrics } from "@/lib/metrics";

const STATE_LABEL: Record<DayState, string> = {
  done: "trained",
  rest: "planned rest",
  miss: "missed",
  today: "today",
  future: "upcoming",
};

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Two signals, not one: contact (did you show up) and growth (is it working).
 * A sparse week where the deadlift jumped should look different from a full week
 * where nothing moved.
 */
export default function Streak({ m }: { m: Metrics }) {
  const gap = m.daysSinceLast;
  return (
    <section>
      <div className="head">
        <h2>Streak</h2>
        <span className="meta">
          <span className="num">{m.sessionsThisWeek}</span> of {m.weeklyTarget} this week
          {m.restThisWeek > 0 && <> · {m.restThisWeek} rest</>}
        </span>
      </div>

      <div className="stack">
        <div className="card">
          <p className="eyebrow">This week</p>
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
                Last session{" "}
                {new Date(`${m.lastSessionDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long" })}.{" "}
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

        <div className="card">
          <p className="eyebrow">Strength index</p>
          <div className="indexrow">
            {m.strengthIndex !== null && <span className="bignum num">{m.strengthIndex}</span>}
            <span className="sub" style={{ paddingBottom: 5 }}>{m.indexNote}</span>
          </div>
          <div className="lifts" style={{ marginTop: 12 }}>
            {m.anchors.map((a) => (
              <div className="lift" key={a.id}>
                <span className="name">{a.name}</span>
                <span className="val num" style={a.current ? undefined : { color: "var(--muted)" }}>
                  {a.current ?? "not yet"}
                </span>
                <span
                  className={`delta ${a.trend === "up" ? "up" : a.trend === "down" ? "down" : "flat"}`}
                  title={a.since ? `Estimated 1-rep max change since ${shortDate(a.since)}` : undefined}
                >
                  {a.trend === "up" ? "▲ " : a.trend === "down" ? "▼ " : ""}
                  {a.delta ?? "—"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
