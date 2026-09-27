import Link from "next/link";
import { loadDay } from "@/lib/brief";
import { computeMetrics, mergeSources } from "@/lib/metrics";
import { trainedDates } from "@/lib/workouts";
import { prettyDate } from "@/lib/date";
import { renderMarkdown, splitBrief } from "@/lib/markdown";
import Freshness from "./Freshness";
import SyncStatus from "./SyncStatus";
import WeekStrip from "./WeekStrip";
import Strength from "./Strength";
import Motivation from "./Motivation";
import Tabs from "./Tabs";
import InjuryNotes from "./InjuryNotes";
import Body from "./Body";
import Today from "./Today";
import Coaching from "./Coaching";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Page() {
  let state: Awaited<ReturnType<typeof loadDay>> | null = null;
  let error: string | null = null;
  try {
    state = await loadDay();
  } catch (err) {
    error = String(err);
  }

  if (error || !state) {
    return (
      <>
        <h1>Lift</h1>
        <div className="card warn" style={{ marginTop: 16 }}>
          <div className="label">Couldn&apos;t reach the repo</div>
          <div className="note">{error}</div>
        </div>
      </>
    );
  }

  // The repo is the system of record: Hevy has the iron, Beyond+ has the cable work,
  // Lift knows which days a workout was started, and only the merge has the whole picture.
  const merged = mergeSources(state.sessions, state.voltraSessions, trainedDates(state.workouts));
  const metrics = computeMetrics(merged, state.today, state.restDays);
  const parts = state.briefMarkdown ? splitBrief(state.briefMarkdown) : null;

  const within = (date: string, days: number) =>
    (Date.parse(`${state.today}T12:00:00Z`) - Date.parse(`${date}T12:00:00Z`)) / 86400000 < days;
  const voltraUnnamedRecent = state.voltraSessions.filter((v) => v.unnamed && within(v.date, 14)).length;
  const hevyLeftOpen =
    (state.sessions as Array<{ date: string; left_open?: boolean }>).find((s) => s.left_open && within(s.date, 7))?.date ??
    null;

  const todayTab = state.briefData ? (
    <Today
      data={state.briefData}
      dayNames={state.dayNames}
      today={state.today}
      stale={state.stale}
      workouts={state.workouts}
      voltraUnnamedRecent={voltraUnnamedRecent}
      hevyLeftOpen={hevyLeftOpen}
    />
  ) : (
    <section>
      <div className="head"><h2>Today&apos;s pumps</h2></div>
      <div className="card warn">
        <div className="label">No structured session for {state.briefDate ?? "today"}</div>
        <div className="note">
          This brief predates structured data, so there&apos;s nothing to start here. The session is in
          the Coaching tab.
        </div>
      </div>
    </section>
  );

  return (
    <>
      <header className="top">
        <Motivation date={state.today} />
        <p className="date">{prettyDate(state.today).replace(/, \d{4}$/, "")}</p>
        <Freshness stale={state.stale} briefDate={state.briefDate} generatedAt={state.generatedAt} />
        <SyncStatus hevySyncedAt={state.hevySyncedAt} voltraSyncedAt={state.voltraSyncedAt} />
        <WeekStrip m={metrics} />
      </header>

      <Tabs
        tabs={[
          { id: "today", label: "Today's pumps", content: todayTab },
          {
            id: "progress",
            label: "Progress",
            content: (
              <>
                <Strength m={metrics} />
                <Body state={state} />
                <p className="sub" style={{ paddingBottom: 8 }}>
                  <Link href="/rate">Rate exercises</Link>: tell the coach what to program more, or never.
                </p>
              </>
            ),
          },
          { id: "coaching", label: "Coaching", content: <Coaching html={parts ? renderMarkdown(parts.coaching) : ""} /> },
          { id: "injury", label: "Injury notes", content: <InjuryNotes html={parts ? renderMarkdown(parts.injury) : ""} /> },
        ]}
      />
    </>
  );
}
