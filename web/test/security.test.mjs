/**
 * Sessions, the cross-site check, the brief validator and what errors may say.
 *
 *   node test/security.test.mjs
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../.test-build/sec");
execSync(
  `npx tsc "${join(here, "../lib/auth.ts")}" "${join(here, "../lib/briefCheck.ts")}" "${join(here, "../lib/errors.ts")}" --outDir "${out}" --rootDir "${join(here, "../lib")}" --module esnext --target es2022 --moduleResolution bundler --skipLibCheck --types node`,
  { stdio: "pipe" }
);
for (const f of readdirSync(out).filter((f) => f.endsWith(".js"))) {
  const p = join(out, f);
  writeFileSync(p, readFileSync(p, "utf8").replace(/from "(\.\/[a-zA-Z]+)"/g, 'from "$1.js"'));
}
writeFileSync(join(out, "package.json"), '{ "type": "module" }\n');

process.env.APP_SECRET = "correct horse battery staple";
const A = await import(`${out}/auth.js`);
const B = await import(`${out}/briefCheck.js`);
const E = await import(`${out}/errors.js`);
const { GitHubError } = await import(`${out}/github.js`);

let failed = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.log(`FAIL  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failed++;
  }
};

// ---- sessions --------------------------------------------------------------------
{
  const t = A.issueSession();
  eq("fresh session verifies", A.verifySession(t), true);
  eq("session isn't the secret", t.includes(process.env.APP_SECRET), false);
  const [v, at, sig] = t.split(".");
  eq("tampered time rejected", A.verifySession(`${v}.${Number(at) + 1}.${sig}`), false);
  eq("tampered signature rejected", A.verifySession(`${v}.${at}.${sig.slice(0, -2)}xx`), false);
  eq("garbage rejected", A.verifySession("nope"), false);
  eq("missing rejected", A.verifySession(undefined), false);

  const old = A.issueSession(Date.now() - 366 * 86400000);
  eq("over a year old rejected", A.verifySession(old), false);

  process.env.SESSION_VERSION = "2";
  eq("version bump revokes", A.verifySession(t), false);
  eq("new version verifies", A.verifySession(A.issueSession()), true);
  delete process.env.SESSION_VERSION;

  process.env.APP_SECRET = "a different secret";
  eq("new secret revokes", A.verifySession(t), false);
  process.env.APP_SECRET = "correct horse battery staple";

  eq("legacy cookie accepted for upgrade", A.legacyValid("correct horse battery staple"), true);
  eq("wrong legacy rejected", A.legacyValid("correct horse"), false);
  eq("same secret", A.sameSecret("abc", "abc"), true);
  eq("different length is just false", A.sameSecret("abc", "abcd"), false);

  const saved = process.env.APP_SECRET;
  delete process.env.APP_SECRET;
  eq("no APP_SECRET, nothing verifies", [A.verifySession(t), A.legacyValid(saved)], [false, false]);
  process.env.APP_SECRET = saved;
}

// ---- cross-site ------------------------------------------------------------------
{
  const h = (o) => ({ get: (k) => o[k] ?? null });
  eq("GET always fine", A.sameOrigin("GET", h({ "sec-fetch-site": "cross-site" })), true);
  eq("same-origin POST", A.sameOrigin("POST", h({ "sec-fetch-site": "same-origin", origin: "https://lift.app", host: "lift.app" })), true);
  eq("cross-site POST refused", A.sameOrigin("POST", h({ "sec-fetch-site": "cross-site" })), false);
  eq("same-site but other subdomain refused", A.sameOrigin("POST", h({ "sec-fetch-site": "same-site" })), false);
  eq("foreign Origin refused", A.sameOrigin("POST", h({ origin: "https://evil.example", host: "lift.app" })), false);
  eq("no browser headers (curl) passes to the session check", A.sameOrigin("POST", h({})), true);
  // Chrome sends Origin: null on a form post under a strict referrer policy.
  eq("same-origin form with Origin null", A.sameOrigin("POST", h({ "sec-fetch-site": "same-origin", origin: "null", host: "lift.app" })), true);
  eq("Origin null without fetch metadata refused", A.sameOrigin("POST", h({ origin: "null", host: "lift.app" })), false);
}

// ---- the brief -------------------------------------------------------------------
{
  const good = {
    date: "2030-01-01", day: "A", day_name: "Push", day_type: "real", headline: "x".repeat(1000),
    variants: {
      full: { label: "Full", meta: "m", duration: "50-60 min", rows: [
        { name: "Flat DB Press", reps: "4 × 6-10", rpe: 8, load_lb: 55, superset: "A" },
        { name: "", reps: "3 × 10" },
        { name: "Weird", reps: "3 × 10", load_lb: 99999, superset: "AB", rpe: 42 },
      ] },
      beast: { label: "Beast", rows: [] },
      sideways: { label: "Not a variant", rows: [{ name: "x", reps: "1" }] },
    },
  };
  const { brief, problems } = B.checkBrief(good);
  eq("headline bounded", brief.headline.length, 300);
  eq("bad row dropped, good kept", brief.variants.full.rows.map((r) => r.name), ["Flat DB Press", "Weird"]);
  eq("out-of-range values nulled", [brief.variants.full.rows[1].load_lb, brief.variants.full.rows[1].superset, brief.variants.full.rows[1].rpe], [null, null, null]);
  eq("empty variant dropped", "beast" in brief.variants, false);
  eq("unknown variant ignored", "sideways" in brief.variants, false);
  eq("problems reported", problems.length >= 2, true);
  eq("no date, no brief", B.checkBrief({ ...good, date: "yesterday" }).brief, null);
  eq("no usable variant, no brief", B.checkBrief({ ...good, variants: { full: { rows: [] } } }).brief, null);
  eq("not an object", B.checkBrief("hello").brief, null);
}

// ---- errors ------------------------------------------------------------------------
{
  eq("our GitHub message passes", E.publicMessage(new GitHubError("auth", 401, "GitHub rejected the data key")), "GitHub rejected the data key");
  eq("upstream body stripped", E.publicMessage(new Error('Hevy POST /routines: 400 {"error":"internal detail"}')), "Hevy POST /routines: 400");
  eq("our config error passes", E.publicMessage(new Error("HEVY_API_KEY is not set")), "HEVY_API_KEY is not set");
  eq("unknown error is generic", E.publicMessage(new TypeError("Cannot read properties of undefined (reading 'x')")), "Something went wrong. The details are in the Vercel logs.");
}

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("security: all checks passed");
