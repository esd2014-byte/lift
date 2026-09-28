/** Shared shapes for the brief the cloud routine writes each morning. */

export type Row = {
  superset?: string | null;
  name: string;
  station?: string;
  reps: string;
  rpe?: number | string | null;
  /** Pounds to program on the device. Required on Voltra rows - see docs/brief-schema.md. */
  load_lb?: number | null;
  note?: string;
  /**
   * Set by the app, never by the brief: this row's load_lb was a guess (see
   * lib/loadGuess.ts), so today is a calibration day for it.
   */
  calibration?: import("./loadGuess").Calibration;
};

export type Variant = {
  label: string;
  meta: string;
  duration: string;
  /**
   * The Hevy routine to open for THIS variant. Usually the day's own routine, but
   * Beast mode promotes to a different day, so the button has to name the right one.
   * Omit to fall back to the day's routine.
   */
  hevy_routine?: string;
  note?: { kind: "accent" | "warn"; text: string } | null;
  rows: Row[];
};

export type BriefData = {
  date: string;
  generated_at?: string;
  day: string;
  day_name: string;
  day_type: "real" | "short" | "rest";
  headline?: string;
  voltra_mounts?: string[];
  injury_flag?: string | null;
  variants: Record<string, Variant>;
};

export const VARIANT_ORDER = ["full", "beast", "minimum", "travel"] as const;
