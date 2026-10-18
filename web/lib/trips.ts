import type { Hotel, HotelGym } from "./programDay";

/**
 * Trips: dates away from home, what the hotel gym has, and a proposed session for
 * each day. Stored as one JSON list in logs/trips.json.
 *
 * The app proposes the days (the rotation simply continues, with a rest day every
 * seventh), the athlete overrides any of them, and the morning routine reads the
 * plan: on a trip day its pick is that day's planned session, converted to the hotel
 * gym. A planned rest day on a trip counts as rest, not a miss.
 *
 * Pure text in, text out: the route does the I/O.
 */

export type TripDay = { date: string; day: string };
export type Trip = {
  id: string;
  from: string;
  to: string;
  place?: string;
  gym: Hotel;
  /** One per date from `from` to `to`. `day` is a program day letter or "rest". */
  days: TripDay[];
  created_at: string;
};

export const HOTEL_TYPES: HotelGym[] = ["machines_cardio", "full_gym", "db_only", "bodyweight"];
export const MAX_TRIP_DAYS = 31;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length <= MAX_TRIP_DAYS; d = addDays(d, 1)) out.push(d);
  return out;
}

export function parseTrips(raw: string | null): Trip[] {
  try {
    const list = JSON.parse(raw ?? "[]");
    return Array.isArray(list)
      ? list.filter((t) => t && typeof t.id === "string" && ISO.test(t.from) && ISO.test(t.to) && Array.isArray(t.days))
      : [];
  } catch {
    return [];
  }
}

const serialize = (list: Trip[]) =>
  JSON.stringify(
    [...list].sort((a, b) => (a.from < b.from ? -1 : 1)),
    null,
    2
  ) + "\n";

/** The trip today falls in, if any. */
export const activeTrip = (trips: Trip[], today: string) => trips.find((t) => t.from <= today && today <= t.to) ?? null;

/** The next trip that hasn't ended, current or upcoming. */
export const nextTrip = (trips: Trip[], today: string) =>
  [...trips].filter((t) => t.to >= today).sort((a, b) => (a.from < b.from ? -1 : 1))[0] ?? null;

/** Planned rest days on trips, up to today: rest, not misses. */
export const tripRestDays = (trips: Trip[], today: string) =>
  trips.flatMap((t) => t.days.filter((d) => d.day === "rest" && d.date <= today).map((d) => d.date));

/**
 * The proposed session for each day of a trip: the rotation continues from the day
 * after `next` (the day the coach would program next), with a rest day every seventh.
 */
export function proposeDays(from: string, to: string, rotation: string[], next: string | null): TripDay[] {
  let i = Math.max(0, rotation.indexOf(next ?? rotation[0]));
  return datesBetween(from, to).map((date, k) => {
    if ((k + 1) % 7 === 0 || !rotation.length) return { date, day: "rest" };
    const day = rotation[i % rotation.length];
    i++;
    return { date, day };
  });
}

/** The letter after the last one trained, in rotation order; the first when nothing is known. */
export function nextInRotation(rotation: string[], lastByDay: Record<string, string>): string | null {
  const last = Object.entries(lastByDay)
    .filter(([id]) => rotation.includes(id))
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : rotation.indexOf(b[0]) - rotation.indexOf(a[0])))[0];
  if (!last) return rotation[0] ?? null;
  return rotation[(rotation.indexOf(last[0]) + 1) % rotation.length];
}

export type TripInput = {
  from: string;
  to: string;
  place?: string;
  gym: { type: string; db_max_lb?: number | null; kettlebells?: boolean };
};

/** Why a trip can't be saved, in words, or null. */
export function checkTrip(t: TripInput, today: string): string | null {
  if (!ISO.test(t.from ?? "") || !ISO.test(t.to ?? "")) return "pick the dates you're away";
  if (t.to < t.from) return "the trip ends before it starts";
  if (t.to < today) return "that trip is already over";
  if (datesBetween(t.from, t.to).length > MAX_TRIP_DAYS) return `trips are up to ${MAX_TRIP_DAYS} days`;
  if (!HOTEL_TYPES.includes(t.gym?.type as HotelGym)) return "pick what the hotel gym has";
  const max = t.gym.db_max_lb;
  if (max != null && !(typeof max === "number" && max > 0 && max <= 200)) return "heaviest dumbbell must be a weight";
  if (t.place && t.place.length > 80) return "keep the place short";
  return null;
}

const overlaps = (a: { from: string; to: string }, b: { from: string; to: string }) => a.from <= b.to && b.from <= a.to;

/** A new trip with proposed days. Null `text` when it overlaps another trip. */
export function addTrip(current: string | null, input: TripInput, days: TripDay[], now: string) {
  const list = parseTrips(current);
  if (list.some((t) => overlaps(t, input))) return { text: null, trip: null };
  const trip: Trip = {
    id: `${input.from}-${list.length + 1}`,
    from: input.from,
    to: input.to,
    ...(input.place?.trim() ? { place: input.place.trim() } : {}),
    gym: {
      type: input.gym.type as HotelGym,
      db_max_lb: input.gym.db_max_lb ?? null,
      kettlebells: input.gym.kettlebells === true,
    },
    days,
    created_at: now,
  };
  return { text: serialize([...list, trip]), trip };
}

function edit(current: string | null, id: string, change: (t: Trip) => Trip | null) {
  const list = parseTrips(current);
  const found = list.find((t) => t.id === id);
  if (!found) return null;
  const next = change(found);
  return { text: serialize(list.flatMap((t) => (t === found ? (next ? [next] : []) : [t]))), trip: next };
}

/** Change one day's plan: another program day, or rest. */
export const setTripDay = (current: string | null, id: string, date: string, day: string) =>
  edit(current, id, (t) => {
    if (!t.days.some((d) => d.date === date)) throw new Error("that date isn't on the trip");
    return { ...t, days: t.days.map((d) => (d.date === date ? { date, day } : d)) };
  });

/**
 * Back home early: the trip ends yesterday and later days are dropped. A trip that
 * hadn't started yet, or started today, is removed entirely.
 */
export const endTrip = (current: string | null, id: string, today: string) =>
  edit(current, id, (t) => {
    if (t.from >= today) return null;
    const to = addDays(today, -1);
    return { ...t, to, days: t.days.filter((d) => d.date <= to) };
  });
