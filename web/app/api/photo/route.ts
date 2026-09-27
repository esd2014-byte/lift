import { NextRequest, NextResponse } from "next/server";
import { writeBinaryFile } from "@/lib/github";
import { todayISO } from "@/lib/date";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Store a weekly progress photo in the repo.
 *
 * The client downscales to ~1200px JPEG before sending, which keeps a year of
 * weekly photos to roughly 10MB - small enough that the repo stays the single
 * place everything lives, with no extra storage service to run.
 */
export async function POST(req: NextRequest) {
  try {
    const { dataUrl } = (await req.json()) as { dataUrl?: string };
    const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl ?? "");
    if (!m) return NextResponse.json({ error: "expected a base64 jpeg/png/webp data URL" }, { status: 400 });

    const [, ext, b64] = m;
    const bytes = Math.floor((b64.length * 3) / 4);
    if (bytes > 4_000_000) {
      return NextResponse.json({ error: "image too large after downscaling" }, { status: 413 });
    }

    const today = todayISO();
    const stamp = new Date().toISOString().slice(11, 16).replace(":", "");
    const path = `logs/photos/${today}-${stamp}.${ext === "jpeg" ? "jpg" : ext}`;

    await writeBinaryFile(path, b64, `Progress photo ${today}`);
    return NextResponse.json({ ok: true, path, date: today });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
