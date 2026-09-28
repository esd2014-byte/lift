/**
 * POST JSON from the browser, and turn any failure into one plain sentence the UI
 * can show: the server's own message when it sent one ("weight must be a number
 * between 80 and 400"), "no connection" when the request never got out.
 */
export async function postJson<T = Record<string, unknown>>(url: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("no connection");
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (!res.ok) throw new Error(json?.error ?? `the server said ${res.status}`);
  return (json ?? {}) as T;
}

/** "Didn't save: no connection." */
export const didntSave = (err: unknown) =>
  `Didn't save: ${(err instanceof Error ? err.message : String(err)).replace(/\.$/, "")}.`;
