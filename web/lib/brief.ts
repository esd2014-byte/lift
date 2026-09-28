import { readMany } from "./github";
import { todayISO } from "./date";
import { rollingAverage } from "./bodyweight";
import { parseDayNames } from "./program";
import { checkBrief } from "./briefCheck";
import { parseLog, type WorkoutEntry } from "./workouts";
import type { BriefData } from "./types";
import type { DigestSession, VoltraSession } from "./metrics";

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
  bodyweight: { logged: number | null; skipped: boolean; rolling7: number | null; days: number };
  measurements: { lastDate: string | null; daysSince: number | null };
  photos: { lastDate: string | null; daysSince: number | null };
  restDays: string[];
  /** { A: "Push", B: "Pull", ... } - used to name the Hevy routine a variant points at. */
  dayNames: Record<string, string>;
  workouts: WorkoutEntry[];
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
    ],
    ["logs/photos"]
  );

  const hevy = parseJson<{ synced_at: string; sessions: DigestSession[] }>(files["logs/hevy/recent.json"]);
  const voltra = parseJson<{ synced_at: string; unnamed_count: number; sessions: VoltraSession[] }>(files["logs/voltra/recent.json"]);
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
  const briefData = checked?.brief ?? null;
  if (checked?.problems.length) console.warn(`brief ${briefDate}: ${checked.problems.join("; ")}`);

  // Bodyweight: one row per day; a skipped day is recorded as "skip" so the app
  // can tell "not asked yet" from "asked and declined".
  let logged: number | null = null;
  let skipped = false;
  let rolling7: number | null = null;
  let days = 0;
  if (bwCsv) {
    const rows = bwCsv.trimEnd().split("\n").slice(1).filter(Boolean);
    const mine = rows.find((r) => r.startsWith(`${today},`));
    if (mine) {
      const v = mine.split(",")[1];
      if (v === "skip") skipped = true;
      else logged = Number(v);
    }
    const r = rollingAverage(rows, today);
    rolling7 = r.avg;
    days = r.n;
  }

  const lastMeas = measCsv
    ? (measCsv.trimEnd().split("\n").slice(1).filter(Boolean).at(-1)?.split(",")[0] ?? null)
    : null;
  const lastPhoto = photoFiles.length
    ? (photoFiles.map((f) => f.slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().at(-1) ?? null)
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
    bodyweight: { logged, skipped, rolling7, days },
    measurements: { lastDate: lastMeas, daysSince: lastMeas ? daysBetween(lastMeas, today) : null },
    photos: { lastDate: lastPhoto, daysSince: lastPhoto ? daysBetween(lastPhoto, today) : null },
    restDays: (restLog ?? []).map((r) => r.date),
    dayNames,
    workouts: parseLog(workoutsRaw),
  };
}
