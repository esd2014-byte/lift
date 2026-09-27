/**
 * Read and write files in the private data repo via the GitHub Contents API.
 *
 * Why the API rather than the filesystem: the cloud routine commits the morning
 * brief directly to the repo. Reading through the API means a new brief is live
 * the moment it lands, without waiting for a Vercel rebuild.
 */

import { dataRepo } from "./config";

function api(path: string) {
  const { owner, repo } = dataRepo();
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
}

function withRef(path: string) {
  return `${api(path)}?ref=${encodeURIComponent(dataRepo().branch)}`;
}

function headers() {
  return {
    Authorization: `Bearer ${dataRepo().token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/** Fetch a file's text. Returns null when it doesn't exist (a missing brief is normal). */
export async function readFile(path: string): Promise<string | null> {
  const res = await fetch(withRef(path), { headers: headers(), cache: "no-store" });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub read ${path}: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { content: string; encoding: string };
  return Buffer.from(json.content, json.encoding as BufferEncoding).toString("utf8");
}

/** List a directory. Returns [] when it doesn't exist. */
export async function listDir(path: string): Promise<string[]> {
  const res = await fetch(withRef(path), { headers: headers(), cache: "no-store" });
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`GitHub list ${path}: ${res.status}`);
  const json = (await res.json()) as Array<{ name: string; type: string }>;
  return json.filter((e) => e.type === "file").map((e) => e.name);
}

/** Create or update a file, committing it. Handles the sha lookup for updates. */
export async function writeFile(path: string, content: string, message: string) {
  let sha: string | undefined;
  const existing = await fetch(withRef(path), { headers: headers(), cache: "no-store" });
  if (existing.ok) sha = ((await existing.json()) as { sha: string }).sha;

  const res = await fetch(api(path), {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, "utf8").toString("base64"),
      sha,
      branch: dataRepo().branch,
    }),
  });
  if (!res.ok) throw new Error(`GitHub write ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

/**
 * Write an already-base64 payload (a photo) without re-encoding it.
 * The GitHub contents API wants base64 anyway, so binary rides the same path.
 */
export async function writeBinaryFile(path: string, base64: string, message: string) {
  let sha: string | undefined;
  const existing = await fetch(withRef(path), { headers: headers(), cache: "no-store" });
  if (existing.ok) sha = ((await existing.json()) as { sha: string }).sha;

  const res = await fetch(api(path), {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: base64, sha, branch: dataRepo().branch }),
  });
  if (!res.ok) throw new Error(`GitHub write ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
