import { NextRequest, NextResponse } from "next/server";
import { syncVoltra } from "@/lib/sync";
import { cronAuthorized } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily digest, triggered by Vercel Cron. The logic lives in lib/sync.ts. */
export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) return new NextResponse("Not found", { status: 404 });
  const result = await syncVoltra("daily");
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
