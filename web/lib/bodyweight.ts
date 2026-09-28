/**
 * Rolling bodyweight average over a window of calendar days.
 *
 * "7-day average" has to mean the last seven days, not the last seven rows: with
 * gaps in logging, the last seven rows can span a month and the number drifts
 * from what the label promises. Returns the sample size so the UI can say how
 * much the average rests on.
 */
export function rollingAverage(rows: string[], today: string, days = 7): { avg: number | null; n: number } {
  const cutoff = new Date(`${today}T12:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const from = cutoff.toISOString().slice(0, 10);

  const nums = rows
    .map((r) => r.split(","))
    .filter(([date]) => date >= from && date <= today)
    .map(([, v]) => Number(v))
    .filter(isWeight);
  if (!nums.length) return { avg: null, n: 0 };
  return { avg: Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1)), n: nums.length };
}

// "skip" rows parse to NaN and an empty cell to 0; neither is a weight.
function isWeight(n: number) {
  return Number.isFinite(n) && n > 0;
}
