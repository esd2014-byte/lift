/**
 * Reading Beyond+ session lists, whatever shape the reply takes.
 *
 *   node test/voltra.test.mjs
 */
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../.test-build/voltra");
execSync(`npx tsc "${join(here, "../lib/voltra.ts")}" --outDir "${out}" --module esnext --target es2022 --moduleResolution bundler --skipLibCheck`, { stdio: "pipe" });
writeFileSync(join(out, "package.json"), '{ "type": "module" }\n');
const V = await import(`${out}/voltra.js`);

let failed = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.log(`FAIL  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failed++;
  }
};
const s = [{ id: 1, title: "2026.09.26" }];
eq("bare key", V.sessionsIn({ workoutSessions: s }), s);
eq("wrapped in data", V.sessionsIn({ ok: true, data: { workoutSessions: s } }), s);
eq("data is the array", V.sessionsIn({ code: 0, data: s }), s);
eq("list under data", V.sessionsIn({ data: { list: s, total: 1 } }), s);
eq("bare array", V.sessionsIn(s), s);
eq("nothing", V.sessionsIn({ data: { total: 0 } }), []);
eq("ignores arrays that aren't sessions", V.sessionsIn({ data: { tags: [1, 2], list: s } }), s);
eq("shape for logs", V.shapeOf({ ok: true, data: { list: s } }), "{ok, data:{list:array(1)}}");

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("voltra: all checks passed");
