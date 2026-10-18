/**
 * Finding Hevy exercise templates for lifts no routine uses yet. A fake Hevy: no
 * network, no key.
 *
 *   npx tsx --test test/hevyTemplates.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveMissingTemplates } from "@/lib/hevyRoutine";

const MAPPING = `
stock:
  kb_swing: Kettlebell Swing
custom:
  kb_snatch: {title: KB Snatch, muscle_group: full_body, equipment_category: kettlebell}
  abx_nordic_curl: {title: ABX Nordic Curl, muscle_group: hamstrings, equipment_category: other}
`;

function fakeHevy(catalogue: Array<{ id: string; title: string }>) {
  const calls = { list: 0, created: [] as string[] };
  return {
    calls,
    api: {
      list: async () => {
        calls.list++;
        return [...catalogue];
      },
      create: async (spec: { title: string }) => {
        calls.created.push(spec.title);
        catalogue.push({ id: `new-${spec.title}`, title: spec.title });
      },
    },
  };
}

test("nothing missing: no calls to Hevy at all", async () => {
  const { api, calls } = fakeHevy([]);
  const found = await resolveMissingTemplates(
    ["Kettlebell Swing"],
    new Map([["kettlebell swing", "t1"]]),
    MAPPING,
    api
  );
  assert.deepEqual(found, {});
  assert.equal(calls.list, 0);
});

test("a stock title is found in the catalogue; a missing custom one is created, then found", async () => {
  const { api, calls } = fakeHevy([
    { id: "stock-swing", title: "Kettlebell Swing" },
    { id: "custom-nordic", title: "ABX Nordic Curl" },
  ]);
  const found = await resolveMissingTemplates(
    ["Kettlebell Swing", "KB Snatch", "ABX Nordic Curl", "Not In Hevy"],
    new Map(),
    MAPPING,
    api
  );
  assert.deepEqual(found, {
    "kettlebell swing": "stock-swing",
    "abx nordic curl": "custom-nordic",
    "kb snatch": "new-KB Snatch",
  });
  assert.deepEqual(calls.created, ["KB Snatch"], "only the custom one that didn't exist");
  assert.equal(calls.list, 2, "read once, and once more after creating");
});

test("an unknown stock title is just not found: nothing is created for it", async () => {
  const { api, calls } = fakeHevy([]);
  const found = await resolveMissingTemplates(["Mystery Lift"], new Map(), MAPPING, api);
  assert.deepEqual(found, {});
  assert.deepEqual(calls.created, []);
});
