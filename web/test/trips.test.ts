/**
 * Trips: proposing a session per day, changing them, coming home early, and the
 * hotel conversion. Synthetic data only.
 *
 *   npx tsx --test test/trips.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activeTrip,
  addTrip,
  checkTrip,
  endTrip,
  nextInRotation,
  parseTrips,
  proposeDays,
  setTripDay,
  tripRestDays,
} from "@/lib/trips";
import { programRows, travelRows, type ProgramDay } from "@/lib/programDay";

const ROT = ["A", "B", "C", "D", "E", "F"];

test("proposal: the rotation continues, with a rest every seventh day", () => {
  const days = proposeDays("2030-01-01", "2030-01-09", ROT, "C");
  assert.deepEqual(
    days.map((d) => d.day),
    ["C", "D", "E", "F", "A", "B", "rest", "C", "D"]
  );
  assert.equal(nextInRotation(ROT, { A: "2030-01-01", B: "2030-01-03" }), "C");
  assert.equal(nextInRotation(ROT, { F: "2030-01-03" }), "A", "wraps around");
  assert.equal(nextInRotation(ROT, {}), "A");
});

test("trip lifecycle: add, overlap refused, change a day, home early", () => {
  const input = { from: "2030-01-05", to: "2030-01-08", gym: { type: "db_only", db_max_lb: 50, kettlebells: true } };
  const a = addTrip(null, input, proposeDays(input.from, input.to, ROT, "A"), "now");
  assert.ok(a.text && a.trip);
  assert.deepEqual(a.trip!.gym, { type: "db_only", db_max_lb: 50, kettlebells: true });
  assert.equal(addTrip(a.text, { ...input, from: "2030-01-08", to: "2030-01-10" }, [], "now").text, null);

  const changed = setTripDay(a.text, a.trip!.id, "2030-01-06", "rest")!;
  assert.equal(changed.trip!.days[1].day, "rest");
  assert.throws(() => setTripDay(a.text, a.trip!.id, "2031-01-01", "A"), /isn't on the trip/);
  assert.deepEqual(tripRestDays(parseTrips(changed.text), "2030-01-07"), ["2030-01-06"]);
  assert.equal(activeTrip(parseTrips(changed.text), "2030-01-07")?.id, a.trip!.id);
  assert.equal(activeTrip(parseTrips(changed.text), "2030-01-09"), null);

  const home = endTrip(changed.text, a.trip!.id, "2030-01-07")!;
  assert.equal(home.trip!.to, "2030-01-06");
  assert.deepEqual(
    home.trip!.days.map((d) => d.date),
    ["2030-01-05", "2030-01-06"]
  );
  const cancelled = endTrip(a.text, a.trip!.id, "2030-01-02")!;
  assert.equal(cancelled.trip, null);
  assert.deepEqual(parseTrips(cancelled.text), []);
});

test("trip checks name the problem", () => {
  const ok = { from: "2030-01-05", to: "2030-01-08", gym: { type: "full_gym" } };
  assert.equal(checkTrip(ok, "2030-01-01"), null);
  assert.match(checkTrip({ ...ok, to: "2030-01-01" }, "2030-01-01")!, /ends before/);
  assert.match(checkTrip({ ...ok, gym: { type: "spa" } }, "2030-01-01")!, /hotel gym/);
  assert.match(checkTrip({ ...ok, to: "2030-03-01" }, "2030-01-01")!, /up to/);
  assert.match(checkTrip(ok, "2030-02-01")!, /already over/);
});

const LIB = new Map([
  ["db_press", { name: "DB Press", station: "nuobell" }],
  ["swing", { name: "KB Swing", station: "kettlebell" }],
  ["snatch", { name: "KB Snatch", station: "kettlebell", location: "travel_only" }],
  ["v_row", { name: "Voltra Row", station: "voltra_platform" }],
]);
const DAY: ProgramDay = {
  id: "A",
  name: "Test",
  type: "real",
  minutes: [40, 50],
  blocks: [
    { exercise: "db_press", sets: 3, reps: [8, 12] },
    { exercise: "swing", sets: 3, reps: [15, 20] },
    { exercise: "snatch", sets: 3, reps: [8, 8] },
    { exercise: "v_row", sets: 3, reps: [10, 12] },
  ],
};

test("travel-only lifts stay out of home sessions; the hotel conversion says what to do", () => {
  assert.deepEqual(
    programRows(DAY.blocks, LIB).map((r) => r.name),
    ["DB Press", "KB Swing", "Voltra Row"]
  );
  const rows = travelRows(
    DAY,
    LIB,
    { v_row: { db_only: "DB row" } },
    { type: "db_only", db_max_lb: 50, kettlebells: false }
  );
  assert.deepEqual(
    rows.map((r) => [r.name, r.note ?? ""]),
    [
      ["DB Press", "hotel dumbbells go to 50 lb"],
      ["KB Swing", "no kettlebells: use a dumbbell"],
      ["KB Snatch", "no kettlebells: use a dumbbell"],
      ["DB row", "in place of Voltra Row"],
    ]
  );
  const kb = travelRows(DAY, LIB, {}, { type: "full_gym", db_max_lb: null, kettlebells: true });
  assert.equal(kb[2].note, undefined, "a hotel with kettlebells takes the snatch as written");
});
