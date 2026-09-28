/**
 * Calibration guesses for Voltra rows the brief left without a load. Synthetic data only.
 *
 *   node test/loadGuess.test.mjs
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../.test-build/loadGuess");
execSync(
  `npx tsc "${join(here, "../lib/loadGuess.ts")}" --outDir "${out}" --rootDir "${join(here, "../lib")}" --module esnext --target es2022 --moduleResolution bundler --skipLibCheck`,
  { stdio: "pipe" }
);
for (const f of readdirSync(out).filter((f) => f.endsWith(".js"))) {
  const p = join(out, f);
  writeFileSync(p, readFileSync(p, "utf8").replace(/from "(\.\/[a-zA-Z]+)"/g, 'from "$1.js"'));
}
writeFileSync(join(out, "package.json"), '{ "type": "module" }\n');
const G = await import(`${out}/loadGuess.js`);

let failed = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.log(`FAIL  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failed++;
  }
};

const files = {
  "library/exercises.yaml": `
voltra:
  - {id: cable_pull, name: Test Cable Pull}
  - {id: cable_press, name: Test Cable Press}
  - {id: cable_new, name: Test Cable New}
dumbbell:
  - {id: db_press, name: Test DB Press}
`,
  "scripts/voltra_mapping.yaml": `
actions:
  cable_pull: 1
  cable_press: 2
  cable_new: 3
estimate_from:
  cable_press: {lift: db_press, ratio: 0.5}
`,
  "scripts/hevy_mapping.yaml": `
stock:
  cable_pull: Pull (Cable)
  cable_press: Press (Cable)
  db_press: Press (Dumbbell)
`,
  "logs/hevy/recent.json": JSON.stringify({
    sessions: [
      { date: "2026-01-02", exercises: [{ name: "Pull (Cable)", sets: 3, top: { lb: 80, reps: 10 } }] },
      { date: "2026-01-05", exercises: [{ name: "Pull (Cable)", sets: 3, top: { lb: 100, reps: 10 } }] },
      { date: "2026-01-04", exercises: [{ name: "Press (Dumbbell)", sets: 3, top: { lb: 60, reps: 8 } }] },
    ],
  }),
};
files["logs/voltra/recent.json"] = JSON.stringify({
  sessions: [
    // Newer than the Hevy pull (2026-01-05), so it wins: 120 lb x 10 per set.
    { date: "2026-01-06", actions: ["Pull"], action_ids: [1], unnamed: false, sets: 3, reps: 30, avg_force_lb: 119.6 },
    // Two movements in one session: which force was which is unknowable, so ignored.
    { date: "2026-01-07", actions: ["Pull", "Press"], action_ids: [1, 2], unnamed: false, sets: 6, reps: 60, avg_force_lb: 200 },
    // A digest written before action ids were kept.
    { date: "2026-01-08", actions: ["Press"], unnamed: false, sets: 3, reps: 30, avg_force_lb: 200 },
  ],
});
const input = G.guessInputs(files);

// ---- the arithmetic ----
eq("rep range", G.repRange("3 × 8-12"), { lo: 8, hi: 12 });
eq("single rep target", G.repRange("4 × 6"), { lo: 6, hi: 6 });
eq("rounds down to 5", [G.floor5(47.9), G.floor5(2), G.floor5(400)], [45, 5, 230]);
eq("same reps, no reserve, same weight", Math.round(G.carryOver(100, 10, 10, 0)), 100);
eq("more reps means lighter", G.carryOver(100, 10, 12, 2) < 100, true);
eq("newest set wins", G.lastLogged(JSON.parse(files["logs/hevy/recent.json"]).sessions, "Pull (Cable)").lb, 100);

// ---- the tiers ----
const row = (name, extra = {}) => ({ name, reps: "3 × 8-12", rpe: 8, ...extra });

const hevyOnly = G.guessInputs({ ...files, "logs/voltra/recent.json": null });
const own = G.guessRow(row("Test Cable Pull"), hevyOnly);
// 100 x 10 -> 12 reps + 2 in reserve: 100 * (1 + 10/30) / (1 + 14/30) = 90.9 -> 90
eq("own history", [own.source, own.lb, own.rpe, own.reps], ["history", 90, 8, "3 × 8-12"]);
eq("says where it came from", own.basis.includes("100 lb × 10 on 2026-01-05"), true);
const dev = G.guessRow(row("Test Cable Pull"), input);
// 120 x 10: 120 * (1 + 10/30) / (1 + 14/30) = 109.1 -> 105
eq("newer Voltra history beats older Hevy", [dev.lb, dev.basis.includes("on the Voltra")], [105, true]);

const rel = G.guessRow(row("Test Cable Press"), input);
// 60 x 8 -> 12 reps + 2: 60 * (1 + 8/30) / (1 + 14/30) = 51.8, x 0.5 = 25.9 -> 25
eq("related lift", [rel.source, rel.lb], ["related", 25]);

eq("coach's note", G.guessRow(row("Test Cable New", { note: "try 42 lb" }), input).lb, 40);
eq("light start", G.guessRow(row("Test Cable New"), input).source, "none");
eq("missing RPE defaults to 8", G.guessRow(row("Test Cable Pull", { rpe: null }), input).rpe, 8);

eq("a row with a load is left alone", G.guessRow(row("Test Cable Pull", { load_lb: 70 }), input), null);
eq("a dumbbell row is left alone", G.guessRow(row("Test DB Press"), input), null);

// ---- the brief ----
const brief = { date: "2026-01-06", day: "A", variants: { full: { label: "Full", meta: "", duration: "", rows: [row("Test Cable Pull"), row("Test DB Press")] } } };
const filled = G.fillLoads(brief, input);
eq("fills load_lb and flags calibration", [filled.variants.full.rows[0].load_lb, Boolean(filled.variants.full.rows[0].calibration)], [105, true]);
eq("leaves other rows untouched", filled.variants.full.rows[1], brief.variants.full.rows[1]);
eq("doesn't mutate the brief", brief.variants.full.rows[0].load_lb, undefined);

eq("no history files is fine", G.guessRow(row("Test Cable Pull"), G.guessInputs({ ...files, "logs/hevy/recent.json": null, "logs/voltra/recent.json": "not json" })).source, "none");

if (failed) {
  console.log(`loadGuess: ${failed} check(s) failed`);
  process.exit(1);
}
console.log("loadGuess: all checks passed");
