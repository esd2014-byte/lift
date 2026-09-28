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
const item = V.sessionItem({ position: 1, actionId: 7, lb: 60.4, sets: 3, reps: 8, restSec: 95, oneArm: false });
const oneArm = V.sessionItem({ position: 2, actionId: 9, lb: 300, sets: 2, reps: 12, restSec: 60, oneArm: true });
const payload = V.sessionPayload("2026.09.28", [item, oneArm]);

// The contract (Cortex session-schema-reference.md): everything filled in, nothing
// left for the backend to store as null.
eq("config objects are complete", Object.keys(item.actionModeConfig).length, 17);
eq("handMode lives in actionModeConfig", [item.actionModeConfig.handMode, oneArm.actionModeConfig.handMode, "handMode" in item], [2, 1, false]);
eq("disabled extras are null, never 0", [item.actionModeConfig.chainsValue, item.itemDetails[0].modeConfig.eccentricValue], [null, null]);
eq("sessionConfig has its defaults", payload.sessionConfig, { autoUnloadHoldingTime: 3, targetRepUnload: false, zeroUnload: false, smartLoadValue: 3 });
eq("bilateral sets are direction 0", item.itemDetails.map((d) => d.modeConfig.direction), [0, 0, 0]);
eq("one-arm sets alternate sides", oneArm.itemDetails.map((d) => d.modeConfig.direction), [1, 2, 1, 2]);
eq("positions are 1-based and consecutive", oneArm.itemDetails.map((d) => d.position), [1, 2, 3, 4]);
eq("load rounded and clamped", [item.actionModeConfig.baseValue, oneArm.itemDetails[0].modeConfig.baseValue], [60, 230]);
eq("rest in whole tens", item.itemDetails[0].restTime, 100);

// The vendor's own validator, when the voltra CLI is installed (VOLTRA_BIN, or on
// PATH). Local and offline: `session validate` needs no key and uploads nothing.
writeFileSync(join(out, "session.json"), JSON.stringify(payload, null, 2));
{
  const bin = process.env.VOLTRA_BIN || "voltra";
  let stdout = "";
  try {
    stdout = execSync(`"${bin}" session validate --from "${join(out, "session.json")}" --json`, { stdio: "pipe" }).toString();
  } catch (err) {
    stdout = err.stdout?.toString() ?? "";
  }
  const verdict = /"valid":\s*(true|false)/.exec(stdout);
  if (!verdict) console.log("  (voltra CLI not found; skipped the vendor validator)");
  else if (verdict[1] !== "true") {
    console.log(`FAIL  voltra session validate rejected the payload:\n${stdout}`);
    failed++;
  }
}

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
