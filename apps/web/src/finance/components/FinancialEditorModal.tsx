// Editor for one financial item. Two modes:
// - edit:   opened by double-clicking a clip (`itemId`). "Guardar" replaces
//           the item in one undo entry; "Eliminar" deletes it.
// - create: opened by "+ Ingreso" & co. with a `draft` from
//           bridge.createDraftItem. Nothing exists until "Guardar", which
//           adds it; Cancelar / Escape / × / overlay leave the document as is.
// Either way the form works on a local draft and nothing reaches the bridge
// before "Guardar". Items on a locked line open read-only.
//
// What the form says back before "Guardar" (UX-audit 2026-11-11):
// - per kind, in plain words, when the money moves (schedule, card cycle,
//   MSI installments, a purchase's payment) — editor-readback.ts;
// - what the item does to your cash (<EffectLine>, the "/" bar's line);
// - whether a debt ends: a card's "Libre en …" / "no se liquida", a loan's
//   balance × payment × count check with "Ajustar", and "Quiero liquidarla
//   el …" (the canvas goal seek, without dragging).
// Errors show when you leave a field or press "Guardar" (always enabled):
// the focus then lands on the first field to fix (UX-32).
//
// ONE form for every kind (item-form-spec.ts is its single source): the same
// skeleton — Tipo · Nombre → Cuánto → Cuándo (… · Termina) → Detalles →
// readback / effect line — filled per kind from that table. The kind is a
// field like any other: switching it keeps what was typed (UX-31).
import * as React from "react";
import { useForm } from "@mantine/form";
import {
  addMonths,
  compareISODate,
  createDefaultFinancialItem,
  isISODate,
  monthlyInstallment,
  remainingInstallmentDebt,
} from "@slicex/core";
import type {
  CreditCardItem,
  FinancialDocument,
  FinancialItem,
  FinancialItemKind,
  FinancialRecurrence,
  ISODate,
  InstallmentPlanItem,
  LoanItem,
} from "@slicex/core";
import type { FinancialBridgeApi, FinancialPlacement, FinancialPreview } from "../bridge-api";
import { formatDateWeekday, formatMoney, parseNumberInput } from "../format";
import { KIND_COLORS, KIND_LABELS, KIND_ORDER } from "../labels";
import { useEscapeLayer, useOverlay } from "../../ui/use-overlay";
import { useAnnounce } from "../../ui/announcer";
import { useFinancialRevision } from "./FinancialUi";
import { DateField } from "./DateField";
import { describePreviewEffect, EffectLine, useLivePreviewEffect } from "./EffectLine";
import {
  DaySelect,
  errorAria,
  FieldError,
  FieldErrorsContext,
  focusFirstInvalid,
  useEditableText,
  useFieldError,
} from "./form-kit";
import { SchedulePicker } from "./SchedulePicker";
import {
  cleanItem,
  endLabel,
  fieldLabel,
  firstErrorPath,
  firstFieldError,
  itemFormErrors,
  itemFromForm,
  startLabel,
  type ItemFormErrors,
} from "../item-schema";
import {
  FORM_SECTIONS,
  ITEM_FORM_SPEC,
  fieldHint,
  happensOnce as isOnce,
  isOptional,
  sectionFields,
  usesFrequency,
  type FormFieldSpec,
} from "../item-form-spec";
import {
  cardPayoffLine,
  cardPreview,
  cardSentence,
  docWithItem,
  installmentSchedule,
  installmentSentence,
  loanCheck,
  loanSuggestedPayment,
  payoffGoal,
  purchaseSentence,
  type PayoffGoal,
  type ReadbackTone,
} from "../editor-readback";
import {
  LAST_DAY,
  firstPayment,
  lastPayment,
  monthlyDay,
  paymentCount,
  snapEndToLastPayment,
  startOnFirstPayment,
  withPayday,
  withPaymentCount,
  withStartDate,
  cadenceText,
  defaultPaymentCount,
  frequencyParts,
  upcomingPayments,
  withFrequencyParts,
  type FrequencyUnit,
} from "../schedule-ui";

interface FinancialEditorModalBaseProps {
  bridge: FinancialBridgeApi;
  onClose: () => void;
  /**
   * Where focus goes on close when the element focused before opening is
   * gone or was <body> (the shell passes the canvas host so playlist
   * shortcuts keep working).
   */
  returnFocusFallback?: () => HTMLElement | null;
  /**
   * Credit cards: open the "paste a statement" flow for this card. The
   * editor calls it only once nothing is left unsaved (UX-51).
   */
  onImportStatement?: (cardId: string) => void;
  /** Create: the row the new item should land on (see bridge.addItem). */
  placement?: FinancialPlacement;
  /** The real today ("hoy", "mañana", "el 15" in the date fields); default: the plan's start. */
  today?: ISODate;
}

export type FinancialEditorModalProps = FinancialEditorModalBaseProps &
  (
    | { /** Edit the existing item with this id. */ itemId: string; draft?: undefined }
    | {
        /** Create: a NEW item (bridge.createDraftItem) added on "Guardar". */
        draft: FinancialItem;
        itemId?: undefined;
      }
  );

// Values of the form while the edited item does not exist (the modal is
// closing): never shown.
const MISSING_ITEM: FinancialItem = {
  id: "",
  kind: "expense",
  name: "",
  amount: 0,
  recurrence: { frequency: "once", startDate: "1970-01-01", endDate: "1970-01-01" },
};

// `usesFrequency` (the kinds whose schedule is `recurrence.frequency`) and
// `isOnce` (a single occurrence: by convention, like
// createDefaultFinancialItem, a one-day window, endDate === startDate) come
// from the form's spec.

/** The "main" amount that survives a kind switch, when there is one. */
function primaryAmount(item: FinancialItem): number | undefined {
  switch (item.kind) {
    case "income":
    case "expense":
    case "card-purchase":
      return item.amount;
    case "loan":
      return item.paymentAmount;
    default:
      return undefined;
  }
}

function withPrimaryAmount(item: FinancialItem, amount: number): FinancialItem {
  switch (item.kind) {
    case "income":
    case "expense":
    case "card-purchase":
      return { ...item, amount };
    case "loan":
      return { ...item, paymentAmount: amount };
    default:
      return item;
  }
}

/** Title of the create-mode editor ("Nuevo Ingreso", "Nueva Tarjeta"…). */
const NEW_TITLE_PREFIX: Readonly<Record<FinancialItemKind, string>> = {
  income: "Nuevo",
  expense: "Nuevo",
  loan: "Nuevo",
  "credit-card": "Nueva",
  "card-purchase": "Nueva",
  "installment-plan": "Nuevo",
};

/** The name a new item of `kind` gets ("Gasto", "6 MSI"…). */
function defaultName(kind: FinancialItemKind): string {
  return createDefaultFinancialItem(kind, "name", "2026-01-01").name;
}

/** The name was never written by the person (the kind's own, or "N MSI"). */
function hasDefaultName(item: FinancialItem): boolean {
  const name = item.name.trim();
  return name === "" || name === defaultName(item.kind) || name === KIND_LABELS[item.kind] || /^\d+ MSI$/.test(name);
}

/** Builds the item a kind switch produces (keeps id, name, window, amount). */
export function switchKind(
  prev: FinancialItem,
  kind: FinancialItemKind,
  doc: FinancialDocument,
): FinancialItem {
  const start = isISODate(prev.recurrence.startDate)
    ? prev.recurrence.startDate
    : doc.startDate;
  // Defaults (e.g. the MSI / purchase card) must come from the OTHER items:
  // the edited item is still a credit card in `doc` while it is being
  // converted, and must never become its own card.
  const others: FinancialDocument = {
    ...doc,
    items: doc.items.filter((item) => item.id !== prev.id),
  };
  const created = createDefaultFinancialItem(kind, prev.id, start, others);
  const keepFrequency = usesFrequency(kind) && usesFrequency(prev.kind);
  // The window (start / end / anchor) survives; the frequency only when
  // both kinds are frequency-driven.
  const recurrence: FinancialRecurrence = { ...prev.recurrence };
  if (!keepFrequency) {
    recurrence.frequency = created.recurrence.frequency;
    if (isOnce(prev)) {
      // A one-day "once" window means nothing for a recurring schedule:
      // take the new kind's default end instead.
      if (created.recurrence.endDate === undefined) delete recurrence.endDate;
      else recurrence.endDate = created.recurrence.endDate;
    }
    if (usesFrequency(kind) && recurrence.frequency === "once") {
      recurrence.endDate = recurrence.startDate;
    }
  }
  let next: FinancialItem = {
    ...created,
    name: hasDefaultName(prev) ? created.name : prev.name,
    recurrence,
  };
  if (prev.enabled !== undefined) next.enabled = prev.enabled;
  // Keep a custom colour override, but drop one that was just the old
  // kind's colour (the new kind brings its own).
  if (
    prev.color !== undefined &&
    prev.color.toLowerCase() !== KIND_COLORS[prev.kind].toLowerCase()
  ) {
    next.color = prev.color;
  }
  const amount = primaryAmount(prev);
  if (amount !== undefined && Number.isFinite(amount)) {
    next = withPrimaryAmount(next, amount);
  }
  return next;
}

/**
 * A NEW item's form (UX-30): the amounts are empty and required — nobody
 * decided "$500" or "$1,000" — and with two cards or more none is picked.
 * The legitimate inferences stay (the date at the cursor, the kind's name,
 * the only card when there is one).
 */
export function blankDraft(draft: FinancialItem, cards: ReadonlyArray<CreditCardItem>): FinancialItem {
  const blank = { ...draft } as Record<string, unknown>;
  const onlyCard = cards.length === 1 ? cards[0]!.id : undefined;
  switch (draft.kind) {
    case "income":
    case "expense":
      blank.amount = undefined;
      break;
    case "card-purchase":
      blank.amount = undefined;
      blank.cardId = onlyCard ?? "";
      break;
    case "loan": {
      blank.paymentAmount = undefined;
      // "¿Cuántos pagos te faltan?" is asked, not assumed (it was 13).
      const recurrence = { ...draft.recurrence };
      delete recurrence.endDate;
      blank.recurrence = recurrence;
      break;
    }
    case "credit-card":
      blank.balance = undefined;
      blank.minimumPayment = undefined;
      break;
    case "installment-plan":
      blank.originalAmount = undefined;
      if (cards.length >= 2) blank.cardId = "";
      else if (onlyCard !== undefined) blank.cardId = onlyCard;
      else delete blank.cardId;
      break;
    default:
      break;
  }
  return blank as unknown as FinancialItem;
}

/**
 * The form's view of a saved item: a recurring window starts ON its first
 * payment ("Primer pago", UX-34) — the same payments, the anchor kept.
 */
function openItem(item: FinancialItem): FinancialItem {
  if (!usesFrequency(item.kind) || isOnce(item)) return item;
  const recurrence = startOnFirstPayment(item.recurrence);
  return recurrence === item.recurrence ? item : { ...item, recurrence };
}

/**
 * The item "Guardar" sends to the bridge: drops `undefined` optionals so it
 * matches a clean document, and canonicalises a single occurrence.
 *
 * A "once" item happens on the date the form shows (Fecha = startDate) and
 * nothing else: it never carries an anchorDate and its window is one day
 * (endDate === startDate). The draft may still hold the anchor of a
 * recurring schedule it was switched from (frequency → "Una vez", or a kind
 * switch that lands on "once"); it is kept in the draft so switching back
 * restores the paydays, and stripped here — otherwise the point clip would
 * be placed on that hidden anchor instead of the shown date.
 */
export function normalizeForSave(draft: FinancialItem): FinancialItem {
  const item: Record<string, unknown> = { ...draft, name: draft.name.trim() };
  for (const key of Object.keys(item)) {
    if (item[key] === undefined) delete item[key];
  }
  const recurrence: FinancialRecurrence = { ...draft.recurrence };
  if (recurrence.endDate === undefined) delete recurrence.endDate;
  if (recurrence.anchorDate === undefined) delete recurrence.anchorDate;
  // "Cada N" only means something for daily / monthly rules, and 1 is the default.
  if (
    recurrence.interval === undefined ||
    recurrence.interval === 1 ||
    (recurrence.frequency !== "daily" && recurrence.frequency !== "monthly")
  ) {
    delete recurrence.interval;
  }
  if (isOnce(draft)) {
    delete recurrence.anchorDate;
    recurrence.endDate = recurrence.startDate;
  }
  item.recurrence =
    usesFrequency(draft.kind) && !isOnce(draft) ? snapEndToLastPayment(recurrence) : recurrence;
  return item as unknown as FinancialItem;
}

/**
 * First validation error of the draft ("Monto: No puede ser negativo"), or
 * null when it can be saved. The rules are the shared schema of
 * @slicex/contracts + the editor's (item-schema.ts).
 */
export function validateFinancialDraft(
  draft: FinancialItem,
  cards: ReadonlyArray<CreditCardItem>,
  docStartDate?: ISODate,
): string | null {
  return firstFieldError(itemFormErrors(draft, cards, { docStartDate }), draft);
}

// Field errors are shown under their field and tied to its input (form-kit:
// FieldErrorsContext, provided around the fields with the errors to show).

function numberToText(value: number | undefined): string {
  return value === undefined || Number.isNaN(value) ? "" : String(value);
}

function sameNumber(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b));
}

/**
 * Text input holding a number. Keeps the raw text locally so partial input
 * ("12.", "") is not clobbered; emits `undefined` when empty (the schema
 * says what to write when it is required) and NaN for garbage. Understands
 * "12 mil" / "12k" like the "/" bar (parseNumberInput).
 */
function NumberField({
  label,
  value,
  onChange,
  optional = false,
  prefix,
  suffix,
  placeholder,
  path,
  hint,
  muted = false,
  wide = false,
  compact = false,
  children,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  optional?: boolean;
  /** Words before the input on its row ("Después de"). */
  prefix?: string;
  suffix?: string;
  placeholder?: string;
  /** Form path of the value (its schema error shows under the field). */
  path?: string;
  /** Help under the field (examples go here, never as a plausible placeholder). */
  hint?: React.ReactNode;
  /** Kept but not used by the plan right now (a totalero's rate). */
  muted?: boolean;
  wide?: boolean;
  /** A short input for a count ("Después de [N] pagos"). */
  compact?: boolean;
  /** Extra controls on the input row ("Calcular pago"). */
  children?: React.ReactNode;
}) {
  const fieldError = useFieldError(path);
  const hintId = React.useId();
  const { text, setText, emit } = useEditableText(value, numberToText, sameNumber);
  // One description at a time: the error when there is one, else the help.
  const describedBy = fieldError.message ? fieldError.id : hint ? hintId : undefined;
  const className = [
    "fin-editor__field",
    wide ? "fin-editor__field--wide" : "",
    muted ? "fin-editor__field--muted" : "",
    compact ? "fin-editor__field--compact" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className} data-field-path={path}>
      <label className="fin-editor__field-label">
        <span className="fin-editor__label">
          {label}
          {optional ? <em className="fin-editor__optional"> (opcional)</em> : null}
        </span>
        <span className="fin-editor__control">
          {prefix ? <span className="fin-editor__prefix">{prefix}</span> : null}
          <input
            type="text"
            inputMode="decimal"
            spellCheck={false}
            autoComplete="off"
            value={text}
            placeholder={placeholder}
            aria-invalid={fieldError.message ? true : undefined}
            aria-describedby={describedBy}
            onChange={(event) => {
              const raw = event.target.value;
              setText(raw);
              const parsed = parseNumberInput(raw);
              const next = parsed === null ? undefined : parsed;
              if (emit(next)) onChange(next);
            }}
          />
          {suffix ? <span className="fin-editor__suffix">{suffix}</span> : null}
          {children}
        </span>
      </label>
      {hint ? (
        <span id={hintId} className="fin-editor__hint">
          {hint}
        </span>
      ) : null}
      <FieldError {...fieldError} />
    </div>
  );
}

/** A day-of-month field ("Día de corte", "Día de pago"): THE day control (form-kit). */
function DayField({
  label,
  path,
  value,
  onChange,
}: {
  label: string;
  path: string;
  value: number | undefined;
  onChange: (day: number) => void;
}) {
  const fieldError = useFieldError(path);
  const id = React.useId();
  return (
    <div className="fin-editor__field" data-field-path={path}>
      <label className="fin-editor__label" htmlFor={id}>
        {label}
      </label>
      <DaySelect
        id={id}
        value={value}
        onChange={(day) => {
          if (day !== undefined) onChange(day);
        }}
        {...errorAria(fieldError)}
      />
      <FieldError {...fieldError} />
    </div>
  );
}

/** "Pagas $8,000 cada mes, el día 20, desde …: 7 pagos." — the schedule in plain words. */
function scheduleSentence(draft: FinancialItem, payments: number | null, last: string | null): string | null {
  const rule = draft.recurrence;
  if (!isISODate(rule.startDate)) return null;
  const amount = primaryAmount(draft);
  const valid = amount !== undefined && Number.isFinite(amount);
  const money = valid ? ` ${formatMoney(amount)}` : "";
  const verb = draft.kind === "income" ? "Cobras" : draft.kind === "card-purchase" ? "Cargas" : "Pagas";
  if (rule.frequency === "once") {
    return `${verb}${money} una sola vez, el ${formatDateWeekday(rule.startDate)}.`;
  }
  const end =
    rule.endDate === undefined
      ? ", sin fecha de fin"
      : payments && last
        ? `, hasta el ${formatDateWeekday(last)}: ${payments} ${payments === 1 ? "pago" : "pagos"}` +
          (draft.kind === "loan" && valid ? `, ${formatMoney(amount * payments)} en total` : "")
        : ": ningún pago en ese rango";
  return `${verb}${money} ${cadenceText(rule)}, desde el ${formatDateWeekday(rule.startDate)}${end}.`;
}

// Plain-words readback of the "Cuándo" block: what will happen, and the
// next dates — so the person sees the schedule, not just the controls. Not a
// live region (UX-37): the editor announces it once typing pauses.
function Readback({
  sentence,
  upcoming = [],
  more = false,
}: {
  sentence: string | null;
  upcoming?: ReadonlyArray<string>;
  more?: boolean;
}) {
  if (!sentence) return null;
  return (
    <div className="fin-editor__field--wide fin-readback">
      <p className="fin-readback__sentence">{sentence}</p>
      {upcoming.length > 0 ? (
        <p className="fin-readback__next">
          <span className="fin-readback__label">Próximos:</span>
          {upcoming.map((date) => (
            <span key={date} className="fin-readback__date">
              {formatDateWeekday(date)}
            </span>
          ))}
          {more ? <span className="fin-readback__more">…</span> : null}
        </p>
      ) : null}
    </div>
  );
}

/** One toned line under a debt's numbers ("Libre en …", "no se liquida", the loan check). */
function CheckLine({
  text,
  tone,
  children,
}: {
  text: string;
  tone: ReadbackTone;
  children?: React.ReactNode;
}) {
  return (
    <div className="fin-editor__field--wide fin-editor__check-line" data-tone={tone}>
      <span>{text}</span>
      {children}
    </div>
  );
}

// "Crear tarjeta…" (UX-24): a card created right here, without losing the
// purchase being written; it comes back selected.
function NewCardForm({
  bridge,
  onCreated,
  onCancel,
}: {
  bridge: FinancialBridgeApi;
  onCreated: (cardId: string, name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState("");
  const [cutDay, setCutDay] = React.useState<number | undefined>(undefined);
  const [dueDay, setDueDay] = React.useState<number | undefined>(undefined);
  const [mode, setMode] = React.useState<"statement" | "fixed">("statement");
  const [payment, setPayment] = React.useState("");
  const [tried, setTried] = React.useState(false);
  const boxRef = React.useRef<HTMLFieldSetElement | null>(null);
  const nameRef = React.useRef<HTMLInputElement | null>(null);
  const ids = { name: React.useId(), cut: React.useId(), due: React.useId(), pay: React.useId(), err: React.useId() };
  React.useEffect(() => nameRef.current?.focus(), []);
  // Escape closes this step only (the editor stays open).
  useEscapeLayer(true, onCancel);

  const paymentValue = parseNumberInput(payment);
  const errors: Record<string, string> = {};
  if (name.trim() === "") errors.name = "Ponle un nombre";
  if (cutDay === undefined) errors.cut = "Elige el día de corte";
  if (dueDay === undefined) errors.due = "Elige el día de pago";
  if (mode === "fixed" && !(paymentValue !== null && Number.isFinite(paymentValue) && paymentValue > 0)) {
    errors.pay = "Escribe cuánto pagas al mes";
  }
  const show = (key: string) => (tried ? errors[key] : undefined);

  const create = () => {
    setTried(true);
    if (Object.keys(errors).length > 0) {
      requestAnimationFrame(() => focusFirstInvalid(boxRef.current));
      return;
    }
    const base = bridge.createDraftItem("credit-card") as CreditCardItem;
    const card: CreditCardItem = {
      ...base,
      name: name.trim(),
      balance: 0,
      minimumPayment: 0,
      cutDay: cutDay!,
      dueDay: dueDay!,
    };
    if (mode === "statement") card.paymentMode = "statement";
    else card.paymentAmount = paymentValue!;
    const id = bridge.addItem(cleanItem(normalizeForSave(card)));
    onCreated(id, card.name);
  };

  const fieldAria = (key: string) =>
    show(key) ? { "aria-invalid": true as const, "aria-describedby": `${ids.err}-${key}` } : {};
  const error = (key: string) =>
    show(key) ? (
      <span id={`${ids.err}-${key}`} className="fin-editor__field-error">
        {show(key)}
      </span>
    ) : null;

  return (
    <fieldset
      ref={boxRef}
      className="fin-editor__field--wide fin-newcard"
      onKeyDown={(event) => {
        // Enter creates the card, never submits the editor.
        if (event.key === "Enter" && (event.target as HTMLElement).tagName === "INPUT") {
          event.preventDefault();
          create();
        }
      }}
    >
      <legend className="fin-newcard__title">Nueva tarjeta</legend>
      <div className="fin-newcard__grid">
        <div className="fin-editor__field fin-editor__field--wide">
          <label className="fin-editor__label" htmlFor={ids.name}>
            Nombre de la tarjeta
          </label>
          <input
            ref={nameRef}
            id={ids.name}
            type="text"
            value={name}
            placeholder="ej. Nu, BBVA Oro"
            onChange={(event) => setName(event.target.value)}
            {...fieldAria("name")}
          />
          {error("name")}
        </div>
        <div className="fin-editor__field">
          <label className="fin-editor__label" htmlFor={ids.cut}>
            Día de corte
          </label>
          <DaySelect id={ids.cut} value={cutDay} onChange={setCutDay} {...fieldAria("cut")} />
          {error("cut")}
        </div>
        <div className="fin-editor__field">
          <label className="fin-editor__label" htmlFor={ids.due}>
            Día de pago
          </label>
          <DaySelect id={ids.due} value={dueDay} onChange={setDueDay} {...fieldAria("due")} />
          {error("due")}
        </div>
        <div className="fin-editor__field fin-editor__field--wide" role="radiogroup" aria-label="Cómo la pagas">
          <span className="fin-editor__label" aria-hidden="true">
            Cómo la pagas
          </span>
          <label className="fin-editor__check">
            <input
              type="radio"
              name={`${ids.name}-mode`}
              checked={mode === "statement"}
              onChange={() => setMode("statement")}
            />
            <span>El total cada mes (totalero)</span>
          </label>
          <label className="fin-editor__check">
            <input
              type="radio"
              name={`${ids.name}-mode`}
              checked={mode === "fixed"}
              onChange={() => setMode("fixed")}
            />
            <span>Un pago fijo al mes</span>
          </label>
        </div>
        {mode === "fixed" ? (
          <div className="fin-editor__field fin-editor__field--wide">
            <label className="fin-editor__label" htmlFor={ids.pay}>
              ¿Cuánto pagas al mes?
            </label>
            <input
              id={ids.pay}
              type="text"
              inputMode="decimal"
              value={payment}
              onChange={(event) => setPayment(event.target.value)}
              {...fieldAria("pay")}
            />
            {error("pay")}
          </div>
        ) : null}
      </div>
      <div className="fin-newcard__actions">
        <button type="button" className="fin-editor__button" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" className="fin-editor__button fin-editor__button--primary" onClick={create}>
          Crear tarjeta
        </button>
      </div>
    </fieldset>
  );
}

/** Value of the MSI card select for "nothing picked yet" (several cards, UX-30). */
const CHOOSE_CARD = "__choose";

function CardSelect({
  label,
  cards,
  value,
  optional,
  onChange,
  bridge,
}: {
  label: string;
  cards: ReadonlyArray<CreditCardItem>;
  /** "" = none picked yet. */
  value: string | undefined;
  optional: boolean;
  onChange: (cardId: string | undefined) => void;
  bridge: FinancialBridgeApi;
}) {
  const fieldError = useFieldError("cardId");
  const announce = useAnnounce();
  const [creatingCard, setCreatingCard] = React.useState(false);
  const newCardRef = React.useRef<HTMLButtonElement | null>(null);
  const selectId = React.useId();
  const known = value !== undefined && cards.some((card) => card.id === value);
  // A card id that no longer exists (card deleted, or a stale default) gets
  // its own selected placeholder option. Rendering it as "" instead would
  // make "— Sin tarjeta —" / "Selecciona…" the already-selected option, and
  // picking it again fires no change event: the form could never be fixed.
  const missing = value !== undefined && value !== "" && !known;
  const unchosen = value === "" || (!optional && !known && !missing);

  const newCard = creatingCard ? (
    <NewCardForm
      bridge={bridge}
      onCancel={() => {
        setCreatingCard(false);
        requestAnimationFrame(() => newCardRef.current?.focus());
      }}
      onCreated={(id, name) => {
        setCreatingCard(false);
        onChange(id);
        announce({ message: `Tarjeta «${name}» creada y elegida para esta compra.` });
      }}
    />
  ) : null;
  const newCardButton = creatingCard ? null : (
    <button
      ref={newCardRef}
      type="button"
      className="fin-editor__link"
      onClick={() => setCreatingCard(true)}
    >
      {cards.length === 0 ? "Crear tarjeta…" : "Nueva tarjeta…"}
    </button>
  );

  if (cards.length === 0 && !optional) {
    return (
      <>
        <div className="fin-editor__field fin-editor__field--wide" data-field-path="cardId">
          <span className="fin-editor__label">{label}</span>
          <span className="fin-editor__hint">
            Todavía no tienes tarjetas. {newCardButton}
          </span>
          <FieldError {...fieldError} />
        </div>
        {newCard}
      </>
    );
  }
  const selectValue = known || missing ? value : value === "" ? CHOOSE_CARD : optional ? "" : CHOOSE_CARD;
  return (
    <>
      <div className="fin-editor__field" data-field-path="cardId">
        <label className="fin-editor__label" htmlFor={selectId}>
          {label}
          {optional ? <em className="fin-editor__optional"> (opcional)</em> : null}
        </label>
        <select
          id={selectId}
          value={selectValue}
          {...errorAria(fieldError)}
          onChange={(event) => onChange(event.target.value === "" ? undefined : event.target.value)}
        >
          {unchosen ? (
            <option value={CHOOSE_CARD} disabled>
              Selecciona…
            </option>
          ) : null}
          {optional ? <option value="">— Sin tarjeta —</option> : null}
          {missing ? (
            <option value={value} disabled>
              (tarjeta eliminada)
            </option>
          ) : null}
          {cards.map((card) => (
            <option key={card.id} value={card.id}>
              {card.name}
            </option>
          ))}
        </select>
        {newCardButton}
        <FieldError {...fieldError} />
      </div>
      {newCard}
    </>
  );
}

/**
 * Whether the item's clip sits on a locked line. Re-checked only when the
 * playlist's lines / clips change (lock toggles, moves): hover, playhead and
 * viewport notifications are skipped before touching the bridge, and the
 * setter receives a primitive so React bails out (canon §2.6).
 */
function useItemLocked(bridge: FinancialBridgeApi, id: string | null): boolean {
  const core = bridge.core;
  const [locked, setLocked] = React.useState(
    () => id !== null && bridge.isItemLocked(id),
  );
  React.useEffect(() => {
    if (id === null) {
      setLocked(false);
      return undefined;
    }
    let { tracks, clips } = core.getState();
    setLocked(bridge.isItemLocked(id));
    const sub = core.subscribe((state) => {
      if (state.tracks === tracks && state.clips === clips) return;
      tracks = state.tracks;
      clips = state.clips;
      setLocked(bridge.isItemLocked(id));
    });
    return () => sub.unsubscribe();
  }, [bridge, core, id]);
  return locked;
}

/** Pause before the readback is announced (UX-37: one announcement per pause, never per key). */
const READBACK_ANNOUNCE_MS = 600;

/** `text` once it has not changed for `delayMs` (the first value is never "said"). */
function useSettledText(text: string, delayMs: number): string {
  const [settled, setSettled] = React.useState("");
  const firstRef = React.useRef(true);
  React.useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false;
      return undefined;
    }
    const timer = setTimeout(() => setSettled(text), delayMs);
    return () => clearTimeout(timer);
  }, [text, delayMs]);
  return settled;
}

/** Runs a pure engine helper on a draft that may still be half-typed. */
function safely<T>(compute: () => T): T | null {
  try {
    return compute();
  } catch {
    return null;
  }
}

export function FinancialEditorModal(props: FinancialEditorModalProps) {
  const { bridge, onClose, returnFocusFallback } = props;
  const creating = props.draft !== undefined;
  // Create mode: the draft's id is not in the document (nor the playlist).
  const itemId = props.draft !== undefined ? props.draft.id : props.itemId;
  const revision = useFinancialRevision(bridge);
  const announce = useAnnounce();
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = React.useId();

  const doc = React.useMemo(
    () => bridge.getDocument(),
    // `revision` is the cache key for document changes.
    [bridge, revision],
  );
  const today = props.today ?? doc.startDate;
  const cards = React.useMemo(
    () =>
      doc.items.filter(
        (item): item is CreditCardItem =>
          item.kind === "credit-card" && item.id !== itemId,
      ),
    [doc, itemId],
  );

  // State: Mantine Form, controlled — the readbacks, the effect line and the
  // presets derive from every value as you type. Validation: the shared Zod
  // schema (item-schema.ts), shown per field on blur / submit.
  const [initialItem] = React.useState<FinancialItem | null>(() => {
    if (props.draft !== undefined) return openItem(blankDraft(props.draft, cards));
    const item = bridge.getItem(itemId);
    return item ? openItem(item) : null;
  });
  const [missing, setMissing] = React.useState(initialItem === null);
  const form = useForm<FinancialItem>({
    mode: "controlled",
    initialValues: initialItem ?? MISSING_ITEM,
  });
  const draft: FinancialItem | null = missing ? null : form.getValues();
  const missingRef = React.useRef(missing);
  // Same contract as a useState setter (null = the item is gone). A new
  // object REPLACES the values: keys it lacks (a kind switch) are cleared,
  // since Mantine merges.
  const setDraft = React.useCallback(
    (
      next:
        | FinancialItem
        | null
        | ((prev: FinancialItem | null) => FinancialItem | null),
    ) => {
      const prev = missingRef.current ? null : form.getValues();
      const value = typeof next === "function" ? next(prev) : next;
      if (value === null) {
        missingRef.current = true;
        setMissing(true);
        return;
      }
      if (value === prev) return;
      const cleared: Record<string, unknown> = {};
      if (prev) for (const key of Object.keys(prev)) if (!(key in value)) cleared[key] = undefined;
      missingRef.current = false;
      setMissing(false);
      // (FinancialItem is a union: Mantine types setValues per member.)
      form.setValues({ ...cleared, ...value } as never);
    },
    [form],
  );
  const loadedIdRef = React.useRef(itemId);
  React.useEffect(() => {
    if (creating || loadedIdRef.current === itemId) return;
    loadedIdRef.current = itemId;
    const item = bridge.getItem(itemId);
    setDraft(item ? openItem(item) : null);
    if (item) form.resetDirty(openItem(item) as never);
  }, [bridge, itemId, creating]);

  // Failure reported by the bridge on Guardar / Eliminar (the modal stays
  // open). Cleared by any further edit.
  const [actionError, setActionError] = React.useState<string | null>(null);
  React.useEffect(() => setActionError(null), [draft]);

  // Edit mode: close when the item does not exist (bad id, deleted / undone
  // elsewhere). A create-mode draft never exists in the document.
  const exists = React.useMemo(
    () => creating || bridge.getItem(itemId) !== null,
    [bridge, itemId, creating, revision],
  );
  React.useEffect(() => {
    if (!exists) onCloseRef.current();
  }, [exists]);

  // Items on a locked line are read-only: the playlist vetoes every edit
  // of their clip, so a save would silently drop the dates.
  const locked = useItemLocked(bridge, creating ? null : itemId);

  // The open / close contract of every surface (UX-27): Escape closes (the
  // top layer only: an open calendar first), the focus goes back to the
  // opener (fallback: the canvas host). The first field takes the focus
  // below (selected), so no auto focus here.
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  useOverlay({
    open: true,
    onClose: () => onCloseRef.current(),
    kind: "modal",
    containerRef: dialogRef,
    autoFocus: false,
    fallbackFocus: returnFocusFallback,
  });

  const nameRef = React.useRef<HTMLInputElement | null>(null);
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    const input = nameRef.current;
    if (!input) return;
    if (input.matches(":disabled")) {
      // Read-only (locked line): focus still has to land in the dialog.
      cancelRef.current?.focus();
      return;
    }
    input.focus();
    input.select();
  }, [itemId]);

  // Overlay closes only on a click that started on the overlay (a text
  // selection dragged out of an input must not close the editor).
  const pressedOnOverlayRef = React.useRef(false);

  // Errors: validated always, SHOWN once the field was left or "Guardar"
  // pressed (UX-32).
  const [touched, setTouched] = React.useState<ReadonlySet<string>>(() => new Set());
  // Each failed "Guardar" renders again (and moves the focus again).
  const [submitCount, setSubmitCount] = React.useState(0);
  const submitted = submitCount > 0;
  const formRef = React.useRef<HTMLFormElement | null>(null);
  const focusInvalidRef = React.useRef<string | null | false>(false);

  // "Termina": on a date (default) or after N payments — both store an end
  // date; this only says which one the form shows. Changed only by typing
  // or choosing, never by focus (UX-37).
  const [endBy, setEndBy] = React.useState<"date" | "count">("date");
  // "Tipo" (UX-31: editing asks before converting) and the unsaved-changes
  // question (UX-51 / UX-27).
  const [pendingKind, setPendingKind] = React.useState<FinancialItemKind | null>(null);
  const kindDraftsRef = React.useRef(new Map<FinancialItemKind, FinancialItem>());
  const [confirm, setConfirm] = React.useState<null | "close" | "statement">(null);
  const confirmRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    if (confirm) confirmRef.current?.focus();
  }, [confirm]);

  // Every hook runs before the early return below (rules of hooks: the item
  // can vanish while the editor is open — deleted / undone elsewhere).
  const fieldErrors = React.useMemo<ItemFormErrors>(
    () => (draft ? itemFormErrors(draft, cards, { docStartDate: doc.startDate }) : {}),
    [draft, cards, doc.startDate],
  );
  const shownErrors = React.useMemo<ItemFormErrors>(() => {
    if (submitted) return fieldErrors;
    const out: ItemFormErrors = {};
    for (const [path, message] of Object.entries(fieldErrors)) if (touched.has(path)) out[path] = message;
    return out;
  }, [fieldErrors, touched, submitted]);
  const valid = Object.keys(fieldErrors).length === 0;
  const dirty = !missing && form.isDirty();

  // UX-23: what the item does to your cash, before "Guardar" — the "/" bar's
  // line. The preview is keyed WITHOUT the name (typing a name recomputes
  // nothing); an unchanged item being edited shows no line.
  const savedItem = draft && valid ? cleanItem(normalizeForSave(itemFromForm(draft))) : null;
  const previewKey = savedItem && !locked && (creating || dirty) ? JSON.stringify({ ...savedItem, name: "" }) : null;
  const preview = React.useMemo<FinancialPreview | null>(() => {
    if (previewKey === null) return null;
    const item = JSON.parse(previewKey) as FinancialItem;
    return creating ? { kind: "add", item } : { kind: "document", doc: docWithItem(doc, item) };
  }, [previewKey, creating, doc]);
  const effect = useLivePreviewEffect(bridge, preview);

  // Readbacks per kind (editor-readback.ts), keyed on the values that matter.
  const formItem = draft ? itemFromForm(draft) : null;
  const readKey = formItem ? JSON.stringify({ ...formItem, name: "" }) : "";
  const card = formItem?.kind === "credit-card" ? formItem : null;
  const cardInfo = React.useMemo(
    () => (card ? safely(() => cardPreview(card, doc)) : null),
    // `card` is rebuilt every render; `readKey` stands for its values.
    [readKey, doc],
  );
  const plan = formItem?.kind === "installment-plan" ? formItem : null;
  const planSchedule = React.useMemo(
    () => (plan ? safely(() => installmentSchedule(plan, cards, doc.startDate)) : null),
    [readKey, cards, doc.startDate],
  );

  const recurrence = draft?.recurrence;
  const showFrequency = draft ? usesFrequency(draft.kind) : false;
  const byPayments = showFrequency && recurrence !== undefined && recurrence.frequency !== "once";
  const payments = byPayments && recurrence ? paymentCount(recurrence) : null;
  const last = byPayments && recurrence ? lastPayment(recurrence) : null;

  let readback: string | null = null;
  if (draft && formItem) {
    if (formItem.kind === "credit-card") readback = cardSentence(formItem, cardInfo);
    else if (formItem.kind === "installment-plan") readback = planSchedule ? installmentSentence(formItem, planSchedule) : null;
    else readback = scheduleSentence(draft, payments, last);
  }
  const purchase =
    formItem?.kind === "card-purchase"
      ? purchaseSentence(formItem, cards.find((candidate) => candidate.id === formItem.cardId) ?? null)
      : null;
  const spoken = useSettledText(
    [readback, purchase, effect ? describePreviewEffect(effect, { reserve: doc.minimumCashReserve }) : null]
      .filter(Boolean)
      .join(" "),
    READBACK_ANNOUNCE_MS,
  );

  // After a failed "Guardar": the focus goes to the field the summary names.
  React.useEffect(() => {
    const path = focusInvalidRef.current;
    if (path === false) return;
    focusInvalidRef.current = false;
    const root = formRef.current;
    if (!root) return;
    const box = path ? root.querySelector(`[data-field-path="${path}"]`) : null;
    const control = box?.querySelector<HTMLElement>("input:not([type=radio]), select, textarea");
    if (control && !control.matches(":disabled")) control.focus();
    else focusFirstInvalid(root);
  });

  if (!draft || !exists || !recurrence || !formItem) return null;

  const summary = submitted ? firstFieldError(fieldErrors, draft) : null;
  const message = summary ?? actionError;

  const patch = (fields: Record<string, unknown>) =>
    setDraft((prev) =>
      prev ? ({ ...prev, ...fields } as FinancialItem) : prev,
    );
  const patchRecurrence = (fields: Partial<FinancialRecurrence>) =>
    setDraft((prev) =>
      prev ? { ...prev, recurrence: { ...prev.recurrence, ...fields } } : prev,
    );

  const onStartDateChange = (value: string) =>
    setDraft((prev) => {
      if (!prev) return prev;
      // Moving the date moves the whole schedule (window start + phase).
      let next: FinancialRecurrence = withStartDate(prev.recurrence, value);
      // A recurring end is a number of payments: it travels with the start.
      const count =
        usesFrequency(prev.kind) && !isOnce(prev) && isISODate(value)
          ? paymentCount(prev.recurrence)
          : null;
      if (count !== null && count > 0) next = withPaymentCount(next, count);
      else if (isISODate(value) && next.endDate !== undefined) {
        if (isOnce(prev)) {
          // Hidden end of a one-day window follows the date.
          next.endDate = value;
        } else if (isISODate(next.endDate) && compareISODate(next.endDate, value) < 0) {
          next.endDate = value;
        }
      }
      return { ...prev, recurrence: next };
    });

  // "Cada [N] [unit]" changed (either control).
  const onScheduleChange = (unit: FrequencyUnit, every: number) =>
    setDraft((prev) => {
      if (!prev) return prev;
      const next = withFrequencyParts(prev.recurrence, unit, every);
      if (next.frequency === "once") {
        // One-day window (endDate === startDate), like the core defaults.
        // The anchor stays in the draft (switching back keeps the paydays);
        // normalizeForSave strips it from a saved single occurrence.
        next.endDate = next.startDate;
      } else if (
        isOnce(prev) &&
        next.endDate !== undefined &&
        next.endDate === next.startDate
      ) {
        // once → recurring: a one-day window would allow a single
        // occurrence; open it up (or, for a loan, ask how many payments).
        delete next.endDate;
      }
      return { ...prev, recurrence: next };
    });

  const onIndefiniteChange = (indefinite: boolean) =>
    setDraft((prev) => {
      if (!prev) return prev;
      const next: FinancialRecurrence = { ...prev.recurrence };
      if (indefinite) {
        delete next.endDate;
      } else if (usesFrequency(prev.kind) && !isOnce(prev)) {
        return {
          ...prev,
          recurrence: withPaymentCount(next, defaultPaymentCount(next)),
        };
      } else {
        const base = isISODate(next.startDate) ? next.startDate : doc.startDate;
        next.endDate = addMonths(base, 12);
      }
      return { ...prev, recurrence: next };
    });

  const onPaydayChange = (day: number) =>
    setDraft((prev) => (prev ? { ...prev, recurrence: withPayday(prev.recurrence, day) } : prev));

  const onPaymentCountChange = (count: number | undefined) =>
    setDraft((prev) => {
      if (!prev) return prev;
      if (count === undefined || !Number.isInteger(count) || count < 1) {
        const next = { ...prev.recurrence };
        delete next.endDate;
        return { ...prev, recurrence: next };
      }
      return { ...prev, recurrence: withPaymentCount(prev.recurrence, count) };
    });

  // UX-31: a kind switch never loses what was typed — each kind keeps its
  // own draft, so Gasto → Tarjeta → Gasto comes back as it was.
  const applyKind = (kind: FinancialItemKind) => {
    setDraft((prev) => {
      if (!prev || prev.kind === kind) return prev;
      kindDraftsRef.current.set(prev.kind, prev);
      const stored = kindDraftsRef.current.get(kind);
      if (stored) return { ...stored, name: hasDefaultName(prev) ? stored.name : prev.name };
      const switched = switchKind(prev, kind, doc);
      if (!creating) return switched;
      const blank = blankDraft(switched, cards);
      const amount = primaryAmount(prev);
      return amount !== undefined && Number.isFinite(amount) ? withPrimaryAmount(blank, amount) : blank;
    });
    setPendingKind(null);
  };
  const onKindPicked = (kind: FinancialItemKind) => {
    if (kind === draft.kind) {
      // Back to its own kind: the conversion question goes away.
      setPendingKind(null);
      return;
    }
    // Creating: nothing exists yet, switch at once. Editing: ask first.
    if (creating) applyKind(kind);
    else setPendingKind(kind);
  };

  const save = (then: "close" | "statement" = "close"): boolean => {
    if (locked) return false;
    if (!valid) {
      setSubmitCount((count) => count + 1);
      setConfirm(null);
      focusInvalidRef.current = firstErrorPath(fieldErrors, draft.kind);
      return false;
    }
    // Nothing edited: leave the plan as it is. The form opens a recurrence on
    // its first real payment (UX-34), so re-saving would move the clip start.
    if (!creating && !dirty) {
      if (then === "statement") props.onImportStatement?.(itemId);
      else onClose();
      return true;
    }
    const item = cleanItem(normalizeForSave(itemFromForm(draft)));
    const said = effect ? ` ${describePreviewEffect(effect, { reserve: doc.minimumCashReserve })}` : "";
    const undo = () => {
      bridge.core.undo();
    };
    if (creating) {
      bridge.addItem(item, props.placement);
      announce({ message: `Agregado: ${item.name}.${said}`, undo });
      onClose();
      return true;
    }
    if (bridge.replaceItem(item)) {
      announce({ message: `Guardado: ${item.name}.${said}`, undo });
      if (then === "statement") props.onImportStatement?.(item.id);
      else onClose();
      return true;
    }
    setActionError(
      bridge.isItemLocked(itemId)
        ? "No se guardó: la línea de evento está bloqueada."
        : "No se guardó: el elemento ya no existe.",
    );
    return false;
  };

  const remove = () => {
    if (creating || locked) return;
    const name = draft.name.trim() || KIND_LABELS[draft.kind];
    if (bridge.deleteItem(itemId)) {
      announce({ message: `Eliminado: ${name}.`, undo: () => void bridge.core.undo() });
      onClose();
    } else {
      setActionError(
        bridge.isItemLocked(itemId)
          ? "No se eliminó: la línea de evento está bloqueada."
          : "No se eliminó: el elemento ya no existe.",
      );
    }
  };

  // UX-51: the statement replaces the editor — never with changes unsaved.
  const importStatement = () => {
    if (dirty) setConfirm("statement");
    else props.onImportStatement?.(draft.id);
  };
  const requestClose = () => {
    if (dirty && !locked) setConfirm("close");
    else onClose();
  };

  const spec = ITEM_FORM_SPEC[draft.kind];
  const schedule = frequencyParts(recurrence);
  const indefinite = recurrence.endDate === undefined;
  const endMode: "never" | "date" | "count" = indefinite ? "never" : endBy;
  const monthly = showFrequency && recurrence.frequency === "monthly";
  const first = byPayments ? firstPayment(recurrence) : null;
  const startPreview =
    first && isISODate(recurrence.startDate) && first !== recurrence.startDate
      ? `${draft.kind === "income" ? "Primer cobro" : "Primer pago"}: ${formatDateWeekday(first)}`
      : undefined;
  const upcoming = byPayments ? upcomingPayments(recurrence, 4) : [];
  const title = creating
    ? `${NEW_TITLE_PREFIX[draft.kind]} ${KIND_LABELS[draft.kind]}`
    : `Editar ${KIND_LABELS[draft.kind]}`;

  // A number field of the spec changed. An MSI's name that only said the
  // months ("6 MSI") follows them.
  const setNumber = (path: string, value: number | undefined) => {
    const fields: Record<string, unknown> = { [path]: value };
    if (
      path === "installmentsTotal" &&
      value !== undefined &&
      Number.isInteger(value) &&
      value >= 1 &&
      /^\d+ MSI$/.test(draft.name.trim())
    ) {
      fields.name = `${value} MSI`;
    }
    patch(fields);
  };

  // One control per field kind of the spec (item-form-spec.ts): the same
  // drawing for the same kind of field, whatever the item.
  const renderField = (field: FormFieldSpec): React.ReactNode => {
    const label = fieldLabel(field.path, draft);
    const optional = isOptional(field, draft);
    const hint = fieldHint(field, draft);
    const wide = field.width === "wide";
    switch (field.control) {
      case "kind":
        return (
          <div className="fin-editor__field" data-field-path="kind">
            <label className="fin-editor__label" htmlFor={`${titleId}-kind`}>
              {label}
            </label>
            <select
              id={`${titleId}-kind`}
              value={pendingKind ?? draft.kind}
              onChange={(event) => onKindPicked(event.target.value as FinancialItemKind)}
            >
              {KIND_ORDER.map((kind) => (
                <option key={kind} value={kind}>
                  {KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>
        );
      case "text":
        return (
          <label className="fin-editor__field" data-field-path="name">
            <span className="fin-editor__label">{label}</span>
            <input
              ref={nameRef}
              type="text"
              value={draft.name}
              aria-invalid={shownErrors.name ? true : undefined}
              aria-describedby={shownErrors.name ? "fin-editor-name-error" : undefined}
              onChange={(event) => patch({ name: event.target.value })}
            />
            <FieldError id="fin-editor-name-error" message={shownErrors.name} />
          </label>
        );
      case "money":
      case "count":
      case "percent":
        return (
          <NumberField
            label={label}
            path={field.path}
            value={numberAt(draft, field.path)}
            optional={optional}
            hint={hint}
            muted={field.muted?.(draft) ?? false}
            wide={wide}
            suffix={field.control === "percent" ? "%" : undefined}
            onChange={(value) => setNumber(field.path, value)}
          />
        );
      case "computed":
        return draft.kind === "installment-plan" ? <InstallmentValue label={label} plan={draft} wide={wide} /> : null;
      case "payment-mode": {
        const statement = draft.kind === "credit-card" && draft.paymentMode === "statement";
        return (
          <label className={`fin-editor__field${wide ? " fin-editor__field--wide" : ""}`} data-field-path={field.path}>
            <span className="fin-editor__label">{label}</span>
            <select
              value={statement ? "statement" : "fixed"}
              onChange={(event) =>
                patch({
                  paymentMode: event.target.value === "statement" ? "statement" : undefined,
                })
              }
            >
              <option value="fixed">Pago fijo cada mes</option>
              <option value="statement">Pago total del estado de cuenta (totalero)</option>
            </select>
            {hint ? <span className="fin-editor__hint">{hint}</span> : null}
          </label>
        );
      }
      case "card":
        return draft.kind === "card-purchase" || draft.kind === "installment-plan" ? (
          <CardSelect
            label={label}
            cards={cards}
            value={draft.cardId}
            optional={optional}
            bridge={bridge}
            onChange={(cardId) =>
              // A purchase always goes on a card ("" = none picked yet); an
              // MSI may have none.
              patch({ cardId: draft.kind === "card-purchase" ? (cardId ?? "") : cardId })
            }
          />
        ) : null;
      case "repeat":
        return spec.repeat === "choose" ? (
          <div className="fin-editor__field fin-editor__field--wide" data-field-path={field.path}>
            <span className="fin-editor__label" id="fin-editor-repeat">
              {label}
            </span>
            <SchedulePicker
              labelledBy="fin-editor-repeat"
              unit={schedule.unit}
              every={schedule.every}
              onChange={onScheduleChange}
            />
          </div>
        ) : (
          // A card / an MSI moves every month (its days are below): said, not asked.
          <div className="fin-editor__field fin-editor__field--wide fin-editor__computed fin-editor__reading">
            <span className="fin-editor__label">{label}</span>
            <span className="fin-editor__computed-value">Cada mes</span>
          </div>
        );
      case "start":
        return (
          <DateField
            path="recurrence.startDate"
            label={startLabel(draft)}
            value={recurrence.startDate}
            reference={doc.startDate}
            today={today}
            preview={startPreview}
            wide={monthly || wide}
            onChange={onStartDateChange}
          >
            {monthly ? (
              <span className="fin-editor__payday">
                <span aria-hidden="true">Día</span>
                <DaySelect
                  aria-label={draft.kind === "income" ? "Día de cobro" : "Día de pago"}
                  value={monthlyDay(recurrence) >= LAST_DAY ? LAST_DAY : monthlyDay(recurrence)}
                  onChange={(day) => {
                    if (day !== undefined) onPaydayChange(day);
                  }}
                />
              </span>
            ) : null}
          </DateField>
        );
      case "day":
        return (
          <DayField
            label={label}
            path={field.path}
            value={numberAt(draft, field.path)}
            onChange={(day) => patch({ [field.path]: day })}
          />
        );
      case "end":
        if (spec.end === "count") {
          // A loan always ends: after the payments you still owe (UX-08).
          return (
            <NumberField
              label={endLabel(draft)}
              path="recurrence.endDate"
              prefix="Después de"
              suffix="pagos"
              compact
              wide
              hint="Los pagos que te faltan, contando el próximo."
              value={payments ?? undefined}
              onChange={(n) => onPaymentCountChange(n === undefined ? undefined : Math.floor(n))}
            />
          );
        }
        if (spec.end === "derived") {
          return recurrence.endDate !== undefined ? (
            <EndCut
              label={endLabel(draft)}
              endDate={recurrence.endDate}
              onRemove={() => patchRecurrence({ endDate: undefined })}
            />
          ) : (
            <div
              className="fin-editor__field fin-editor__field--wide fin-editor__computed fin-editor__reading"
              data-field-path="recurrence.endDate"
            >
              <span className="fin-editor__label">{endLabel(draft)}</span>
              <span className="fin-editor__computed-value">
                {installmentEndText(planSchedule, draft.kind === "installment-plan" ? draft.installmentsTotal : undefined)}
              </span>
            </div>
          );
        }
        return (
          <div
            className="fin-editor__field fin-editor__field--wide"
            role="radiogroup"
            aria-labelledby="fin-editor-end"
          >
            <span className="fin-editor__label" id="fin-editor-end">
              {endLabel(draft)}
            </span>
            <div className="fin-ends">
              <label className="fin-ends__option">
                <input
                  type="radio"
                  name="fin-editor-end"
                  checked={endMode === "never"}
                  onChange={() => onIndefiniteChange(true)}
                />
                <span>Nunca</span>
              </label>
              <span className="fin-ends__option">
                <label className="fin-ends__choice">
                  <input
                    type="radio"
                    name="fin-editor-end"
                    checked={endMode === "date"}
                    onChange={() => {
                      setEndBy("date");
                      if (indefinite) onIndefiniteChange(false);
                    }}
                  />
                  <span>El</span>
                </label>
                {/* Typing (or picking) a date chooses this option; the
                    focus passing by does not (UX-37). */}
                <span className="fin-ends__input">
                  <DateField
                    inline
                    path="recurrence.endDate"
                    label="Fecha de fin"
                    value={endMode === "date" ? recurrence.endDate : undefined}
                    // "15 nov" for an end date means the next 15 NOV on
                    // or after the start, never one before it.
                    reference={isISODate(recurrence.startDate) ? recurrence.startDate : doc.startDate}
                    today={today}
                    prefer="on-or-after"
                    min={isISODate(recurrence.startDate) ? recurrence.startDate : undefined}
                    onChange={(endDate) => {
                      setEndBy("date");
                      patchRecurrence({ endDate });
                    }}
                  />
                </span>
              </span>
              {byPayments ? (
                <span className="fin-ends__option">
                  <label className="fin-ends__choice">
                    <input
                      type="radio"
                      name="fin-editor-end"
                      checked={endMode === "count"}
                      onChange={() => {
                        setEndBy("count");
                        if (indefinite) onIndefiniteChange(false);
                      }}
                    />
                    <span>Después de</span>
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    className="fin-ends__count"
                    aria-label="Número de pagos"
                    value={endMode === "count" && payments ? String(payments) : ""}
                    onChange={(event) => {
                      const n = Math.floor(Number(event.target.value));
                      setEndBy("count");
                      if (Number.isFinite(n) && n >= 1) onPaymentCountChange(n);
                    }}
                  />
                  <span className="fin-ends__unit">pagos</span>
                </span>
              ) : null}
            </div>
          </div>
        );
      case "loan-calc": {
        if (draft.kind !== "loan") return null;
        const suggested = loanSuggestedPayment(draft);
        return (
          <div className="fin-editor__field--wide fin-editor__calc">
            <button
              type="button"
              className="fin-editor__button fin-editor__button--small"
              disabled={suggested === null}
              aria-describedby={suggested === null ? "fin-editor-calc-hint" : undefined}
              onClick={() => {
                if (suggested !== null) patch({ paymentAmount: suggested });
              }}
            >
              Calcular pago{suggested !== null ? `: ${formatMoney(suggested)}` : ""}
            </button>
            {suggested === null ? (
              <span id="fin-editor-calc-hint" className="fin-editor__hint">
                Escribe cuánto debes y cuántos pagos te faltan.
              </span>
            ) : null}
          </div>
        );
      }
      case "debt-check": {
        if (draft.kind === "loan") {
          const check = loanCheck(draft);
          return check ? (
            <CheckLine text={check.text} tone={check.tone}>
              {check.adjustTo !== undefined ? (
                <button
                  type="button"
                  className="fin-editor__button fin-editor__button--small"
                  onClick={() => onPaymentCountChange(check.adjustTo)}
                >
                  Ajustar a {check.adjustTo} {check.adjustTo === 1 ? "pago" : "pagos"}
                </button>
              ) : null}
            </CheckLine>
          ) : null;
        }
        if (formItem.kind === "credit-card") {
          const payoff = cardPayoffLine(formItem, cardInfo);
          return payoff ? <CheckLine text={payoff.text} tone={payoff.tone} /> : null;
        }
        return null;
      }
      case "payoff-goal":
        if (draft.kind === "loan") {
          return <PayoffGoalField item={draft} doc={doc} today={today} onUse={(goal) => setLoanGoal(goal, patch, draft)} />;
        }
        if (formItem.kind === "credit-card") {
          return (
            <PayoffGoalField
              item={formItem}
              doc={doc}
              today={today}
              onUse={(goal) => patch({ paymentAmount: goal.paymentAmount })}
            />
          );
        }
        return null;
      default:
        return null;
    }
  };

  return (
    <div
      className="playlist-shell__modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        pressedOnOverlayRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedOnOverlayRef.current && event.target === event.currentTarget) {
          requestClose();
        }
        pressedOnOverlayRef.current = false;
      }}
    >
      <div
        ref={dialogRef}
        className="playlist-shell__modal fin-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-mode={creating ? "create" : "edit"}
        data-kind={draft.kind}
        data-locked={locked ? "true" : "false"}
      >
        <header className="playlist-shell__modal-header fin-editor__header">
          <h2 className="fin-editor__title" id={titleId}>
            <span
              className="fin-editor__swatch"
              style={{ background: KIND_COLORS[draft.kind] }}
              aria-hidden="true"
            />
            {title}
          </h2>
          <button
            type="button"
            className="playlist-shell__modal-close"
            onClick={onClose}
            aria-label="Cerrar"
          >
            ×
          </button>
        </header>
        <form
          ref={formRef}
          className="playlist-shell__modal-body fin-editor__body"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
          onBlur={(event) => {
            const path = (event.target as HTMLElement)
              .closest("[data-field-path]")
              ?.getAttribute("data-field-path");
            if (path && !touched.has(path)) setTouched((prev) => new Set(prev).add(path));
          }}
        >
          {locked ? (
            <p className="fin-editor__locked" role="status">
              Línea de evento bloqueada: desbloquéala para editar o eliminar.
            </p>
          ) : null}
          {/* A disabled fieldset disables every control inside (read-only). */}
          <FieldErrorsContext.Provider value={shownErrors}>
          <fieldset className="fin-editor__grid" disabled={locked}>
            {/* The one skeleton (item-form-spec.ts): Tipo · Nombre, then
                Cuánto, Cuándo and Detalles — the same sections in the same
                order for every kind; a section with nothing for this kind
                is left out. A kind switch rebuilds the kind's sections. */}
            {FORM_SECTIONS.map((section) => {
              const fields = sectionFields(draft, section.id);
              if (fields.length === 0) return null;
              const body = fields.map((field) => (
                <React.Fragment key={field.path}>{renderField(field)}</React.Fragment>
              ));
              if (section.title === null) {
                return (
                  <div key={section.id} className={`fin-editor__section fin-editor__section--${section.id}`}>
                    {body}
                    {pendingKind ? (
                      <div
                        className="fin-editor__field--wide fin-editor__kind-confirm"
                        role="group"
                        aria-label="Convertir"
                      >
                        <span>
                          ¿Convertir «{draft.name.trim() || KIND_LABELS[draft.kind]}» de {KIND_LABELS[draft.kind]} a{" "}
                          {KIND_LABELS[pendingKind]}? Lo que no aplique a {KIND_LABELS[pendingKind]} se pierde al
                          guardar.
                        </span>
                        <button
                          type="button"
                          className="fin-editor__button fin-editor__button--primary"
                          onClick={() => applyKind(pendingKind)}
                        >
                          Convertir
                        </button>
                        <button type="button" className="fin-editor__button" onClick={() => setPendingKind(null)}>
                          No
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              }
              const headingId = `fin-editor-${section.id}`;
              return (
                <div
                  key={`${section.id}-${draft.kind}`}
                  className={`fin-editor__section fin-editor__section--${section.id}`}
                  role="group"
                  aria-labelledby={headingId}
                >
                  <h3 id={headingId} className="fin-editor__section-title">
                    {section.title}
                  </h3>
                  {body}
                </div>
              );
            })}
            {/* What it comes to, in plain words: the schedule (and a
                purchase's payment), then what it does to your cash. */}
            <div className="fin-editor__section fin-editor__section--outcome">
              <Readback
                sentence={readback}
                upcoming={upcoming}
                more={byPayments && (recurrence.endDate === undefined || (payments ?? 0) > upcoming.length)}
              />
              {purchase ? <Readback sentence={purchase} /> : null}
              <EffectLine className="fin-editor__field--wide" effect={effect} reserve={doc.minimumCashReserve} />
            </div>
          </fieldset>
          </FieldErrorsContext.Provider>

          {/* The readback, said once typing pauses (UX-37). */}
          <p className="fin-sr-only" role="status" aria-live="polite" aria-atomic="true">
            {spoken}
          </p>

          <footer className="fin-editor__actions">
            <p className="fin-editor__error" role="alert" aria-live="polite">
              {message ?? ""}
            </p>
            {confirm ? (
              <div className="fin-editor__confirm" role="group" aria-labelledby={`${titleId}-confirm`}>
                <span id={`${titleId}-confirm`}>
                  {confirm === "statement"
                    ? "Guarda o descarta tus cambios antes de pegar el estado de cuenta."
                    : "Tienes cambios sin guardar."}
                </span>
                {confirm === "statement" ? (
                  <>
                    <button
                      ref={confirmRef}
                      type="button"
                      className="fin-editor__button fin-editor__button--primary"
                      onClick={() => save("statement")}
                    >
                      Guardar y pegar
                    </button>
                    <button
                      type="button"
                      className="fin-editor__button"
                      onClick={() => props.onImportStatement?.(draft.id)}
                    >
                      Descartar y pegar
                    </button>
                  </>
                ) : (
                  <button ref={confirmRef} type="button" className="fin-editor__button" onClick={onClose}>
                    Descartar cambios
                  </button>
                )}
                <button type="button" className="fin-editor__button" onClick={() => setConfirm(null)}>
                  Seguir editando
                </button>
              </div>
            ) : null}
            <div className="fin-editor__buttons">
              {creating ? null : (
                <button
                  type="button"
                  className="fin-editor__button fin-editor__button--danger"
                  disabled={locked}
                  onClick={remove}
                >
                  Eliminar
                </button>
              )}
              {!creating && draft.kind === "credit-card" && props.onImportStatement ? (
                <button
                  type="button"
                  className="fin-editor__button"
                  disabled={locked}
                  onClick={importStatement}
                >
                  Pegar estado de cuenta…
                </button>
              ) : null}
              <span className="fin-editor__actions-spacer" />
              <button
                ref={cancelRef}
                type="button"
                className="fin-editor__button"
                onClick={onClose}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="fin-editor__button fin-editor__button--primary"
                disabled={locked}
              >
                Guardar
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}

/** An MSI end that cuts installments (UX-07): said, with its error and the fix. */
function EndCut({ label, endDate, onRemove }: { label: string; endDate: string; onRemove: () => void }) {
  const fieldError = useFieldError("recurrence.endDate");
  return (
    <div className="fin-editor__field fin-editor__field--wide" data-field-path="recurrence.endDate">
      <span className="fin-editor__label">{label}</span>
      <span className="fin-editor__control fin-editor__endcut">
        <span>{isISODate(endDate) ? formatDateWeekday(endDate) : endDate}</span>
        <button type="button" className="fin-editor__link" onClick={onRemove} {...errorAria(fieldError)}>
          Quitar la fecha de fin
        </button>
      </span>
      <FieldError {...fieldError} />
    </div>
  );
}

/** An MSI's "Termina", derived from its months: the last installment. */
function installmentEndText(
  schedule: ReturnType<typeof installmentSchedule> | null,
  months: number | undefined,
): string {
  if (!schedule) {
    // Still being written: the months alone already say which one is last.
    return months !== undefined && Number.isInteger(months) && months >= 1
      ? `Con el abono ${months} de ${months}`
      : "Con el último abono";
  }
  if (schedule.all.length === 0) return "Ya pagaste todos los abonos";
  const last = schedule.all[schedule.all.length - 1]!;
  return `Con el abono ${schedule.total} de ${schedule.total}, el ${formatDateWeekday(last)}`;
}

/** A numeric value of the item at a top-level form path (undefined when absent). */
function numberAt(item: FinancialItem, path: string): number | undefined {
  const value = (item as unknown as Record<string, unknown>)[path];
  return typeof value === "number" ? value : undefined;
}

/**
 * "Quiero liquidarla el [fecha]" (UX-28): the canvas goal seek
 * (solveDebtPayment), without dragging — the same words as its pill.
 */
function PayoffGoalField({
  item,
  doc,
  today,
  onUse,
}: {
  item: CreditCardItem | LoanItem;
  doc: FinancialDocument;
  today: ISODate;
  onUse: (goal: PayoffGoal) => void;
}) {
  const [target, setTarget] = React.useState<string | undefined>(undefined);
  const key = JSON.stringify({ ...item, name: "" });
  const goal = React.useMemo(
    () => (target && isISODate(target) ? safely(() => payoffGoal(item, doc, target)) : null),
    // `item` is rebuilt every render; `key` stands for its values.
    [key, doc, target],
  );
  return (
    <DateField
      wide
      optional
      label={fieldLabel("payoffGoal", item)}
      value={target}
      reference={today}
      today={today}
      prefer="on-or-after"
      min={doc.startDate}
      preview={goal ? goal.text : target && isISODate(target) ? "No hay nada que liquidar con estos datos" : undefined}
      onChange={setTarget}
    >
      {goal ? (
        <button type="button" className="fin-editor__button fin-editor__button--small" onClick={() => onUse(goal)}>
          Usar {formatMoney(goal.paymentAmount)}
        </button>
      ) : null}
    </DateField>
  );
}

function setLoanGoal(goal: PayoffGoal, patch: (fields: Record<string, unknown>) => void, loan: LoanItem) {
  const fields: Record<string, unknown> = { paymentAmount: goal.paymentAmount };
  if (goal.endDate) fields.recurrence = { ...loan.recurrence, endDate: goal.endDate };
  patch(fields);
}

/** An MSI's "Mensualidad": computed from the purchase and the months, read-only. */
function InstallmentValue({ label, plan, wide }: { label: string; plan: InstallmentPlanItem; wide: boolean }) {
  const valid =
    Number.isFinite(plan.originalAmount) &&
    plan.originalAmount >= 0 &&
    Number.isInteger(plan.installmentsTotal) &&
    plan.installmentsTotal >= 1 &&
    Number.isInteger(plan.installmentsPaid) &&
    plan.installmentsPaid >= 0 &&
    plan.installmentsPaid <= plan.installmentsTotal;
  return (
    <div className={`fin-editor__field${wide ? " fin-editor__field--wide" : ""} fin-editor__computed`}>
      <span className="fin-editor__label">{label}</span>
      <span className="fin-editor__computed-value">
        {valid ? formatMoney(monthlyInstallment(plan)) : "—"}
        {valid ? (
          <span className="fin-editor__computed-note">
            {" "}
            · restante {formatMoney(remainingInstallmentDebt(plan))}
          </span>
        ) : null}
      </span>
    </div>
  );
}
