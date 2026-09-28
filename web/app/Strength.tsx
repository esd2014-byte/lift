import type { Metrics } from "@/lib/metrics";

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Growth: is it working. A sparse week where the deadlift jumped should look
 * different from a full week where nothing moved.
 */
export default function Strength({ m }: { m: Metrics }) {
  return (
    <section>
      <div className="head">
        <h2>Strength</h2>
      </div>
      <div className="card">
        <p className="eyebrow">Strength index</p>
        <div className="indexrow">
          {m.strengthIndex !== null && <span className="bignum num">{m.strengthIndex}</span>}
          <span className="sub" style={{ paddingBottom: 5 }}>
            {m.indexNote}
          </span>
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
    </section>
  );
}
