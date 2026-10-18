/**
 * The Gym tab's file edits and history cards. Synthetic data only.
 *
 *   npx tsx --test test/gym.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEdit, editEquipment, exerciseCards, missingStations, readEquipment, setExerciseStatus } from "@/lib/gym";

const LIBRARY = `# The library. Comments matter.
meta:
  updated: 2030-01-01

anchors:
  - id: db_bench
    name: DB Bench Press
    anchor: true
    station: nuobell
    tolerance: loved                # a comment on the line

push:
  - {id: cable_press, name: Cable Press, station: voltra_mount, tolerance: fine}
  - {id: band_push, name: Band Push, station: bands, tolerance: disliked, status: retired,
     note: "two lines"}

parked:
  - {id: kb_snatch, name: KB Snatch, blocked_on: adjustable KB}
`;

const EQUIPMENT = `# Home gym.
meta:
  updated: 2030-01-01

dumbbells:
  # THE WEIGHT RULE
  - model: NUOBELL adjustable
    min_lb: 5
    max_lb: 80
    increment_lb: 5
  - model: fixed pairs
    sizes_lb: [3, 5, 10]

kettlebells:
  fixed_lb: [25, 35]
  adjustable:
    range_lb: [26.5, 70.5]
    increment_lb: 4.4
    status: owned

voltra:
  model: VOLTRA I
  attachments:
    - tricep rope
    - ankle straps

accessories:
  - ab roller   # keep me
`;

test("status: a flow entry gets a key, a block entry gets a line, the rest is byte-identical", () => {
  const flow = setExerciseStatus(LIBRARY, "cable_press", "inactive");
  assert.match(
    flow,
    /\{id: cable_press, name: Cable Press, station: voltra_mount, tolerance: fine, status: inactive\}/
  );
  assert.equal(flow.replace(", status: inactive", ""), LIBRARY);

  const block = setExerciseStatus(LIBRARY, "db_bench", "inactive");
  assert.match(block, /- id: db_bench\n {4}status: inactive\n {4}name: DB Bench Press/);
  assert.ok(block.includes("tolerance: loved                # a comment on the line"));

  // An existing status is rewritten in place; activating "no status" is a no-op.
  assert.match(setExerciseStatus(LIBRARY, "band_push", "active"), /status: active,\n {5}note: "two lines"/);
  assert.equal(setExerciseStatus(LIBRARY, "cable_press", "active"), LIBRARY);
  assert.throws(() => setExerciseStatus(LIBRARY, "nope", "inactive"), /not found/);
});

test("equipment: read, and edit without losing comments", () => {
  const e = readEquipment(EQUIPMENT)!;
  assert.deepEqual(e.nuobell, { min: 5, max: 80, step: 5 });
  assert.deepEqual(e.fixedDumbbells, [3, 5, 10]);
  assert.deepEqual(e.adjustableKb, { min: 26.5, max: 70.5, step: 4.4, owned: true });
  assert.deepEqual(e.lists.voltra_attachments, ["tricep rope", "ankle straps"]);

  let out = editEquipment(EQUIPMENT, { action: "fixed_dumbbells", sizes: [20, 3, 5, 10, 15] }, "2030-02-01");
  assert.match(out, /sizes_lb: \[ 3, 5, 10, 15, 20 \]|sizes_lb: \[3, 5, 10, 15, 20\]/);
  out = editEquipment(out, { action: "list_add", list: "accessories", item: "jump rope" }, "2030-02-01");
  out = editEquipment(out, { action: "list_remove", list: "voltra_attachments", item: "ankle straps" }, "2030-02-01");
  for (const c of ["# Home gym.", "# THE WEIGHT RULE", "# keep me"]) assert.ok(out.includes(c), `kept ${c}`);
  const after = readEquipment(out)!;
  assert.deepEqual(after.fixedDumbbells, [3, 5, 10, 15, 20]);
  assert.deepEqual(after.lists.accessories, ["ab roller", "jump rope"]);
  assert.deepEqual(after.lists.voltra_attachments, ["tricep rope"]);
  assert.match(out, /updated: 2030-02-01/);
  assert.throws(() => editEquipment(EQUIPMENT, { action: "list_remove", list: "accessories", item: "anvil" }, "x"));
});

test("equipment: bad edits are named; a missing station takes its exercises out", () => {
  assert.match(checkEdit({ action: "nuobell", min: 90, max: 80, step: 5 })!, /lightest/);
  assert.match(checkEdit({ action: "kettlebells", sizes: [-1] })!, /weights/);
  assert.equal(checkEdit({ action: "list_add", list: "accessories", item: "bands" }), null);
  const none = readEquipment(EQUIPMENT.replace(/sizes_lb: \[3, 5, 10\]/, "sizes_lb: []"))!;
  assert.deepEqual([...missingStations(none)], ["small_db"]);
});

test("exercise cards: last set, estimated max, and what can't be toggled", () => {
  const cards = exerciseCards({
    "library/exercises.yaml": LIBRARY,
    "scripts/hevy_mapping.yaml": "stock:\n  db_bench: Bench Press (Dumbbell)\n",
    "scripts/voltra_mapping.yaml": "actions:\n  cable_press: 51\n",
    "logs/hevy/recent.json": JSON.stringify({
      sessions: [
        {
          date: "2030-01-05",
          title: "A",
          exercises: [{ name: "Bench Press (Dumbbell)", sets: 4, top: { lb: 60, reps: 10 } }],
        },
        {
          date: "2030-01-01",
          title: "A",
          exercises: [{ name: "Bench Press (Dumbbell)", sets: 4, top: { lb: 55, reps: 10 } }],
        },
      ],
    }),
    "logs/voltra/recent.json": JSON.stringify({
      sessions: [
        { date: "2030-01-04", action_ids: [51], actions: ["Cable Press"], sets: 3, reps: 30, avg_force_lb: 40.4 },
      ],
    }),
  });
  const by = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.deepEqual(by.db_bench.last, { date: "2030-01-05", lb: 60, reps: 10, where: "Hevy" });
  assert.equal(by.db_bench.e1rm, 80);
  assert.equal(by.db_bench.stationName, "NUOBELL");
  assert.deepEqual(by.cable_press.last, { date: "2030-01-04", lb: 40, reps: 10, where: "Voltra" });
  assert.equal(by.band_push.status, "retired");
  assert.equal(by.kb_snatch.locked, "parked: adjustable KB");
});
