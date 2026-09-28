/**
 * Where the data lives, and the credential for it.
 *
 * Code and data are separate repositories: this code can be public, the data never
 * is. The token should be a fine-grained PAT scoped to the data repo only, so that
 * nothing holding the runtime environment can push to the repo production deploys
 * from.
 *
 *   DATA_REPO    owner/name of the private data repo
 *   DATA_BRANCH  branch to read and write (default: main)
 *   DATA_TOKEN   fine-grained PAT: Contents read/write + Metadata read, that repo only
 *
 * Fails closed: with either variable missing, every data call throws rather than
 * guessing a location or falling back to a broader credential.
 */
export type DataRepo = { owner: string; repo: string; branch: string; token: string };

export function dataRepo(): DataRepo {
  const slug = process.env.DATA_REPO?.trim();
  if (!slug) throw new Error("DATA_REPO is not set");
  const m = slug.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (!m) throw new Error("DATA_REPO must look like owner/name");

  // Trim: a token pasted into a dashboard field very often carries a trailing
  // newline or space, which GitHub rejects as "Bad credentials" - indistinguishable
  // from a genuinely wrong token unless you check for it.
  const token = process.env.DATA_TOKEN?.trim();
  if (!token) throw new Error("DATA_TOKEN is not set");

  return { owner: m[1], repo: m[2], branch: process.env.DATA_BRANCH?.trim() || "main", token };
}
