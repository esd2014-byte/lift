import type { Goals } from "@/lib/goals";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(1)}`;

/** The primary goal, and bodyweight against its target rate. Lives on the Progress tab. */
export default function Goal({
  goals,
  bodyweight,
  today,
}: {
  goals: Goals | null;
  bodyweight: { rolling7: number | null; atStart: { date: string; weight: number } | null };
  today: string;
}) {
  const start = bodyweight.atStart;
  const rate = goals?.primary?.rate;
  const weeksIn = start ? daysBetween(start.date, today) / 7 : 0;
  return (
    <section>
      {goals?.primary && (
        <div className="card goal">
          <p className="eyebrow" style={{ margin: 0 }}>
            Goal
          </p>
          <p className="goal-text">{goals.primary.statement}</p>
          {start && bodyweight.rolling7 != null ? (
            <p className="sub">
              Bodyweight <b className="num">{bodyweight.rolling7.toFixed(1)}</b> lb (7-day average),{" "}
              <b className="num">{signed(bodyweight.rolling7 - start.weight)}</b> since {md(start.date)}.
              {rate && weeksIn >= 1 && (
                <>
                  {" "}
                  On pace would be{" "}
                  <span className="num">
                    +{(rate[0] * weeksIn).toFixed(1)} to +{(rate[1] * weeksIn).toFixed(1)}
                  </span>{" "}
                  by now.
                </>
              )}
            </p>
          ) : (
            <p className="sub">Log bodyweight a few mornings a week and progress shows up here.</p>
          )}
          {goals.priorityMuscles.length > 0 && <p className="sub">Priority: {goals.priorityMuscles.join(", ")}.</p>}
          {goals.secondary.length > 0 && (
            <ul className="goal-list">
              {goals.secondary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
