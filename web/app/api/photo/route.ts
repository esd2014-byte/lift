import { NextRequest, NextResponse } from "next/server";
import { logged } from "@/lib/log";
import { publicMessage } from "@/lib/errors";
import { requireAuth } from "@/lib/guard";
import { writeBinaryFile } from "@/lib/github";
import { todayISO } from "@/lib/date";
import { MAX_PHOTO_BYTES, base64Bytes } from "@/lib/limits";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Store a weekly progress photo in the repo.
 *
 * The client downscales to ~1200px JPEG before sending, which keeps a year of
 * weekly photos to roughly 10MB - small enough that the repo stays the single
 * place everything lives, with no extra storage service to run.
 */
async function handlePOST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const { dataUrl } = (await req.json()) as { dataUrl?: string };
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? "");
    if (!m) return NextResponse.json({ error: "expected a base64 jpeg/png/webp data URL" }, { status: 400 });

    const [, ext, b64] = m;
    if (base64Bytes(b64) > MAX_PHOTO_BYTES) {
      return NextResponse.json({ error: `photo is over ${MAX_PHOTO_BYTES / 1_000_000} MB after shrinking` }, { status: 413 });
    }

    const today = todayISO();
    const stamp = new Date().toISOString().slice(11, 16).replace(":", "");
    const path = `logs/photos/${today}-${stamp}.${ext === "jpeg" ? "jpg" : ext}`;

    await writeBinaryFile(path, b64, `Progress photo ${today}`);
    return NextResponse.json({ ok: true, path, date: today });
  } catch (err) {
    console.error("photo failed", err);
    return NextResponse.json({ error: publicMessage(err) }, { status: 500 });
  }
}

export const POST = logged("photo", handlePOST);
