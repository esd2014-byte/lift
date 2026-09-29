import { readMany } from "./store";
import { todayISO } from "./date";
import { rollingAverage } from "./bodyweight";
import { parseDayNames } from "./program";
import { checkBrief } from "./briefCheck";
import { parseLog, type WorkoutEntry } from "./workouts";
import { fillLoads, guessInputs, GUESS_PATHS } from "./loadGuess";
import type { BriefData } from "./types";
import type { DigestSession, VoltraSession } from "./metrics";
import { parseProgram, programBriefs, type Program } from "./programDay";
import { parseInjuries, type Injury } from "./injuries";
import { parseDayNotes, type DayNote } from "./dayNotes";
import { parseGoals, type Goals } from "./goals";

/**
 * Everything the home page needs, read from the repo.
 *
 * The morning routine writes two files per day: a .md of coaching prose and a
 * .json of structured session data. The JSON is what the variant buttons and the
 * program table run on. Older briefs are markdown-only, so structured data is
 * always optional and the page degrades to prose when it's missing.
 */

export type DayState = {
  today: string;
  briefDate: string | null;
  briefMarkdown: string | null;
  briefData: BriefData | null;
  stale: boolean;
  generatedAt: string | null;
  sessions: DigestSession[];
  hevySyncedAt: string | null;
  voltraSessions: VoltraSession[];
  voltraSyncedAt: string | null;
  voltraUnnamed: number;
  bodyweight: {
    logged: number | null;
    skipped: boolean;
    rolling7: number | null;
    days: number;
    /** The most recent weight before today, for a hint that can't be mistaken for today's entry. */
    last: { date: string; weight: number } | null;
    /** The first weight logged once the program started, the baseline for the goal. */
    atStart: { date: string; weight: number } | null;
  };
  measurements: { lastDate: string | null; daysSince: number | null };
  photos: { lastDate: string | null; daysSince: number | null };
  restDays: string[];
  /** { A: "Push", B: "Pull", ... } - used to name the Hevy routine a variant points at. */
  dayNames: Record<string, string>;
  workouts: WorkoutEntry[];
  /** Every program day, built from the program with loads from history: the off-plan choices. */
  programDays: Record<string, BriefData>;
  program: Program | null;
  goals: Goals | null;
  injuries: Injury[];
  dayNotes: DayNote[];
};

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** How far back to look for a brief. Older than this and it's no use as today's plan. */
const BRIEF_LOOKBACK_DAYS = 7;

function daysBefore(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export async function loadDay(): Promise<DayState> {
  const today = todayISO();

  // Everything the page needs in ONE request. The brief is found by asking for the
  // last week's files by name rather than listing logs/briefs, which grows by a
  // file a day and would eventually pass the listing API's cap.
  const briefDates = Array.from({ length: BRIEF_LOOKBACK_DAYS }, (_, i) => daysBefore(today, i));
  const briefPaths = briefDates.flatMap((d) => [`logs/briefs/${d}.md`, `logs/briefs/${d}.json`]);
  const { files, dirs } = await readMany(
    [
      ...briefPaths,
      "logs/hevy/recent.json",
      "logs/voltra/recent.json",
      "logs/bodyweight.csv",
      "logs/measurements.csv",
      "logs/rest-days.json",
      "program/current.yaml",
      "logs/workouts.json",
      "logs/injuries.json",
      "logs/day-notes.json",
      "athlete/profile.yaml",
      ...GUESS_PATHS,
    ],
    ["logs/photos"]
  );

  const hevy = parseJson<{ synced_at: string; sessions: DigestSession[] }>(files["logs/hevy/recent.json"]);
  const voltra = parseJson<{ synced_at: string; unnamed_count: number; sessions: VoltraSession[] }>(
    files["logs/voltra/recent.json"]
  );
  const bwCsv = files["logs/bodyweight.csv"];
  const measCsv = files["logs/measurements.csv"];
  const restLog = parseJson<Array<{ date: string; reason: string }>>(files["logs/rest-days.json"]);
  const programRaw = files["program/current.yaml"];
  const workoutsRaw = files["logs/workouts.json"];
  const photoFiles = dirs["logs/photos"];

  const dayNames = parseDayNames(programRaw);

  const briefDate = briefDates.find((d) => files[`logs/briefs/${d}.md`]) ?? null;
  const briefMarkdown = briefDate ? files[`logs/briefs/${briefDate}.md`] : null;
  // Model-written: checked and bounded before anything renders or pushes it.
  const checked = briefDate ? checkBrief(parseJson<unknown>(files[`logs/briefs/${briefDate}.json`])) : null;
  // Voltra rows without a load get a calibration guess from lift history.
  const guesses = guessInputs(files);
  const briefData = checked?.brief ? fillLoads(checked.brief, guesses) : null;
  const programDays = Object.fromEntries(
    Object.entries(programBriefs(programRaw, files["library/exercises.yaml"] ?? null, today)).map(([id, b]) => [
      id,
      fillLoads(b, guesses, { anyRow: true }),
    ])
  );
  if (checked?.problems.length) console.warn(`brief ${briefDate}: ${checked.problems.join("; ")}`);

  // Bodyweight: one row per day; a skipped day is recorded as "skip" so the app
  // can tell "not asked yet" from "asked and declined".
  let logged: number | null = null;
  let skipped = false;
  let rolling7: number | null = null;
  let days = 0;
  let last: { date: string; weight: number } | null = null;
  let atStart: { date: string; weight: number } | null = null;
  const program = parseProgram(programRaw);
  const programStart = program?.meta.starts ? String(program.meta.starts).slice(0, 10) : null;
  if (bwCsv) {
    const rows = bwCsv.trimEnd().split("\n").slice(1).filter(Boolean);
    const mine = rows.find((r) => r.startsWith(`${today},`));
    if (mine) {
      const v = mine.split(",")[1];
      if (v === "skip") skipped = true;
      else logged = Number(v);
    }
    for (const row of [...rows].reverse()) {
      const [date, v] = row.split(",");
      if (date < today && Number(v) > 0) {
        last = { date, weight: Number(v) };
        break;
      }
    }
    if (programStart) {
      for (const row of rows) {
        const [date, v] = row.split(",");
        if (date >= programStart && Number(v) > 0) {
          atStart = { date, weight: Number(v) };
          break;
        }
      }
    }
    const r = rollingAverage(rows, today);
    rolling7 = r.avg;
    days = r.n;
  }

  const lastMeas = measCsv
    ? (measCsv.trimEnd().split("\n").slice(1).filter(Boolean).at(-1)?.split(",")[0] ?? null)
    : null;
  const lastPhoto = photoFiles.length
    ? (photoFiles
        .map((f) => f.slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort()
        .at(-1) ?? null)
    : null;

  return {
    today,
    briefDate,
    briefMarkdown,
    briefData,
    stale: briefDate !== today,
    generatedAt: briefData?.generated_at ?? null,
    sessions: hevy?.sessions ?? [],
    hevySyncedAt: hevy?.synced_at ?? null,
    voltraSessions: voltra?.sessions ?? [],
    voltraSyncedAt: voltra?.synced_at ?? null,
    voltraUnnamed: voltra?.unnamed_count ?? 0,
    bodyweight: { logged, skipped, rolling7, days, last, atStart },
    measurements: { lastDate: lastMeas, daysSince: lastMeas ? daysBetween(lastMeas, today) : null },
    photos: { lastDate: lastPhoto, daysSince: lastPhoto ? daysBetween(lastPhoto, today) : null },
    restDays: (restLog ?? []).map((r) => r.date),
    dayNames,
    workouts: parseLog(workoutsRaw),
    programDays,
    program,
    goals: parseGoals(files["athlete/profile.yaml"] ?? null),
    injuries: parseInjuries(files["logs/injuries.json"] ?? null),
    dayNotes: parseDayNotes(files["logs/day-notes.json"] ?? null),
  };
}
