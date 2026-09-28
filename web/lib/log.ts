import type { NextRequest } from "next/server";

/**
 * Structured logs: one JSON object per line, so Vercel's runtime logs can be
 * searched by field ("evt":"route" and "status":500, say) rather than by prose.
 *
 * Never put secrets, tokens or request bodies in here. Paths, counts, ids, timings.
 */
export function log(evt: string, fields: Record<string, unknown> = {}, level: "info" | "warn" | "error" = "info") {
  const line = JSON.stringify({ evt, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}

type Handler<C> = (req: NextRequest, ctx: C) => Response | Promise<Response>;

/**
 * Wraps a route handler with one log line per request: which route, how it ended,
 * how long it took, and a short id that also goes back in the `x-request-id`
 * header - so "it failed at 7:02" can be matched to its log line.
 */
export function logged<C = unknown>(route: string, handler: Handler<C>): Handler<C> {
  return async (req, ctx) => {
    const id = crypto.randomUUID().slice(0, 8);
    const t0 = Date.now();
    try {
      const res = await handler(req, ctx);
      const status = res.status;
      log("route", { route, method: req.method, status, ms: Date.now() - t0, id }, status >= 500 ? "error" : "info");
      try {
        res.headers.set("x-request-id", id);
      } catch {
        // Some responses (Response.redirect) have immutable headers; the log line still has the id.
      }
      return res;
    } catch (err) {
      log("route", { route, method: req.method, status: 500, ms: Date.now() - t0, id, error: err instanceof Error ? err.name : "error" }, "error");
      throw err;
    }
  };
}
