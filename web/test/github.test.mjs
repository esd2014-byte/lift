/**
 * The data layer everything stands on: collision retries, classified failures,
 * time limits, the one-request page read, and key-expiry tracking. Runs against a
 * fake fetch - no network, no token.
 *
 *   node test/github.test.mjs
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "../.test-build/gh");
execSync(
  `npx tsc "${join(here, "../lib/github.ts")}" "${join(here, "../lib/limits.ts")}" --outDir "${out}" --rootDir "${join(here, "../lib")}" --module esnext --target es2022 --moduleResolution bundler --skipLibCheck`,
  { stdio: "pipe" }
);
for (const f of readdirSync(out).filter((f) => f.endsWith(".js"))) {
  const p = join(out, f);
  writeFileSync(p, readFileSync(p, "utf8").replace(/from "(\.\/[a-zA-Z]+)"/g, 'from "$1.js"'));
}
writeFileSync(join(out, "package.json"), '{ "type": "module" }\n');

process.env.DATA_REPO = "someone/data";
process.env.DATA_TOKEN = "test-token";
const G = await import(`${out}/github.js`);
const L = await import(`${out}/limits.js`);

let failed = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    console.log(`FAIL  ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failed++;
  }
};
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const reply = (status, body, headers = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

// ---- a collision is retried on fresh content, so neither write is lost --------
{
  // The file changes underneath us between our read and our write.
  let file = { text: "a\n", sha: "s1" };
  let puts = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "PUT") {
      puts++;
      const body = JSON.parse(init.body);
      if (puts === 1) {
        file = { text: "a\nother\n", sha: "s2" }; // someone else wrote first
        return reply(409, { message: "is at s2 but expected s1" });
      }
      if (body.sha !== file.sha) return reply(409, { message: "stale" });
      file = { text: Buffer.from(body.content, "base64").toString(), sha: "s3" };
      return reply(200, {});
    }
    return reply(200, { content: b64(file.text), encoding: "base64", sha: file.sha });
  };
  const r = await G.updateFile("logs/x.txt", (cur) => (cur ?? "") + "mine\n", "msg");
  eq("retried and succeeded", [r.changed, puts], [true, 2]);
  eq("both writes survive", file.text, "a\nother\nmine\n");
}

// ---- no change means no commit --------------------------------------------------
{
  let puts = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "PUT") puts++;
    return reply(200, { content: b64("same"), encoding: "base64", sha: "s" });
  };
  const r = await G.updateFile("f", (cur) => cur, "msg");
  eq("unchanged skips the write", [r.changed, puts], [false, 0]);
}

// ---- persistent conflicts give up ----------------------------------------------
{
  let puts = 0;
  globalThis.fetch = async (url, init = {}) => {
    if (init.method === "PUT") {
      puts++;
      return reply(409, { message: "conflict" });
    }
    return reply(404, {});
  };
  let kind = null;
  try {
    await G.updateFile("f", () => "x", "msg");
  } catch (e) {
    kind = e.kind;
  }
  eq("gives up after 4 tries", [kind, puts], ["conflict", 4]);
}

// ---- failures say what kind they are --------------------------------------------
{
  const kindOf = async (res) => {
    globalThis.fetch = async () => res();
    try {
      await G.readFile("f");
    } catch (e) {
      return e.kind;
    }
    return null;
  };
  eq("401 is a bad key", await kindOf(() => reply(401, "Bad credentials")), "auth");
  eq("rate limit", await kindOf(() => reply(403, "limit", { "x-ratelimit-remaining": "0" })), "rate");
  eq("403 otherwise is access", await kindOf(() => reply(403, "no")), "auth");
  eq("5xx is GitHub down", await kindOf(() => reply(502, "bad gateway")), "down");
  globalThis.fetch = async () => {
    const e = new Error("timeout");
    e.name = "TimeoutError";
    throw e;
  };
  let err = null;
  try {
    await G.readFile("f");
  } catch (e) {
    err = e;
  }
  eq("timeout is GitHub down", [err?.kind, /didn't answer/.test(err?.message)], ["down", true]);
  eq(
    "missing file is null, not an error",
    await (async () => {
      globalThis.fetch = async () => reply(404, {});
      return G.readFile("f");
    })(),
    null
  );
}

// ---- one request for the whole page --------------------------------------------
{
  let calls = 0;
  let query = "";
  globalThis.fetch = async (url, init = {}) => {
    calls++;
    if (String(url).endsWith("/graphql")) {
      query = JSON.parse(init.body).query;
      return reply(
        200,
        {
          data: {
            repository: {
              f0: { text: "hello", isTruncated: false, isBinary: false },
              f1: null,
              f2: { text: "partial", isTruncated: true, isBinary: false },
              d0: {
                entries: [
                  { name: "2030-01-01.jpg", type: "blob" },
                  { name: "sub", type: "tree" },
                ],
              },
            },
          },
        },
        { "github-authentication-token-expiration": "2030-02-01 12:00:00 UTC" }
      );
    }
    return reply(200, { content: b64("the whole big file"), encoding: "base64", sha: "s" });
  };
  const { files, dirs } = await G.readMany(["a.md", "missing.md", "big.csv"], ["logs/photos"]);
  eq("files by path", files, { "a.md": "hello", "missing.md": null, "big.csv": "the whole big file" });
  eq("dir lists files only", dirs, { "logs/photos": ["2030-01-01.jpg"] });
  eq("one request, plus one for the truncated file", calls, 2);
  eq("reads the configured branch", query.includes('"main:a.md"'), true);
  eq(
    "expiry from GitHub",
    [G.tokenExpiry()?.date.toISOString(), G.tokenExpiry()?.source],
    ["2030-02-01T12:00:00.000Z", "GitHub"]
  );
}

// ---- expiry: the configured date wins; a header that says "now" is ignored ------
{
  const nowish = new Date()
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");
  globalThis.fetch = async () =>
    reply(
      200,
      { content: b64("x"), encoding: "base64", sha: "s" },
      { "github-authentication-token-expiration": nowish }
    );
  await G.readFile("f");
  eq("header equal to now is not trusted", G.tokenExpiry(), null);
  process.env.DATA_TOKEN_EXPIRES = "2031-03-04";
  eq(
    "configured date wins",
    [G.tokenExpiry()?.date.toISOString(), G.tokenExpiry()?.source],
    ["2031-03-04T00:00:00.000Z", "DATA_TOKEN_EXPIRES"]
  );
  process.env.DATA_TOKEN_EXPIRES = "not a date";
  eq("bad configured date falls through", G.tokenExpiry(), null);
  delete process.env.DATA_TOKEN_EXPIRES;
}

// ---- GraphQL trouble falls back to plain reads ---------------------------------
{
  const seen = [];
  globalThis.fetch = async (url) => {
    seen.push(String(url).endsWith("/graphql") ? "graphql" : "rest");
    if (String(url).endsWith("/graphql")) return reply(200, { errors: [{ message: "Something unexpected" }] });
    if (String(url).includes("/contents/logs/photos")) return reply(200, [{ name: "p.jpg", type: "file" }]);
    return reply(200, { content: b64("via rest"), encoding: "base64", sha: "s" });
  };
  const origWarn = console.warn;
  console.warn = () => {};
  const r = await G.readMany(["a.md"], ["logs/photos"]);
  console.warn = origWarn;
  eq("fallback result", r, { files: { "a.md": "via rest" }, dirs: { "logs/photos": ["p.jpg"] } });
  eq("tried graphql first", seen[0], "graphql");

  // ...but not when GitHub itself is down: that would just fail slower.
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return reply(503, "down");
  };
  let kind = null;
  try {
    await G.readMany(["a.md"]);
  } catch (e) {
    kind = e.kind;
  }
  eq("down doesn't fall back", [kind, calls], ["down", 1]);
}

// ---- photo size ---------------------------------------------------------------------
eq("base64 size", L.base64Bytes(Buffer.alloc(1000).toString("base64")), 1000);
eq("limit fits Vercel's 4.5 MB body with base64 overhead", (L.MAX_PHOTO_BYTES * 4) / 3 < 4_400_000, true);

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("github: all checks passed");
