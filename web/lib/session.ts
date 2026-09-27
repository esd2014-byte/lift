import type { BriefData, Row, Variant } from "./types";

/**
 * Naming and routing for one workout, shared by the Today screen and the pushes to
 * Hevy and Beyond+ - so the button, the Hevy routine and the device session always
 * say the same thing.
 */

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
 * The Beyond+ session title: the program day, then the date.
 *
 * Titled by day so Beyond+ History reads like a training log ("Day A - Push"),
 * with the date so a repeated day is still distinguishable. ASCII only: the device
 * API's handling of other characters is untested.
 */
export function voltraTitle(dayTitleText: string, date: string): string {
  return `${dayTitleText.replace(/\s+—\s+/g, " - ")} (${shortDate(date)})`;
}

/** Hevy routine title for today's workout. One routine, rewritten each day. */
export function hevyTitle(dayTitleText: string, variantKey: string, variant: Variant | undefined): string {
  const suffix = variantKey !== "full" && variant?.label ? ` · ${variant.label}` : "";
  return `Today: ${dayTitleText}${suffix}`;
}
