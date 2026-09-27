import { NextRequest, NextResponse } from "next/server";
import { readFile } from "@/lib/github";
import { todayISO } from "@/lib/date";
import { parseDayNames } from "@/lib/program";
import { pushVoltraSession } from "@/lib/voltraSession";
import type { BriefData } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Push (or re-push) today's Beyond+ session for a variant. Starting a workout does
 * this automatically; this route is the manual path. The logic is in
 * lib/voltraSession.ts.
 */
export async function POST(req: NextRequest) {
  const { variant = "full", date } = (await req.json().catch(() => ({}))) as { variant?: string; date?: string };
  const day = date ?? todayISO();
  const [briefRaw, programRaw] = await Promise.all([readFile(`logs/briefs/${day}.json`), readFile("program/current.yaml")]);
  if (!briefRaw) return NextResponse.json({ error: `no brief for ${day}` }, { status: 404 });
  const result = await pushVoltraSession(JSON.parse(briefRaw) as BriefData, variant, parseDayNames(programRaw));
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
