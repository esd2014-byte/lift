/**
 * The Program tab's read of recent logs: last date per program day, the last
 * session, and the questions the logs can't answer.
 *
 *   npx tsx --test test/recent.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dayLetter, lastSession, lastTrainedByDay, noteDates, questions } from "@/lib/recent";
import { briefParts } from "@/lib/markdown";
import type { DigestSession, VoltraSession } from "@/lib/metrics";
import type { WorkoutEntry } from "@/lib/workouts";

const TODAY = "2030-01-10";
const hevy = (date: string, title: string, exercises: DigestSession["exercises"] = []): DigestSession => ({
  date,
  title,
  exercises,
});
const voltra = (date: string, actions: string[], unnamed = false): VoltraSession =>
  ({
    date,
    actions,
    action_ids: [],
    unnamed,
    sets: 3,
    reps: 30,
    avg_force_lb: 50,
    max_force_lb: 62.4,
  }) as unknown as VoltraSession;
const workout = (date: string, day: string, ended = true): WorkoutEntry => ({
  date,
  day,
  variant: "full",
  started_at: `${date}T18:00:00Z`,
  ...(ended ? { ended_at: `${date}T18:50:00Z`, minutes: 50 } : {}),
});

test("day letters come out of Lift and Hevy titles", () => {
  assert.equal(dayLetter("Day B — Pull"), "B");
  assert.equal(dayLetter("Today: Day A — Push · Beast mode"), "A");
  assert.equal(dayLetter("Morning walk"), null);
});

test("last trained per day: newest date wins, future dates ignored", () => {
  const last = lastTrainedByDay(
    [workout("2030-01-02", "Day A — Push"), workout("2030-01-08", "Day A — Push")],
    [hevy("2030-01-05", "Day B — Pull"), hevy("2030-01-20", "Day C — Lower")],
    TODAY
  );
  assert.deepEqual(last, { A: "2030-01-08", B: "2030-01-05" });
});

test("last session: Hevy and Voltra on the newest day, capped at six lines", () => {
  const s = lastSession(
    [
      hevy("2030-01-05", "Day B — Pull"),
      hevy("2030-01-08", "Today: Day A — Push", [
        { name: "Bench Press (Dumbbell)", sets: 4, top: { lb: 55, reps: 9, rpe: 8, seconds: null } },
        { name: "Plank", sets: 3, top: { lb: null, reps: null, rpe: null, seconds: 45 } },
      ]),
    ],
    [voltra("2030-01-08", ["Voltra Single-Arm Press"])],
    [workout("2030-01-08", "Day A — Push")],
    TODAY
  )!;
  assert.equal(s.date, "2030-01-08");
  assert.equal(s.day, "Day A — Push");
  assert.equal(s.minutes, 50);
  assert.deepEqual(s.lines, [
    "Bench Press (Dumbbell): 55 lb × 9",
    "Plank: 45s",
    "Voltra Single-Arm Press: 3 × 10, peak 62 lb",
  ]);
  assert.equal(lastSession([], [], [], TODAY), null);
});

test("questions: what the logs can't settle, skipping days with a note", () => {
  const q = questions(
    [hevy("2030-01-09", "Day B — Pull")],
    [voltra("2030-01-10", ["Row"]), voltra("2030-01-10", ["Shrug"]), voltra("2030-01-08", [], true)],
    [workout("2030-01-09", "Day A — Push"), workout("2030-01-08", "Day C — Lower")],
    [],
    TODAY
  );
  const texts = q.map((x) => x.text);
  assert.ok(texts.some((t) => /2 sessions today/.test(t)));
  assert.ok(texts.some((t) => /Day A in Lift on Wednesday but logged Day B/.test(t)));
  assert.ok(texts.some((t) => /Free Exercises/.test(t)));
  // Jan 8 had a Voltra session, so "nothing synced" doesn't apply.
  assert.ok(!texts.some((t) => /nothing synced/.test(t)));

  const answered = questions(
    [],
    [voltra("2030-01-10", ["Row"]), voltra("2030-01-10", ["Shrug"])],
    [],
    [{ date: "2030-01-10", text: "one workout", trained: false, logged_at: "x" }],
    TODAY
  );
  assert.deepEqual(answered, []);

  const silent = questions([], [], [workout("2030-01-09", "Day A — Push")], [], TODAY);
  assert.match(silent[0].text, /nothing synced/);
  assert.deepEqual(questions([], [], [workout(TODAY, "Day A — Push", false)], [], TODAY), [], "still running");
});

test("note dates: today and the two days before", () => {
  assert.deepEqual(noteDates(TODAY), ["2030-01-10", "2030-01-09", "2030-01-08"]);
});

test("brief parts: everything from ## More is set aside", () => {
  const p = briefParts("# Tue\n\n## Today\n\n- Day A\n\n## More\n\nlong reasoning\n");
  assert.equal(p.main, "## Today\n\n- Day A");
  assert.equal(p.more, "long reasoning");
  assert.equal(briefParts("## Today\n\nx").more, "");
});
