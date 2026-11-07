// Display formatting for the financial UI (es-MX, MXN). Pure functions, no
// DOM. Dates are parsed from the ISO string by hand — never through a
// local-time `Date` — so a timezone/DST can never shift the displayed day.
//
// Formatters are created once at module load (Intl constructors are not
// cheap; the panels call these on every render).

const MONTHS_ES: ReadonlyArray<string> = [
  "ENE",
  "FEB",
  "MAR",
  "ABR",
  "MAY",
  "JUN",
  "JUL",
  "AGO",
  "SEP",
  "OCT",
  "NOV",
  "DIC",
];

const INTEGER_FORMAT = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
  useGrouping: true,
});

const CENTS_FORMAT = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

const PERCENT_FORMAT = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
  useGrouping: true,
});

/** U+2212 MINUS SIGN — typographic minus used for signed deltas. */
const MINUS = "−";

function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Unsigned "$12,000" / "$1,234.50" for a non-negative, cent-rounded value. */
function formatMagnitude(abs: number): string {
  return Number.isInteger(abs)
    ? `$${INTEGER_FORMAT.format(abs)}`
    : `$${CENTS_FORMAT.format(abs)}`;
}

/**
 * "$12,000" (integer → no decimals), "$1,234.50" (2 decimals otherwise),
 * "-$2,340" for negatives. Non-finite → "—".
 */
export function formatMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded = roundCents(n);
  if (rounded === 0) return "$0";
  const body = formatMagnitude(Math.abs(rounded));
  return rounded < 0 ? `-${body}` : body;
}

/**
 * Explicit sign for deltas: "+$9,000", "−$5,792" (U+2212), "$0" for zero.
 * Non-finite → "—".
 */
export function formatSignedMoney(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const rounded = roundCents(n);
  if (rounded === 0) return "$0";
  const body = formatMagnitude(Math.abs(rounded));
  return rounded < 0 ? `${MINUS}${body}` : `+${body}`;
}

interface ParsedISODate {
  year: number;
  month: number; // 1..12
  day: number; // 1..31
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseISODate(iso: string): ParsedISODate | null {
  const match = ISO_DATE_RE.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

/** "2026-11-15" → "15 NOV". Unparseable input is returned unchanged. */
export function formatDateShort(iso: string): string {
  const parsed = parseISODate(iso);
  if (!parsed) return iso;
  return `${parsed.day} ${MONTHS_ES[parsed.month - 1]}`;
}

/** "2027-03-15" → "15 MAR 2027". Unparseable input is returned unchanged. */
export function formatDateLong(iso: string): string {
  const parsed = parseISODate(iso);
  if (!parsed) return iso;
  return `${parsed.day} ${MONTHS_ES[parsed.month - 1]} ${parsed.year}`;
}

/** 99.9 → "99.9%", 45 → "45%", 3.256 → "3.26%". Non-finite → "—". */
export function formatPercent(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${PERCENT_FORMAT.format(n)}%`;
}

/**
 * Whole-peso display for read-only summaries ("$125,386"): estimated
 * interest leaves cents on every debt figure, which is noise at a glance.
 * Editors keep `formatMoney` (exact).
 */
export function formatMoneyWhole(n: number): string {
  return formatMoney(Math.round(n) || 0);
}

/** Whole-peso signed delta for read-only comparisons. */
export function formatSignedMoneyWhole(n: number): string {
  return formatSignedMoney(Math.round(n) || 0);
}
