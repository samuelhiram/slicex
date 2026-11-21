// "/" command bar: one Spanish sentence → a draft financial item.
//
// Pure (no DOM, no clock — `today` comes from the caller) and total: every
// input yields a ParsedCommand or null; nothing throws.
//
// Grammar — case- and accent-insensitive, words in any order:
//   amount     8000 · 8,000 · $8,000.50 · 8 mil · 8 mil 500 · 8k · 1.5k ·
//              medio millón · 2 millones · "8000 pesos" (required: no amount → null)
//   kind       me pagan / cobro / recibo / ingreso / gano → income;
//              pago / gasto / compra / me cobran → expense (verbs, dropped from the name);
//              sueldo, nómina, salario, aguinaldo, bono, venta… → income;
//              renta, súper, colegiatura, gasolina, luz… → expense (nouns, kept as the name);
//              préstamo / crédito (dropped), hipoteca / deuda (kept) → loan;
//              N msi / a N meses sin intereses → installment-plan;
//              tarjeta / tdc (not after "pago"/"con") → credit-card;
//              con|en|a|cargo a [la] tarjeta [nombre] / con <tarjeta del doc> → card-purchase;
//              nothing recognised → expense ("tipo" assumed)
//   frequency  quincenal / cada quincena / la quincena / cada 15 días / 15 y 30 → semimonthly;
//              mensual / cada mes / al mes / por mes / 8000/mes / el N → monthly;
//              semanal / cada semana / a la semana / cada 8 días / los viernes → weekly;
//              catorcenal / cada 14 días / cada 2 semanas → biweekly;
//              una vez / único, or a specific date with no frequency → once
//   dates      hoy · mañana · pasado mañana · ayer · el viernes (next one, today excluded) ·
//              el 15 de diciembre [de 2027] · 15 dic · dic 15 · 15/12[/2026] · 2026-12-15 ·
//              en 3 días / en 2 semanas / en un mes · en diciembre (the 1st; today if
//              it is the current month) · el N / el día N / fin de mes (day of month) —
//              a date without a year that already passed moves to next year
//   window     desde 1 dic / a partir del 1 de diciembre / desde enero / desde mañana → start;
//              hasta junio / hasta el 15 de marzo / hasta 2027 → end;
//              6 meses / 2 años / 8 semanas / 12 pagos / 12 mensualidades / 6 quincenas → end
//   loans      "préstamo de 50000 pagando 7500 mensual": larger amount = balance, smaller = payment
//   cards      al 99.9% / 45% anual / tasa 45 → annualRate; corte 15 → cutDay;
//              pago|vence|límite el 26 → dueDay; mínimo 1500 → minimumPayment
//   MSI        llevo 3 / 3 pagados → installmentsPaid
//
// Judgement calls (see tests):
// - "el N" with no other frequency means monthly on day N (renta 8000 el 1).
// - MSI: the date is the PURCHASE date (today when none is said), exactly
//   like the editor's draft; the engine derives the first installment from
//   the card's payment day (UX-33: "/" and the editor give the same first
//   installment for the same purchase).
// - End bounds (hasta…, N meses) snap to the LAST occurrence inside the bound,
//   so the item ends on its last payment (same occurrences either way).
// - Monthly on day 29-31 starts on the first clamped occurrence (Nov 30 for
//   "el 31") and carries an anchorDate with the real day, so later months
//   keep the 31st.
import {
  addDays,
  addMonths,
  clampedDayOfMonth,
  createDefaultFinancialItem,
  daysInMonth,
  expandRecurrence,
  isISODate,
  monthlyInstallment,
  toDayNumber,
  type FinancialDocument,
  type FinancialItem,
  type FinancialItemKind,
  type FinancialRecurrence,
  type ISODate,
  type RecurrenceFrequency,
} from "@slicex/core";
import {
  formatDateLong,
  formatDateShort,
  formatMoney,
  formatPercent,
  parseDateInput,
} from "./format";
import { KIND_LABELS } from "./labels";

export interface CommandContext {
  today: ISODate;
  doc: FinancialDocument;
}

export interface ParsedCommand {
  /** Draft: id "cmd-draft", sensible defaults for anything not said. */
  item: FinancialItem;
  /** Short Spanish summary, e.g. "Gasto · Renta · $8,000 · cada mes, día 1 · desde 1 dic". */
  summary: string;
  /** Fields that were defaulted (Spanish words for the UI hint), e.g. ["fecha"]. */
  assumed: string[];
}

const DRAFT_ID = "cmd-draft";

// ---------------------------------------------------------------------------
// Vocabulary (accent-free, lower case)

const STOPWORDS = new Set([
  "de", "del", "la", "las", "el", "los", "a", "al", "en", "con", "por", "para",
  "y", "e", "o", "mi", "mis", "su", "sus", "un", "una", "unos", "unas", "que",
  "cada", "x", "me", "le", "les", "lo", "se", "es", "son", "desde", "hasta",
  "durante", "todos", "todas", "este", "esta", "proximo", "proxima",
]);

const CURRENCY = new Set(["$", "pesos", "peso", "mxn", "mn", "varos", "baros"]);

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6,
  siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciocho: 18, veinte: 20, veinticuatro: 24,
  treinta: 30, cuarenta: 40, cincuenta: 50, cien: 100,
};

const INCOME_ME_VERBS = new Set([
  "pagan", "paga", "pagaron", "depositan", "deposita", "depositaron", "dan",
  "da", "dieron", "caen", "cae", "llega", "llegan", "transfieren", "transfiere",
  "entra", "entran",
]);
const EXPENSE_ME_VERBS = new Set(["cobran", "cobra", "cargan", "carga", "descuentan", "descuenta", "quitan"]);
const INCOME_VERBS = new Set([
  "cobro", "cobrar", "cobre", "recibo", "recibir", "recibi", "ingreso", "ingresos",
  "ingresa", "ingresan", "gano", "gane", "ganar",
]);
const EXPENSE_VERBS = new Set([
  "pago", "pagar", "pague", "pagare", "gasto", "gastos", "gaste", "gastar",
  "compra", "compro", "compre", "comprar", "abono", "abonar", "pagando", "abonando",
]);
/** Verbs that pay something off ("pago tarjeta" is a payment, not a new card). */
const PAY_VERBS = new Set(["pago", "pagar", "pague", "pagos", "abono", "abonar", "pagando", "abonando"]);
/** Kind words that ARE the kind's label: the fallback name was said, not assumed. */
const KIND_NAMING_WORDS = new Set([
  "ingreso", "ingresos", "gasto", "gastos", "compra", "prestamo", "prestamos",
  "credito", "tarjeta", "tdc", "msi",
]);
const INCOME_NOUNS = new Set([
  "sueldo", "salario", "nomina", "aguinaldo", "bono", "bonos", "venta", "ventas",
  "honorarios", "comision", "comisiones", "reembolso", "freelance", "pension",
  "beca", "propina", "propinas", "utilidades", "dividendos", "finiquito",
  "liquidacion", "prima", "chamba",
]);
const ONE_OFF_NOUNS = new Set([
  "aguinaldo", "bono", "venta", "reembolso", "finiquito", "liquidacion", "prima",
  "regalo", "premio", "utilidades",
]);
const EXPENSE_NOUNS = new Set([
  "renta", "super", "supermercado", "despensa", "colegiatura", "luz", "agua", "gas",
  "gasolina", "internet", "telefono", "celular", "netflix", "spotify", "disney",
  "hbo", "seguro", "comida", "uber", "didi", "taxi", "cine", "mantenimiento",
  "predial", "gimnasio", "gym", "doctor", "medico", "medicina", "farmacia",
  "transporte", "estacionamiento", "cafe", "restaurante", "cena", "desayuno",
  "suscripcion", "tenencia", "verificacion", "multa", "impuestos", "lavanderia",
  "veterinario", "escuela", "guarderia", "curso", "viaje", "vuelo", "hotel",
  "regalo", "ropa", "zapatos", "amazon", "oxxo", "walmart", "costco", "laptop",
]);
const LOAN_WORDS = new Set(["prestamo", "prestamos", "credito", "creditos", "financiamiento"]);
const LOAN_NOUNS = new Set(["hipoteca", "deuda", "deudas"]);
const CARD_WORDS = new Set(["tarjeta", "tdc"]);
const CARD_PREPS = new Set(["con", "en", "a", "al", "cargo", "cargar", "cargado", "cargada"]);
const CARD_ARTICLES = new Set(["la", "mi", "mis", "el", "su", "a", "al", "en"]);
const GENERIC_CARD_NAME_WORDS = new Set(["tarjeta", "de", "credito", "la", "el", "card", "tdc"]);

const RATE_WORDS = new Set(["tasa", "cat", "interes"]);
const RATE_PREFIXES = new Set(["al", "a", "del", "de", "tasa", "cat", "interes", "con", "una", "un", "el"]);
const RATE_SUFFIXES = new Set(["anual", "anuales", "anualmente"]);

const SEMIMONTHLY_ADJ = new Set(["quincenal", "quincenales", "quincenalmente"]);
const MONTHLY_ADJ = new Set(["mensual", "mensuales", "mensualmente", "mensualidad", "mensualidades"]);
const WEEKLY_ADJ = new Set(["semanal", "semanales", "semanalmente"]);
const BIWEEKLY_ADJ = new Set(["catorcenal", "catorcenales", "catorcenalmente", "bisemanal", "bisemanales"]);
// "Cada N meses" in one word.
const MONTHS_ADJ: ReadonlyMap<string, number> = new Map([
  ["bimestral", 2], ["bimestrales", 2],
  ["trimestral", 3], ["trimestrales", 3],
  ["cuatrimestral", 4], ["cuatrimestrales", 4],
  ["semestral", 6], ["semestrales", 6],
  ["anual", 12], ["anuales", 12], ["anualmente", 12],
]);
const PER_PREFIXES = new Set(["cada", "por", "x", "al", "a"]);

const PAYMENT_UNITS = new Set([
  "pagos", "mensualidades", "cuotas", "plazos", "abonos", "letras", "parcialidades",
]);
const DURATION_PREFIXES = new Set(["por", "durante", "a", "x", "en"]);

const START_WORDS = new Set([
  "desde", "empezando", "iniciando", "comenzando", "arrancando", "empieza", "inicia", "comienza",
]);
const END_WORDS = new Set(["hasta", "terminando", "termina"]);
const DATE_PREFIXES = new Set(["la", "este", "esta", "proximo", "proxima", "siguiente"]);
const AMOUNT_UNITS = new Set(["mil", "k", "millon", "millones", "%", ...CURRENCY]);
const RELATIVE_DAYS: Readonly<Record<string, number>> = {
  hoy: 0,
  manana: 1,
  ayer: -1,
  antier: -2,
  anteayer: -2,
};

const MONTH_NAMES: ReadonlyArray<string> = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre",
];
const WEEKDAY_NAMES: ReadonlyArray<string> = [
  "domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado",
];
const WEEKDAY_LABELS: ReadonlyArray<string> = [
  "domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado",
];

// ---------------------------------------------------------------------------
// Text helpers

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** 1..12 for a month name or a ≥ 3-letter prefix of one ("dic", "set"), else 0. */
function monthOf(word: string): number {
  if (word.length < 3 || !/^[a-z]+$/.test(word)) return 0;
  for (let i = 0; i < MONTH_NAMES.length; i += 1) {
    if (MONTH_NAMES[i]!.startsWith(word)) return i + 1;
  }
  return "setiembre".startsWith(word) ? 9 : 0;
}

/** 0 = Sunday … 6 = Saturday for a full weekday name (plural allowed), else -1. */
function weekdayOf(word: string): number {
  if (word === "") return -1;
  const index = WEEKDAY_NAMES.indexOf(word);
  if (index >= 0) return index;
  return word.endsWith("s") ? WEEKDAY_NAMES.indexOf(word.slice(0, -1)) : -1;
}

/** "15" → 15 when it can be a day of month (1..31, ≤ 2 digits), else null. */
function plainDay(word: string): number | null {
  if (!/^\d{1,2}$/.test(word)) return null;
  const day = Number(word);
  return day >= 1 && day <= 31 ? day : null;
}

/** Small count: "12" (≤ 3 digits) or a number word ("seis"), else null. */
function smallInt(word: string): number | null {
  if (/^\d{1,3}$/.test(word)) return Number(word);
  const value = NUMBER_WORDS[word];
  return value === undefined ? null : value;
}

/** "8000" · "8,000" · "$8,000.50" · "8k" · "1.5k" · "8.000" · "99,5" → number, else null. */
function parseAmountToken(word: string): number | null {
  let s = word.startsWith("$") ? word.slice(1) : word;
  let multiplier = 1;
  if (s.endsWith("k")) {
    multiplier = 1000;
    s = s.slice(0, -1);
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, "");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s) && multiplier === 1) s = s.replace(/\./g, "");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const value = Number(s) * multiplier;
  return Number.isFinite(value) ? value : null;
}

/** "99.9" / "99,9" → 99.9 (rates), else null. */
function parseDecimal(word: string): number | null {
  if (!/^\d+([.,]\d+)?$/.test(word)) return null;
  const value = Number(word.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Tokens

interface Tok {
  raw: string;
  norm: string;
  used: boolean;
}

const LEADING_PUNCT = /^[([{¿¡"'«“‘+\-–—]+/;
const TRAILING_PUNCT = /[)\]}?!"'»”’:;,.…]+$/;
const LETTER_RE = /\p{L}/u;

function pushPiece(out: Tok[], piece: string): void {
  const raw = piece.replace(LEADING_PUNCT, "").replace(TRAILING_PUNCT, "");
  if (raw === "") return;
  const norm = fold(raw);
  // "12msi" → "12" "msi"; "8mil" → "8" "mil" ("8k" stays one amount token).
  const glued = /^(\$?\d[\d.,]*)([a-z]+)$/.exec(norm);
  if (glued && glued[2] !== "k" && glued[1]!.length < raw.length) {
    const cut = glued[1]!.length;
    out.push({ raw: raw.slice(0, cut), norm: glued[1]!, used: false });
    out.push({ raw: raw.slice(cut), norm: glued[2]!, used: false });
    return;
  }
  out.push({ raw, norm, used: false });
}

function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const chunk of text.normalize("NFC").split(/\s+/)) {
    if (chunk === "") continue;
    // A comma between digits is a thousands separator; anywhere else it splits.
    for (const part of chunk.split(/,(?!\d)|(?<!\d),/)) {
      // "8000/mes" → "8000" "/" "mes" ("/" reads as "per"); dates keep their slashes.
      if (part.includes("/") && LETTER_RE.test(part) && !/^\d{1,2}\/\p{L}{3,}/u.test(part)) {
        const bits = part.split("/");
        bits.forEach((bit, k) => {
          if (k > 0) out.push({ raw: "/", norm: "x", used: false });
          pushPiece(out, bit);
        });
        continue;
      }
      pushPiece(out, part);
    }
  }
  return out;
}

/** Token stream: `at` returns "" for consumed or out-of-range tokens, so patterns never match across them. */
class Words {
  constructor(private readonly toks: Tok[]) {}

  get length(): number {
    return this.toks.length;
  }

  at(i: number): string {
    const tok = this.toks[i];
    return tok !== undefined && !tok.used ? tok.norm : "";
  }

  use(from: number, to: number): void {
    const end = Math.min(to, this.toks.length);
    for (let k = Math.max(0, from); k < end; k += 1) this.toks[k]!.used = true;
  }

  remaining(): Tok[] {
    return this.toks.filter((tok) => !tok.used);
  }
}

// ---------------------------------------------------------------------------
// Dates

type DateExpr =
  | { type: "fixed"; date: ISODate }
  | { type: "text"; text: string }
  | { type: "dom"; day: number }
  | { type: "weekday"; weekday: number }
  | { type: "month"; month: number; year: number | null }
  | { type: "year"; year: number };

interface DateHit {
  expr: DateExpr;
  end: number;
}

const NUMERIC_DATE_RE = /^\d{1,4}[/-]\d{1,2}([/-]\d{1,4})?$/;
const ALPHA_DATE_RE = /^\d{1,2}[/-][a-z]{3,}([/-]\d{2,4})?$/;

function ymd(date: ISODate): [number, number, number] {
  return [Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10))];
}

/** 0 = Sunday … 6 = Saturday. Day number 0 (1970-01-01) was a Thursday. */
function weekdayIndex(date: ISODate): number {
  return (((toDayNumber(date) + 4) % 7) + 7) % 7;
}

function nextWeekday(from: ISODate, weekday: number, strict: boolean): ISODate {
  let delta = (weekday - weekdayIndex(from) + 7) % 7;
  if (strict && delta === 0) delta = 7;
  return addDays(from, delta);
}

/**
 * First date ≥ `base` on day `dom` (clamped to short months). When clamped,
 * `anchor` carries a real day-`dom` date so a monthly schedule keeps the 31st.
 */
function domOnOrAfter(base: ISODate, dom: number): { date: ISODate; anchor?: ISODate } {
  let [y, m] = ymd(base);
  let date = clampedDayOfMonth(y, m, dom);
  if (date < base) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    date = clampedDayOfMonth(y, m, dom);
  }
  if (ymd(date)[2] === dom) return { date };
  let ay = y;
  let am = m;
  for (let k = 0; k < 12 && daysInMonth(ay, am) < dom; k += 1) {
    am += 1;
    if (am > 12) {
      am = 1;
      ay += 1;
    }
  }
  return { date, anchor: clampedDayOfMonth(ay, am, dom) };
}

/**
 * Reads a date expression at `i` (prefixes "el", "la", "este", "próximo",
 * "día" allowed). `bound` (after desde/hasta) also accepts a bare day number,
 * a bare month and a bare year.
 */
function readDate(w: Words, i: number, mode: "main" | "bound", today: ISODate): DateHit | null {
  let j = i;
  let domPrefix = false;
  for (;;) {
    const t = w.at(j);
    if (t === "el" || t === "los" || t === "dia" || t === "dias") {
      domPrefix = true;
      j += 1;
    } else if (DATE_PREFIXES.has(t)) {
      j += 1;
    } else {
      break;
    }
  }
  const t = w.at(j);
  if (t === "") return null;

  if (t === "pasado" && w.at(j + 1) === "manana") {
    return { expr: { type: "fixed", date: addDays(today, 2) }, end: j + 2 };
  }
  const relative = RELATIVE_DAYS[t];
  if (relative !== undefined) {
    return { expr: { type: "fixed", date: addDays(today, relative) }, end: j + 1 };
  }

  const weekday = weekdayOf(t);
  if (weekday >= 0) {
    let end = j + 1;
    if (w.at(end) === "que" && w.at(end + 1) === "viene") end += 2;
    else if (w.at(end) === "proximo") end += 1;
    return { expr: { type: "weekday", weekday }, end };
  }

  if (NUMERIC_DATE_RE.test(t) || ALPHA_DATE_RE.test(t)) {
    return parseDateInput(t, today) !== null ? { expr: { type: "text", text: t }, end: j + 1 } : null;
  }

  const day = plainDay(t);
  if (day !== null) {
    let k = j + 1;
    if (w.at(k) === "de") k += 1;
    if (monthOf(w.at(k)) > 0) {
      let text = `${day} ${w.at(k)}`;
      let end = k + 1;
      let y = end;
      if (w.at(y) === "de" || w.at(y) === "del") y += 1;
      if (/^\d{4}$/.test(w.at(y))) {
        text += ` ${w.at(y)}`;
        end = y + 1;
      }
      return parseDateInput(text, today) !== null ? { expr: { type: "text", text }, end } : null;
    }
    if ((domPrefix || mode === "bound") && !AMOUNT_UNITS.has(w.at(j + 1))) {
      return { expr: { type: "dom", day }, end: j + 1 };
    }
    return null;
  }

  const month = monthOf(t);
  if (month > 0) {
    const day2 = plainDay(w.at(j + 1));
    if (day2 !== null) {
      let text = `${day2} ${t}`;
      let end = j + 2;
      if (/^\d{4}$/.test(w.at(end))) {
        text += ` ${w.at(end)}`;
        end += 1;
      }
      if (parseDateInput(text, today) !== null) return { expr: { type: "text", text }, end };
    }
    if (mode === "bound") {
      let end = j + 1;
      let year: number | null = null;
      let y = end;
      if (w.at(y) === "de" || w.at(y) === "del") y += 1;
      if (/^\d{4}$/.test(w.at(y))) {
        year = Number(w.at(y));
        end = y + 1;
      }
      return { expr: { type: "month", month, year }, end };
    }
    return null;
  }

  if (mode === "bound" && /^(19|20|21)\d{2}$/.test(t)) {
    return { expr: { type: "year", year: Number(t) }, end: j + 1 };
  }
  if (t === "fin" && (w.at(j + 1) === "de" || w.at(j + 1) === "del") && w.at(j + 2) === "mes") {
    return { expr: { type: "dom", day: 31 }, end: j + 3 };
  }
  if (t === "ultimo") {
    let end = j + 1;
    if (w.at(end) === "dia") end += 1;
    if ((w.at(end) === "de" || w.at(end) === "del") && w.at(end + 1) === "mes") end += 2;
    return { expr: { type: "dom", day: 31 }, end };
  }
  return null;
}

/** Date of a main-clause expression (a once date / a schedule's first occurrence). */
function resolveMainDate(expr: DateExpr, today: ISODate, startBound: ISODate | null): ISODate {
  switch (expr.type) {
    case "fixed":
      return expr.date;
    case "text":
      return parseDateInput(expr.text, today, "on-or-after") ?? today;
    case "weekday":
      return startBound !== null
        ? nextWeekday(startBound, expr.weekday, false)
        : nextWeekday(today, expr.weekday, true);
    case "month": {
      if (expr.year !== null) return clampedDayOfMonth(expr.year, expr.month, 1);
      const [ty, tm] = ymd(today);
      if (expr.month === tm) return today;
      return clampedDayOfMonth(expr.month > tm ? ty : ty + 1, expr.month, 1);
    }
    case "year":
      return clampedDayOfMonth(expr.year, 1, 1);
    case "dom":
      return domOnOrAfter(startBound ?? today, expr.day).date;
  }
}

/** Start of the window ("desde …"). Dates without a year take the nearest one. */
function resolveStartBound(expr: DateExpr, today: ISODate): ISODate {
  switch (expr.type) {
    case "text":
      return parseDateInput(expr.text, today, "nearest") ?? today;
    case "month": {
      if (expr.year !== null) return clampedDayOfMonth(expr.year, expr.month, 1);
      const [ty] = ymd(today);
      const ref = toDayNumber(today);
      let best = today;
      let bestScore = Number.POSITIVE_INFINITY;
      for (let y = ty - 1; y <= ty + 1; y += 1) {
        const candidate = clampedDayOfMonth(y, expr.month, 1);
        const score = Math.abs(toDayNumber(candidate) - ref);
        if (score <= bestScore) {
          best = candidate;
          bestScore = score;
        }
      }
      return best;
    }
    default:
      return resolveMainDate(expr, today, null);
  }
}

/** End bound ("hasta …"), never before `start` when the year is implicit. */
function resolveEndBound(expr: DateExpr, start: ISODate): ISODate {
  switch (expr.type) {
    case "fixed":
      return expr.date;
    case "text":
      return parseDateInput(expr.text, start, "on-or-after") ?? start;
    case "weekday":
      return nextWeekday(start, expr.weekday, false);
    case "dom":
      return domOnOrAfter(start, expr.day).date;
    case "month": {
      if (expr.year !== null) return clampedDayOfMonth(expr.year, expr.month, 31);
      const [sy, sm] = ymd(start);
      return clampedDayOfMonth(expr.month >= sm ? sy : sy + 1, expr.month, 31);
    }
    case "year":
      return clampedDayOfMonth(expr.year, 12, 31);
  }
}

function recurrenceOf(
  frequency: RecurrenceFrequency,
  startDate: ISODate,
  anchor: ISODate | undefined,
  interval?: number,
): FinancialRecurrence {
  const rule: FinancialRecurrence = { frequency, startDate };
  if (anchor !== undefined) rule.anchorDate = anchor;
  // "Cada N días / meses" (the editor's same model: schedule-ui.ts).
  if (interval !== undefined && interval > 1 && (frequency === "daily" || frequency === "monthly")) {
    rule.interval = interval;
  }
  return rule;
}

/** Last occurrence of `rule` in [startDate, bound], or null. Only the last ~2 months are expanded. */
function lastOccurrenceOnOrBefore(rule: FinancialRecurrence, bound: ISODate): ISODate | null {
  if (bound < rule.startDate) return null;
  const lookBack = addDays(bound, -62);
  const from = lookBack > rule.startDate ? lookBack : rule.startDate;
  const dates = expandRecurrence(rule, { from, to: bound });
  return dates.length > 0 ? dates[dates.length - 1]! : null;
}

type Duration = { unit: "months" | "days" | "payments"; n: number };

function endFromDuration(rule: FinancialRecurrence, duration: Duration): ISODate {
  const start = rule.startDate;
  if (duration.unit === "payments") {
    const dates = expandRecurrence(rule, { from: start, to: addDays(start, duration.n * 32 + 31) });
    const index = Math.min(duration.n, dates.length) - 1;
    return index >= 0 ? dates[index]! : start;
  }
  const bound =
    duration.unit === "months"
      ? addDays(addMonths(start, duration.n), -1)
      : addDays(start, duration.n - 1);
  return lastOccurrenceOnOrBefore(rule, bound) ?? bound;
}

// ---------------------------------------------------------------------------
// Amounts

interface AmountHit {
  value: number;
  start: number;
  end: number;
}

function readAmount(w: Words, i: number): AmountHit | null {
  const t = w.at(i);
  if (t === "") return null;
  let value: number;
  let end = i + 1;
  if (t === "medio" && w.at(i + 1) === "millon") {
    value = 500_000;
    end = i + 2;
  } else if (t === "mil") {
    value = 1000;
  } else {
    const parsed = parseAmountToken(t);
    const next = w.at(i + 1);
    if (parsed !== null) {
      value = parsed;
    } else {
      const word = NUMBER_WORDS[t];
      if (word === undefined || (next !== "mil" && next !== "millon" && next !== "millones")) return null;
      value = word;
    }
    if (next === "mil") {
      value *= 1000;
      end += 1;
      // "8 mil 500" → 8500
      if (/^\d{1,3}$/.test(w.at(end))) {
        value += Number(w.at(end));
        end += 1;
      }
    } else if (next === "k") {
      value *= 1000;
      end += 1;
    } else if (next === "millon" || next === "millones") {
      value *= 1_000_000;
      end += 1;
    }
  }
  if (CURRENCY.has(w.at(end))) end += 1;
  return { value: roundCents(value), start: i, end };
}

// ---------------------------------------------------------------------------
// Cards

interface CardInfo {
  id: string;
  name: string;
  words: string[];
}

function cardsOf(doc: FinancialDocument | undefined): CardInfo[] {
  const out: CardInfo[] = [];
  if (!doc || !Array.isArray(doc.items)) return out;
  for (const item of doc.items) {
    if (item.kind !== "credit-card" || typeof item.name !== "string") continue;
    const words = fold(item.name)
      .split(/[^a-z0-9]+/)
      .filter((word) => word !== "" && !GENERIC_CARD_NAME_WORDS.has(word));
    if (words.length > 0) out.push({ id: item.id, name: item.name, words });
  }
  return out;
}

function matchCardName(w: Words, j: number, cards: CardInfo[]): { id: string; end: number } | null {
  for (const card of cards) {
    if (card.words.every((word, k) => w.at(j + k) === word)) {
      return { id: card.id, end: j + card.words.length };
    }
  }
  return null;
}

/**
 * A card reference at `i`: "con [la] tarjeta [nu]", "en bbva", "cargo a la
 * tarjeta"; with `allowBare`, also "tarjeta bbva" / "bbva". `cardId` null =
 * a card was named generically ("con tarjeta").
 */
function cardRefAt(
  w: Words,
  i: number,
  cards: CardInfo[],
  allowBare: boolean,
): { cardId: string | null; end: number } | null {
  let j = i;
  let prep = false;
  if (CARD_PREPS.has(w.at(j))) {
    prep = true;
    j += 1;
    while (CARD_ARTICLES.has(w.at(j))) j += 1;
  }
  let generic = false;
  if (CARD_WORDS.has(w.at(j))) {
    generic = true;
    j += 1;
    if (w.at(j) === "de" && w.at(j + 1) === "credito") j += 2;
    else if (w.at(j) === "credito") j += 1;
  }
  if (prep || generic || allowBare) {
    const named = matchCardName(w, j, cards);
    if (named) return { cardId: named.id, end: named.end };
  }
  if (generic && (prep || allowBare)) return { cardId: null, end: j };
  return null;
}

/** Index of the previous token, skipping articles / "de" / "a". */
function previousContent(w: Words, i: number): string {
  let k = i - 1;
  while (k >= 0 && CARD_ARTICLES.has(w.at(k))) k -= 1;
  if (w.at(k) === "de") k -= 1;
  return w.at(k);
}

// ---------------------------------------------------------------------------
// Kind detection (non-consuming pre-pass: later passes depend on the kind)

interface KindIntent {
  kind: FinancialItemKind;
  /** Any kind hint was found ("tipo" is assumed otherwise). */
  hinted: boolean;
  oneOff: boolean;
}

function detectKind(w: Words, cards: CardInfo[]): KindIntent {
  let msi = false;
  let loan = false;
  let cardRef = false;
  let cardCreate = false;
  let verbKind: "income" | "expense" | null = null;
  let nounKind: "income" | "expense" | null = null;
  let oneOff = false;
  for (let i = 0; i < w.length; i += 1) {
    const t = w.at(i);
    if (t.replace(/\./g, "") === "msi" || (t === "sin" && /^interes(es)?$/.test(w.at(i + 1)))) msi = true;
    const cardCredit = t === "credito" && (CARD_WORDS.has(w.at(i - 1)) || (w.at(i - 1) === "de" && CARD_WORDS.has(w.at(i - 2))));
    if ((LOAN_WORDS.has(t) && !cardCredit) || LOAN_NOUNS.has(t)) loan = true;
    if (CARD_PREPS.has(t) && !PAY_VERBS.has(w.at(i - 1)) && cardRefAt(w, i, cards, false) !== null) cardRef = true;
    if (CARD_WORDS.has(t) && !CARD_PREPS.has(previousContent(w, i)) && !PAY_VERBS.has(previousContent(w, i))) {
      cardCreate = true;
    }
    if (verbKind === null) {
      if (t === "me" && INCOME_ME_VERBS.has(w.at(i + 1))) verbKind = "income";
      else if (t === "me" && EXPENSE_ME_VERBS.has(w.at(i + 1))) verbKind = "expense";
      else if (INCOME_VERBS.has(t)) verbKind = "income";
      else if (EXPENSE_VERBS.has(t) && w.at(i - 1) !== "me") verbKind = "expense";
    }
    if (nounKind === null) {
      if (INCOME_NOUNS.has(t)) nounKind = "income";
      else if (EXPENSE_NOUNS.has(t)) nounKind = "expense";
    }
    if (ONE_OFF_NOUNS.has(t)) oneOff = true;
  }
  let kind: FinancialItemKind;
  let hinted = true;
  if (msi) kind = "installment-plan";
  else if (loan) kind = "loan";
  else if (cardRef && verbKind !== "income") kind = "card-purchase";
  else if (cardCreate) kind = "credit-card";
  else if (verbKind !== null) kind = verbKind;
  else if (nounKind !== null) kind = nounKind;
  else {
    kind = "expense";
    hinted = false;
  }
  return { kind, hinted, oneOff };
}

// ---------------------------------------------------------------------------
// Parser

/** Spanish sentence → draft item, or null when no amount can be found. Never throws. */
export function parseCommand(text: string, ctx: CommandContext): ParsedCommand | null {
  try {
    return parseCommandUnsafe(text, ctx);
  } catch {
    return null;
  }
}

function parseCommandUnsafe(text: string, ctx: CommandContext): ParsedCommand | null {
  if (typeof text !== "string" || !ctx || !isISODate(ctx.today)) return null;
  const today = ctx.today;
  const doc = ctx.doc;
  const w = new Words(tokenize(text));
  if (w.length === 0) return null;
  const cards = cardsOf(doc);
  const intent = detectKind(w, cards);
  const kind = intent.kind;

  // 1. MSI: "12 msi", "a 12 msi", "msi 12", "12 meses sin intereses"; "llevo 3".
  let msiTotal: number | null = null;
  let msiPaid: number | null = null;
  for (let i = 0; i < w.length; i += 1) {
    const t = w.at(i);
    if (t !== "" && t.replace(/\./g, "") === "msi") {
      let from = i;
      let to = i + 1;
      const prev = smallInt(w.at(i - 1));
      const next = smallInt(w.at(i + 1));
      if (prev !== null && prev > 0 && prev <= 60) {
        msiTotal ??= prev;
        from = w.at(i - 2) === "a" ? i - 2 : i - 1;
      } else if (next !== null && next > 0 && next <= 60) {
        msiTotal ??= next;
        to = i + 2;
      }
      w.use(from, to);
    } else if (t === "sin" && /^interes(es)?$/.test(w.at(i + 1))) {
      let from = i;
      if (w.at(i - 1) === "meses" || w.at(i - 1) === "mes") {
        const n = smallInt(w.at(i - 2));
        if (n !== null && n > 0 && n <= 60) {
          msiTotal ??= n;
          from = w.at(i - 3) === "a" ? i - 3 : i - 2;
        } else {
          from = i - 1;
        }
      }
      w.use(from, i + 2);
    }
  }
  if (kind === "installment-plan") {
    for (let i = 0; i < w.length; i += 1) {
      const t = w.at(i);
      let at = -1;
      let from = i;
      if (t === "llevo" || t === "van") at = i + 1;
      else if (t === "ya" && /^pague$|^pagado$/.test(w.at(i + 1))) at = i + 2;
      else if (smallInt(t) !== null && /^pagad[oa]s$/.test(w.at(i + 1))) at = i;
      if (at < 0) continue;
      const n = smallInt(w.at(at));
      if (n === null) continue;
      msiPaid ??= n;
      let to = at + 1;
      if (/^(pagad[oa]s|pagos|meses|mensualidades)$/.test(w.at(to))) to += 1;
      if (at === i) from = i;
      w.use(from, to);
    }
  }

  // 2. Rate: "al 99.9%", "45% anual", "tasa 45", "99.9 por ciento".
  let rate: number | null = null;
  for (let i = 0; i < w.length; i += 1) {
    const t = w.at(i);
    if (t === "") continue;
    let value: number | null = null;
    let to = i + 1;
    const percent = /^(\d+(?:[.,]\d+)?)%$/.exec(t);
    if (percent) {
      value = parseDecimal(percent[1]!);
    } else if (parseDecimal(t) !== null && w.at(i + 1) === "%") {
      value = parseDecimal(t);
      to = i + 2;
    } else if (parseDecimal(t) !== null && w.at(i + 1) === "por" && w.at(i + 2) === "ciento") {
      value = parseDecimal(t);
      to = i + 3;
    } else if (RATE_WORDS.has(t)) {
      let j = i + 1;
      while (w.at(j) === "de" || w.at(j) === "del" || w.at(j) === "al" || w.at(j) === "anual") j += 1;
      const m = /^(\d+(?:[.,]\d+)?)%?$/.exec(w.at(j));
      if (m) {
        value = parseDecimal(m[1]!);
        to = j + 1;
        if (w.at(to) === "%") to += 1;
      }
    }
    if (value === null || !(value > 0 && value <= 1000)) continue;
    let from = i;
    for (let steps = 0; steps < 3 && RATE_PREFIXES.has(w.at(from - 1)); steps += 1) from -= 1;
    while (RATE_SUFFIXES.has(w.at(to))) to += 1;
    if (w.at(to) === "de" && w.at(to + 1) === "interes") to += 2;
    rate ??= value;
    w.use(from, to);
    i = to - 1;
  }

  // 3. Card details (only when creating a card): "corte 15", "pago el 26", "mínimo 1500".
  let cutDay: number | null = null;
  let dueDay: number | null = null;
  let minimumPayment: number | null = null;
  if (kind === "credit-card") {
    for (let i = 0; i < w.length; i += 1) {
      const t = w.at(i);
      if (t === "minimo") {
        let j = i + 1;
        if (w.at(j) === "de") j += 1;
        const amount = readAmount(w, j);
        if (amount) {
          minimumPayment ??= amount.value;
          w.use(w.at(i - 1) === "pago" ? i - 1 : i, amount.end);
          i = amount.end - 1;
        }
        continue;
      }
      const isCut = t === "corte" || t === "corta" || t === "cortan";
      const isDue = /^(pago|paga|pagar|vence|vencimiento|limite)$/.test(t);
      if (!isCut && !isDue) continue;
      let j = i + 1;
      while (/^(de|pago|el|dia|los)$/.test(w.at(j))) j += 1;
      const day = plainDay(w.at(j));
      if (day === null || AMOUNT_UNITS.has(w.at(j + 1))) continue;
      if (isCut) cutDay ??= day;
      else dueDay ??= day;
      let from = i;
      if (w.at(i - 1) === "de" && w.at(i - 2) === "fecha") from = i - 2;
      else if (w.at(i - 1) === "fecha") from = i - 1;
      w.use(from, j + 1);
      i = j;
    }
  }

  // 4a. "cada N días|semanas|meses" — any N, like the editor's "Cada [N]
  //     [días | meses]". Colloquial MX ones keep their meaning: "cada 8 días"
  //     is weekly, "cada 15 días" the quincena, "cada 30 días" monthly.
  let freq: RecurrenceFrequency | null = null;
  let freqInterval: number | undefined;
  let unsupportedPeriod = false;
  for (let i = 0; i < w.length; i += 1) {
    if (w.at(i) !== "cada") continue;
    const n = smallInt(w.at(i + 1));
    if (n === null) continue;
    const unit = w.at(i + 2);
    let f: RecurrenceFrequency | null;
    let every: number | undefined;
    if (unit === "dias" || unit === "dia") {
      f = n === 7 || n === 8 ? "weekly" : n === 14 ? "biweekly" : n === 15 ? "semimonthly" : n >= 28 && n <= 31 ? "monthly" : n >= 1 ? "daily" : null;
      if (f === "daily") every = n;
    } else if (unit === "semanas" || unit === "semana") {
      f = n === 1 ? "weekly" : n === 2 ? "biweekly" : n >= 3 ? "daily" : null;
      if (f === "daily") every = n * 7;
    } else if (unit === "meses" || unit === "mes") {
      f = n >= 1 ? "monthly" : null;
      if (n > 1) every = n;
    } else if (unit === "quincenas" || unit === "quincena") {
      f = n === 1 ? "semimonthly" : null;
    } else {
      continue;
    }
    // Unsupported periods ("cada 2 quincenas") are consumed but leave the frequency to the defaults.
    if (f !== null) {
      if (freq === null) {
        freq = f;
        freqInterval = every;
      }
    } else unsupportedPeriod = true;
    w.use(i, i + 3);
  }

  // 5. Relative dates: "en 3 días", "dentro de 2 semanas", "en un mes".
  let dateExpr: DateExpr | null = null;
  for (let i = 0; i < w.length; i += 1) {
    const t = w.at(i);
    let j: number;
    if (t === "en") j = i + 1;
    else if (t === "dentro" && w.at(i + 1) === "de") j = i + 2;
    else continue;
    const n = smallInt(w.at(j));
    if (n === null) continue;
    const unit = w.at(j + 1);
    let date: ISODate;
    if (unit === "dias" || unit === "dia") date = addDays(today, n);
    else if (unit === "semanas" || unit === "semana") date = addDays(today, 7 * n);
    else if (unit === "meses" || unit === "mes") date = addMonths(today, n);
    else if (unit === "anos" || unit === "ano") date = addMonths(today, 12 * n);
    else continue;
    dateExpr ??= { type: "fixed", date };
    w.use(i, j + 2);
  }

  // 6. Durations / payment counts: "6 meses", "2 años", "12 pagos", "6 quincenas".
  let duration: Duration | null = null;
  let durationFreq: RecurrenceFrequency | null = null;
  for (let i = 0; i < w.length; i += 1) {
    const n = smallInt(w.at(i));
    if (n === null || n <= 0 || n > 360) continue;
    const unit = w.at(i + 1);
    const plural = unit.endsWith("s") || n === 1;
    let d: Duration | null = null;
    let hint: RecurrenceFrequency | null = null;
    if (unit === "meses" || (unit === "mes" && n === 1)) d = { unit: "months", n };
    else if (unit === "anos" || (unit === "ano" && n === 1)) d = { unit: "months", n: 12 * n };
    else if (unit === "semanas" || (unit === "semana" && n === 1)) d = { unit: "days", n: 7 * n };
    else if ((unit === "quincenas" || unit === "quincena") && plural) {
      d = { unit: "payments", n };
      hint = "semimonthly";
    } else if ((unit === "catorcenas" || unit === "catorcena") && plural) {
      d = { unit: "payments", n };
      hint = "biweekly";
    } else if (PAYMENT_UNITS.has(unit)) {
      d = { unit: "payments", n };
      if (unit === "mensualidades") hint = "monthly";
    }
    if (d === null) continue;
    if (duration === null) {
      duration = d;
      durationFreq = hint;
    }
    w.use(DURATION_PREFIXES.has(w.at(i - 1)) ? i - 1 : i, i + 2);
    i += 1;
  }

  // 4b. Frequency words: quincenal, mensual, semanal, catorcenal, "cada mes",
  //     "a la semana", "una vez", "15 y 30".
  for (let i = 0; i < w.length; i += 1) {
    const t = w.at(i);
    if (t === "") continue;
    let f: RecurrenceFrequency | null = null;
    let from = i;
    let to = i + 1;
    const perStart = (): number => {
      const prev = w.at(i - 1);
      if (prev === "la") return PER_PREFIXES.has(w.at(i - 2)) ? i - 2 : i - 1;
      return PER_PREFIXES.has(prev) ? i - 1 : i;
    };
    if (SEMIMONTHLY_ADJ.has(t)) f = "semimonthly";
    else if (MONTHS_ADJ.has(t)) {
      f = "monthly";
      if (freq === null) freqInterval = MONTHS_ADJ.get(t);
    } else if (MONTHLY_ADJ.has(t)) f = "monthly";
    else if (WEEKLY_ADJ.has(t)) f = "weekly";
    else if (BIWEEKLY_ADJ.has(t)) f = "biweekly";
    else if (t === "quincena" || t === "catorcena") {
      f = t === "quincena" ? "semimonthly" : "biweekly";
      from = perStart();
    } else if (t === "mes" || t === "semana") {
      from = perStart();
      if (from === i) continue;
      f = t === "mes" ? "monthly" : "weekly";
    } else if (t === "vez" && w.at(i - 1) === "una") {
      f = "once";
      from = w.at(i - 2) === "solo" ? i - 2 : i - 1;
    } else if (t === "unico" || t === "unica") {
      f = "once";
    } else if (plainDay(t) === 15 && w.at(i + 1) === "y") {
      let j = i + 2;
      while (w.at(j) === "el" || w.at(j) === "los") j += 1;
      const second = w.at(j);
      if (second === "30" || second === "31" || second === "ultimo") to = j + 1;
      else if (second === "fin" && (w.at(j + 1) === "de" || w.at(j + 1) === "del") && w.at(j + 2) === "mes") to = j + 3;
      else continue;
      if (w.at(to) === "dia") to += 1;
      f = "semimonthly";
      while (/^(el|los|dia|dias)$/.test(w.at(from - 1))) from -= 1;
    }
    if (f === null) continue;
    freq ??= f;
    w.use(from, to);
    i = to - 1;
  }

  // 7. Dates: desde / hasta / weekdays / day-of-month / specific dates.
  let startExpr: DateExpr | null = null;
  let endExpr: DateExpr | null = null;
  let weekdayFreq = false;
  for (let i = 0; i < w.length; i += 1) {
    const t = w.at(i);
    if (t === "") continue;
    let after = -1;
    if (START_WORDS.has(t)) {
      after = i + 1;
      if (w.at(after) === "desde" || w.at(after) === "en") after += 1;
    } else if (t === "a" && w.at(i + 1) === "partir") {
      after = i + 2;
      if (w.at(after) === "de" || w.at(after) === "del") after += 1;
    }
    if (after >= 0) {
      const hit = readDate(w, after, "bound", today);
      if (hit) {
        startExpr ??= hit.expr;
        w.use(i, hit.end);
        i = hit.end - 1;
        continue;
      }
    }
    if (END_WORDS.has(t)) {
      const hit = readDate(w, w.at(i + 1) === "en" ? i + 2 : i + 1, "bound", today);
      if (hit) {
        endExpr ??= hit.expr;
        w.use(i, hit.end);
        i = hit.end - 1;
        continue;
      }
    }
    if (t === "cada" || t === "los" || (t === "todos" && w.at(i + 1) === "los")) {
      const j = t === "todos" ? i + 2 : i + 1;
      const weekday = weekdayOf(w.at(j));
      if (weekday >= 0) {
        weekdayFreq = true;
        dateExpr ??= { type: "weekday", weekday };
        w.use(i, j + 1);
        i = j;
        continue;
      }
    }
    if (t === "en") {
      const month = monthOf(w.at(i + 1));
      if (month > 0 && plainDay(w.at(i + 2)) === null) {
        let end = i + 2;
        let year: number | null = null;
        if (/^\d{4}$/.test(w.at(end))) {
          year = Number(w.at(end));
          end += 1;
        }
        dateExpr ??= { type: "month", month, year };
        w.use(i, end);
        i = end - 1;
        continue;
      }
    }
    const hit = readDate(w, i, "main", today);
    if (hit) {
      dateExpr ??= hit.expr;
      w.use(i, hit.end);
      i = hit.end - 1;
    }
  }

  // 8. Kind words and card references (consumed so they stay out of the name).
  let matchedCardId: string | null = null;
  let kindNamed = kind === "installment-plan";
  for (let i = 0; i < w.length; i += 1) {
    const t = w.at(i);
    if (t === "") continue;
    if (t === "me" && (INCOME_ME_VERBS.has(w.at(i + 1)) || EXPENSE_ME_VERBS.has(w.at(i + 1)))) {
      w.use(i, i + 2);
      i += 1;
      continue;
    }
    if (INCOME_VERBS.has(t) || EXPENSE_VERBS.has(t) || (kind === "loan" && LOAN_WORDS.has(t))) {
      if (KIND_NAMING_WORDS.has(t)) kindNamed = true;
      w.use(i, i + 1);
      continue;
    }
    if (kind === "credit-card" && CARD_WORDS.has(t)) {
      kindNamed = true;
      let to = i + 1;
      if (w.at(to) === "de" && w.at(to + 1) === "credito") to += 2;
      else if (w.at(to) === "credito") to += 1;
      w.use(i, to);
      i = to - 1;
      continue;
    }
    if (kind === "card-purchase" || kind === "installment-plan") {
      const ref = cardRefAt(w, i, cards, kind === "installment-plan");
      if (ref) {
        if (ref.cardId !== null) matchedCardId ??= ref.cardId;
        w.use(i, ref.end);
        i = ref.end - 1;
      }
    }
  }

  // 9. Amounts: the largest wins (a loan's second amount is its payment).
  const hits: AmountHit[] = [];
  for (let i = 0; i < w.length; i += 1) {
    const hit = readAmount(w, i);
    if (!hit) continue;
    if (hit.value > 0) hits.push(hit);
    i = hit.end - 1;
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => b.value - a.value);
  const main = hits[0]!;
  w.use(main.start, main.end);
  let loanBalance: number | null = null;
  let amount = main.value;
  if (kind === "loan" && hits.length > 1) {
    const second = hits[1]!;
    if (second.value >= 100 && second.value < main.value) {
      loanBalance = main.value;
      amount = second.value;
      w.use(second.start, second.end);
    }
  }
  // A card's smaller amount is what you pay each month ("tarjeta nu 20000
  // pago 2000 al mes"); "totalero" / "pago el total" pays each statement.
  let cardPayment: number | null = null;
  let cardStatement = false;
  if (kind === "credit-card") {
    if (hits.length > 1) {
      const second = hits[1]!;
      if (second.value > 0 && second.value < main.value) {
        cardPayment = second.value;
        w.use(second.start, second.end);
      }
    }
    for (let i = 0; i < w.length; i += 1) {
      const t = w.at(i);
      if (t === "totalero" || t === "totalera" || (t === "total" && /^(el|pago|pagar|todo)$/.test(w.at(i - 1)))) {
        cardStatement = true;
        w.use(t === "total" && w.at(i - 1) === "el" && /^(pago|pagar)$/.test(w.at(i - 2)) ? i - 2 : i, i + 1);
      }
    }
  }

  // 10. Name: what is left, edge stopwords trimmed.
  const nameWords = w.remaining().filter((tok) => /[\p{L}\p{N}]/u.test(tok.norm) && !CURRENCY.has(tok.norm));
  let a = 0;
  let b = nameWords.length;
  while (a < b && STOPWORDS.has(nameWords[a]!.norm)) a += 1;
  while (b > a && STOPWORDS.has(nameWords[b - 1]!.norm)) b -= 1;
  const said = nameWords
    .slice(a, b)
    .map((tok) => tok.raw)
    .join(" ");
  const name = said === "" ? KIND_LABELS[kind] : said.charAt(0).toLocaleUpperCase("es-MX") + said.slice(1);

  // Frequency.
  const assumed: string[] = [];
  const assume = (field: string): void => {
    if (!assumed.includes(field)) assumed.push(field);
  };
  if (!intent.hinted) assume("tipo");
  if (said === "" && !kindNamed) assume("nombre");

  let frequency: RecurrenceFrequency;
  let interval: number | undefined;
  if (kind === "credit-card" || kind === "installment-plan") frequency = "monthly";
  else if (freq !== null) {
    frequency = freq;
    interval = freqInterval;
  }
  else if (durationFreq !== null) frequency = durationFreq;
  else if (weekdayFreq) frequency = "weekly";
  else if (kind === "loan") {
    frequency = "monthly";
    assume("frecuencia");
  } else if (dateExpr?.type === "dom") frequency = "monthly";
  else if (dateExpr !== null || intent.oneOff) frequency = "once";
  else if (kind === "income") {
    frequency = "monthly";
    assume("frecuencia");
  } else frequency = "once";
  if (freq === null && unsupportedPeriod) assume("frecuencia");

  // Start date (+ anchor).
  const startBound = startExpr !== null ? resolveStartBound(startExpr, today) : null;
  let startDate: ISODate;
  let anchor: ISODate | undefined;
  if (dateExpr !== null && dateExpr.type === "dom") {
    const first = domOnOrAfter(startBound ?? today, dateExpr.day);
    startDate = first.date;
    anchor = first.anchor;
  } else if (dateExpr !== null) {
    const date = resolveMainDate(dateExpr, today, startBound);
    if (startBound !== null && frequency !== "once" && startBound < date) {
      startDate = startBound;
      anchor = date;
    } else {
      startDate = date;
    }
  } else if (startBound !== null) {
    startDate = startBound;
  } else if (kind === "installment-plan") {
    // The purchase is today; the engine pays the installments on the
    // card's payment days from there (same as the editor's draft).
    startDate = today;
    assume("fecha");
  } else {
    startDate = today;
    if (frequency !== "semimonthly" && kind !== "credit-card") assume("fecha");
  }

  // End date.
  let endDate: ISODate | undefined;
  if (kind !== "credit-card" && kind !== "installment-plan") {
    const rule = recurrenceOf(frequency, startDate, anchor, interval);
    if (frequency === "once") {
      endDate = startDate;
    } else if (duration !== null) {
      endDate = endFromDuration(rule, duration);
    } else if (endExpr !== null) {
      const bound = resolveEndBound(endExpr, startDate);
      endDate = lastOccurrenceOnOrBefore(rule, bound) ?? bound;
    } else if (kind === "loan") {
      endDate = addMonths(startDate, 12);
      assume("plazo");
    }
  }
  const recurrence = recurrenceOf(frequency, startDate, anchor, interval);
  if (endDate !== undefined) recurrence.endDate = endDate;

  // Item.
  const base = createDefaultFinancialItem(kind, DRAFT_ID, startDate, doc);
  let item: FinancialItem;
  switch (base.kind) {
    case "income":
    case "expense":
      item = { ...base, name, amount, recurrence };
      break;
    case "card-purchase": {
      const cardId = matchedCardId ?? base.cardId;
      if (matchedCardId === null) assume("tarjeta");
      item = { ...base, name, amount, cardId, recurrence };
      break;
    }
    case "loan": {
      item = { ...base, name, paymentAmount: amount, recurrence };
      if (loanBalance !== null) item.balance = loanBalance;
      if (rate !== null) item.annualRate = rate;
      break;
    }
    case "credit-card": {
      if (rate === null) assume("tasa");
      if (cutDay === null) assume("día de corte");
      if (dueDay === null) assume("día de pago");
      const cut = cutDay ?? base.cutDay;
      item = {
        ...base,
        name,
        balance: amount,
        annualRate: rate ?? base.annualRate,
        cutDay: cut,
        dueDay: dueDay ?? (cutDay !== null ? ((cut + 10 - 1) % 28) + 1 : base.dueDay),
        minimumPayment: minimumPayment ?? base.minimumPayment,
      };
      if (cardStatement) item.paymentMode = "statement";
      else if (cardPayment !== null) item.paymentAmount = cardPayment;
      break;
    }
    case "installment-plan": {
      if (msiTotal === null) assume("meses");
      const total = msiTotal ?? base.installmentsTotal;
      const paid = Math.min(Math.max(msiPaid ?? 0, 0), Math.max(total - 1, 0));
      item = {
        ...base,
        name,
        originalAmount: amount,
        installmentsTotal: total,
        installmentsPaid: paid,
        recurrence: recurrenceOf("monthly", startDate, anchor),
      };
      if (matchedCardId !== null) item.cardId = matchedCardId;
      else if (item.cardId !== undefined) assume("tarjeta");
      break;
    }
  }

  return { item, summary: summarize(item, today, cards, doc), assumed };
}

/** What a fixed-payment card pays each month (the engine's `paymentAmount ?? minimumPayment`). */
export function cardMonthlyPayment(card: Extract<FinancialItem, { kind: "credit-card" }>): number {
  const value = card.paymentAmount ?? card.minimumPayment;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * UX-01 (same rule as the editor): a card with a balance that pays $0 a
 * month never gets paid off — the projection would assume it is never paid.
 * True for a fixed-payment card with balance > 0 and no payment.
 */
export function cardNeverPaidOff(item: FinancialItem): boolean {
  return (
    item.kind === "credit-card" &&
    item.paymentMode !== "statement" &&
    item.balance > 0 &&
    cardMonthlyPayment(item) <= 0
  );
}

/**
 * Day the engine pays an MSI plan's first installment: the card's payment
 * day on/after the purchase (the anchor's day without a card), never before
 * the plan's start. Same rule as the projection (payoff.ts installmentInput).
 */
export function firstInstallmentDate(
  item: Extract<FinancialItem, { kind: "installment-plan" }>,
  doc: FinancialDocument | undefined,
): ISODate {
  const rec = item.recurrence;
  const from = doc && isISODate(doc.startDate) && doc.startDate > rec.startDate ? doc.startDate : rec.startDate;
  const card = item.cardId
    ? doc?.items.find((other) => other.kind === "credit-card" && other.id === item.cardId)
    : undefined;
  const day =
    card && card.kind === "credit-card"
      ? card.dueDay
      : ymd(rec.anchorDate !== undefined && isISODate(rec.anchorDate) ? rec.anchorDate : rec.startDate)[2];
  return domOnOrAfter(from, Math.min(31, Math.max(1, Math.floor(day)))).date;
}

// ---------------------------------------------------------------------------
// Intent (UX-05): not every sentence is a new item. "tengo 11400 en el
// banco" is today's balance, "pagué la tarjeta nu 3000" pays a card, "gasté
// 300 en uber ayer" already happened, and a sentence whose kind was only
// guessed must not be added without a choice.

/** What the sentence asks for. */
export type CommandIntent =
  /** Today's real cash ("tengo / me quedan / saldo / en el banco" + amount). */
  | { type: "balance"; amount: number }
  /** A payment to a card of the plan, today or in the past. */
  | { type: "card-payment"; cardId: string; cardName: string; amount: number; date: ISODate }
  /**
   * A new item. `past`: a one-off dated before today (today's cash should
   * already include it). `needsKind`: the kind was only guessed ("tipo").
   */
  | { type: "item"; parsed: ParsedCommand; past: boolean; needsKind: boolean };

const BALANCE_WORDS = new Set([
  "tengo", "tenemos", "traigo", "quedan", "queda", "saldo", "banco", "cuenta",
  "liquidez", "efectivo", "disponible",
]);
/** Words that make a balance-looking sentence something else. */
const NOT_BALANCE_WORDS = new Set([
  ...CARD_WORDS, ...LOAN_WORDS, ...LOAN_NOUNS, "msi", "que",
  ...SEMIMONTHLY_ADJ, ...MONTHLY_ADJ, ...WEEKLY_ADJ, ...BIWEEKLY_ADJ,
]);
const PAID_VERBS = new Set([...PAY_VERBS, "abone", "pagamos", "abonamos", "liquide"]);
/** Before a card name, these make it a purchase ("con nu"), not a payment. */
const PURCHASE_PREPS = new Set(["con", "en", "cargo", "cargar", "cargado", "cargada"]);

function amountsOf(w: Words): number[] {
  const out: number[] = [];
  for (let i = 0; i < w.length; i += 1) {
    const hit = readAmount(w, i);
    if (!hit) continue;
    if (hit.value > 0) out.push(hit.value);
    i = hit.end - 1;
  }
  return out;
}

function isBalanceSentence(w: Words, cards: CardInfo[]): boolean {
  let balanceWord = false;
  for (let i = 0; i < w.length; i += 1) {
    const t = w.at(i);
    if (NOT_BALANCE_WORDS.has(t) || INCOME_NOUNS.has(t) || EXPENSE_NOUNS.has(t)) return false;
    if (INCOME_VERBS.has(t) || EXPENSE_VERBS.has(t) || PAID_VERBS.has(t)) return false;
    if (t === "me" && (INCOME_ME_VERBS.has(w.at(i + 1)) || EXPENSE_ME_VERBS.has(w.at(i + 1)))) return false;
    if (BALANCE_WORDS.has(t)) balanceWord = true;
  }
  // "saldo de nu": a card's balance, not today's cash.
  if (cards.some((card) => card.words.some((word) => w.remaining().some((tok) => tok.norm === word)))) {
    return false;
  }
  return balanceWord;
}

/** "pagué la tarjeta nu", "abono a nu", "pago bbva": the card paid, or null. */
function paidCard(w: Words, cards: CardInfo[]): CardInfo | null {
  let paid = false;
  for (let i = 0; i < w.length; i += 1) if (PAID_VERBS.has(w.at(i))) paid = true;
  if (!paid) return null;
  for (let i = 0; i < w.length; i += 1) {
    const named = matchCardName(w, i, cards);
    if (!named) continue;
    let k = i - 1;
    while (k >= 0 && (CARD_ARTICLES.has(w.at(k)) || CARD_WORDS.has(w.at(k)) || w.at(k) === "de" || w.at(k) === "credito")) {
      k -= 1;
    }
    if (PURCHASE_PREPS.has(w.at(k))) return null;
    return cards.find((card) => card.id === named.id) ?? null;
  }
  return null;
}

/**
 * The sentence's intent, or null when it holds no amount (see
 * `explainNoAmount`). Pure and total, like `parseCommand`.
 */
export function interpretCommand(text: string, ctx: CommandContext): CommandIntent | null {
  try {
    if (typeof text !== "string" || !ctx || !isISODate(ctx.today)) return null;
    const w = new Words(tokenize(text));
    if (w.length === 0) return null;
    const cards = cardsOf(ctx.doc);
    const amounts = amountsOf(w);
    if (amounts.length === 0) return null;
    const amount = Math.max(...amounts);

    if (isBalanceSentence(w, cards)) return { type: "balance", amount };

    const parsed = parseCommand(text, ctx);
    if (!parsed) return null;
    const rec = parsed.item.recurrence;
    const once = rec.frequency === "once";

    const card = paidCard(new Words(tokenize(text)), cards);
    if (card && once && rec.startDate <= ctx.today) {
      return { type: "card-payment", cardId: card.id, cardName: card.name, amount, date: rec.startDate };
    }

    const past =
      once &&
      rec.startDate < ctx.today &&
      (parsed.item.kind === "expense" || parsed.item.kind === "income" || parsed.item.kind === "card-purchase");
    return { type: "item", parsed, past, needsKind: parsed.assumed.includes("tipo") };
  } catch {
    return null;
  }
}

/**
 * Why a sentence without an amount does nothing, in the person's terms
 * (UX-45): "deshacer", "borra netflix" or "ayuda" are not movements.
 */
export function explainNoAmount(text: string): string {
  const words = fold(typeof text === "string" ? text : "")
    .split(/[^a-z0-9?]+/)
    .filter(Boolean);
  const has = (...candidates: string[]) => candidates.some((word) => words.includes(word));
  if (has("deshacer", "deshaz", "undo", "regresa", "revertir")) {
    return "Para deshacer usa Ctrl+Z. Aquí solo se agregan movimientos.";
  }
  if (has("borra", "borrar", "elimina", "eliminar", "quita", "quitar", "cancela", "cancelar")) {
    return "Desde aquí solo se agregan movimientos: selecciona el objeto y pulsa Supr.";
  }
  if (has("cambia", "cambiar", "mueve", "mover", "edita", "editar")) {
    return "Para cambiar un objeto, haz doble clic en él. Aquí solo se agregan movimientos.";
  }
  if (has("ayuda", "help", "?", "como", "que")) {
    return "Escribe qué y cuánto: “renta 8000 el 1”, “sueldo 9000 quincenal” o “tengo 11400 en el banco”.";
  }
  return "Falta el monto: “gasolina 600 cada semana”.";
}

// ---------------------------------------------------------------------------
// Summary

function displayDate(date: ISODate, today: ISODate): string {
  return date.slice(0, 4) === today.slice(0, 4) ? formatDateShort(date) : formatDateLong(date);
}

function scheduleParts(rule: FinancialRecurrence, today: ISODate): string[] {
  const start = rule.startDate;
  if (rule.frequency === "once") return [start === today ? "hoy" : `el ${displayDate(start, today)}`];
  const anchor = rule.anchorDate ?? start;
  const parts: string[] = [];
  const every = rule.interval !== undefined && rule.interval > 1 ? rule.interval : 1;
  switch (rule.frequency) {
    case "monthly":
      parts.push(every > 1 ? `cada ${every} meses, día ${ymd(anchor)[2]}` : `cada mes, día ${ymd(anchor)[2]}`);
      break;
    case "daily":
      parts.push(every > 1 ? `cada ${every} días` : "cada día");
      break;
    case "semimonthly":
      parts.push("cada quincena (15 y fin de mes)");
      break;
    case "weekly":
      parts.push(`cada semana, ${WEEKDAY_LABELS[weekdayIndex(anchor)]}`);
      break;
    case "biweekly":
      parts.push(`cada 14 días, ${WEEKDAY_LABELS[weekdayIndex(anchor)]}`);
      break;
  }
  parts.push(start === today ? "desde hoy" : `desde ${displayDate(start, today)}`);
  if (rule.endDate !== undefined) parts.push(`hasta ${displayDate(rule.endDate, today)}`);
  return parts;
}

function summarize(
  item: FinancialItem,
  today: ISODate,
  cards: CardInfo[],
  doc: FinancialDocument | undefined,
): string {
  const parts: string[] = [KIND_LABELS[item.kind]];
  if (fold(item.name) !== fold(KIND_LABELS[item.kind])) parts.push(item.name);
  const cardName = (id: string | undefined): string | null =>
    id === undefined ? null : cards.find((card) => card.id === id)?.name ?? null;
  switch (item.kind) {
    case "income":
    case "expense":
      parts.push(formatMoney(item.amount), ...scheduleParts(item.recurrence, today));
      break;
    case "card-purchase": {
      parts.push(formatMoney(item.amount));
      const card = cardName(item.cardId);
      if (card !== null) parts.push(`con ${card}`);
      parts.push(...scheduleParts(item.recurrence, today));
      break;
    }
    case "loan":
      parts.push(formatMoney(item.paymentAmount));
      if (item.balance !== undefined) parts.push(`saldo ${formatMoney(item.balance)}`);
      if (item.annualRate !== undefined) parts.push(`${formatPercent(item.annualRate)} anual`);
      parts.push(...scheduleParts(item.recurrence, today));
      break;
    case "credit-card": {
      parts.push(`saldo ${formatMoney(item.balance)}`);
      if (item.paymentMode === "statement") parts.push("pagas el total cada mes");
      else {
        parts.push(`${formatPercent(item.annualRate)} anual`);
        const monthly = cardMonthlyPayment(item);
        if (monthly > 0) parts.push(`pagas ${formatMoney(monthly)} al mes`);
      }
      parts.push(`corte día ${item.cutDay}, pago día ${item.dueDay}`);
      break;
    }
    case "installment-plan": {
      parts.push(`${formatMoney(item.originalAmount)} a ${item.installmentsTotal} MSI (${formatMoney(monthlyInstallment(item))}/mes)`);
      if (item.installmentsPaid > 0) parts.push(`${item.installmentsPaid} pagados`);
      const card = cardName(item.cardId);
      if (card !== null) parts.push(`con ${card}`);
      const bought = item.recurrence.startDate;
      parts.push(bought === today ? "compra hoy" : `compra el ${displayDate(bought, today)}`);
      parts.push(`primer abono ${displayDate(firstInstallmentDate(item, doc), today)}`);
      break;
    }
  }
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Ghost completion

/** Ordered by how common the word is: the first match wins. */
const VOCABULARY: ReadonlyArray<string> = [
  "quincenal", "quincena", "mensual", "semanal", "catorcenal", "catorcena",
  "mañana", "pasado mañana", "sueldo", "nómina", "renta", "préstamo", "tarjeta",
  "aguinaldo", "colegiatura", "gasolina", "súper", "supermercado", "semana",
  "meses", "pagos", "mensualidades", "desde", "hasta", "cada",
  "bimestral", "trimestral", "semestral",
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre",
  "lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo",
  "salario", "honorarios", "bono", "venta", "cobro", "recibo", "ingreso",
  "gasto", "compra", "hipoteca", "netflix", "spotify", "internet", "teléfono",
  "celular", "seguro", "mantenimiento", "gimnasio", "despensa", "transporte",
  "estacionamiento", "agua", "predial", "crédito", "anual", "intereses",
];
/** After "cada" / "la" / "por": the noun forms come first ("cada sem" → "semana"). */
const VOCABULARY_AFTER_PER: ReadonlyArray<string> = ["quincena", "semana", "catorcena", "mes"];
const PER_WORDS = new Set(["cada", "la", "por", "x"]);
/** Complete words that are also prefixes of longer entries: never "completed". */
const COMPLETE_WORDS = new Set([
  "mes", "mil", "msi", "gas", "dia", "dias", "pago", "hoy", "luz", "uber", "ano", "anos",
]);
const VOCABULARY_FOLDED = new Set(VOCABULARY.map(fold));

/** Ghost completion for the word being typed (ONLY the missing suffix), or null. */
export function completeCommand(text: string): string | null {
  try {
    if (typeof text !== "string") return null;
    const source = text.normalize("NFC");
    const match = /(\p{L}+)$/u.exec(source);
    if (!match) return null;
    const typed = match[1]!;
    if (typed.length < 3) return null;
    const prefix = fold(typed);
    if (prefix.length !== typed.length) return null;
    if (COMPLETE_WORDS.has(prefix) || VOCABULARY_FOLDED.has(prefix)) return null;
    const before = source.slice(0, match.index);
    const prevWord = fold(/(\p{L}+)\s+$/u.exec(before)?.[1] ?? "");
    const lists = PER_WORDS.has(prevWord) ? [VOCABULARY_AFTER_PER, VOCABULARY] : [VOCABULARY];
    for (const list of lists) {
      for (const entry of list) {
        const folded = fold(entry);
        if (folded.length > prefix.length && folded.startsWith(prefix)) {
          const suffix = entry.slice(typed.length);
          const shouting = typed === typed.toUpperCase() && typed !== typed.toLowerCase();
          return shouting ? suffix.toLocaleUpperCase("es-MX") : suffix;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}
