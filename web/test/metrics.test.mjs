/**
 * Checks the streak, strength and bodyweight numbers on synthetic data.
 *
 * Each case here is a bug that shipped: a day logged in two apps counted as four
 * sessions, a dumbbell RDL scored as a regression on the Voltra deadlift, rest
 * days that didn't count, evening sessions dated tomorrow, and a "7-day average"
 * that averaged the last seven rows.
 *
 *   node test/metrics.test.mjs
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = "/tmp/pt-metrics-test";
execSync(
  `npx tsc "${join(here, "../lib/metrics.ts")}" "${join(here, "../lib/date.ts")}" "${join(here, "../lib/bodyweight.ts")}" --outDir "${out}" --module esnext --target es2022 --moduleResolution bundler --skipLibCheck`,
  { stdio: "pipe" }
);
const { computeMetrics, mergeSources } = await import(`${out}/metrics.js`);
const { localDateOf } = await import(`${out}/date.js`);
const { rollingAverage } = await import(`${out}/bodyweight.js`);

let failed = 0;
const check = (label, ok) => { if (!ok) { console.log(`FAIL  ${label}`); failed++; } };
const eq = (label, got, want) => check(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`, JSON.stringify(got) === JSON.stringify(want));

const ex = (name, lb, reps) => ({ name, sets: 3, top: { lb, reps, rpe: null, seconds: null } });
const hevy = (date, ...exercises) => ({ date, title: "Day", exercises });
const voltra = (date, actions, max_force_lb = 100) => ({
  date, actions, unnamed: actions.every((a) => /free exercise/i.test(a)),
  sets: 3, reps: 30, avg_force_lb: null, max_force_lb,
});

const TODAY = "2026-09-27"; // a Sunday

// ---- frequency counts distinct days ---------------------------------------
{
  // One evening logged in both apps, with Beyond+ sending one record per exercise.
  const merged = mergeSources(
    [hevy("2026-09-26", ex("Lateral Raise (Dumbbell)", 20, 12)), hevy("2026-09-21", ex("Cat / Cow", null, 8))],
    [voltra("2026-09-26", ["Lat Pulldown"]), voltra("2026-09-26", ["Tricep Extension Pushdown"]), voltra("2026-09-26", ["Cable Crunch"])]
  );
  const m = computeMetrics(merged, TODAY);
  eq("last7 counts days, not records", m.last7, 2);
  eq("last28 counts days, not records", m.last28, 2);
  eq("sessions this week", m.sessionsThisWeek, 2);
}

// ---- unnamed Voltra work counts as attendance, not strength ---------------
{
  const merged = mergeSources([], [voltra("2026-09-24", ["Free Exercises"], 300)]);
  const m = computeMetrics(merged, TODAY);
  eq("unnamed day counts toward streak", m.last7, 1);
  check("unnamed day feeds no anchor", m.anchors.every((a) => a.trend === "none"));
}

// ---- anchors: exact names, enforced source, no invented zeroes ------------
{
  const merged = mergeSources(
    [
      hevy("2026-05-01", ex("Deadlift (Barbell)", 225, 5)),
      hevy("2026-09-03", ex("Romanian Deadlift (Dumbbell)", 55, 10)),
      hevy("2026-08-01", ex("Pull Up (Weighted)", 10, 7)),
      hevy("2026-09-02", ex("Pull Up (Weighted)", null, 10)),
      hevy("2026-09-01", ex("Bench Press (Dumbbell)", 45, 10)),
      hevy("2026-09-21", ex("Bench Press (Dumbbell)", 50, 10)),
      hevy("2026-09-22", ex("Incline Bench Press (Dumbbell)", 80, 10)),
    ],
    []
  );
  const m = computeMetrics(merged, TODAY);
  const a = Object.fromEntries(m.anchors.map((x) => [x.id, x]));
  eq("Hevy deadlifts don't feed the Voltra deadlift", a.deadlift.trend, "none");
  eq("pull-up with no load recorded is ignored", a.pullup.delta, "baseline");
  eq("pull-up shows the last loaded set", a.pullup.current, "10 lb × 7");
  eq("incline doesn't match flat bench", a.flat_press.current, "50 lb × 10");
  eq("flat bench delta carries a unit", a.flat_press.delta, "+7 lb");
  eq("flat bench trend", a.flat_press.trend, "up");
  eq("no index until calibrated", m.strengthIndex, null);
  check("index note names what's missing", m.indexNote.includes("Voltra Belt Squat") && m.indexNote.includes("Voltra Deadlift"));
}
{
  const merged = mergeSources(
    [],
    [voltra("2026-09-10", ["Voltra Deadlift Harness"], 150), voltra("2026-09-20", ["Voltra Deadlift Harness"], 140)]
  );
  const d = computeMetrics(merged, TODAY).anchors.find((x) => x.id === "deadlift");
  eq("device deadlift is matched", d.current, "140 lb × 10");
  eq("a real drop reads as down", d.trend, "down");
  check("down delta is signed", d.delta.startsWith("−"));
}

// ---- rest days --------------------------------------------------------------
{
  const merged = mergeSources([hevy("2026-09-21", ex("Cat / Cow", null, 8))], []);
  const m = computeMetrics(merged, TODAY, ["2026-09-22", "2026-09-23", "2026-09-30"]);
  const state = Object.fromEntries(m.week.map((d) => [d.date, d.state]));
  eq("Mon trained", state["2026-09-21"], "done");
  eq("Tue rest", state["2026-09-22"], "rest");
  eq("Thu missed", state["2026-09-24"], "miss");
  eq("rest days leave the target", m.weeklyTarget, 4);
  eq("rest count", m.restThisWeek, 2);
}

// ---- dates are local, not UTC ---------------------------------------------
eq("9pm ET on the 26th stays the 26th (offset)", localDateOf("2026-09-27T01:00:00+00:00"), "2026-09-26");
eq("9pm ET on the 26th stays the 26th (Z)", localDateOf("2026-09-27T01:00:00Z"), "2026-09-26");
eq("no offset is read as UTC", localDateOf("2026-09-27T01:00:00"), "2026-09-26");
eq("morning is unchanged", localDateOf("2026-09-27T14:00:00Z"), "2026-09-27");

// ---- bodyweight average is over calendar days -----------------------------
{
  const rows = ["2026-08-01,160", "2026-09-01,158", "2026-09-21,152", "2026-09-25,skip", "2026-09-26,151"];
  eq("old rows fall out of the window", rollingAverage(rows, TODAY), { avg: 151.5, n: 2 });
  eq("empty window", rollingAverage(["2026-08-01,160"], TODAY), { avg: null, n: 0 });
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("metrics: all checks passed");
