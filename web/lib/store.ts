import * as github from "./github";
import * as folder from "./fsStore";

/**
 * Where the app's data lives. Everything above this layer reads and writes through
 * here and never knows which store it's talking to:
 *
 *   DATA_DIR set  -> a folder on disk (lib/fsStore.ts): tests, local dev, the demo
 *   otherwise     -> the private GitHub data repo (lib/github.ts): production
 *
 * Chosen per call, not at import, so a test can point DATA_DIR at a fresh folder.
 */
export type DataStore = {
  readFile(path: string): Promise<string | null>;
  readMany(
    paths: string[],
    dirs?: string[]
  ): Promise<{ files: Record<string, string | null>; dirs: Record<string, string[]> }>;
  listDir(path: string): Promise<string[]>;
  updateFile(
    path: string,
    change: (current: string | null) => string | null,
    message: string
  ): Promise<{ changed: boolean; sha?: string }>;
  writeFile(path: string, content: string, message: string): Promise<{ changed: boolean; sha?: string }>;
  writeBinaryFile(path: string, base64: string, message: string): Promise<unknown>;
};

export function store(): DataStore {
  return process.env.DATA_DIR?.trim() ? folder : github;
}

/** True when running on a local folder rather than the GitHub repo. */
export const usingFolder = () => Boolean(process.env.DATA_DIR?.trim());

export const readFile: DataStore["readFile"] = (p) => store().readFile(p);
export const readMany: DataStore["readMany"] = (p, d) => store().readMany(p, d);
export const listDir: DataStore["listDir"] = (p) => store().listDir(p);
export const updateFile: DataStore["updateFile"] = (p, c, m) => store().updateFile(p, c, m);
export const writeFile: DataStore["writeFile"] = (p, c, m) => store().writeFile(p, c, m);
export const writeBinaryFile: DataStore["writeBinaryFile"] = (p, b, m) => store().writeBinaryFile(p, b, m);
