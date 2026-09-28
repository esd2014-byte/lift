import { NextRequest, NextResponse } from "next/server";
import { isAuthed } from "./auth";

/**
 * Defence in depth: the proxy already gates every route, but each route that reads
 * private data or changes state checks the session itself too. A proxy matcher
 * mistake, or a framework bug that skips the proxy, then fails closed instead of
 * open.
 */
export function requireAuth(req: NextRequest): NextResponse | null {
  return isAuthed(req.cookies) ? null : new NextResponse("Not found", { status: 404 });
}

/**
 * The same check for server-rendered pages. Pages don't get a request object, so
 * this reads the cookies from the request context and 404s like the proxy does.
 */
export async function requirePageAuth(): Promise<void> {
  const { cookies } = await import("next/headers");
  const { notFound } = await import("next/navigation");
  if (!isAuthed(await cookies())) notFound();
}
