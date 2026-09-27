import Link from "next/link";
import { loadLibrary } from "@/lib/library";
import RateList from "./RateList";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function RatePage() {
  let exercises, error: string | null = null;
  try {
    ({ exercises } = await loadLibrary());
  } catch (err) {
    error = String(err);
  }

  return (
    <>
      <h1>Rate exercises</h1>
      <p className="sub">
        <Link href="/">← Today</Link>
      </p>
      {error ? (
        <div className="card warn">
          <div className="label">Couldn&apos;t load the library</div>
          <div className="note">{error}</div>
        </div>
      ) : (
        <RateList exercises={exercises!} />
      )}
    </>
  );
}
