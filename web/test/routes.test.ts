/**
 * The API routes and the page's data, end to end, against a folder of synthetic
 * data (test/fixtures/data) instead of GitHub. Each test gets a fresh copy.
 *
 * No network: no Hevy or Beyond+ keys are set, and fetch throws if anything tries.
 *
 *   npx tsx --test test/routes.test.ts
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { issueSession } from "@/lib/auth";
import { todayISO } from "@/lib/date";
import { loadDay } from "@/lib/brief";
import { readFile as storeRead } from "@/lib/store";
import { POST as bodyweight } from "@/app/api/bodyweight/route";
import { POST as measurements } from "@/app/api/measurements/route";
import { POST as restDay } from "@/app/api/rest-day/route";
import { POST as injuries } from "@/app/api/injuries/route";
import { POST as dayNote } from "@/app/api/day-note/route";
import { POST as tolerance } from "@/app/api/tolerance/route";
import { POST as workout } from "@/app/api/workout/route";
import { POST as photo } from "@/app/api/photo/route";

// Nothing reads these at import time, only when a test calls in.
process.env.APP_SECRET = "test secret, not a real one";
delete process.env.HEVY_API_KEY;
delete process.env.VOLTRA_API_KEY;
delete process.env.DATA_REPO;
delete process.env.DATA_TOKEN;
globalThis.fetch = (async (url: unknown) => {
  throw new Error(`test tried to reach the network: ${String(url)}`);
}) as typeof fetch;

const FIXTURES = join(__dirname, "fixtures");
const today = todayISO();
let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "lift-data-"));
  cpSync(join(FIXTURES, "data"), dir, { recursive: true });
  mkdirSync(join(dir, "logs/briefs"), { recursive: true });
  const brief = readFileSync(join(FIXTURES, "brief-template.json"), "utf8").replaceAll("{{DATE}}", today);
  writeFileSync(join(dir, `logs/briefs/${today}.json`), brief);
  writeFileSync(join(dir, `logs/briefs/${today}.md`), readFileSync(join(FIXTURES, "brief-template.md"), "utf8"));
  process.env.DATA_DIR = dir;
  delete process.env.DATA_READONLY;
});

const file = (p: string) => readFileSync(join(dir, p), "utf8");

function req(body: unknown, { authed = true } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (authed) headers.cookie = `pt_session=${issueSession()}`;
  return new NextRequest("http://localhost/api/x", { method: "POST", headers, body: JSON.stringify(body) });
}

async function call(
  handler: (r: NextRequest, ctx: unknown) => Response | Promise<Response>,
  body: unknown,
  opts?: { authed?: boolean }
) {
  const res = await handler(req(body, opts), {});
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, id: res.headers.get("x-request-id") };
}

// ---- auth: every write route refuses a request without a session --------------------
test("every write route 404s without a session", async () => {
  for (const h of [bodyweight, measurements, restDay, injuries, dayNote, tolerance, workout, photo]) {
    const r = await call(h, {}, { authed: false });
    assert.equal(r.status, 404);
  }
  assert.equal(file("logs/bodyweight.csv").includes(today), false, "nothing was written");
});

test("responses carry a request id for matching to the logs", async () => {
  const r = await call(bodyweight, { weight: 181 });
  assert.match(r.id ?? "", /^[0-9a-f]{8}$/);
});

// ---- bodyweight ---------------------------------------------------------------------
test("bodyweight: one row per day, a second entry replaces the first", async () => {
  assert.equal((await call(bodyweight, { weight: 181 })).status, 200);
  const r = await call(bodyweight, { weight: 182.4 });
  assert.equal(r.status, 200);
  const rows = file("logs/bodyweight.csv")
    .trim()
    .split("\n")
    .filter((l) => l.startsWith(`${today},`));
  assert.deepEqual(rows, [`${today},182.4`]);
  assert.equal(typeof r.json.rolling7, "number");
});

test("bodyweight: a skipped day is recorded as skip", async () => {
  await call(bodyweight, { skip: true });
  assert.ok(file("logs/bodyweight.csv").includes(`${today},skip`));
});

test("bodyweight: nonsense is refused and nothing is written", async () => {
  for (const weight of [5, 900, "181", null]) {
    assert.equal((await call(bodyweight, { weight })).status, 400);
  }
  assert.equal(file("logs/bodyweight.csv").includes(today), false);
});

// ---- measurements, rest days, injury notes -------------------------------------------
test("measurements: partial entries keep the columns aligned", async () => {
  assert.equal((await call(measurements, { waist: 33.5, shoulder: 48.5 })).status, 200);
  assert.ok(file("logs/measurements.csv").includes(`${today},33.5,,48.5`));
  assert.equal((await call(measurements, {})).status, 400);
  assert.equal((await call(measurements, { arm: 400 })).status, 400);
});

test("rest day: stored with the reason, one per day", async () => {
  await call(restDay, { reason: "travel" });
  await call(restDay, { reason: "kid was sick" });
  const log = JSON.parse(file("logs/rest-days.json"));
  assert.equal(log.length, 1);
  assert.equal(log[0].reason, "kid was sick");
  assert.equal((await call(restDay, { reason: "  " })).status, 400);
});

test("injuries: report, update, resolve and reopen one card", async () => {
  const r = await call(injuries, { action: "create", text: "Right elbow sore after curls. Sharp at the bottom." });
  assert.equal(r.status, 200);
  const id = (r.json.injury as { id: string }).id;
  assert.equal(id, `${today}-1`);
  await call(injuries, { action: "create", text: "Left knee clicks." });
  await call(injuries, { action: "update", id, text: "Better with hammer grip." });
  await call(injuries, { action: "resolve", id });
  let list = JSON.parse(file("logs/injuries.json"));
  assert.equal(list.length, 2);
  assert.equal(list[0].title, "Right elbow sore after curls");
  assert.equal(list[0].status, "resolved");
  assert.deepEqual(
    list[0].updates.map((u: { text: string }) => u.text),
    ["Right elbow sore after curls. Sharp at the bottom.", "Better with hammer grip.", "Marked resolved."]
  );
  assert.equal(list[1].id, `${today}-2`, "ids don't collide on the same day");
  await call(injuries, { action: "reopen", id });
  list = JSON.parse(file("logs/injuries.json"));
  assert.equal(list[0].status, "active");
  assert.equal(list[0].resolved_at, null);
});

test("injuries: bad requests are refused", async () => {
  assert.equal((await call(injuries, { action: "create", text: " " })).status, 400);
  assert.equal((await call(injuries, { action: "update", id: "nope", text: "x" })).status, 404);
  assert.equal((await call(injuries, { action: "resolve", id: "nope" })).status, 404);
  assert.equal((await call(injuries, { action: "delete", id: "x" })).status, 400);
  assert.equal((await call(injuries, { action: "create", text: "x".repeat(2001) })).status, 400);
});

test("day notes: appended; a trained note counts toward the streak", async () => {
  await call(dayNote, { text: "Beyond+ split one calibration workout into four sessions." });
  const r = await call(dayNote, { text: "Pushups at home, not logged.", when: "yesterday", trained: true });
  assert.equal(r.status, 200);
  const notes = JSON.parse(file("logs/day-notes.json"));
  assert.equal(notes.length, 2);
  assert.equal(notes[0].date < notes[1].date, true, "kept in date order");
  assert.equal(notes[0].trained, true);
  assert.equal(notes[1].trained, false);
  const day = await loadDay();
  assert.equal(day.dayNotes.length, 2);
  assert.equal((await call(dayNote, { text: "" })).status, 400);
  assert.equal((await call(dayNote, { text: "x", when: "last week" })).status, 400);
});

// ---- tolerance ratings ----------------------------------------------------------------
test("tolerance: rewrites just the one value in the library", async () => {
  const before = file("library/exercises.yaml");
  const r = await call(tolerance, { updates: { dead_bug: "loved" } });
  assert.equal(r.status, 200);
  const after = file("library/exercises.yaml");
  assert.ok(
    after.includes("tolerance: loved}") &&
      !after.includes(
        "pattern: anti_extension,\n     muscles: {primary: [abs]}, progression: reps, tolerance: untested"
      )
  );
  assert.equal(after.split("\n").length, before.split("\n").length, "comments and layout survive");
  assert.equal((await call(tolerance, { updates: { dead_bug: "meh" } })).status, 400);
});

// ---- workout start / end ---------------------------------------------------------------
test("workout: start logs the variant; pushes report failure without breaking the start", async () => {
  const r = await call(workout, { action: "start", variant: "full", briefDate: today });
  assert.equal(r.status, 200);
  const log = JSON.parse(file("logs/workouts.json"));
  assert.equal(log.length, 1);
  assert.equal(log[0].variant, "full");
  assert.equal(JSON.parse(file("logs/variants.json"))[0].variant, "full");
  // No keys in tests: both pushes fail, and say so, but the start still counts.
  assert.equal((r.json.hevy as { ok: boolean }).ok, false);
  assert.equal((r.json.voltra as { ok: boolean }).ok, false);
});

test("workout: end closes the running workout; ending again is a 409", async () => {
  await call(workout, { action: "start", variant: "minimum", briefDate: today });
  const r = await call(workout, { action: "end" });
  assert.equal(r.status, 200);
  assert.ok(JSON.parse(file("logs/workouts.json"))[0].ended_at);
  assert.equal((await call(workout, { action: "end" })).status, 409);
});

test("workout: an off-plan program day starts from the program, and the log says so", async () => {
  const r = await call(workout, { action: "start", variant: "full", day: "B" });
  assert.equal(r.status, 200);
  const log = JSON.parse(file("logs/workouts.json"));
  assert.equal(log[0].day, "Day B — Pull");
  assert.equal(log[0].off_plan, true);
  const chosen = JSON.parse(file("logs/variants.json"))[0];
  assert.equal(chosen.day, "Day B — Pull");
  assert.equal(chosen.off_plan, true);
  assert.equal((await call(workout, { action: "start", variant: "full", day: "Q" })).status, 404);
  assert.equal((await call(workout, { action: "start", variant: "beast", day: "B" })).status, 400);
});

test("workout: bad requests are refused", async () => {
  assert.equal((await call(workout, { action: "start", variant: "turbo" })).status, 400);
  assert.equal((await call(workout, { action: "start", variant: "full", briefDate: "2031-12-31" })).status, 404);
  assert.equal((await call(workout, { action: "dance" })).status, 400);
});

// ---- photos -----------------------------------------------------------------------------
test("photo: stored under today's date; non-images refused", async () => {
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const r = await call(photo, { dataUrl: `data:image/png;base64,${png}` });
  assert.equal(r.status, 200);
  assert.ok(existsSync(join(dir, String(r.json.path))));
  assert.equal((await call(photo, { dataUrl: "data:text/html;base64,PGgxPg==" })).status, 400);
});

// ---- read-only demo -------------------------------------------------------------------
test("read-only data: writes are refused with a plain message", async () => {
  process.env.DATA_READONLY = "1";
  const r = await call(bodyweight, { weight: 181 });
  assert.equal(r.status, 500);
  assert.match(String(r.json.error), /read-only demo/);
  assert.equal(file("logs/bodyweight.csv").includes(today), false);
});

// ---- the page's data ---------------------------------------------------------------------
test("page data: today's brief, with Voltra loads guessed as calibration", async () => {
  const day = await loadDay();
  assert.equal(day.briefDate, today);
  assert.equal(day.stale, false);
  const rows = day.briefData!.variants.full.rows;
  const press = rows.find((r) => r.name === "Cable Single-Arm Press")!;
  const pushdown = rows.find((r) => r.name === "Cable Pushdown")!;
  // No history for the press: DB bench 60 x 10 carried to 15 reps + 2 in reserve is
  // 51 lb; 80% of that is 40.8, rounded down to 40.
  assert.equal(press.calibration?.source, "related");
  assert.equal(press.load_lb, 40);
  // Pushdown: Voltra 01-01 (35 lb) is older than Hevy 01-05 (40 x 12), so Hevy wins.
  assert.equal(pushdown.calibration?.source, "history");
  assert.match(pushdown.calibration!.basis, /Triceps Rope Pushdown/);
  // Rows with a load, and non-Voltra rows, are left alone.
  assert.equal(rows.find((r) => r.name === "DB Bench Press")!.calibration, undefined);
  assert.equal(rows.find((r) => r.name === "Dead Bug")!.calibration, undefined);
});

test("page data: every program day, with loads from history", async () => {
  const day = await loadDay();
  assert.deepEqual(Object.keys(day.programDays), ["A", "B"]);
  const pull = day.programDays.B.variants.full;
  assert.equal(pull.hevy_routine, "Day B — Pull");
  assert.deepEqual(
    pull.rows.map((r) => [r.superset, r.name, r.reps]),
    [
      ["A", "Cable Lat Pulldown", "4 × 8-12"],
      ["A", "DB Row", "4 × 8-12"],
      [null, "Dead Bug", "3 × 10"],
    ]
  );
  // DB Row: a free-weight row gets a number from its own history only (55 x 10).
  const row = pull.rows.find((r) => r.name === "DB Row")!;
  assert.equal(row.calibration?.source, "history");
  assert.equal(typeof row.load_lb, "number");
  // Pulldown: a Voltra row, guessed the usual way from its device history.
  assert.equal(pull.rows[0].calibration?.source, "history");
  // Dead Bug: no history, bodyweight - no invented number.
  assert.equal(pull.rows[2].load_lb, undefined);
  assert.equal(day.program?.meta.block, "reintroduction");
  assert.equal(day.goals?.primary?.statement, "Add a little muscle and stay lean.");
});

test("page data: bodyweight, measurements and history come through", async () => {
  const day = await loadDay();
  assert.equal(day.sessions.length, 3);
  assert.equal(day.voltraSessions.length, 2);
  assert.equal(day.dayNames.A, "Push");
  assert.equal(day.measurements.lastDate, "2030-01-01");
  assert.equal(day.bodyweight.logged, null, "nothing logged today yet");
});

test("page data: no brief within a week falls back to prose-less, not a crash", async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "lift-empty-"));
  const day = await loadDay();
  assert.equal(day.briefDate, null);
  assert.equal(day.briefData, null);
  assert.deepEqual(day.sessions, []);
});

test("the folder store refuses paths that climb out of DATA_DIR", async () => {
  await assert.rejects(storeRead("../../etc/passwd"), /escapes DATA_DIR/);
});
