import { parse } from "yaml";
import { readFile, listDir } from "./github";
import { todayISO } from "./date";
import { rollingAverage } from "./bodyweight";
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
};

function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400000);
}

async function readJson<T>(path: string): Promise<T | null> {
  const raw = await readFile(path);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function loadDay(): Promise<DayState> {
  const today = todayISO();

  const [briefFiles, hevy, voltra, bwCsv, measCsv, photoFiles, restLog, programRaw] = await Promise.all([
    listDir("logs/briefs"),
    readJson<{ synced_at: string; sessions: DigestSession[] }>("logs/hevy/recent.json"),
    readJson<{ synced_at: string; unnamed_count: number; sessions: VoltraSession[] }>("logs/voltra/recent.json"),
    readFile("logs/bodyweight.csv"),
    readFile("logs/measurements.csv"),
    listDir("logs/photos"),
    readJson<Array<{ date: string; reason: string }>>("logs/rest-days.json"),
    readFile("program/current.yaml"),
  ]);

  const dayNames: Record<string, string> = {};
  try {
    const program = parse(programRaw ?? "") as { days?: Record<string, { name?: string }> };
    for (const [id, d] of Object.entries(program?.days ?? {})) {
      if (d?.name) dayNames[id] = d.name;
    }
  } catch {
    // A malformed program shouldn't blank the page; the button falls back to the day id.
  }

  const mdFiles = briefFiles.filter((f) => f.endsWith(".md")).sort();
  const briefDate = mdFiles.includes(`${today}.md`)
    ? today
    : (mdFiles.at(-1)?.replace(/\.md$/, "") ?? null);

  const [briefMarkdown, briefData] = briefDate
    ? await Promise.all([
        readFile(`logs/briefs/${briefDate}.md`),
        readJson<BriefData>(`logs/briefs/${briefDate}.json`),
      ])
    : [null, null];

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
  };
}
