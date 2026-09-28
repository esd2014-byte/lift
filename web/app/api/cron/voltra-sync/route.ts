import { NextRequest, NextResponse } from "next/server";
import { logged } from "@/lib/log";
import { syncVoltra } from "@/lib/sync";
import { cronAuthorized } from "@/lib/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Daily digest, triggered by Vercel Cron. The logic lives in lib/sync.ts. */
async function handleGET(req: NextRequest) {
  if (!cronAuthorized(req)) return new NextResponse("Not found", { status: 404 });
  const result = await syncVoltra("daily");
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = logged("cron/voltra-sync", handleGET);
