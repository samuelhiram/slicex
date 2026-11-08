// Display formatting for the financial UI (es-MX, MXN). Pure functions, no
// DOM. Dates are parsed from the ISO string by hand — never through a
// local-time `Date` — so a timezone/DST can never shift the displayed day.
//
// Formatters are created once at module load (Intl constructors are not
// cheap; the panels call these on every render).
import {
  daysInMonth,
  fromDayNumber,
  isISODate,
  toDayNumber,
  type ISODate,
} from "@slicex/core";

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

// --- es-MX date entry -------------------------------------------------------

/** Weekday abbreviations, index 0 = Sunday. */
const WEEKDAYS_ES: ReadonlyArray<string> = [
  "dom",
  "lun",
  "mar",
  "mié",
  "jue",
  "vie",
  "sáb",
];

/** Accent-free month names (index 0 = enero) matched by prefix. */
const MONTH_NAMES: ReadonlyArray<string> = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

const WEEKDAY_NAMES: ReadonlyArray<string> = [
  "domingo",
  "lunes",
  "martes",
  "miercoles",
  "jueves",
  "viernes",
  "sabado",
];

/** Shortest accepted prefix of a month / weekday name ("nov", "sáb"). */
const MIN_NAME_PREFIX = 3;
const MIN_YEAR = 1900;
const MAX_YEAR = 2199;

/** 0 = Sunday … 6 = Saturday. Day number 0 (1970-01-01) was a Thursday. */
function weekdayIndex(iso: ISODate): number {
  return (((toDayNumber(iso) + 4) % 7) + 7) % 7;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** "2026-11-15" → "dom 15 NOV 2026". Unparseable input is returned unchanged. */
export function formatDateWeekday(iso: string): string {
  if (!isISODate(iso)) return iso;
  return `${WEEKDAYS_ES[weekdayIndex(iso)]} ${formatDateLong(iso)}`;
}

/** "2026-11-05" → "05/11/2026" (es-MX numeric, day first). Invalid → "". */
export function formatDateInput(iso: string | undefined): string {
  if (iso === undefined || !isISODate(iso)) return "";
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
}

/**
 * How a date typed without a year ("15 nov", "15/11") picks its year:
 * - "nearest": the occurrence closest to the reference (ties → later);
 * - "on-or-after": the first occurrence on or after the reference (e.g. an
 *   end date typed relative to its start date).
 */
export type DateYearPreference = "nearest" | "on-or-after";

/** Index of the name `token` is a prefix of (≥ 3 letters), or -1. */
function nameIndex(token: string, names: ReadonlyArray<string>): number {
  if (token.length < MIN_NAME_PREFIX) return -1;
  for (let i = 0; i < names.length; i += 1) {
    if (names[i]!.startsWith(token)) return i;
  }
  return -1;
}

function monthIndex(token: string): number {
  const index = nameIndex(token, MONTH_NAMES);
  // "set" / "setiembre": the other spelling of septiembre.
  if (index < 0 && token.length >= MIN_NAME_PREFIX && "setiembre".startsWith(token)) {
    return 8;
  }
  return index;
}

const isNumberToken = (token: string) => token.charCodeAt(0) <= 57;

function toYear(token: string): number | null {
  if (token.length === 2) return 2000 + Number(token);
  if (token.length === 4) return Number(token);
  return null;
}

function toSmall(token: string): number | null {
  return token.length <= 2 ? Number(token) : null;
}

function buildISO(year: number, month: number, day: number): ISODate | null {
  if (!Number.isInteger(year) || year < MIN_YEAR || year > MAX_YEAR) return null;
  if (month < 1 || month > 12 || day < 1) return null;
  if (day > daysInMonth(year, month)) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function resolveYear(
  month: number,
  day: number,
  reference: ISODate,
  prefer: DateYearPreference,
): ISODate | null {
  if (!isISODate(reference)) return null;
  const refYear = Number(reference.slice(0, 4));
  const refDay = toDayNumber(reference);
  let best: ISODate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  // ±1 year covers every ordinary date; up to +4 finds the next 29 FEB.
  for (let year = refYear - 1; year <= refYear + 4; year += 1) {
    const candidate = buildISO(year, month, day);
    if (candidate === null) continue;
    const delta = toDayNumber(candidate) - refDay;
    if (prefer === "on-or-after" && delta < 0) continue;
    const score = prefer === "on-or-after" ? delta : Math.abs(delta);
    // `<=` on "nearest": a tie goes to the later year (years ascend).
    if (prefer === "nearest" ? score <= bestScore : score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Lenient es-MX date entry → ISO date, or null when the text is not a real
 * calendar date. Day always comes before month (never US mm/dd). Accepts:
 *   "15/11/2026", "15-11-2026", "15.11.26", "2026-11-15", "2026/11/15",
 *   "15 nov", "15 nov 2026", "15 de noviembre de 2026", "nov 15 2026",
 *   "15/11" and an optional leading weekday ("sáb 15 NOV 2026", which is
 *   what `formatDateWeekday` prints). Accents and case are ignored.
 * A date typed without a year takes it from `reference` (see
 * DateYearPreference). Pure: never reads the clock.
 */
export function parseDateInput(
  raw: string,
  reference: ISODate,
  prefer: DateYearPreference = "nearest",
): ISODate | null {
  const text = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
  if (text === "" || !/^[a-z0-9\s/.,-]+$/.test(text)) return null;
  const tokens = (text.match(/[a-z]+|\d+/g) ?? []).filter(
    (token) => token !== "de" && token !== "del",
  );
  const words = tokens.filter((token) => !isNumberToken(token));
  const numberCount = tokens.length - words.length;

  // A leading weekday is decoration ("sáb 15 NOV 2026"): dropped, never
  // checked against the date. "mar" is both martes and marzo: it is the
  // month unless another word or a full numeric date follows it.
  let monthWord: string | null = null;
  if (words.length === 2) {
    if (tokens[0] !== words[0] || nameIndex(words[0]!, WEEKDAY_NAMES) < 0) {
      return null;
    }
    tokens.shift();
    monthWord = words[1]!;
  } else if (words.length === 1) {
    const word = words[0]!;
    if (monthIndex(word) >= 0 && numberCount <= 2) {
      monthWord = word;
    } else if (tokens[0] === word && nameIndex(word, WEEKDAY_NAMES) >= 0) {
      tokens.shift();
    } else {
      return null;
    }
  } else if (words.length > 2) {
    return null;
  }

  if (monthWord !== null) {
    const month = monthIndex(monthWord) + 1;
    if (month === 0) return null;
    const at = tokens.indexOf(monthWord);
    const numbers = tokens.filter((token) => token !== monthWord);
    // "15 nov", "15 nov 2026" (day before the month) or "nov 15 [2026]".
    if (numbers.length < 1 || numbers.length > 2) return null;
    if (at !== 0 && at !== 1) return null;
    const day = toSmall(numbers[0]!);
    if (day === null) return null;
    if (numbers.length === 1) return resolveYear(month, day, reference, prefer);
    // Four-digit year only after a month name: "mar 15/11" must not read
    // as 15 MAR 2011.
    const yearToken = numbers[1]!;
    return yearToken.length === 4
      ? buildISO(Number(yearToken), month, day)
      : null;
  }

  if (tokens.length === 3) {
    const [a, b, c] = tokens as [string, string, string];
    if (a.length === 4) {
      const month = toSmall(b);
      const day = toSmall(c);
      return month === null || day === null
        ? null
        : buildISO(Number(a), month, day);
    }
    const day = toSmall(a);
    const month = toSmall(b);
    const year = toYear(c);
    return day === null || month === null || year === null
      ? null
      : buildISO(year, month, day);
  }
  if (tokens.length === 2) {
    const day = toSmall(tokens[0]!);
    const month = toSmall(tokens[1]!);
    return day === null || month === null
      ? null
      : resolveYear(month, day, reference, prefer);
  }
  return null;
}

/** `iso` moved by `days` (keyboard ↑/↓ in date fields). Invalid → null. */
export function shiftISODate(iso: string, days: number): ISODate | null {
  if (!isISODate(iso)) return null;
  const next = fromDayNumber(toDayNumber(iso) + Math.trunc(days));
  const year = Number(next.slice(0, 4));
  return year < MIN_YEAR || year > MAX_YEAR ? null : next;
}
