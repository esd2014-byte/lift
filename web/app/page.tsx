import { requirePageAuth } from "@/lib/guard";
import Link from "next/link";
import { loadDay } from "@/lib/brief";
import { GitHubError, tokenExpiry } from "@/lib/github";
import { computeMetrics, mergeSources } from "@/lib/metrics";
import { trainedDates } from "@/lib/workouts";
import { prettyDate, ZONE } from "@/lib/date";
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

/** What went wrong reading the data repo, in words that say what to do next. */
function explain(err: unknown): { title: string; detail: string; fix: string } {
  const detail = err instanceof Error ? err.message : String(err);
  if (err instanceof GitHubError) {
    if (err.kind === "auth") {
      return {
        title: "The data key isn't working",
        detail,
        fix: "Make a new fine-grained token for the data repo (Contents: read and write), set it as DATA_TOKEN in Vercel, and redeploy.",
      };
    }
    if (err.kind === "rate") return { title: "GitHub needs a breather", detail, fix: "Nothing's broken. Try again after the reset." };
    if (err.kind === "down") return { title: "GitHub isn't answering", detail, fix: "Usually brief. Try again in a minute; githubstatus.com says if it's them." };
  }
  if (/DATA_(REPO|TOKEN) is not set/.test(detail)) {
    return { title: "The app isn't configured", detail, fix: "Set DATA_REPO and DATA_TOKEN in Vercel, then redeploy." };
  }
  return { title: "Couldn't load today", detail, fix: "Try again. If it keeps happening, /api/diagnostics shows which part is failing." };
}

export default async function Page() {
  await requirePageAuth();
  let state: Awaited<ReturnType<typeof loadDay>> | null = null;
  let failure: { title: string; detail: string; fix: string } | null = null;
  try {
    state = await loadDay();
  } catch (err) {
    failure = explain(err);
  }

  if (failure || !state) {
    return (
      <header className="top">
        <h1 className="hype">Lift</h1>
        <div className="callout warn" style={{ marginTop: 16 }} role="alert">
          <b>{failure?.title ?? "Couldn't load today"}</b>
          <div style={{ marginTop: 6 }}>{failure?.detail}</div>
          <div style={{ marginTop: 10, fontSize: ".84rem" }}>{failure?.fix}</div>
        </div>
        <a className="btn block" href="/" style={{ display: "block", textAlign: "center", marginTop: 12, textDecoration: "none" }}>
          Try again
        </a>
      </header>
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
        <Freshness zone={ZONE} stale={state.stale} briefDate={state.briefDate} generatedAt={state.generatedAt} />
        <SyncStatus hevySyncedAt={state.hevySyncedAt} voltraSyncedAt={state.voltraSyncedAt} tokenExpiresAt={tokenExpiry()?.date ?? null} />
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
