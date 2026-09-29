import type { Program } from "@/lib/programDay";
import type { Goals } from "@/lib/goals";
import type { Metrics } from "@/lib/metrics";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n).toFixed(1)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Coaching, top to bottom: the program (the week's shape), where you are in it and
 * against your goals, and the coach's reasoning for today, injuries included.
 */
export default function Coaching({
  html,
  workoutDay,
  todayDay,
  program,
  goals,
  metrics,
  bodyweight,
  today,
}: {
  html: string;
  workoutDay: string | null;
  /** Today's program day letter from the brief, to mark in the rotation. */
  todayDay: string | null;
  program: Program | null;
  goals: Goals | null;
  metrics: Metrics;
  bodyweight: { rolling7: number | null; atStart: { date: string; weight: number } | null };
  today: string;
}) {
  const perWeek = program?.structure.days_per_week ?? program?.days.length ?? 0;
  const real = program?.days.filter((d) => d.type === "real") ?? [];
  const short = program?.days.filter((d) => d.type === "short") ?? [];
  const range = (days: typeof real) => {
    const m = days.flatMap((d) => d.minutes ?? []);
    return m.length ? `${Math.min(...m)}-${Math.max(...m)} min` : "";
  };

  const starts = program?.meta.starts ? String(program.meta.starts).slice(0, 10) : null;
  const blockWeeks = program?.meta.block_length_weeks ?? null;
  const week = starts && today >= starts ? Math.floor(daysBetween(starts, today) / 7) + 1 : null;
  const testIn = program?.nextTest ? daysBetween(today, program.nextTest) : null;

  const start = bodyweight.atStart;
  const rate = goals?.primary?.rate;
  const weeksIn = start ? daysBetween(start.date, today) / 7 : 0;

  return (
    <section>
      <div className="head">
        <h2>Coaching</h2>
      </div>

      {program && (
        <>
          <p className="eyebrow">The program</p>
          <p className="sub" style={{ marginTop: 0 }}>
            {[
              `${perWeek} training days a week`,
              real.length ? `${real.length} real (${range(real)})` : "",
              short.length ? `${short.length} short (${range(short)})` : "",
              perWeek < 7 ? `${7 - perWeek} rest` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
            . Days run in order; a missed day waits, it isn&apos;t owed.
          </p>
          <ol className="rotation">
            {program.days.map((d) => (
              <li key={d.id} className={`${d.type}${d.id === todayDay ? " now" : ""}`}>
                <span className="rletter">{d.id}</span>
                <span className="rname">{d.name.replace(/\s*\(short\)$/i, "")}</span>
                <span className="rmeta num">
                  {d.id === todayDay
                    ? "today"
                    : d.type === "short"
                      ? "short"
                      : d.minutes
                        ? `${d.minutes[0]}-${d.minutes[1]}m`
                        : ""}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}

      {(program || goals) && (
        <>
          <p className="eyebrow" style={{ marginTop: 20 }}>
            Where you are
          </p>
          <ul className="facts">
            {week !== null && (
              <li>
                <b>{cap(program?.meta.block ?? "current")} block</b>, week <span className="num">{week}</span>
                {blockWeeks ? (
                  <>
                    {" "}
                    of <span className="num">{blockWeeks}</span>
                    {week > blockWeeks && <>: the block is done, time to reassess</>}
                  </>
                ) : null}
              </li>
            )}
            <li>
              This week: <span className="num">{metrics.sessionsThisWeek}</span> of{" "}
              <span className="num">{metrics.weeklyTarget}</span> training days;{" "}
              <span className="num">{metrics.last28}</span> in the last four weeks.
            </li>
            {testIn !== null && testIn >= 0 && program?.nextTest && (
              <li>
                Next strength test {md(program.nextTest)}, in <span className="num">{testIn}</span> day
                {testIn === 1 ? "" : "s"}.
              </li>
            )}
          </ul>

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
        </>
      )}

      <p className="eyebrow" style={{ marginTop: 22 }}>
        Why today{workoutDay && <> · </>}
        {workoutDay && <span className="plan">{workoutDay}</span>}
      </p>
      {html.trim() ? (
        <div className="coach" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="empty">No coaching notes in today&apos;s brief.</p>
      )}
    </section>
  );
}
