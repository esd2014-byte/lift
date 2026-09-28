import type { BriefData, Row, Variant } from "./types";

/**
 * Naming and routing for one workout, shared by the Today screen and the pushes to
 * Hevy and Beyond+ - so the button, the Hevy routine and the device session always
 * say the same thing.
 */

/**
 * The two ideas every screen uses:
 *
 *   workout day  the program day the plan is built on: "Day A — Push".
 *   variant      today's adjustment to it. The app names variants itself, so the
 *                words never change from day to day, whatever the brief called them.
 */
export const VARIANT_NAMES: Record<string, string> = {
  full: "As planned",
  beast: "Beast mode",
  minimum: "Quick",
  travel: "Traveling",
  rest: "Rest day",
};

export const variantName = (key: string) => VARIANT_NAMES[key] ?? key;

/** The workout day the brief is built on, before any variant: "Day A — Push", or the rest day's name. */
export function workoutDay(brief: BriefData, dayNames: Record<string, string>): string {
  if (!/^[A-Z]$/.test(brief.day)) return brief.day_name;
  return `Day ${brief.day} — ${dayNames[brief.day] ?? brief.day_name}`;
}

/**
 * The program day a variant actually trains.
 *
 * `hevy_routine` on the variant is the contract. Briefs written before that field
 * existed don't carry it, and Beast mode can promote to a different day - so rather
 * than confidently naming the wrong day, read the promoted day out of the variant's
 * own text ("promote to Day E") and resolve its title from the program.
 */
export function dayTitle(brief: BriefData, variant: Variant | undefined, dayNames: Record<string, string>): string {
  if (variant?.hevy_routine) return variant.hevy_routine;
  const hay = `${variant?.meta ?? ""} ${variant?.note?.text ?? ""}`;
  const m = /\bDay\s+([A-F])\b/.exec(hay);
  if (m && m[1] !== brief.day) {
    const name = dayNames[m[1]];
    return name ? `Day ${m[1]} — ${name}` : `Day ${m[1]}`;
  }
  if (!/^[A-Z]$/.test(brief.day)) return brief.day_name; // a rest day's optional work
  return `Day ${brief.day} — ${dayNames[brief.day] ?? brief.day_name}`;
}

/** Cable work is logged on the device; everything else in Hevy. */
export function isVoltraRow(row: Row): boolean {
  return /voltra|cable/i.test(`${row.name} ${row.station ?? ""}`);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-27" -> "Sep 27" */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}`;
}

/**
 * The Beyond+ session title: the workout's date, "2026.09.28".
 *
 * One session per day, found on the device by date - the same convention as the
 * sessions already there. The program day is in Lift and the Hevy routine.
 */
export function voltraTitle(date: string): string {
  return date.replace(/-/g, ".");
}

/** Hevy routine title for today's workout. One routine, rewritten each day. */
export function hevyTitle(dayTitleText: string, variantKey: string, variant: Variant | undefined): string {
  const suffix = variantKey !== "full" && variant ? ` · ${variantName(variantKey)}` : "";
  return `Today: ${dayTitleText}${suffix}`;
}
