// Internal money helpers. Money is rounded to cents after every step.

/** Round half away from zero to cents, tolerant of binary noise (1.005 → 1.01). Never returns -0 or NaN. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const abs = Math.round(Math.abs(value) * 100 + 1e-7) / 100;
  if (abs === 0) return 0;
  return value < 0 ? -abs : abs;
}

/** Positive finite magnitude rounded to cents, else 0. */
export function positiveMoney(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return 0;
  return roundMoney(value);
}
