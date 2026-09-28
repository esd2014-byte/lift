/**
 * Build a demo data folder: the synthetic data repo from test/fixtures/data, plus
 * six weeks of made-up training history and a brief for today, all dated relative
 * to today so the app looks lived-in whenever it runs. Nothing here is real data.
 *
 *   node scripts/demo-data.mjs [out-dir]     (default: .demo-data)
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(process.argv[2] ?? join(web, ".demo-data"));
const fixtures = join(web, "test/fixtures");
const zone = process.env.APP_TIMEZONE || "America/New_York";

const today = new Intl.DateTimeFormat("en-CA", {
  timeZone: zone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(new Date());
const daysAgo = (n) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

rmSync(out, { recursive: true, force: true });
cpSync(join(fixtures, "data"), out, { recursive: true });
mkdirSync(join(out, "logs/briefs"), { recursive: true });

// ---- history: ~4 sessions a week for six weeks, with slow, believable progress ----
// A fixed pattern (no randomness) so screenshots are reproducible.
const hevy = [];
const voltra = [];
const workouts = [];
let id = 5000;
for (let n = 42; n >= 1; n--) {
  const dow = new Date(`${daysAgo(n)}T12:00:00Z`).getUTCDay();
  if (![1, 2, 4, 6].includes(dow)) continue; // Mon, Tue, Thu, Sat
  if (n === 23 || n === 24) continue; // a travel gap, as real logs have
  const date = daysAgo(n);
  const week = Math.floor((42 - n) / 7);
  const push = dow === 1 || dow === 4;
  const exercises = push
    ? [
        {
          name: "Bench Press (Dumbbell)",
          sets: 4,
          top: { lb: 50 + 5 * Math.floor(week / 2), reps: 8 + (week % 2) * 2, rpe: 8, seconds: null },
        },
        {
          name: "Triceps Rope Pushdown",
          sets: 3,
          top: { lb: 35 + 5 * Math.floor(week / 3), reps: 12, rpe: null, seconds: null },
        },
      ]
    : [
        {
          name: "Pull Up (Weighted)",
          sets: 3,
          top: { lb: 10 + 5 * Math.floor(week / 2), reps: 6, rpe: 8, seconds: null },
        },
        {
          name: "Dumbbell Row",
          sets: 3,
          top: { lb: 50 + 5 * Math.floor(week / 2), reps: 10, rpe: null, seconds: null },
        },
      ];
  hevy.push({
    date,
    start: `${date}T18:00:00+00:00`,
    minutes: 45 + (n % 3) * 5,
    title: push ? "Day A — Push" : "Day B — Pull",
    exercises,
  });
  const lift = push ? ["Voltra Belt Squat", 3334, 90 + 5 * week] : ["Voltra Deadlift Harness", 3335, 120 + 5 * week];
  voltra.push({
    date,
    start: `${date}T18:40:00`,
    id: id++,
    actions: [lift[0]],
    action_ids: [lift[1]],
    unnamed: false,
    sets: 4,
    reps: 32,
    duration_sec: 240,
    avg_force_lb: lift[2] - 0.4,
    max_force_lb: lift[2] + 1.5,
    avg_power_w: 350,
    max_power_w: 800,
    avg_velocity_mm_s: 650,
    volume_lb: lift[2] * 32,
  });
  workouts.push({
    date,
    variant: n % 5 === 0 ? "minimum" : "full",
    day: push ? "Day A — Push" : "Day B — Pull",
    started_at: `${date}T18:00:00.000Z`,
    ended_at: `${date}T18:50:00.000Z`,
    minutes: 50,
  });
}
hevy.reverse();
voltra.reverse();
const synced = `${daysAgo(0)}T10:00:00.000Z`;
const digest = (sessions, extra) =>
  JSON.stringify(
    {
      synced_at: synced,
      local_date: today,
      workout_count: sessions.length,
      last_session: sessions[0]?.date ?? null,
      ...extra,
      sessions,
    },
    null,
    2
  ) + "\n";
writeFileSync(join(out, "logs/hevy/recent.json"), digest(hevy, {}));
writeFileSync(join(out, "logs/voltra/recent.json"), digest(voltra, { unnamed_count: 0 }));
writeFileSync(join(out, "logs/workouts.json"), JSON.stringify(workouts, null, 2) + "\n");
writeFileSync(
  join(out, "logs/rest-days.json"),
  JSON.stringify([{ date: daysAgo(23), reason: "travel", logged_at: `${daysAgo(23)}T12:00:00.000Z` }], null, 2) + "\n"
);

// Bodyweight: a gentle lean gain, most days logged.
const bw = ["date,weight_lb"];
for (let n = 30; n >= 1; n--)
  if (n % 4 !== 0) bw.push(`${daysAgo(n)},${(178 + (30 - n) * 0.05 + ((n * 7) % 5) * 0.1).toFixed(1)}`);
writeFileSync(join(out, "logs/bodyweight.csv"), bw.join("\n") + "\n");
writeFileSync(join(out, "logs/measurements.csv"), `date,waist_in,arm_in,shoulder_in\n${daysAgo(12)},33.5,15.25,48.5\n`);

// Today's brief, from the template.
for (const ext of ["json", "md"]) {
  const text = readFileSync(join(fixtures, `brief-template.${ext}`), "utf8").replaceAll("{{DATE}}", today);
  writeFileSync(join(out, `logs/briefs/${today}.${ext}`), text);
}

console.log(`demo data for ${today} in ${out}`);
