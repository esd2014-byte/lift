import { NextResponse } from "next/server";
import { readFile, listDir } from "@/lib/github";
import { dataRepoSource } from "@/lib/config";
import { todayISO } from "@/lib/date";

export const dynamic = "force-dynamic";

const STALE_HOURS = 26;

/**
 * Wiring check, behind the auth gate: open it on a signed-in phone after any env
 * change. It confirms each credential WORKS and each feed is fresh; it never
 * reveals any part of a secret.
 */
export async function GET() {
  const today = todayISO();
  const out: Record<string, unknown> = {
    today,
    env: {
      appSecret: Boolean(process.env.APP_SECRET),
      cronSecret: Boolean(process.env.CRON_SECRET),
      hevyKey: Boolean(process.env.HEVY_API_KEY),
      voltraKey: Boolean(process.env.VOLTRA_API_KEY),
      ...dataRepoSource(),
    },
  };

  try {
    const briefs = (await listDir("logs/briefs")).filter((f) => f.endsWith(".md")).sort();
    out.dataRepo = "ok";
    out.latestBrief = briefs.at(-1)?.replace(/\.md$/, "") ?? null;
    out.hasBriefForToday = briefs.includes(`${today}.md`);
  } catch (err) {
    out.dataRepo = "fail";
    out.dataRepoError = String(err).slice(0, 200);
  }

  const syncs: Record<string, unknown> = {};
  for (const source of ["hevy", "voltra"] as const) {
    try {
      const raw = await readFile(`logs/${source}/recent.json`);
      const at = raw ? (JSON.parse(raw) as { synced_at?: string }).synced_at : undefined;
      const hours = at ? (Date.now() - Date.parse(at)) / 3_600_000 : null;
      syncs[source] = {
        syncedAt: at ?? null,
        stale: hours === null || hours > STALE_HOURS,
      };
    } catch {
      syncs[source] = { syncedAt: null, stale: true, error: "unreadable" };
    }
  }
  out.syncs = syncs;

  try {
    const res = await fetch("https://api.hevyapp.com/v1/workouts/count", {
      headers: { "api-key": process.env.HEVY_API_KEY ?? "" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    out.hevy = res.ok ? "ok" : `http ${res.status}`;
  } catch {
    out.hevy = "fail";
  }

  return NextResponse.json(out);
}
