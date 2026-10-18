/**
 * README screenshots, taken from the running demo with headless Chrome. Made-up data
 * only: run `npm run demo` first.
 *
 *   node scripts/screenshots.mjs [http://localhost:3100]
 *
 * Drives Chrome over the DevTools protocol with Node's built-in WebSocket, so it
 * needs no extra packages. Writes docs/screenshots/*.jpg at 375x812, 2x.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.argv[2] ?? "http://localhost:3100";
const out = resolve(dirname(fileURLToPath(import.meta.url)), "../../docs/screenshots");
const chrome =
  process.env.CHROME ??
  (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const profile = mkdtempSync(join(tmpdir(), "lift-shots-"));
const proc = spawn(
  chrome,
  ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "about:blank"],
  {
    stdio: "ignore",
  }
);

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      .then((r) => r.json())
      .then((list) => list.find((t) => t.type === "page"))
      .catch(() => undefined);
  }
  if (!target) throw new Error("Chrome didn't start");

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params = {}) =>
    new Promise((res, rej) => {
      const n = ++id;
      pending.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const run = async (expression) =>
    (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
  const go = async (url) => {
    await send("Page.navigate", { url });
    for (let i = 0; i < 50; i++) {
      await sleep(200);
      if ((await run("document.readyState")) === "complete") break;
    }
    await sleep(1200); // fonts and hydration
  };
  const shot = async (name) => {
    const { data } = await send("Page.captureScreenshot", { format: "jpeg", quality: 82 });
    writeFileSync(join(out, `${name}.jpg`), Buffer.from(data, "base64"));
    console.log(`docs/screenshots/${name}.jpg`);
  };

  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

  // Sign in to the demo (its documented password), then load the app.
  await go(`${base}/login`);
  await run(
    `fetch("/api/login", { method: "POST", body: new URLSearchParams({ secret: "demo" }), redirect: "follow" }).then(() => true)`
  );

  await go(`${base}/`);
  await shot("today");

  await run(`document.querySelector(".exlist").scrollIntoView({ block: "start" }); window.scrollBy(0, -90); true`);
  await sleep(300);
  await shot("session");

  for (const [tab, setup] of [
    ["program", ""],
    ["progress", ""],
    ["gym", `document.querySelectorAll("details.gymsec").forEach((d, i) => (d.open = i === 1 || i === 2));`],
  ]) {
    await run(`document.getElementById("tab-${tab}").click(); window.scrollTo(0, 0); true`);
    await sleep(500);
    if (setup) {
      await run(
        `${setup} document.querySelectorAll("details.gymsec")[1].scrollIntoView({ block: "start" }); window.scrollBy(0, -70); true`
      );
      await sleep(400);
    } else {
      await run(
        `document.getElementById("panel-${tab}").scrollIntoView({ block: "start" }); window.scrollBy(0, -70); true`
      );
      await sleep(300);
    }
    await shot(tab);
  }
  ws.close();
} finally {
  // Let Chrome exit before removing its profile folder, or it's still writing to it.
  const exited = new Promise((r) => proc.once("exit", r));
  proc.kill();
  await Promise.race([exited, sleep(5000)]);
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
