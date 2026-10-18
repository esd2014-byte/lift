import { NextRequest, NextResponse } from "next/server";
import { logged } from "@/lib/log";
import { publicMessage } from "@/lib/errors";
import { requireAuth } from "@/lib/guard";
import { readMany, updateFile } from "@/lib/store";
import { todayISO } from "@/lib/date";
import { parseProgram } from "@/lib/programDay";
import { parseLog } from "@/lib/workouts";
import { lastTrainedByDay } from "@/lib/recent";
import type { DigestSession } from "@/lib/metrics";
import {
  addTrip,
  checkTrip,
  endTrip,
  nextInRotation,
  proposeDays,
  setTripDay,
  type Trip,
  type TripInput,
} from "@/lib/trips";

export const dynamic = "force-dynamic";

const PATH = "logs/trips.json";

/**
 * Plan a trip, change a day of it, or come home early.
 *
 *   create   {from, to, place?, gym: {type, db_max_lb?, kettlebells?}}
 *            proposes a session per day: the rotation continues from where you are
 *   set_day  {id, date, day}   a program day letter, or "rest"
 *   end      {id}              back home: the trip ends yesterday (or disappears if
 *                              it hadn't started)
 */
async function handlePOST(req: NextRequest) {
  const denied = requireAuth(req);
  if (denied) return denied;
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const today = todayISO();
    const now = new Date().toISOString();
    const { files } = await readMany(
      ["program/current.yaml", "logs/workouts.json", "logs/hevy/recent.json", `logs/briefs/${today}.json`],
      []
    );
    const rotation = (parseProgram(files["program/current.yaml"] ?? null)?.days ?? []).map((d) => d.id);

    let trip: Trip | null = null;
    let problem: string | null = null;
    const apply = (r: { text: string | null; trip: Trip | null } | null, missing = "no such trip") => {
      if (!r) {
        problem = missing;
        return null;
      }
      if (r.text === null) {
        problem = "that overlaps another trip";
        return null;
      }
      trip = r.trip;
      return r.text;
    };

    if (body.action === "create") {
      const input = body as unknown as TripInput;
      const bad = checkTrip(input, today);
      if (bad) return NextResponse.json({ error: bad }, { status: 400 });
      // Where the rotation stands: today's brief if the trip starts today, otherwise
      // the day after the last one trained.
      let briefDay: string | null = null;
      try {
        briefDay = (JSON.parse(files[`logs/briefs/${today}.json`] ?? "{}") as { day?: string }).day ?? null;
      } catch {}
      const hevy = (() => {
        try {
          return (JSON.parse(files["logs/hevy/recent.json"] ?? "{}") as { sessions?: DigestSession[] }).sessions ?? [];
        } catch {
          return [];
        }
      })();
      const next =
        input.from === today && briefDay && rotation.includes(briefDay)
          ? briefDay
          : nextInRotation(rotation, lastTrainedByDay(parseLog(files["logs/workouts.json"] ?? null), hevy, today));
      const days = proposeDays(input.from, input.to, rotation, next);
      await updateFile(PATH, (cur) => apply(addTrip(cur, input, days, now)), `Trip ${input.from} to ${input.to}`);
    } else if (body.action === "set_day") {
      const id = String(body.id ?? "");
      const date = String(body.date ?? "");
      const day = String(body.day ?? "");
      if (day !== "rest" && !rotation.includes(day))
        return NextResponse.json({ error: "unknown day" }, { status: 400 });
      try {
        await updateFile(PATH, (cur) => apply(setTripDay(cur, id, date, day)), `Trip ${id}: ${date} -> ${day}`);
      } catch (err) {
        return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
      }
    } else if (body.action === "end") {
      const id = String(body.id ?? "");
      await updateFile(PATH, (cur) => apply(endTrip(cur, id, today)), `Trip ${id}: back home`);
    } else {
      return NextResponse.json({ error: "action must be create, set_day or end" }, { status: 400 });
    }
    if (problem) return NextResponse.json({ error: problem }, { status: problem === "no such trip" ? 404 : 409 });
    return NextResponse.json({ ok: true, trip });
  } catch (err) {
    console.error("trips failed", err);
    return NextResponse.json({ error: publicMessage(err) }, { status: 500 });
  }
}

export const POST = logged("trips", handlePOST);
