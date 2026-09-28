import { GitHubError } from "./github";

/**
 * What an error may say to the browser.
 *
 * Messages this app wrote itself are safe and useful ("GitHub rejected the data
 * key", "Hevy didn't answer within 10s"). Anything else - a third party's response
 * body, a stack-flavoured runtime error - stays in the server log, and the browser
 * gets a pointer to it instead.
 */
const OURS =
  /^(Hevy|Beyond\+|Voltra|Couldn't reach|[A-Z_]+ is not set|DATA_REPO must|exercise not found|invalid tolerance|no tolerance field|no variant|photo)/;

export function publicMessage(err: unknown): string {
  if (err instanceof GitHubError) return err.message;
  // The demo refuses writes; say so plainly.
  if (err instanceof Error && err.name === "ReadOnlyError") return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  // Keep the status code from an upstream failure, drop its response body.
  if (OURS.test(msg)) return msg.replace(/(: \d{3})\s.*$/s, "$1").slice(0, 200);
  return "Something went wrong. The details are in the Vercel logs.";
}
