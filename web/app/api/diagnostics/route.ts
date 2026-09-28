import { NextRequest, NextResponse } from "next/server";
import { logged } from "@/lib/log";
import { tokenExpiry } from "@/lib/github";
import { readMany } from "@/lib/store";
import { todayISO, ZONE } from "@/lib/date";
import { requireAuth } from "@/lib/guard";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";
import { publicMessage } from "@/lib/errors";
import { listSessions, probe, sessionDetail } from "@/lib/voltra";

export const dynamic = "force-dynamic";

const STALE_HOURS = 26;
const EXPIRY_WARN_DAYS = 14;

type Status = "ok" | "warn" | "fail";
type Check = { group: string; label: string; status: Status; value: string };

/**
 * Wiring check, behind the auth gate: open it on your phone after any env change.
 * It confirms each credential WORKS and each feed is fresh; it never reveals any
 * part of a secret.
 *
 * A readable page by default; `?format=json` for the raw checks.
 */
async function handleGET(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;

  // Raw Beyond+ session data, read-only: ?session=list for ids, ?session=<id> for one.
  const session = req.nextUrl.searchParams.get("session");
  if (session) {
    const body =
      session === "list"
        ? (await listSessions()).sessions
        : /^\d+$/.test(session)
          ? await sessionDetail(Number(session))
          : { error: "session must be list or a number" };
    return new NextResponse(JSON.stringify(body, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const checks = await run(req);
  if (req.nextUrl.searchParams.get("format") === "json") {
    return NextResponse.json({ today: todayISO(), checks });
  }
  return new NextResponse(page(checks), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const localTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: ZONE });

async function run(req: NextRequest): Promise<Check[]> {
  const today = todayISO();
  const checks: Check[] = [];
  const add = (group: string, label: string, status: Status, value: string) =>
    checks.push({ group, label, status, value });

  // ---- settings (set or not; never the value) ----
  const env = (name: string, required: boolean, shown?: string) => {
    const set = Boolean(process.env[name]?.trim());
    add(
      "Settings",
      name,
      set ? "ok" : required ? "fail" : "warn",
      set ? (shown ?? "set") : required ? "missing" : "not set"
    );
  };
  env("APP_SECRET", true);
  env("CRON_SECRET", true);
  env("DATA_REPO", true, process.env.DATA_REPO?.trim());
  env("DATA_TOKEN", true);
  env("DATA_TOKEN_EXPIRES", false, process.env.DATA_TOKEN_EXPIRES?.trim());
  env("HEVY_API_KEY", true);
  env("VOLTRA_API_KEY", true);
  add("Settings", "SESSION_VERSION", "ok", process.env.SESSION_VERSION?.trim() || "1 (default)");
  const signed = verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  add(
    "Settings",
    "This device's sign-in",
    signed ? "ok" : "warn",
    signed ? "signed session" : "old cookie (upgrades on next page load)"
  );

  // ---- data repo, in one request ----
  const yesterday = (() => {
    const d = new Date(`${today}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  try {
    const { files } = await readMany([
      `logs/briefs/${today}.md`,
      `logs/briefs/${yesterday}.md`,
      "logs/hevy/recent.json",
      "logs/voltra/recent.json",
    ]);
    add("Data repo", "Access", "ok", "reads work");
    const briefToday = Boolean(files[`logs/briefs/${today}.md`]);
    add(
      "Data repo",
      "Today's brief",
      briefToday ? "ok" : "warn",
      briefToday ? "written" : files[`logs/briefs/${yesterday}.md`] ? "not yet (yesterday's is there)" : "missing"
    );

    for (const [source, name] of [
      ["hevy", "Hevy sync"],
      ["voltra", "Voltra sync"],
    ] as const) {
      let at: string | undefined;
      try {
        at = (JSON.parse(files[`logs/${source}/recent.json`] ?? "{}") as { synced_at?: string }).synced_at;
      } catch {}
      const hours = at ? (Date.now() - Date.parse(at)) / 3_600_000 : null;
      const stale = hours !== null && hours > STALE_HOURS;
      add(
        "Syncs",
        name,
        hours === null ? "fail" : stale ? "warn" : "ok",
        at ? `${localTime(at)} ET${stale ? " (stale)" : ""}` : "never"
      );
    }
  } catch (err) {
    add("Data repo", "Access", "fail", publicMessage(err));
  }

  // ---- key expiry (known once a GitHub call above has run) ----
  const expiry = tokenExpiry();
  if (expiry) {
    const days = Math.floor((expiry.date.getTime() - Date.now()) / 86_400_000);
    add(
      "Data repo",
      "Key expires",
      days <= EXPIRY_WARN_DAYS ? "warn" : "ok",
      `${expiry.date.toISOString().slice(0, 10)}, in ${days} days (from ${expiry.source})`
    );
  } else {
    add("Data repo", "Key expires", "warn", "unknown: set DATA_TOKEN_EXPIRES");
  }

  // ---- Hevy, live ----
  try {
    const res = await fetch("https://api.hevyapp.com/v1/workouts/count", {
      headers: { "api-key": process.env.HEVY_API_KEY ?? "" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    add("Syncs", "Hevy API", res.ok ? "ok" : "fail", res.ok ? "key works" : `HTTP ${res.status}`);
  } catch {
    add("Syncs", "Hevy API", "fail", "no answer within 8s");
  }

  // ---- Beyond+ endpoint probe (read-only, on request) ----
  if (req.nextUrl.searchParams.get("probe") === "voltra") {
    // The workout and action lists, and the session list the app writes to.
    const paths = ["/workout/list", "/workout/me/actions", "/workout/me/sessions"];
    const results = await Promise.all(paths.map(probe));
    console.info("voltra probe", JSON.stringify(results));
    for (const r of results) {
      const found = r.sessions > 0;
      add(
        "Beyond+ probe",
        r.path,
        found ? "ok" : r.status === 200 ? "warn" : "fail",
        `HTTP ${r.status} · ${r.shape}${found ? ` · ${r.sessions} session(s)` : ""}`
      );
    }
  }

  return checks;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const ICON: Record<Status, string> = { ok: "✓", warn: "⚠", fail: "✗" };

function page(checks: Check[]): string {
  const worst: Status = checks.some((c) => c.status === "fail")
    ? "fail"
    : checks.some((c) => c.status === "warn")
      ? "warn"
      : "ok";
  const summary = { ok: "All good", warn: "Working, with warnings", fail: "Something's broken" }[worst];
  const groups = [...new Set(checks.map((c) => c.group))];
  const body = groups
    .map(
      (g) =>
        `<h2>${esc(g)}</h2><ul>${checks
          .filter((c) => c.group === g)
          .map(
            (c) =>
              `<li class="${c.status}"><span class="i">${ICON[c.status]}</span><span><b>${esc(c.label)}</b><br>${esc(c.value)}</span></li>`
          )
          .join("")}</ul>`
    )
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Lift diagnostics</title>
<style>
:root{color-scheme:light dark;--ok:#1d7a4f;--warn:#8a6209;--fail:#a32b33;--muted:#6b7684;--bg:#f2f4f6;--card:#fff;--ink:#12161b;--line:#dfe4ea}
@media (prefers-color-scheme:dark){:root{--ok:#5ec48c;--warn:#e2b154;--fail:#e8767c;--muted:#8d97a3;--bg:#0d1014;--card:#171b21;--ink:#eef1f4;--line:#2a313a}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 -apple-system,system-ui,sans-serif}
main{max-width:520px;margin:0 auto;padding:max(16px,env(safe-area-inset-top)) 16px 40px}
h1{font-size:1.4rem;margin:8px 0 2px}.sum{margin:0 0 8px;color:var(--${worst});font-weight:600}
h2{font-size:.8rem;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:22px 0 8px}
ul{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:12px}
li{display:flex;gap:12px;padding:11px 14px;border-top:1px solid var(--line);overflow-wrap:anywhere}li:first-child{border-top:0}
.i{font-weight:700;width:1.1em;flex:none}.ok .i{color:var(--ok)}.warn .i{color:var(--warn)}.fail .i{color:var(--fail)}
a{color:inherit}.foot{color:var(--muted);font-size:.85rem;margin-top:18px}
</style></head><body><main>
<h1>Diagnostics</h1><p class="sum">${summary}</p>${body}
<p class="foot"><a href="/">Back to Lift</a> · <a href="?format=json">JSON</a></p>
</main></body></html>`;
}

export const GET = logged("diagnostics", handleGET);
