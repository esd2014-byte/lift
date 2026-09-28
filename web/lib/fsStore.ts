import { promises as fs } from "node:fs";
import path from "node:path";
import { log } from "./log";

/**
 * The data store as a plain folder on disk: same contract as lib/github.ts, no
 * network, no token. Used when DATA_DIR is set - for tests, local development and
 * the demo, which run on synthetic data.
 *
 * Missing files read as null and missing folders list as [], exactly like the
 * GitHub store, so nothing above this layer can tell the difference.
 */

function root(): string {
  const dir = process.env.DATA_DIR?.trim();
  if (!dir) throw new Error("DATA_DIR is not set");
  return path.resolve(dir);
}

/** A repo-relative path inside the data folder. Anything that climbs out is refused. */
function resolve(rel: string): string {
  const base = root();
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) throw new Error(`path escapes DATA_DIR: ${rel}`);
  return full;
}

/** Writes are refused when DATA_READONLY is set (the public demo). */
function assertWritable(rel: string) {
  if (process.env.DATA_READONLY === "1") {
    throw new ReadOnlyError(`This is a read-only demo; nothing was saved (${rel}).`);
  }
}

export class ReadOnlyError extends Error {
  name = "ReadOnlyError";
}

async function readOrNull(full: string): Promise<string | null> {
  try {
    return await fs.readFile(full, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function readFile(rel: string): Promise<string | null> {
  return readOrNull(resolve(rel));
}

export async function listDir(rel: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(resolve(rel), { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function readMany(
  paths: string[],
  dirs: string[] = []
): Promise<{ files: Record<string, string | null>; dirs: Record<string, string[]> }> {
  const files: Record<string, string | null> = {};
  const listed: Record<string, string[]> = {};
  await Promise.all([
    ...paths.map(async (p) => void (files[p] = await readFile(p))),
    ...dirs.map(async (d) => void (listed[d] = await listDir(d))),
  ]);
  return { files, dirs: listed };
}

/** Read-modify-write. One process, so no conflicts to retry. */
export async function updateFile(
  rel: string,
  change: (current: string | null) => string | null,
  message: string
): Promise<{ changed: boolean; sha?: string }> {
  const full = resolve(rel);
  const current = await readOrNull(full);
  const next = change(current);
  if (next === null || next === current) return { changed: false };
  assertWritable(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, next, "utf8");
  log("data.write", { path: rel, store: "fs", message: message.split("\n")[0] });
  return { changed: true };
}

export async function writeFile(rel: string, content: string, message: string) {
  return updateFile(rel, () => content, message);
}

export async function writeBinaryFile(rel: string, base64: string, message: string) {
  assertWritable(rel);
  const full = resolve(rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, Buffer.from(base64, "base64"));
  log("data.write", { path: rel, store: "fs", message: message.split("\n")[0] });
  return { path: rel };
}
