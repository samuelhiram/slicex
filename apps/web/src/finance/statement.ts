// Paste a bank / card statement → dated movements for a card.
//
// Pure (no DOM, no clock — `today` comes from the caller) and total: any text
// yields an array (possibly empty); nothing throws.
//
// Accepted shapes, line by line (mixable in one paste):
// - plain text: "15/11/2026 OXXO REFORMA 123.45", "15-NOV-2026 AMAZON MX $1,234.56",
//   "15 nov AMAZON 1,234.56", "15 de noviembre de 2026 …", "nov 15 …"; an
//   optional second date (operation + posting date) and a time are skipped;
// - delimited rows (tab, ";", "|", or comma CSV with quotes): the date field
//   can be anywhere ("2026-11-15,Uber,89.00");
// - a header row (Fecha · Concepto|Descripción|Movimiento|Detalle · Cargo ·
//   Abono · Importe|Monto · Saldo · Tipo) maps the columns of the rows below.
// Sign: positive = charge (purchase); negative = payment / abono / credit:
// "-1,500.00", "1,500.00-", "(1,500.00)", "1,500.00 CR", an Abono column, a
// Tipo "abono", or a description with ABONO / PAGO / DEVOLUCIÓN / … (not
// "MERCADO PAGO", a merchant).
// Skipped: lines without a date or an amount, header rows, totals rows
// (SALDO / TOTAL / PAGO MÍNIMO / …), zero amounts.
// Dates without a year take the most recent one ≤ today; 2-digit years are 20xx.
// Judgement calls: with two trailing amounts and no header ("… 123.45
// 5,000.00"), the first is the movement and the second a running balance;
// pure-digit fields of ≥ 5 digits are references, never amounts.
import { daysInMonth, isISODate, type ISODate } from "@slicex/core";

export interface StatementRow {
  date: ISODate;
  description: string;
  /** positive = charge (purchase), negative = payment / abono / credit */
  amount: number;
  raw: string;
}

export interface StatementSummary {
  /** Sum of the charges (positive). */
  charges: number;
  /** Sum of the payments / credits, as a positive magnitude. */
  payments: number;
  /** charges − payments (what the paste adds to the card debt). */
  net: number;
  from: ISODate | null;
  to: ISODate | null;
}

// ---------------------------------------------------------------------------
// Text helpers

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function roundCents(value: number): number {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function unquote(field: string): string {
  const trimmed = field.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"').trim();
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Dates

const ES_MONTHS: ReadonlyArray<string> = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
  "septiembre", "octubre", "noviembre", "diciembre",
];
const EN_MONTHS: ReadonlyArray<string> = [
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
];

/** 1..12 for a Spanish (or English) month name / ≥ 3-letter abbreviation, else 0. */
function monthOf(word: string): number {
  const w = fold(word).replace(/\.$/, "");
  if (w.length < 3 || !/^[a-z]+$/.test(w)) return 0;
  for (let i = 0; i < 12; i += 1) if (ES_MONTHS[i]!.startsWith(w)) return i + 1;
  if ("setiembre".startsWith(w)) return 9;
  for (let i = 0; i < 12; i += 1) if (EN_MONTHS[i]!.startsWith(w)) return i + 1;
  return 0;
}

interface DateParts {
  day: number;
  month: number;
  /** null = not written (inferred from today). */
  year: number | null;
}

const NUM_DMY = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/;
const DOT_DMY = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/;
const NUM_YMD = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/;
const ALPHA_DMY = /^(\d{1,2})[/.-]?([a-z]{3,})\.?(?:[/.-]?(\d{2}|\d{4}))?$/;
const TIME_RE = /^\d{1,2}:\d{2}(:\d{2})?$/;
const MERIDIEM_RE = /^(am|pm|a\.m\.|p\.m\.)$/;

function toYear(token: string | undefined): number | null {
  if (token === undefined) return null;
  return token.length === 2 ? 2000 + Number(token) : Number(token);
}

/** One whitespace-free token as a date ("15/11/2026", "15-NOV-2026", "2026-11-15", "15nov"), else null. */
function parseDateToken(token: string): DateParts | null {
  const t = fold(token).replace(/[,;]$/, "");
  let m = NUM_YMD.exec(t);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  m = NUM_DMY.exec(t) ?? DOT_DMY.exec(t);
  if (m) return { day: Number(m[1]), month: Number(m[2]), year: toYear(m[3]) };
  m = ALPHA_DMY.exec(t);
  if (m) {
    const month = monthOf(m[2]!);
    if (month > 0) return { day: Number(m[1]), month, year: toYear(m[3]) };
  }
  return null;
}

/** Date at `tokens[i]` ("15/11/2026" · "15 nov [2026]" · "15 de noviembre de 2026" · "nov 15 [2026]"). */
function readDate(tokens: ReadonlyArray<string>, i: number): { parts: DateParts; next: number } | null {
  const first = tokens[i];
  if (first === undefined) return null;
  const single = parseDateToken(first);
  if (single) return { parts: single, next: i + 1 };
  const yearAt = (k: number): { year: number | null; next: number } => {
    let j = k;
    if (fold(tokens[j] ?? "") === "de" || fold(tokens[j] ?? "") === "del") j += 1;
    const token = (tokens[j] ?? "").replace(/[,;]$/, "");
    return /^\d{4}$/.test(token) ? { year: Number(token), next: j + 1 } : { year: null, next: k };
  };
  if (/^\d{1,2}$/.test(first)) {
    let k = i + 1;
    if (fold(tokens[k] ?? "") === "de") k += 1;
    const month = monthOf(tokens[k] ?? "");
    if (month > 0) {
      const year = yearAt(k + 1);
      return { parts: { day: Number(first), month, year: year.year }, next: year.next };
    }
    return null;
  }
  const month = monthOf(first);
  const dayToken = (tokens[i + 1] ?? "").replace(/,$/, "");
  if (month > 0 && /^\d{1,2}$/.test(dayToken)) {
    const year = yearAt(i + 2);
    return { parts: { day: Number(dayToken), month, year: year.year }, next: year.next };
  }
  return null;
}

/** ISO date; a missing year takes the most recent occurrence ≤ today. */
function resolveDate(parts: DateParts, today: ISODate): ISODate | null {
  const { day, month, year } = parts;
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null;
  if (year !== null) {
    if (year < 1900 || year > 2199 || day > daysInMonth(year, month)) return null;
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }
  const todayYear = Number(today.slice(0, 4));
  for (let y = todayYear; y >= todayYear - 8; y -= 1) {
    if (day > daysInMonth(y, month)) continue;
    const candidate = `${y}-${pad2(month)}-${pad2(day)}`;
    if (candidate <= today) return candidate;
  }
  return null;
}

/** A whole field that is a date (an optional time after it is allowed). */
function parseDateField(field: string, today: ISODate): ISODate | null {
  const tokens = unquote(field).split(/\s+/).filter((token) => token !== "");
  if (tokens.length === 0) return null;
  const hit = readDate(tokens, 0);
  if (!hit) return null;
  let next = hit.next;
  if (TIME_RE.test(tokens[next] ?? "")) next += 1;
  if (MERIDIEM_RE.test(fold(tokens[next] ?? ""))) next += 1;
  return next === tokens.length ? resolveDate(hit.parts, today) : null;
}

// ---------------------------------------------------------------------------
// Money

interface Money {
  value: number;
  /** Written as a credit ("CR" suffix). */
  credit: boolean;
  /** Looks like money ($, thousands separators or decimals), not a bare integer. */
  moneyLike: boolean;
}

/** "$1,234.56" · "-1,500.00" · "1,500.00-" · "(1,500.00)" · "1,500.00CR" · "1.234,56" · "89" → Money, else null. */
function parseMoney(field: string): Money | null {
  let s = fold(unquote(field)).replace(/\s+/g, "");
  if (s === "") return null;
  let negative = false;
  let credit = false;
  let dollar = false;
  for (let guard = 0; guard < 4; guard += 1) {
    if (s.endsWith("cr")) {
      credit = true;
      s = s.slice(0, -2);
    } else if (s.endsWith("mxn")) {
      s = s.slice(0, -3);
    } else if (s.startsWith("mxn")) {
      s = s.slice(3);
    } else {
      break;
    }
  }
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (/^[-−–]/.test(s)) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (s.startsWith("$")) {
    dollar = true;
    s = s.slice(1);
  }
  if (/^[-−–]/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  if (/[-−–]$/.test(s)) {
    negative = true;
    s = s.slice(0, -1);
  }
  let body: string;
  let moneyLike = dollar;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) {
    body = s.replace(/,/g, "");
    moneyLike = true;
  } else if (/^\d*\.\d+$/.test(s)) {
    body = s;
    moneyLike = true;
  } else if (/^\d+$/.test(s)) {
    body = s;
  } else if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) {
    body = s.replace(/\./g, "").replace(",", ".");
    moneyLike = true;
  } else if (/^\d+,\d{2}$/.test(s)) {
    body = s.replace(",", ".");
    moneyLike = true;
  } else {
    return null;
  }
  const magnitude = Number(body);
  if (!Number.isFinite(magnitude)) return null;
  return { value: roundCents(negative ? -magnitude : magnitude), credit, moneyLike };
}

/** A reference / folio number (≥ 5 bare digits): text, never an amount. */
function isReference(field: string): boolean {
  return /^\d{5,}$/.test(unquote(field));
}

// ---------------------------------------------------------------------------
// Row classification

const PAYMENT_RE =
  /\b(abono|abonos|pago|pagos|gracias|devolucion|devoluciones|reembolso|bonificacion|cancelacion|reverso|reversion|deposito)\b/;
const TOTALS_RE =
  /\b(saldo|saldos|total|totales|subtotal)\b|\bpago minimo\b|\blimite de credito\b|\bcredito disponible\b|\bfecha (de )?corte\b|\bfecha limite\b|\bpago para no generar\b/;

function isPaymentDescription(description: string): boolean {
  const d = fold(description);
  if (/mercado\s*pago/.test(d)) return false;
  return PAYMENT_RE.test(d);
}

function isTotalsDescription(description: string): boolean {
  const d = fold(description);
  if (/\btotal\s*play\b/.test(d)) return false;
  return TOTALS_RE.test(d);
}

function cleanDescription(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** Applies the sign rules to a positive-by-default amount. */
function signed(money: Money, extraCredit: boolean, description: string): number {
  if (money.credit || extraCredit) return -Math.abs(money.value);
  if (money.value > 0 && isPaymentDescription(description)) return -money.value;
  return money.value;
}

// ---------------------------------------------------------------------------
// Delimited rows

/** Quote-aware split ("1,234.56" in quotes stays one field). */
function splitFields(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map(unquote);
}

/** Unquoted comma CSV breaks "1,234.56" into "1" + "234.56": glue them back. */
function mergeThousands(fields: string[]): string[] {
  const out: string[] = [];
  for (const field of fields) {
    const prev = out[out.length - 1];
    if (prev !== undefined && /^\d{3}(\.\d+)?$/.test(field) && /^[-−–]?\$?\d{1,3}(,\d{3})*$/.test(prev)) {
      out[out.length - 1] = `${prev},${field}`;
    } else {
      out.push(field);
    }
  }
  return out;
}

const DELIMITERS: ReadonlyArray<string> = ["\t", ";", "|", ","];

interface Header {
  delimiter: string;
  count: number;
  date: number;
  description: number | null;
  charge: number | null;
  credit: number | null;
  amount: number | null;
  type: number | null;
  balance: number | null;
}

function classifyHeader(fields: string[], delimiter: string): Header | null {
  const header: Header = {
    delimiter,
    count: fields.length,
    date: -1,
    description: null,
    charge: null,
    credit: null,
    amount: null,
    type: null,
    balance: null,
  };
  let descriptionIsReference = false;
  for (let k = 0; k < fields.length; k += 1) {
    const h = fold(fields[k]!).trim();
    if (h === "") continue;
    if (/^(saldo|balance)/.test(h)) header.balance ??= k;
    else if (/^(tipo|naturaleza)/.test(h)) header.type ??= k;
    else if (/^(fecha|date|dia\b)/.test(h)) {
      if (header.date < 0) header.date = k;
    } else if (/^(cargos?|debitos?|retiros?|debits?|withdrawals?)\b/.test(h)) header.charge ??= k;
    else if (/^(abonos?|creditos?|depositos?|pagos?|credits?|deposits?)\b/.test(h)) header.credit ??= k;
    else if (/^(importe|monto|cantidad|amount|valor)\b/.test(h)) header.amount ??= k;
    else if (/(concepto|descripcion|description|detalle|movimiento|comercio|establecimiento|merchant|beneficiario|narrativa)/.test(h)) {
      if (header.description === null || descriptionIsReference) {
        header.description = k;
        descriptionIsReference = false;
      }
    } else if (/referencia|reference|folio/.test(h) && header.description === null) {
      header.description = k;
      descriptionIsReference = true;
    }
  }
  const hasAmount = header.charge !== null || header.credit !== null || header.amount !== null;
  return header.date >= 0 && (hasAmount || header.description !== null) ? header : null;
}

/** A header row: recognised column names and no date / amount among its fields. */
function detectHeader(line: string, today: ISODate): Header | null {
  for (const delimiter of DELIMITERS) {
    if (!line.includes(delimiter)) continue;
    const fields = splitFields(line, delimiter);
    if (fields.length < 2) continue;
    if (fields.some((field) => parseDateField(field, today) !== null || parseMoney(field) !== null)) continue;
    const header = classifyHeader(fields, delimiter);
    if (header) return header;
  }
  return null;
}

function fieldsOf(line: string, delimiter: string, expected: number | null): string[] {
  const fields = splitFields(line, delimiter);
  if (delimiter !== ",") return fields;
  return expected === null || fields.length > expected ? mergeThousands(fields) : fields;
}

function parseWithHeader(line: string, header: Header, today: ISODate): StatementRow | null {
  if (!line.includes(header.delimiter)) return null;
  const fields = fieldsOf(line, header.delimiter, header.count);
  const date = parseDateField(fields[header.date] ?? "", today);
  if (date === null) return null;
  const used = new Set<number>([header.date]);
  for (const col of [header.charge, header.credit, header.amount, header.type, header.balance]) {
    if (col !== null) used.add(col);
  }
  const description =
    header.description !== null
      ? cleanDescription(fields[header.description] ?? "")
      : cleanDescription(
          fields
            .filter((field, k) => !used.has(k) && field !== "" && (parseMoney(field) === null || isReference(field)))
            .join(" "),
        );
  let amount: number | null = null;
  const charge = header.charge !== null ? parseMoney(fields[header.charge] ?? "") : null;
  const credit = header.credit !== null ? parseMoney(fields[header.credit] ?? "") : null;
  if (charge !== null && charge.value !== 0) {
    // A value in the Cargo column is a charge whatever its sign (unless marked CR).
    amount = charge.credit ? -Math.abs(charge.value) : Math.abs(charge.value);
  } else if (credit !== null && credit.value !== 0) {
    amount = -Math.abs(credit.value);
  } else if (header.amount !== null) {
    const money = parseMoney(fields[header.amount] ?? "");
    if (money !== null) {
      const type = header.type !== null ? fold(fields[header.type] ?? "") : "";
      if (/^(abono|credito|deposito|pago)/.test(type)) amount = -Math.abs(money.value);
      else if (/^(cargo|debito|compra|retiro)/.test(type)) amount = Math.abs(money.value);
      else amount = signed(money, false, description);
    }
  }
  if (amount === null || amount === 0) return null;
  return { date, description, amount, raw: line };
}

/** A delimited row without a header: the date field anywhere, the first money-looking field is the amount. */
function parseDelimited(line: string, delimiter: string, today: ISODate): StatementRow | null {
  const fields = fieldsOf(line, delimiter, null);
  if (fields.length < 2) return null;
  let dateIndex = -1;
  let date: ISODate | null = null;
  for (let k = 0; k < fields.length && date === null; k += 1) {
    date = parseDateField(fields[k]!, today);
    if (date !== null) dateIndex = k;
  }
  if (date === null) return null;
  let amountIndex = -1;
  let fallbackIndex = -1;
  let creditMarker = false;
  for (let k = 0; k < fields.length; k += 1) {
    if (k === dateIndex) continue;
    const field = fields[k]!;
    if (/^(cr|abono)$/.test(fold(field))) {
      creditMarker = true;
      continue;
    }
    if (isReference(field)) continue;
    const money = parseMoney(field);
    if (money === null) continue;
    if (money.moneyLike && amountIndex < 0) amountIndex = k;
    if (fallbackIndex < 0) fallbackIndex = k;
  }
  const index = amountIndex >= 0 ? amountIndex : fallbackIndex;
  if (index < 0) return null;
  const money = parseMoney(fields[index]!)!;
  const description = cleanDescription(
    fields
      .filter((field, k) => {
        if (k === dateIndex || k === index || field === "") return false;
        if (/^(cr|abono)$/.test(fold(field))) return false;
        return parseMoney(field) === null || isReference(field);
      })
      .join(" "),
  );
  const amount = signed(money, creditMarker, description);
  if (amount === 0) return null;
  return { date, description, amount, raw: line };
}

// ---------------------------------------------------------------------------
// Plain text rows

function parsePlain(line: string, today: ISODate): StatementRow | null {
  const tokens = line.split(/\s+/).filter((token) => token !== "");
  const lead = readDate(tokens, 0);
  if (!lead) return null;
  const date = resolveDate(lead.parts, today);
  if (date === null) return null;
  let start = lead.next;
  const skipTime = (): void => {
    if (TIME_RE.test(tokens[start] ?? "")) start += 1;
    if (MERIDIEM_RE.test(fold(tokens[start] ?? ""))) start += 1;
  };
  skipTime();
  // Operation date + posting date: keep the first, skip the second.
  const second = readDate(tokens, start);
  if (second && resolveDate(second.parts, today) !== null) {
    start = second.next;
    skipTime();
  }

  let end = tokens.length;
  let creditMarker = false;
  let negativeMarker = false;
  while (end > start) {
    const t = fold(tokens[end - 1]!);
    if (t === "cr") creditMarker = true;
    else if (t === "-" || t === "−") negativeMarker = true;
    else if (t !== "mxn" && t !== "mn" && t !== "m.n." && t !== "pesos" && t !== "$") break;
    end -= 1;
  }
  if (end <= start) return null;
  let amountIndex = end - 1;
  let money = parseMoney(tokens[amountIndex]!);
  if (money === null) return null;
  // Two trailing amounts (movement + running balance): the first is the movement.
  const prev = amountIndex - 1 > start ? parseMoney(tokens[amountIndex - 1]!) : null;
  if (prev !== null && prev.moneyLike && money.moneyLike) {
    amountIndex -= 1;
    money = prev;
  }
  let descriptionEnd = amountIndex;
  while (descriptionEnd > start) {
    const t = tokens[descriptionEnd - 1]!;
    if (/^[-−–]$/.test(t)) negativeMarker = true;
    else if (t !== "$" && t !== "+" && fold(t) !== "mxn") break;
    descriptionEnd -= 1;
  }
  const description = cleanDescription(tokens.slice(start, descriptionEnd).join(" "));
  let amount = signed(money, creditMarker, description);
  if (negativeMarker) amount = -Math.abs(amount);
  if (amount === 0) return null;
  return { date, description, amount, raw: line };
}

// ---------------------------------------------------------------------------
// Public API

/** Statement text → rows in input order. Never throws. */
export function parseStatement(text: string, ctx: { today: ISODate }): StatementRow[] {
  try {
    if (typeof text !== "string" || !ctx || !isISODate(ctx.today)) return [];
    const today = ctx.today;
    const rows: StatementRow[] = [];
    let header: Header | null = null;
    for (const rawLine of text.split(/\r\n|\r|\n/)) {
      const raw = rawLine.trim();
      if (raw === "") continue;
      // Leading tabs are kept: an empty first column must not shift the others.
      const line = rawLine.replace(/^[  ]+/, "").replace(/\s+$/, "");
      const maybeHeader = detectHeader(line, today);
      if (maybeHeader) {
        header = maybeHeader;
        continue;
      }
      let row: StatementRow | null = null;
      if (header !== null) row = parseWithHeader(line, header, today);
      if (row === null) {
        for (const delimiter of DELIMITERS) {
          if (!line.includes(delimiter)) continue;
          // A comma only delimits when it splits off a whole date field ("2026-11-15,Uber,89.00");
          // otherwise it is a thousands separator in a plain line.
          if (delimiter === ",") {
            const fields = splitFields(line, ",");
            if (fields.length < 3 || !fields.some((field) => parseDateField(field, today) !== null)) continue;
          }
          row = parseDelimited(line, delimiter, today);
          if (row !== null) break;
        }
      }
      row ??= parsePlain(line, today);
      if (row !== null && !isTotalsDescription(row.description)) rows.push({ ...row, raw });
    }
    return rows;
  } catch {
    return [];
  }
}

/** Totals of parsed rows; `payments` is a positive magnitude, `net` = charges − payments. */
export function summarizeStatement(rows: StatementRow[]): StatementSummary {
  let charges = 0;
  let payments = 0;
  let from: ISODate | null = null;
  let to: ISODate | null = null;
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !Number.isFinite(row.amount)) continue;
    if (row.amount > 0) charges += row.amount;
    else payments -= row.amount;
    if (typeof row.date === "string" && isISODate(row.date)) {
      if (from === null || row.date < from) from = row.date;
      if (to === null || row.date > to) to = row.date;
    }
  }
  charges = roundCents(charges);
  payments = roundCents(payments);
  return { charges, payments, net: roundCents(charges - payments), from, to };
}
