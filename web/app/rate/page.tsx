import { requirePageAuth } from "@/lib/guard";
import Link from "next/link";
import { loadLibrary } from "@/lib/library";
import RateList from "./RateList";
import { publicMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RatePage() {
  await requirePageAuth();
  let exercises,
    error: string | null = null;
  try {
    ({ exercises } = await loadLibrary());
  } catch (err) {
    error = publicMessage(err);
  }

  return (
    <>
      <header className="top">
        <p className="sub" style={{ margin: 0 }}>
          <Link className="tap" href="/">
            ← Today
          </Link>
        </p>
        <h1>Rate exercises</h1>
      </header>
      {error ? (
        <div className="callout warn" role="alert">
          <b>Couldn&apos;t load the exercise library.</b>
          <div style={{ marginTop: 6 }}>{error}</div>
        </div>
      ) : (
        <RateList exercises={exercises!} />
      )}
    </>
  );
}
