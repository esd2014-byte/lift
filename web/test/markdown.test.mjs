/**
 * Checks the brief renderer against synthetic briefs (test/fixtures/briefs).
 *
 * The renderer is hand-written (a full Markdown library would be a large
 * dependency for the narrow subset Claude writes), so it's the piece most likely
 * to break silently when the brief format drifts. Run it after any change:
 *   node test/markdown.test.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = "/tmp/pt-markdown-test";

// Quote the paths: the repo lives under "Claude projects", and the space
// silently splits the argument otherwise.
execSync(
  `npx tsc "${join(here, "../lib/markdown.ts")}" --outDir "${out}" --module esnext --target es2022 --moduleResolution bundler`,
  { stdio: "pipe" }
);
const { renderMarkdown } = await import(`${out}/markdown.js`);

const briefsDir = join(here, "fixtures/briefs");
const briefs = readdirSync(briefsDir).filter((f) => f.endsWith(".md")).sort();
if (!briefs.length) {
  console.log("no briefs to test against - skipping");
  process.exit(0);
}

let failed = 0;
for (const name of briefs) {
  const html = renderMarkdown(readFileSync(join(briefsDir, name), "utf8"));
  // Since 2026-09-26 the session table lives in the brief's JSON, not its prose,
  // so a table is optional here. When one IS present it still has to render.
  const hasTable = html.includes("<table>");
  const checks = {
    "headings promoted below h1": html.includes("<h2>") && !html.includes("<h1>"),
    "bold preserved": html.includes("<strong>"),
    "no leftover table pipes": !/\n\|/.test(html),
    "escapes html": !html.includes("<script"),
    ...(hasTable ? { "table has rows": (html.match(/<tr>/g) || []).length >= 3 } : {}),
  };
  for (const [label, ok] of Object.entries(checks)) {
    if (!ok) {
      console.log(`FAIL  ${name}: ${label}`);
      failed++;
    }
  }
}
// Hostile input. The brief is model-written from free text (workout notes, injury
// notes, rest reasons), so the renderer is a trust boundary.
const hostile = {
  "quote in a link can't break out of href": '[x](https://a"onmouseover="alert(1))',
  "single quote in a link": "[x](https://a'onmouseover='alert(1))",
  "javascript: links aren't links": "[x](javascript:alert(1))",
  "http links aren't links": "[x](http://example.com)",
  "raw tags are escaped": '<img src=x onerror="alert(1)"> <script>alert(1)</script>',
};
for (const [label, md] of Object.entries(hostile)) {
  const html = renderMarkdown(md);
  // Every tag must be one the renderer emits, and every link exactly this shape -
  // so an injected attribute can't hide anywhere.
  const tags = html.match(/<[^>]+>/g) ?? [];
  const ok = tags.every((t) =>
    /^<\/?(p|strong|em|code|a)>$/.test(t) ||
    /^<a href="https:\/\/[^"\s]*" rel="noopener noreferrer" target="_blank">$/.test(t)
  );
  if (!ok) { console.log(`FAIL  ${label}: ${html}`); failed++; }
}
const good = renderMarkdown("[docs](https://example.com/a?b=1&c=2)");
if (!good.includes('href="https://example.com/a?b=1&amp;c=2"') || !good.includes('rel="noopener noreferrer"')) {
  console.log(`FAIL  https link renders: ${good}`); failed++;
}

console.log(failed ? `\n${failed} failure(s)` : `ok - ${briefs.length} brief(s) render cleanly, hostile input escaped`);
process.exit(failed ? 1 : 0);
