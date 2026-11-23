// Internal money helpers. Money is rounded to cents after every step.

/**
 * The largest amount the engine takes — one payment, a balance, today's cash:
 * $1,000,000,000. Cash is a running sum of float64s: with every amount under
 * this cap a plan stays far below 2^53 cents, so each step keeps its cents.
 * Without it, one −$10^31 payment swallowed every later one (at that size,
 * adding −$1,200 changes nothing: each cell read "$0"). The inputs are
 * validated against the same cap (@slicex/contracts MAX_MONEY); the engine
 * clamps whatever reaches it anyway, like MAX_RECURRENCE_INTERVAL.
 */
export const MAX_MONEY = 1_000_000_000;

/** Round half away from zero to cents, tolerant of binary noise (1.005 → 1.01). Never returns -0 or NaN. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const abs = Math.round(Math.abs(value) * 100 + 1e-7) / 100;
  if (abs === 0) return 0;
  return value < 0 ? -abs : abs;
}

/** Positive finite magnitude rounded to cents and capped at MAX_MONEY, else 0. */
export function positiveMoney(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return value >= MAX_MONEY ? MAX_MONEY : roundMoney(value);
}

/** A signed amount (today's cash, may be an overdraft) rounded to cents, within ±MAX_MONEY. */
export function boundedMoney(value: number): number {
  const rounded = roundMoney(value);
  return rounded > MAX_MONEY ? MAX_MONEY : rounded < -MAX_MONEY ? -MAX_MONEY : rounded;
}
