/**
 * Read and write files in the private data repo via the GitHub API.
 *
 * Why the API rather than the filesystem: the cloud routine commits the morning
 * brief directly to the repo. Reading through the API means a new brief is live
 * the moment it lands, without waiting for a Vercel rebuild.
 *
 * Three things this layer guarantees, because everything else stands on it:
 *   - Every call has a time limit, so a slow GitHub can't hang a request until
 *     Vercel kills it.
 *   - Failures say what kind they are (bad key, rate limit, GitHub down), so the
 *     app can tell you what to do rather than print a status code.
 *   - Writes don't clobber each other. Each one re-reads the file and re-applies
 *     its change when another write got there first.
 */

import { dataRepo } from "./config";

const TIMEOUT_MS = 10_000;

export type GitHubErrorKind = "auth" | "rate" | "down" | "conflict" | "other";

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "GitHubError";
  }
}

// Fine-grained tokens report their expiry on every response. Remember the last
// one seen so the app can warn before the key stops working.
let tokenExpiresAt: string | null = null;

/** When the data token expires, as last reported by GitHub (null if it doesn't, or unknown). */
export function tokenExpiry(): Date | null {
  if (!tokenExpiresAt) return null;
  const d = new Date(tokenExpiresAt.replace(" UTC", "Z").replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function contentsUrl(path: string) {
  const { owner, repo } = dataRepo();
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
}

function withRef(path: string) {
  return `${contentsUrl(path)}?ref=${encodeURIComponent(dataRepo().branch)}`;
}

async function gh(url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Bearer ${dataRepo().token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers ?? {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    throw new GitHubError("down", 0, timedOut ? `GitHub didn't answer within ${TIMEOUT_MS / 1000}s` : "Couldn't reach GitHub");
  }
  const exp = res.headers.get("github-authentication-token-expiration");
  if (exp) tokenExpiresAt = exp;
  return res;
}

/** Turn a failed response into an error that says what kind of failure it is. */
async function failure(res: Response, what: string): Promise<GitHubError> {
  const body = (await res.text().catch(() => "")).slice(0, 200);
  if (res.status === 401) {
    return new GitHubError("auth", 401, "GitHub rejected the data key (DATA_TOKEN): it's expired, revoked, or mistyped.");
  }
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
    const mins = reset ? Math.max(1, Math.ceil((reset - Date.now()) / 60000)) : null;
    return new GitHubError("rate", res.status, `GitHub's rate limit is used up${mins ? `; it resets in about ${mins} min` : ""}.`);
  }
  if (res.status === 403 || res.status === 404) {
    return new GitHubError("auth", res.status, `The data key can't ${what}. Check it has Contents access to DATA_REPO.`);
  }
  if (res.status === 409 || res.status === 422) return new GitHubError("conflict", res.status, `${what}: ${body}`);
  if (res.status >= 500) return new GitHubError("down", res.status, `GitHub is having trouble (${res.status}).`);
  return new GitHubError("other", res.status, `${what}: ${res.status} ${body}`);
}

/** Fetch a file's text. Returns null when it doesn't exist (a missing brief is normal). */
export async function readFile(path: string): Promise<string | null> {
  const res = await gh(withRef(path));
  if (res.status === 404) return null;
  if (!res.ok) throw await failure(res, `read ${path}`);
  const json = (await res.json()) as { content: string; encoding: string };
  return Buffer.from(json.content, json.encoding as BufferEncoding).toString("utf8");
}

/**
 * Read many files and list directories in ONE request (GraphQL), instead of one
 * REST call each. Missing files come back null, missing directories as [].
 *
 * Directory listings come from the git tree, which has no 1,000-entry cap - the
 * REST contents API silently stops at 1,000, which a folder with one file a day
 * reaches in under three years.
 */
export async function readMany(
  paths: string[],
  dirs: string[] = []
): Promise<{ files: Record<string, string | null>; dirs: Record<string, string[]> }> {
  try {
    return await readManyGraphQL(paths, dirs);
  } catch (err) {
    // Down or rate-limited: one-at-a-time reads would fail the same way, only slower.
    if (err instanceof GitHubError && (err.kind === "down" || err.kind === "rate")) throw err;
    // Anything else (a token that can't use GraphQL, a schema change) shouldn't take
    // the page down while plain reads still work.
    console.warn("GraphQL read failed; falling back to REST", err);
    return readManyRest(paths, dirs);
  }
}

async function readManyRest(paths: string[], dirs: string[]) {
  const files: Record<string, string | null> = {};
  const listed: Record<string, string[]> = {};
  await Promise.all([
    ...paths.map(async (p) => {
      files[p] = await readFile(p);
    }),
    ...dirs.map(async (d) => {
      const res = await gh(withRef(d));
      if (res.status === 404) return void (listed[d] = []);
      if (!res.ok) throw await failure(res, `list ${d}`);
      const entries = (await res.json()) as Array<{ name: string; type: string }>;
      listed[d] = entries.filter((e) => e.type === "file").map((e) => e.name);
    }),
  ]);
  return { files, dirs: listed };
}

async function readManyGraphQL(
  paths: string[],
  dirs: string[]
): Promise<{ files: Record<string, string | null>; dirs: Record<string, string[]> }> {
  const { owner, repo, branch } = dataRepo();
  const fields = [
    ...paths.map((p, i) => `f${i}: object(expression: ${JSON.stringify(`${branch}:${p}`)}) { ... on Blob { text isTruncated isBinary } }`),
    ...dirs.map((d, i) => `d${i}: object(expression: ${JSON.stringify(`${branch}:${d}`)}) { ... on Tree { entries { name type } } }`),
  ];
  const query = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields.join("\n")} } }`;

  const res = await gh("https://api.github.com/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { owner, name: repo } }),
  });
  if (!res.ok) throw await failure(res, "read the data repo");
  const json = (await res.json()) as {
    data?: { repository: Record<string, { text?: string | null; isTruncated?: boolean; isBinary?: boolean; entries?: Array<{ name: string; type: string }> } | null> | null };
    errors?: Array<{ message: string; type?: string }>;
  };
  const repoData = json.data?.repository;
  if (!repoData) {
    const msg = json.errors?.[0]?.message ?? "no data";
    throw new GitHubError(/not.*(found|resolve)|access/i.test(msg) ? "auth" : "other", 200, `The data key can't read DATA_REPO: ${msg}`);
  }

  const files: Record<string, string | null> = {};
  await Promise.all(
    paths.map(async (p, i) => {
      const blob = repoData[`f${i}`];
      if (!blob || blob.isBinary) files[p] = null;
      // GraphQL truncates very large blobs; fetch those the long way.
      else if (blob.isTruncated) files[p] = await readFile(p);
      else files[p] = blob.text ?? null;
    })
  );
  const listed: Record<string, string[]> = {};
  dirs.forEach((d, i) => {
    listed[d] = (repoData[`d${i}`]?.entries ?? []).filter((e) => e.type === "blob").map((e) => e.name);
  });
  return { files, dirs: listed };
}

/** List a directory's files. Returns [] when it doesn't exist. */
export async function listDir(path: string): Promise<string[]> {
  return (await readMany([], [path])).dirs[path];
}

const ATTEMPTS = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Read-modify-write with retry. `change` gets the file's current text (null if it
 * doesn't exist) and returns the new text, or null to leave it alone.
 *
 * If another write lands between the read and the write - Start and End writing
 * two logs, a double tap, a cron committing at the same moment - GitHub rejects
 * ours as stale. Then the file is re-read and `change` re-applied to the new
 * content, so neither write is lost.
 */
export async function updateFile(
  path: string,
  change: (current: string | null) => string | null,
  message: string
): Promise<{ changed: boolean }> {
  for (let attempt = 1; ; attempt++) {
    const res = await gh(withRef(path));
    let current: string | null = null;
    let sha: string | undefined;
    if (res.ok) {
      const json = (await res.json()) as { content: string; encoding: string; sha: string };
      current = Buffer.from(json.content, json.encoding as BufferEncoding).toString("utf8");
      sha = json.sha;
    } else if (res.status !== 404) {
      throw await failure(res, `read ${path}`);
    }

    const next = change(current);
    if (next === null || next === current) return { changed: false };

    const put = await gh(contentsUrl(path), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, content: Buffer.from(next, "utf8").toString("base64"), sha, branch: dataRepo().branch }),
    });
    if (put.ok) return { changed: true };
    const err = await failure(put, `write ${path}`);
    if (err.kind !== "conflict" || attempt >= ATTEMPTS) throw err;
    await sleep(150 * attempt + Math.random() * 150);
  }
}

/** Replace a file's content outright (a digest, a state file). Retries on conflicts. */
export async function writeFile(path: string, content: string, message: string) {
  return updateFile(path, () => content, message);
}

/**
 * Write an already-base64 payload (a photo) without re-encoding it. Photos get a
 * new, timestamped path each time, so there's nothing to merge with.
 */
export async function writeBinaryFile(path: string, base64: string, message: string) {
  const res = await gh(contentsUrl(path), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, content: base64, branch: dataRepo().branch }),
  });
  if (!res.ok) throw await failure(res, `write ${path}`);
  return res.json();
}
