/**
 * Reading Beyond+ session lists, whatever shape the reply takes, and writing
 * sessions to the endpoints and contract the voltra CLI uses.
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

// ---- writes: endpoint, method and contract fields ----
process.env.VOLTRA_API_KEY = "test-key";
const calls = [];
let reply = { status: 200, body: '{"code":0,"msg":"ok","data":{}}' };
globalThis.fetch = async (url, init) => {
  calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body) : null });
  return new Response(reply.body || null, { status: reply.status });
};
const item = {
  itemGroupPosition: 1, workoutMode: 1, handMode: 2, actionId: 7, actionModeConfig: {},
  itemDetails: [{ position: 1, repCount: 8, restTime: 90, tag: 0, modeConfig: { baseValue: 60, direction: 0 } }],
};
const payload = {
  title: "Day A - Push (Sep 28)", sessionConfig: {}, blockList: [{ blockType: 1, itemList: [item] }],
  originSessionId: null, accountRole: 0, connectionMode: 0, label: 0,
};
await V.createSession(payload);
eq("create endpoint", [calls[0].method, calls[0].url], ["POST", "https://api.beyond-power.com/agent/workout/me/custom-session/v2"]);
eq("create sends the contract fields", calls[0].body, payload);
await V.updateSession(42, payload);
eq("update endpoint", [calls[1].method, calls[1].url], ["PUT", "https://api.beyond-power.com/agent/workout/me/sessions/v2/42"]);
eq("update sends only what can change", Object.keys(calls[1].body).sort(), ["blockList", "connectionMode", "sessionConfig", "title"]);

const rejects = async (label, fn, pattern) => {
  try {
    await fn();
    console.log(`FAIL  ${label}: didn't throw`);
    failed++;
  } catch (err) {
    if (!pattern.test(err.message)) {
      console.log(`FAIL  ${label}: ${err.message}`);
      failed++;
    }
  }
};
reply = { status: 204, body: "" };
await rejects("an empty 204 is not a save", () => V.createSession(payload), /ignored/);
reply = { status: 200, body: '{"code":1001,"msg":"SESSION_TITLE_ALREADY_EXISTED"}' };
await rejects("a refusal code is not a save", () => V.createSession(payload), /SESSION_TITLE_ALREADY_EXISTED/);
reply = { status: 405, body: "" };
await rejects("a wrong method is an error", () => V.createSession(payload), /405/);

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("voltra: all checks passed");
