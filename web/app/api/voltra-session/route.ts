import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/guard";
import { readFile } from "@/lib/github";
import { todayISO } from "@/lib/date";
import { pushVoltraSession } from "@/lib/voltraSession";
import { checkBrief } from "@/lib/briefCheck";
import { withGuessedLoads } from "@/lib/loadGuess";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Push (or re-push) today's Beyond+ session for a variant. Starting a workout does
 * this automatically; this route is the manual path. The logic is in
 * lib/voltraSession.ts.
 */
export async function POST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  const { variant = "full", date } = (await req.json().catch(() => ({}))) as { variant?: string; date?: string };
  const day = date ?? todayISO();
  const briefRaw = await readFile(`logs/briefs/${day}.json`);
  if (!briefRaw) return NextResponse.json({ error: `no brief for ${day}` }, { status: 404 });
  const { brief: checked } = checkBrief(JSON.parse(briefRaw));
  const brief = checked ? await withGuessedLoads(checked) : null;
  if (!brief) return NextResponse.json({ error: `the brief for ${day} couldn't be read` }, { status: 422 });
  const result = await pushVoltraSession(brief, variant);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
