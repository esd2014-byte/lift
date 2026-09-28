/**
 * The workout loop: the log that Start/End write, the names the buttons and both
 * apps share, and the Hevy routine built from a brief. Synthetic data only.
 *
 *   node test/workout.test.mjs
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
// Inside web/ so the compiled modules can resolve node_modules (yaml).
const out = join(here, "../.test-build");
execSync(
  `npx tsc "${join(here, "../lib/workouts.ts")}" "${join(here, "../lib/session.ts")}" "${join(here, "../lib/hevyRoutine.ts")}" --outDir "${out}" --rootDir "${join(here, "../lib")}" --module esnext --target es2022 --moduleResolution bundler --skipLibCheck`,
  { stdio: "pipe" }
);
// Bundler-style imports have no extensions; add them so Node can load the output.
for (const f of readdirSync(out).filter((f) => f.endsWith(".js"))) {
  const p = join(out, f);
  writeFileSync(p, readFileSync(p, "utf8").replace(/from "(\.\/[a-zA-Z]+)"/g, 'from "$1.js"'));
}
writeFileSync(join(out, "package.json"), '{ "type": "module" }\n');
const W = await import(`${out}/workouts.js`);
const S = await import(`${out}/session.js`);
const H = await import(`${out}/hevyRoutine.js`);

let failed = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.log(`FAIL  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failed++;
  }
};

// ---- workout log -------------------------------------------------------------
{
  let log = W.start([], { date: "2030-01-01", variant: "full", day: "Day A — Push", started_at: "2030-01-01T22:00:00Z" });
  eq("one open workout", W.openWorkout(log)?.variant, "full");

  // Starting again before ending replaces, it doesn't stack.
  log = W.start(log, { date: "2030-01-01", variant: "beast", day: "Day A — Push", started_at: "2030-01-01T22:05:00Z" });
  eq("restart replaces", log.length, 1);
  eq("restart takes the new variant", log[0].variant, "beast");

  const ended = W.end(log, "2030-01-01T22:57:00Z");
  eq("elapsed minutes", ended.entry.minutes, 52);
  eq("nothing open after end", W.openWorkout(ended.log), null);
  eq("end with nothing open", W.end(ended.log, "2030-01-01T23:00:00Z").entry, null);

  // Left open overnight: the duration is not trusted.
  const overnight = W.end(
    W.start([], { date: "2030-01-02", variant: "full", day: "Day B", started_at: "2030-01-02T21:00:00Z" }),
    "2030-01-03T13:38:00Z"
  );
  eq("overnight has no minutes", overnight.entry.minutes, null);
  eq("overnight is flagged", overnight.entry.left_open, true);

  const closed = W.closeUnended(W.start([], { date: "2030-01-03", variant: "full", day: "Day C", started_at: "2030-01-03T21:00:00Z" }));
  eq("closed without a time", [closed[0].closed_unended, closed[0].minutes], [true, null]);
  eq("closed isn't open", W.openWorkout(closed), null);
  eq("closed day still counts", W.trainedDates(closed), ["2030-01-03"]);
  eq("bad log parses to empty", W.parseLog("not json"), []);

  // Yesterday's never-ended workout survives today's start, closed.
  const carried = W.start(
    W.start([], { date: "2030-01-04", variant: "full", day: "Day D", started_at: "2030-01-04T21:00:00Z" }),
    { date: "2030-01-05", variant: "full", day: "Day E", started_at: "2030-01-05T21:00:00Z" }
  );
  eq("earlier open workout kept", carried.map((w) => w.date), ["2030-01-04", "2030-01-05"]);
  eq("earlier open workout closed", carried[0].closed_unended, true);
  eq("today's is the open one", W.openWorkout(carried)?.date, "2030-01-05");
}

// ---- names ---------------------------------------------------------------------
{
  const brief = { date: "2030-01-05", day: "A", day_name: "Push", day_type: "real", variants: {} };
  const names = { A: "Push", E: "Upper Hypertrophy" };
  eq("day title", S.dayTitle(brief, { label: "Full", meta: "", duration: "", rows: [] }, names), "Day A — Push");
  eq(
    "promoted day from the variant text",
    S.dayTitle(brief, { label: "Beast", meta: "promote to Day E", duration: "", rows: [] }, names),
    "Day E — Upper Hypertrophy"
  );
  eq("hevy_routine wins", S.dayTitle(brief, { label: "x", meta: "Day E", hevy_routine: "Day B — Pull", duration: "", rows: [] }, names), "Day B — Pull");
  eq("voltra title is ascii + date", S.voltraTitle("Day A — Push", "2030-01-05"), "Day A - Push (Jan 5)");
  eq("hevy title, full", S.hevyTitle("Day A — Push", "full", { label: "Full" }), "Today: Day A — Push");
  eq("hevy title, variant", S.hevyTitle("Day A — Push", "beast", { label: "Beast mode" }), "Today: Day A — Push · Beast mode");
  eq("cable row is voltra", S.isVoltraRow({ name: "Voltra Row", reps: "3 × 10" }), true);
  eq("db row is not", S.isVoltraRow({ name: "DB Lateral Raise", station: "Small DB", reps: "3 × 10" }), false);
}

// ---- hevy routine ----------------------------------------------------------------
{
  eq("strips station ids", H.cleanNote("RPE 8 — [nuobell] — ANCHOR. ABX flat."), "RPE 8 — ANCHOR. ABX flat.");
  eq("keeps ordinary hyphens", H.cleanNote("Free station - superset filler"), "Free station - superset filler");

  const rows = [
    { superset: "A", name: "Flat DB Press", station: "NUOBELL", reps: "4 × 6-10", rpe: 8, load_lb: 55 },
    { superset: "A", name: "DB Lateral Raise", station: "Small DB", reps: "3 × 8-12", rpe: 8, load_lb: 25, note: "[small_db] Priority muscle" },
    { superset: "B", name: "Voltra Single-Arm Press", station: "Voltra @ pin mount", reps: "3 × 10-15", rpe: 8 },
    { superset: "B", name: "DB Seated OHP", station: "NUOBELL", reps: "3 × 10-15", rpe: 8, load_lb: 30 },
    { name: "Plank", station: "Floor", reps: "3 × 45 s", rpe: 7 },
    { name: "Mystery Move", station: "DB", reps: "3 × 10" },
  ];
  const lib = new Map([
    ["flat db press", "flat_press"], ["db lateral raise", "lat_raise"], ["db seated ohp", "ohp"], ["plank", "plank"],
    ["voltra single-arm press", "v_press"], ["mystery move", "mystery"],
  ]);
  const titles = H.hevyTitles(`stock:\n  flat_press: Bench Press (Dumbbell)\n  lat_raise: Lateral Raise (Dumbbell)\n  plank: Plank\ncustom:\n  ohp:\n    title: Seated Overhead Press (Dumbbell)\n`);
  const templates = new Map([
    ["bench press (dumbbell)", "T1"], ["lateral raise (dumbbell)", "T2"], ["seated overhead press (dumbbell)", "T3"], ["plank", "T4"],
  ]);
  const warmup = [{ exercise_template_id: "W", superset_id: null, notes: "WARM-UP", sets: [{ type: "normal", weight_kg: null, reps: 8 }] }];
  const { exercises, skipped, voltra } = H.buildExercises({ rows, libraryIds: lib, hevyTitles: titles, templateIds: templates, warmup });

  eq("warm-up leads", exercises[0].exercise_template_id, "W");
  eq("voltra rows left out and counted", voltra, 1);
  eq("unmapped rows reported", skipped, ["Mystery Move"]);
  eq("template order", exercises.map((e) => e.exercise_template_id), ["W", "T1", "T2", "T3", "T4"]);
  eq("target weight in kg", exercises[1].sets[0].weight_kg, 24.9);
  eq("sets and bottom of the rep range", [exercises[1].sets.length, exercises[1].sets[0].reps], [4, 6]);
  eq("superset kept when both halves are in Hevy", [exercises[1].superset_id, exercises[2].superset_id], [0, 0]);
  eq("superset cleared when its partner is on the Voltra", exercises[3].superset_id, null);
  eq("timed set", [exercises[4].sets[0].duration_seconds, exercises[4].sets[0].reps], [45, null]);
  eq("clean notes", exercises[2].notes, "RPE 8 · 3 × 8-12 · target 25 lb · Priority muscle");

  // The brief abbreviates; the library doesn't.
  const V = await import(`${out}/voltraSession.js`);
  const ids = V.libraryIds("push:\n  - {id: nuobell_seated_ohp, name: NUOBELL Seated Overhead Press}\n  - {id: rdl, name: Dumbbell Romanian Deadlift}\n");
  eq("OHP matches Overhead Press", V.lookupId(ids, "NUOBELL Seated OHP"), "nuobell_seated_ohp");
  eq("DB RDL matches", V.lookupId(ids, "DB RDL"), "rdl");
  eq("exact still wins", V.lookupId(ids, "nuobell seated overhead press"), "nuobell_seated_ohp");
  eq("unknown stays unknown", V.lookupId(ids, "Mystery Move"), undefined);
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("workout: all checks passed");
