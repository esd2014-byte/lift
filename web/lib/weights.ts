import { parse } from "yaml";

/**
 * The loads that actually exist in the gym, from gym/equipment.yaml.
 *
 * A guessed weight has to be one you can pick up: NUOBELLs move in 5 lb steps, the
 * fixed dumbbells are a handful of sizes, and the adjustable kettlebell steps by
 * 4.4 lb. So a guess is rounded DOWN to the nearest real load for its station, the
 * same rule the coach's brief is held to (validate.py --brief in the data repo).
 */

export type Weights = {
  /** NUOBELL adjustable dumbbells, per hand. */
  nuobell: number[];
  /** Fixed dumbbells: the only ones that can partner a NUOBELL lift in a superset. */
  small_db: number[];
  kettlebell: number[];
};

const steps = (lo: number, hi: number, step: number) => {
  const out: number[] = [];
  for (let w = lo; w <= hi + 1e-9; w += step) out.push(Math.round(w * 10) / 10);
  return out;
};

const sorted = (xs: Iterable<number>) => [...new Set(xs)].sort((a, b) => a - b);

export function parseWeights(raw: string | null | undefined): Weights | null {
  let doc: {
    dumbbells?: Array<{ min_lb?: number; max_lb?: number; increment_lb?: number; sizes_lb?: number[] }>;
    kettlebells?: {
      fixed_lb?: number[];
      adjustable?: { range_lb?: [number, number]; increment_lb?: number; status?: string };
    };
  };
  try {
    doc = (parse(raw ?? "") ?? {}) as typeof doc;
  } catch {
    return null;
  }
  if (!doc.dumbbells && !doc.kettlebells) return null;
  const nuobell: number[] = [];
  const fixed: number[] = [];
  for (const db of doc.dumbbells ?? []) {
    if (db.increment_lb && db.max_lb) nuobell.push(...steps(db.min_lb ?? db.increment_lb, db.max_lb, db.increment_lb));
    fixed.push(...(db.sizes_lb ?? []));
  }
  const kb = doc.kettlebells ?? {};
  const bells = [...(kb.fixed_lb ?? [])];
  const adj = kb.adjustable;
  if (adj?.range_lb && adj.increment_lb && (adj.status ?? "owned") === "owned") {
    bells.push(...steps(adj.range_lb[0], adj.range_lb[1], adj.increment_lb));
  }
  return { nuobell: sorted(nuobell), small_db: sorted(fixed), kettlebell: sorted(bells) };
}

/** Rounded down to a 5 lb step, within what the Voltra can load (5-230). */
export function floor5(lb: number) {
  return Math.max(5, Math.min(230, Math.floor(lb / 5) * 5));
}

/** The heaviest of `options` at or under `lb`; the lightest if all are heavier. */
function atMost(lb: number, options: number[]) {
  const fit = options.filter((w) => w <= lb + 1e-9);
  return fit.length ? fit[fit.length - 1] : options[0];
}

/**
 * Round a guessed load DOWN to one that exists for this station. `nuobellPartner`:
 * the row shares a superset with a NUOBELL lift, so only the fixed dumbbells are free.
 * Anything without a known set of weights (the Voltra, an unknown station) keeps the
 * Voltra's 5 lb rule.
 */
export function realWeight(
  lb: number,
  station: string | undefined,
  weights: Weights | null,
  { nuobellPartner = false } = {}
): number {
  if (!weights || !station) return floor5(lb);
  if (station === "nuobell" && weights.nuobell.length) return atMost(lb, weights.nuobell);
  if (station === "small_db" && weights.small_db.length) {
    const options = nuobellPartner ? weights.small_db : sorted([...weights.small_db, ...weights.nuobell]);
    return atMost(lb, options);
  }
  if (station === "kettlebell" && weights.kettlebell.length) return atMost(lb, weights.kettlebell);
  return floor5(lb);
}
