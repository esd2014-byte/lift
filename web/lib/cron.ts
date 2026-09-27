import { NextRequest } from "next/server";

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Constant-time compare,
 * and fail closed when the secret isn't configured.
 */
export function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    console.error("CRON_SECRET is not set - refusing to run");
    return false;
  }
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
