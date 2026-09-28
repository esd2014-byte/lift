export const dynamic = "force-dynamic";

/** One field, one button. Used once per device; the session lasts a year. */
export default async function Login({ searchParams }: { searchParams: Promise<{ e?: string }> }) {
  const { e } = await searchParams;
  return (
    <header className="top">
      <h1 className="hype">Lift</h1>
      <form method="post" action="/api/login" style={{ marginTop: 18 }}>
        <label htmlFor="secret" className="eyebrow" style={{ display: "block", marginBottom: 7 }}>
          App secret
        </label>
        <input id="secret" name="secret" type="password" autoComplete="current-password" required autoFocus style={{ width: "100%" }} />
        {e && (
          <p className="note" role="alert">
            That&apos;s not it.
          </p>
        )}
        <button className="btn block big" type="submit" style={{ marginTop: 12 }}>
          Sign in
        </button>
      </form>
    </header>
  );
}
