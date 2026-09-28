/**
 * Checks the tolerance editor against a synthetic exercises.yaml (test/fixtures).
 *
 * This edits the source of truth for the whole program, and exercises.yaml is
 * heavily commented - the station rules, the injury rationale, why each anchor was
 * chosen. A parse/stringify round-trip would delete all of it silently, which is
 * why the editor works on text. These tests exist to keep it that way.
 *
 *   node test/library.test.mjs
 */
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = "/tmp/pt-library-test";
execSync(
  `npx tsc "${join(here, "../lib/tolerance.ts")}" --outDir "${out}" --module esnext --target es2022 --moduleResolution bundler --skipLibCheck`,
  { stdio: "pipe" }
);
const { applyTolerances } = await import(`${out}/tolerance.js`);

const raw = readFileSync(join(here, "fixtures/exercises.yaml"), "utf8");
let failed = 0;
const check = (label, ok) => {
  if (!ok) {
    console.log(`FAIL  ${label}`);
    failed++;
  }
};

// A block-style entry (the anchors) and a flow-style entry (accessories) - the file
// uses both shapes, and the editor has to handle each.
const edited = applyTolerances(raw, {
  voltra_belt_squat: "loved", // block style
  db_lateral_raise: "disliked", // flow style
});

check("block entry updated", /id: voltra_belt_squat[\s\S]{0,600}?tolerance: loved/.test(edited));
check("flow entry updated", /id: db_lateral_raise[\s\S]{0,400}?tolerance: disliked/.test(edited));
const wasUnreviewed = raw.includes("tolerance_reviewed_by_eli: false");
check("review flag is true after editing", edited.includes("tolerance_reviewed_by_eli: true"));

// The whole point: comments and unrelated content survive untouched.
const commentsBefore = (raw.match(/^\s*#/gm) || []).length;
const commentsAfter = (edited.match(/^\s*#/gm) || []).length;
check(`comments preserved (${commentsBefore} -> ${commentsAfter})`, commentsBefore === commentsAfter);
check("line count unchanged", raw.split("\n").length === edited.split("\n").length);
check("other exercises untouched", edited.includes("id: voltra_deadlift") && edited.includes("doubler_required: true"));
check("injury note intact", edited.includes("MAG bar ONLY"));

// Only the two targeted lines changed.
// Two tolerance lines, plus the review flag only if it wasn't already true.
const expected = wasUnreviewed ? 3 : 2;
const editedLines = edited.split("\n");
const diffLines = raw.split("\n").filter((l, i) => l !== editedLines[i]).length;
check(`exactly ${expected} line(s) changed (got ${diffLines})`, diffLines === expected);

// Bad input must be refused, not silently written.
let threw = false;
try {
  applyTolerances(raw, { voltra_belt_squat: "amazing" });
} catch {
  threw = true;
}
check("rejects an invalid tolerance value", threw);
threw = false;
try {
  applyTolerances(raw, { not_a_real_exercise: "loved" });
} catch {
  threw = true;
}
check("rejects an unknown exercise id", threw);

console.log(failed ? `\n${failed} failure(s)` : "ok - tolerance editor preserves the file");
process.exit(failed ? 1 : 0);
