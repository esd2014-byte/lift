import Link from "next/link";
import { loadDay } from "@/lib/brief";
import { computeMetrics, mergeSources } from "@/lib/metrics";
import { prettyDate } from "@/lib/date";
import { renderMarkdown, splitBrief } from "@/lib/markdown";
import Freshness from "./Freshness";
import SyncStatus from "./SyncStatus";
import Streak from "./Streak";
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
  // and only the merge has the whole session.
  const merged = mergeSources(state.sessions, state.voltraSessions);
  const metrics = computeMetrics(merged, state.today, state.restDays);
  const parts = state.briefMarkdown ? splitBrief(state.briefMarkdown) : null;

  return (
    <>
      <section style={{ paddingBlock: "20px 22px" }}>
        <h1>{prettyDate(state.today).replace(/, \d{4}$/, "")}</h1>
        <p className="sub">
          {state.briefData ? `Day ${state.briefData.day}` : "Lift"} ·{" "}
          <Link href="/rate">rate exercises</Link>
        </p>
        <Freshness stale={state.stale} briefDate={state.briefDate} generatedAt={state.generatedAt} />
        <SyncStatus hevySyncedAt={state.hevySyncedAt} voltraSyncedAt={state.voltraSyncedAt} />
      </section>

      <Streak m={metrics} />

      <Body state={state} />

      {state.briefData ? (
        <Today data={state.briefData} dayNames={state.dayNames} />
      ) : (
        <section>
          <div className="head"><h2>Today&apos;s pumps</h2></div>
          <div className="card warn">
            <div className="label">No structured session for {state.briefDate ?? "today"}</div>
            <div className="note">
              This brief predates structured data, so the variant buttons aren&apos;t available.
              The full session is in the coaching text below.
            </div>
          </div>
        </section>
      )}

      {parts && (
        <Coaching
          html={renderMarkdown(parts.coaching)}
          injuryHtml={renderMarkdown(parts.injury)}
        />
      )}
    </>
  );
}
