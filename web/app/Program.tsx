import type { Program as ProgramShape } from "@/lib/programDay";
import type { Metrics } from "@/lib/metrics";
import type { DayNote } from "@/lib/dayNotes";
import type { LastSession, Question } from "@/lib/recent";
import DayNotes from "./DayNotes";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (iso: string) => {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
const weekdayShort = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Program, top to bottom: the rotation with when each day was last trained, where you
 * are in the block, the last session, what the logs couldn't explain, and the coach's
 * short read of today.
 */
export default function Program({
  html,
  moreHtml,
  workoutDay,
  todayDay,
  program,
  metrics,
  lastByDay,
  last,
  notes,
  noteDates,
  questions,
  today,
}: {
  html: string;
  /** The brief's optional "## More" section, shown collapsed. */
  moreHtml: string;
  workoutDay: string | null;
  /** Today's program day letter from the brief, to mark in the rotation. */
  todayDay: string | null;
  program: ProgramShape | null;
  metrics: Metrics;
  /** Program day letter -> date it was last trained. */
  lastByDay: Record<string, string>;
  last: LastSession | null;
  notes: DayNote[];
  noteDates: string[];
  questions: Question[];
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

  return (
    <section>
      <div className="head">
        <h2>Program</h2>
      </div>

      {program && (
        <>
          <p className="eyebrow">The program</p>
          <p className="sub" style={{ marginTop: 0 }}>
            {[
              `${perWeek} training days a week`,
              real.length ? `${real.length} full (${range(real)})` : "",
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
                <span className="rname">
                  {d.name.replace(/\s*\(short\)$/i, "")}
                  <span className="rlast">
                    {lastByDay[d.id] ? `last ${weekdayShort(lastByDay[d.id])} ${md(lastByDay[d.id])}` : "not yet"}
                  </span>
                </span>
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

      {program && (
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
        </>
      )}

      <p className="eyebrow" style={{ marginTop: 22 }}>
        Last session
      </p>
      {last ? (
        <div className="card lastsession">
          <p className="session-sub">
            <b>
              {weekdayShort(last.date)} {md(last.date)}
            </b>
            {last.day && <> · {last.day}</>}
            {last.minutes != null && (
              <>
                {" "}
                · <span className="num">{last.minutes}</span> min
              </>
            )}
          </p>
          {last.lines.length > 0 ? (
            <ul className="facts">
              {last.lines.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
              {last.more > 0 && <li className="muted">and {last.more} more</li>}
            </ul>
          ) : (
            <p className="sub">Started in Lift; no sets synced.</p>
          )}
        </div>
      ) : (
        <p className="empty">No sessions logged yet.</p>
      )}

      <DayNotes notes={notes} dates={noteDates} questions={questions} />

      <p className="eyebrow" style={{ marginTop: 22 }}>
        Why today{workoutDay && <> · </>}
        {workoutDay && <span className="plan">{workoutDay}</span>}
      </p>
      {html.trim() ? (
        <div className="coach" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="empty">No coaching notes in today&apos;s brief.</p>
      )}
      {moreHtml.trim() && (
        <details className="adjust">
          <summary>
            <span>More reasoning</span>
            <span className="change">Show</span>
          </summary>
          <div className="coach" dangerouslySetInnerHTML={{ __html: moreHtml }} />
        </details>
      )}
    </section>
  );
}
