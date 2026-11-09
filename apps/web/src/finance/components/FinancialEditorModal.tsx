// Editor for one financial item. Two modes:
// - edit:   opened by double-clicking a clip (`itemId`). "Guardar" replaces
//           the item in one undo entry; "Eliminar" deletes it.
// - create: opened by "+ Ingreso" & co. with a `draft` from
//           bridge.createDraftItem. Nothing exists until "Guardar", which
//           adds it; Cancelar / Escape / × / overlay leave the document as is.
// Either way the form works on a local draft and nothing reaches the bridge
// before "Guardar". Items on a locked track open read-only.
import * as React from "react";
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
  RecurrenceFrequency,
} from "@slicex/core";
import type { FinancialBridgeApi, FinancialPlacement } from "../bridge-api";
import {
  formatDateInput,
  formatDateWeekday,
  formatMoney,
  parseDateInput,
  shiftISODate,
  type DateYearPreference,
} from "../format";
import { FREQUENCY_LABELS, KIND_COLORS, KIND_LABELS, KIND_ORDER } from "../labels";
import { parseNumberInput, useFinancialRevision } from "./FinancialUi";
import {
  LAST_DAY,
  lastPayment,
  monthlyDay,
  paymentCount,
  scheduleSummary,
  snapEndToLastPayment,
  withMonthlyDay,
  withPaymentCount,
  withStartDate,
} from "../schedule-ui";

/** Payments a new end covers by default: about a year. */
const DEFAULT_PAYMENTS: Readonly<Record<RecurrenceFrequency, number>> = {
  once: 1,
  weekly: 52,
  biweekly: 26,
  semimonthly: 24,
  monthly: 12,
};

const MONTH_DAYS: ReadonlyArray<number> = Array.from({ length: 30 }, (_, i) => i + 1);

interface FinancialEditorModalBaseProps {
  bridge: FinancialBridgeApi;
  onClose: () => void;
  /**
   * Where focus goes on close when the element focused before opening is
   * gone or was <body> (the shell passes the canvas host so playlist
   * shortcuts keep working).
   */
  returnFocusFallback?: () => HTMLElement | null;
  /** Credit cards: open the "paste a statement" flow for this card. */
  onImportStatement?: (cardId: string) => void;
  /** Create: the row the new item should land on (see bridge.addItem). */
  placement?: FinancialPlacement;
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

const FREQUENCY_ORDER: ReadonlyArray<RecurrenceFrequency> = [
  "once",
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
];

/** Kinds whose schedule is driven by `recurrence.frequency`. */
function usesFrequency(kind: FinancialItemKind): boolean {
  return kind !== "credit-card" && kind !== "installment-plan";
}

/**
 * Single-occurrence item. Convention (same as createDefaultFinancialItem):
 * a "once" window is one day, endDate === startDate.
 */
function isOnce(item: FinancialItem): boolean {
  return usesFrequency(item.kind) && item.recurrence.frequency === "once";
}

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
    name: prev.name,
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
  if (isOnce(draft)) {
    delete recurrence.anchorDate;
    recurrence.endDate = recurrence.startDate;
  }
  item.recurrence =
    usesFrequency(draft.kind) && !isOnce(draft) ? snapEndToLastPayment(recurrence) : recurrence;
  return item as unknown as FinancialItem;
}

function checkMoney(
  value: number | undefined,
  label: string,
  optional = false,
): string | null {
  if (value === undefined) return optional ? null : `${label}: requerido.`;
  if (!Number.isFinite(value)) return `${label}: número inválido.`;
  if (value < 0) return `${label}: no puede ser negativo.`;
  return null;
}

function checkDay(value: number, label: string): string | null {
  if (!Number.isInteger(value) || value < 1 || value > 31) {
    return `${label}: debe ser un día entre 1 y 31.`;
  }
  return null;
}

/** First validation error of the draft, or null when it can be saved. */
export function validateFinancialDraft(
  draft: FinancialItem,
  cards: ReadonlyArray<CreditCardItem>,
): string | null {
  if (draft.name.trim() === "") return "Nombre: requerido.";
  const recurrence = draft.recurrence;
  if (!isISODate(recurrence.startDate)) return "Fecha: inválida.";
  if (recurrence.endDate !== undefined) {
    if (!isISODate(recurrence.endDate)) return "Fecha final: inválida.";
    if (compareISODate(recurrence.endDate, recurrence.startDate) < 0) {
      return "Fecha final: no puede ser anterior a la fecha.";
    }
  }
  const hasCard = (id: string | undefined) =>
    id !== undefined && cards.some((card) => card.id === id);
  switch (draft.kind) {
    case "income":
    case "expense":
      return checkMoney(draft.amount, "Monto");
    case "card-purchase":
      return (
        checkMoney(draft.amount, "Monto") ??
        (hasCard(draft.cardId) ? null : "Tarjeta: selecciona una tarjeta.")
      );
    case "loan":
      return (
        checkMoney(draft.paymentAmount, "Pago") ??
        checkMoney(draft.balance, "Saldo", true) ??
        checkMoney(draft.annualRate, "Tasa anual", true)
      );
    case "credit-card":
      return (
        checkMoney(draft.balance, "Saldo") ??
        checkMoney(draft.annualRate, "Tasa anual") ??
        checkDay(draft.cutDay, "Día de corte") ??
        checkDay(draft.dueDay, "Día de pago") ??
        checkMoney(draft.minimumPayment, "Pago mínimo") ??
        checkMoney(draft.paymentAmount, "Pago planeado", true)
      );
    case "installment-plan": {
      const amountError = checkMoney(draft.originalAmount, "Monto original");
      if (amountError) return amountError;
      if (
        !Number.isInteger(draft.installmentsTotal) ||
        draft.installmentsTotal < 1
      ) {
        return "Meses: debe ser un entero ≥ 1.";
      }
      if (
        !Number.isInteger(draft.installmentsPaid) ||
        draft.installmentsPaid < 0
      ) {
        return "Pagados: debe ser un entero ≥ 0.";
      }
      if (draft.installmentsPaid > draft.installmentsTotal) {
        return "Pagados: no puede ser mayor que Meses.";
      }
      if (draft.cardId !== undefined && !hasCard(draft.cardId)) {
        return "Tarjeta: la tarjeta ya no existe.";
      }
      return null;
    }
    default:
      return null;
  }
}

function numberToText(value: number | undefined): string {
  return value === undefined || Number.isNaN(value) ? "" : String(value);
}

function sameNumber(a: number | undefined, b: number | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b));
}

/**
 * Text input holding a number. Keeps the raw text locally so partial input
 * ("12.", "") is not clobbered; emits NaN for garbage / empty-required and
 * `undefined` for empty-optional (validation reports it).
 */
function NumberField({
  label,
  value,
  onChange,
  optional = false,
  suffix,
  placeholder,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  optional?: boolean;
  suffix?: string;
  placeholder?: string;
}) {
  const [text, setText] = React.useState(() => numberToText(value));
  const emittedRef = React.useRef(value);
  React.useEffect(() => {
    if (!sameNumber(value, emittedRef.current)) {
      emittedRef.current = value;
      setText(numberToText(value));
    }
  }, [value]);
  return (
    <label className="fin-editor__field">
      <span className="fin-editor__label">
        {label}
        {optional ? <em className="fin-editor__optional"> (opcional)</em> : null}
      </span>
      <span className="fin-editor__control">
        <input
          type="text"
          inputMode="decimal"
          spellCheck={false}
          value={text}
          placeholder={placeholder}
          onChange={(event) => {
            const raw = event.target.value;
            setText(raw);
            const parsed = parseNumberInput(raw);
            const next =
              parsed === null ? (optional ? undefined : Number.NaN) : parsed;
            emittedRef.current = next;
            onChange(next);
          }}
        />
        {suffix ? <span className="fin-editor__suffix">{suffix}</span> : null}
      </span>
    </label>
  );
}

/**
 * es-MX date entry (never the browser's locale-dependent date picker, which
 * renders mm/dd/yyyy in en-US browsers). Free text parsed by
 * `parseDateInput` ("15/11/2026", "15 nov", "2026-11-15"…) with a live
 * canonical preview ("dom 15 NOV 2026") and inline validation. ↑/↓ move
 * the date one day (Shift: one week), never below `min`.
 *
 * Emits the ISO date, or "" while the text is not a date (the form's
 * validation then blocks Guardar). Keeps the raw text locally so typing is
 * never clobbered; canonicalises it ("15/11/2026") on blur.
 */
function DateField({
  label,
  value,
  onChange,
  reference,
  prefer = "nearest",
  min,
  disabled = false,
  children,
}: {
  label: string;
  /** ISO date, "" (invalid entry) or undefined (no date, e.g. Indefinido). */
  value: string | undefined;
  onChange: (iso: string) => void;
  /** Where a date typed without a year ("15 nov") takes its year from. */
  reference: string;
  prefer?: DateYearPreference;
  min?: string;
  disabled?: boolean;
  /** Extra controls on the input row (e.g. the "Indefinido" checkbox). */
  children?: React.ReactNode;
}) {
  const id = React.useId();
  const [text, setText] = React.useState(() => formatDateInput(value));
  const emittedRef = React.useRef(value);
  React.useEffect(() => {
    if (value !== emittedRef.current) {
      emittedRef.current = value;
      setText(formatDateInput(value));
    }
  }, [value]);

  const emit = (iso: string) => {
    if (iso === emittedRef.current) return;
    emittedRef.current = iso;
    onChange(iso);
  };

  const parsed = parseDateInput(text, reference, prefer);
  const empty = text.trim() === "";
  const status = disabled ? "off" : parsed ? "ok" : empty ? "empty" : "invalid";
  const message =
    status === "off"
      ? ""
      : parsed
        ? formatDateWeekday(parsed)
        : empty
          ? "ej. 15/11/2026 o 15 nov"
          : "No reconocida · ej. 15/11/2026";

  return (
    <div className="fin-editor__field fin-date">
      <label className="fin-editor__label" htmlFor={id}>
        {label}
      </label>
      <span className="fin-editor__control">
        <input
          id={id}
          type="text"
          autoComplete="off"
          spellCheck={false}
          className="fin-date__input"
          placeholder="dd/mm/aaaa"
          value={text}
          disabled={disabled}
          aria-invalid={status === "invalid" || status === "empty"}
          aria-describedby={`${id}-preview`}
          onChange={(event) => {
            const raw = event.target.value;
            setText(raw);
            emit(parseDateInput(raw, reference, prefer) ?? "");
          }}
          onBlur={() => {
            if (parsed) setText(formatDateInput(parsed));
          }}
          onKeyDown={(event) => {
            if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
            if (event.altKey || event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            const base = parsed ?? (value || reference);
            const step = (event.key === "ArrowUp" ? 1 : -1) * (event.shiftKey ? 7 : 1);
            let next = shiftISODate(base, step);
            if (next === null) return;
            if (min !== undefined && isISODate(min) && compareISODate(next, min) < 0) {
              next = min;
            }
            setText(formatDateInput(next));
            emit(next);
          }}
        />
        {children}
      </span>
      <span
        id={`${id}-preview`}
        className="fin-date__preview"
        data-state={status}
      >
        {message}
      </span>
    </div>
  );
}

function CardSelect({
  label,
  cards,
  value,
  optional,
  onChange,
}: {
  label: string;
  cards: ReadonlyArray<CreditCardItem>;
  value: string | undefined;
  optional: boolean;
  onChange: (cardId: string | undefined) => void;
}) {
  const known = value !== undefined && cards.some((card) => card.id === value);
  // A card id that no longer exists (card deleted, or a stale default) gets
  // its own selected placeholder option. Rendering it as "" instead would
  // make "— Sin tarjeta —" / "Selecciona…" the already-selected option, and
  // picking it again fires no change event: the form could never be fixed.
  const missing = value !== undefined && value !== "" && !known;
  if (cards.length === 0 && !optional) {
    return (
      <div className="fin-editor__field">
        <span className="fin-editor__label">{label}</span>
        <span className="fin-editor__hint">
          No hay tarjetas. Agrega una con “+ Tarjeta”.
        </span>
      </div>
    );
  }
  return (
    <label className="fin-editor__field">
      <span className="fin-editor__label">
        {label}
        {optional ? <em className="fin-editor__optional"> (opcional)</em> : null}
      </span>
      <select
        value={known || missing ? value : ""}
        onChange={(event) => onChange(event.target.value || undefined)}
      >
        {optional ? (
          <option value="">— Sin tarjeta —</option>
        ) : known || missing ? null : (
          <option value="" disabled>
            Selecciona…
          </option>
        )}
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
    </label>
  );
}

/**
 * Whether the item's clip sits on a locked track. Re-checked only when the
 * playlist's tracks / clips change (lock toggles, moves): hover, playhead and
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

/**
 * Focus management for the modal: remembers the element focused when it
 * opened and gives focus back to it when the editor goes away (fallback:
 * `fallback()`, e.g. the canvas host, when that element is gone or was
 * <body>). Runs in a passive-effect cleanup, i.e. after the commit that also
 * lifts `inert` from the shell, so the target is focusable again.
 */
function useRestoreFocus(fallback: (() => HTMLElement | null) | undefined) {
  const fallbackRef = React.useRef(fallback);
  fallbackRef.current = fallback;
  const [opener] = React.useState<Element | null>(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );
  React.useEffect(
    () => () => {
      const target =
        opener instanceof HTMLElement &&
        opener.isConnected &&
        opener !== opener.ownerDocument.body
          ? opener
          : (fallbackRef.current?.() ?? null);
      target?.focus({ preventScroll: true });
    },
    [opener],
  );
}

export function FinancialEditorModal(props: FinancialEditorModalProps) {
  const { bridge, onClose, returnFocusFallback } = props;
  const creating = props.draft !== undefined;
  // Create mode: the draft's id is not in the document (nor the playlist).
  const itemId = props.draft !== undefined ? props.draft.id : props.itemId;
  const revision = useFinancialRevision(bridge);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;
  useRestoreFocus(returnFocusFallback);

  const [draft, setDraft] = React.useState<FinancialItem | null>(() =>
    props.draft !== undefined ? props.draft : bridge.getItem(itemId),
  );
  const loadedIdRef = React.useRef(itemId);
  React.useEffect(() => {
    if (creating || loadedIdRef.current === itemId) return;
    loadedIdRef.current = itemId;
    setDraft(bridge.getItem(itemId));
  }, [bridge, itemId, creating]);

  // Failure reported by the bridge on Guardar / Eliminar (the modal stays
  // open). Cleared by any further edit.
  const [actionError, setActionError] = React.useState<string | null>(null);
  React.useEffect(() => setActionError(null), [draft]);

  const doc = React.useMemo(
    () => bridge.getDocument(),
    // `revision` is the cache key for document changes.
    [bridge, revision],
  );
  const cards = React.useMemo(
    () =>
      doc.items.filter(
        (item): item is CreditCardItem =>
          item.kind === "credit-card" && item.id !== itemId,
      ),
    [doc, itemId],
  );

  // Edit mode: close when the item does not exist (bad id, deleted / undone
  // elsewhere). A create-mode draft never exists in the document.
  const exists = React.useMemo(
    () => creating || bridge.getItem(itemId) !== null,
    [bridge, itemId, creating, revision],
  );
  React.useEffect(() => {
    if (!exists) onCloseRef.current();
  }, [exists]);

  // Items on a locked track are read-only: the playlist vetoes every edit
  // of their clip, so a save would silently drop the dates.
  const locked = useItemLocked(bridge, creating ? null : itemId);

  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const nameRef = React.useRef<HTMLInputElement | null>(null);
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);
  React.useEffect(() => {
    const input = nameRef.current;
    if (!input) return;
    if (input.matches(":disabled")) {
      // Read-only (locked track): focus still has to land in the dialog.
      cancelRef.current?.focus();
      return;
    }
    input.focus();
    input.select();
  }, [itemId]);

  // Overlay closes only on a click that started on the overlay (a text
  // selection dragged out of an input must not close the editor).
  const pressedOnOverlayRef = React.useRef(false);

  if (!draft || !exists) return null;

  const error = validateFinancialDraft(draft, cards);

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
      let recurrence: FinancialRecurrence = withStartDate(prev.recurrence, value);
      // A recurring end is a number of payments: it travels with the start.
      const count =
        usesFrequency(prev.kind) && !isOnce(prev) && isISODate(value)
          ? paymentCount(prev.recurrence)
          : null;
      if (count !== null && count > 0) recurrence = withPaymentCount(recurrence, count);
      else if (isISODate(value) && recurrence.endDate !== undefined) {
        if (isOnce(prev)) {
          // Hidden end of a one-day window follows the date.
          recurrence.endDate = value;
        } else if (
          isISODate(recurrence.endDate) &&
          compareISODate(recurrence.endDate, value) < 0
        ) {
          recurrence.endDate = value;
        }
      }
      return { ...prev, recurrence };
    });

  const onFrequencyChange = (frequency: RecurrenceFrequency) =>
    setDraft((prev) => {
      if (!prev) return prev;
      const recurrence: FinancialRecurrence = { ...prev.recurrence, frequency };
      if (frequency === "once") {
        // One-day window (endDate === startDate), like the core defaults.
        // The anchor stays in the draft (switching back keeps the paydays);
        // normalizeForSave strips it from a saved single occurrence.
        recurrence.endDate = recurrence.startDate;
      } else if (
        isOnce(prev) &&
        recurrence.endDate !== undefined &&
        recurrence.endDate === recurrence.startDate
      ) {
        // once → recurring: a one-day window would allow a single
        // occurrence; open it up (Indefinido) instead.
        delete recurrence.endDate;
      }
      return { ...prev, recurrence };
    });

  const onIndefiniteChange = (indefinite: boolean) =>
    setDraft((prev) => {
      if (!prev) return prev;
      const recurrence: FinancialRecurrence = { ...prev.recurrence };
      if (indefinite) {
        delete recurrence.endDate;
      } else if (usesFrequency(prev.kind) && !isOnce(prev)) {
        return {
          ...prev,
          recurrence: withPaymentCount(recurrence, DEFAULT_PAYMENTS[recurrence.frequency]),
        };
      } else {
        const base = isISODate(recurrence.startDate)
          ? recurrence.startDate
          : doc.startDate;
        recurrence.endDate = addMonths(base, 12);
      }
      return { ...prev, recurrence };
    });

  const onMonthlyDayChange = (day: number) =>
    setDraft((prev) =>
      prev ? { ...prev, recurrence: withMonthlyDay(prev.recurrence, day) } : prev,
    );

  const onPaymentCountChange = (count: number) =>
    setDraft((prev) =>
      prev && count >= 1
        ? { ...prev, recurrence: withPaymentCount(prev.recurrence, count) }
        : prev,
    );

  const onKindChange = (kind: FinancialItemKind) =>
    setDraft((prev) =>
      prev && prev.kind !== kind ? switchKind(prev, kind, doc) : prev,
    );

  const save = () => {
    if (locked || validateFinancialDraft(draft, cards) !== null) return;
    if (creating) {
      bridge.addItem(normalizeForSave(draft), props.placement);
      onClose();
      return;
    }
    if (bridge.replaceItem(normalizeForSave(draft))) {
      onClose();
    } else {
      setActionError(
        bridge.isItemLocked(itemId)
          ? "No se guardó: la pista está bloqueada."
          : "No se guardó: el elemento ya no existe.",
      );
    }
  };

  const remove = () => {
    if (creating || locked) return;
    if (bridge.deleteItem(itemId)) {
      onClose();
    } else {
      setActionError(
        bridge.isItemLocked(itemId)
          ? "No se eliminó: la pista está bloqueada."
          : "No se eliminó: el elemento ya no existe.",
      );
    }
  };

  const recurrence = draft.recurrence;
  const showFrequency = usesFrequency(draft.kind);
  const showEndDate = !(showFrequency && recurrence.frequency === "once");
  // Frequency kinds (income, expense, loan, purchase) end after N payments;
  // cards / MSI keep their own end date.
  const byPayments = showFrequency && recurrence.frequency !== "once";
  const indefinite = recurrence.endDate === undefined;
  const payments = byPayments ? paymentCount(recurrence) : null;
  const last = byPayments ? lastPayment(recurrence) : null;
  const title = creating
    ? `${NEW_TITLE_PREFIX[draft.kind]} ${KIND_LABELS[draft.kind]}`
    : `Editar ${KIND_LABELS[draft.kind]}`;
  const message = error ?? actionError;

  return (
    <div
      className="playlist-shell__modal-overlay"
      role="presentation"
      onMouseDown={(event) => {
        pressedOnOverlayRef.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressedOnOverlayRef.current && event.target === event.currentTarget) {
          onClose();
        }
        pressedOnOverlayRef.current = false;
      }}
    >
      <div
        className="playlist-shell__modal fin-editor"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-mode={creating ? "create" : "edit"}
        data-locked={locked ? "true" : "false"}
      >
        <header className="playlist-shell__modal-header">
          <strong className="fin-editor__title">
            <span
              className="fin-editor__swatch"
              style={{ background: KIND_COLORS[draft.kind] }}
              aria-hidden="true"
            />
            {title}
          </strong>
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
          className="playlist-shell__modal-body fin-editor__body"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          {locked ? (
            <p className="fin-editor__locked" role="status">
              Pista bloqueada: desbloquéala para editar o eliminar.
            </p>
          ) : null}
          {/* A disabled fieldset disables every control inside (read-only). */}
          <fieldset className="fin-editor__grid" disabled={locked}>
            <label className="fin-editor__field fin-editor__field--wide">
              <span className="fin-editor__label">Nombre</span>
              <input
                ref={nameRef}
                type="text"
                value={draft.name}
                onChange={(event) => patch({ name: event.target.value })}
              />
            </label>
            <label className="fin-editor__field fin-editor__field--wide">
              <span className="fin-editor__label">Tipo</span>
              <select
                value={draft.kind}
                onChange={(event) =>
                  onKindChange(event.target.value as FinancialItemKind)
                }
              >
                {KIND_ORDER.map((kind) => (
                  <option key={kind} value={kind}>
                    {KIND_LABELS[kind]}
                  </option>
                ))}
              </select>
            </label>

            <KindFields
              key={draft.kind}
              draft={draft}
              cards={cards}
              patch={patch}
            />

            <DateField
              label="Fecha"
              value={recurrence.startDate}
              reference={doc.startDate}
              onChange={onStartDateChange}
            />
            {showFrequency ? (
              <label className="fin-editor__field">
                <span className="fin-editor__label">Frecuencia</span>
                <select
                  value={recurrence.frequency}
                  onChange={(event) =>
                    onFrequencyChange(event.target.value as RecurrenceFrequency)
                  }
                >
                  {FREQUENCY_ORDER.map((frequency) => (
                    <option key={frequency} value={frequency}>
                      {FREQUENCY_LABELS[frequency]}
                    </option>
                  ))}
                </select>
                <span className="fin-date__preview" data-state="ok">
                  {byPayments && recurrence.frequency !== "monthly"
                    ? scheduleSummary(recurrence)
                    : ""}
                </span>
              </label>
            ) : null}
            {byPayments && recurrence.frequency === "monthly" ? (
              <label className="fin-editor__field">
                <span className="fin-editor__label">Día de pago</span>
                <select
                  value={monthlyDay(recurrence)}
                  onChange={(event) => onMonthlyDayChange(Number(event.target.value))}
                >
                  {MONTH_DAYS.map((day) => (
                    <option key={day} value={day}>
                      Día {day}
                    </option>
                  ))}
                  <option value={LAST_DAY}>Último día del mes</option>
                </select>
                <span className="fin-date__preview" data-state="ok">
                  {scheduleSummary(recurrence)}
                </span>
              </label>
            ) : null}
            {byPayments ? (
              <div className="fin-editor__field">
                <label className="fin-editor__label" htmlFor="fin-editor-payments">
                  Pagos
                </label>
                <span className="fin-editor__control">
                  <input
                    id="fin-editor-payments"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    step={1}
                    value={indefinite ? "" : String(payments ?? "")}
                    disabled={indefinite}
                    placeholder="—"
                    onChange={(event) => {
                      const n = Math.floor(Number(event.target.value));
                      if (Number.isFinite(n) && n >= 1) onPaymentCountChange(n);
                    }}
                  />
                  <label className="fin-editor__check">
                    <input
                      type="checkbox"
                      checked={indefinite}
                      onChange={(event) => onIndefiniteChange(event.target.checked)}
                    />
                    <span>Indefinido</span>
                  </label>
                </span>
                <span className="fin-date__preview" data-state="ok">
                  {indefinite
                    ? "Sin final: sigue hasta el horizonte"
                    : last
                      ? `Último: ${formatDateWeekday(last)}`
                      : "Ningún pago en ese rango"}
                </span>
              </div>
            ) : null}
            {showEndDate && !byPayments ? (
              <DateField
                label="Fecha final"
                value={recurrence.endDate}
                disabled={indefinite}
                // "15 nov" for an end date means the next 15 NOV on or
                // after the start, never one before it.
                reference={
                  isISODate(recurrence.startDate)
                    ? recurrence.startDate
                    : doc.startDate
                }
                prefer="on-or-after"
                min={
                  isISODate(recurrence.startDate)
                    ? recurrence.startDate
                    : undefined
                }
                onChange={(endDate) => patchRecurrence({ endDate })}
              >
                <label className="fin-editor__check">
                  <input
                    type="checkbox"
                    checked={indefinite}
                    onChange={(event) => onIndefiniteChange(event.target.checked)}
                  />
                  <span>Indefinido</span>
                </label>
              </DateField>
            ) : null}
          </fieldset>

          <p className="fin-editor__error" role="alert" aria-live="polite">
            {message ?? ""}
          </p>

          <footer className="fin-editor__actions">
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
                onClick={() => props.onImportStatement?.(draft.id)}
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
              disabled={locked || error !== null}
            >
              Guardar
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function KindFields({
  draft,
  cards,
  patch,
}: {
  draft: FinancialItem;
  cards: ReadonlyArray<CreditCardItem>;
  patch: (fields: Record<string, unknown>) => void;
}) {
  switch (draft.kind) {
    case "income":
    case "expense":
      return (
        <NumberField
          label="Monto"
          value={draft.amount}
          onChange={(amount) => patch({ amount })}
        />
      );
    case "card-purchase":
      return (
        <>
          <NumberField
            label="Monto"
            value={draft.amount}
            onChange={(amount) => patch({ amount })}
          />
          <CardSelect
            label="Tarjeta"
            cards={cards}
            value={draft.cardId || undefined}
            optional={false}
            onChange={(cardId) => patch({ cardId: cardId ?? "" })}
          />
        </>
      );
    case "loan":
      return (
        <>
          <NumberField
            label="Pago"
            value={draft.paymentAmount}
            onChange={(paymentAmount) => patch({ paymentAmount })}
          />
          <NumberField
            label="Saldo"
            optional
            value={draft.balance}
            onChange={(balance) => patch({ balance })}
          />
          <NumberField
            label="Tasa anual"
            optional
            suffix="%"
            value={draft.annualRate}
            onChange={(annualRate) => patch({ annualRate })}
          />
        </>
      );
    case "credit-card":
      return (
        <>
          <label className="fin-editor__field fin-editor__field--wide">
            <span className="fin-editor__label">Forma de pago</span>
            <select
              value={draft.paymentMode === "statement" ? "statement" : "fixed"}
              onChange={(event) =>
                patch({
                  paymentMode: event.target.value === "statement" ? "statement" : undefined,
                })
              }
            >
              <option value="fixed">Pago fijo cada mes</option>
              <option value="statement">Pago total del estado de cuenta (totalero)</option>
            </select>
            {draft.paymentMode === "statement" ? (
              <span className="fin-editor__hint">
                Cada fecha de pago liquidas lo que se cortó: nunca pagas intereses. Una compra
                después del corte se paga hasta el mes siguiente.
              </span>
            ) : null}
          </label>
          <NumberField
            label="Saldo"
            value={draft.balance}
            onChange={(balance) => patch({ balance })}
          />
          <NumberField
            label="Tasa anual"
            suffix="%"
            value={draft.annualRate}
            onChange={(annualRate) => patch({ annualRate })}
          />
          <NumberField
            label="Día de corte"
            value={draft.cutDay}
            onChange={(cutDay) => patch({ cutDay: cutDay ?? Number.NaN })}
          />
          <NumberField
            label="Día de pago"
            value={draft.dueDay}
            onChange={(dueDay) => patch({ dueDay: dueDay ?? Number.NaN })}
          />
          <NumberField
            label="Pago mínimo"
            value={draft.minimumPayment}
            onChange={(minimumPayment) => patch({ minimumPayment })}
          />
          {draft.paymentMode === "statement" ? null : (
            <NumberField
              label="Pago planeado"
              optional
              value={draft.paymentAmount}
              onChange={(paymentAmount) => patch({ paymentAmount })}
            />
          )}
        </>
      );
    case "installment-plan":
      return <InstallmentFields draft={draft} cards={cards} patch={patch} />;
    default:
      return null;
  }
}

function InstallmentFields({
  draft,
  cards,
  patch,
}: {
  draft: Extract<FinancialItem, { kind: "installment-plan" }>;
  cards: ReadonlyArray<CreditCardItem>;
  patch: (fields: Record<string, unknown>) => void;
}) {
  const valid =
    Number.isFinite(draft.originalAmount) &&
    draft.originalAmount >= 0 &&
    Number.isInteger(draft.installmentsTotal) &&
    draft.installmentsTotal >= 1 &&
    Number.isInteger(draft.installmentsPaid) &&
    draft.installmentsPaid >= 0 &&
    draft.installmentsPaid <= draft.installmentsTotal;
  return (
    <>
      <NumberField
        label="Monto original"
        value={draft.originalAmount}
        onChange={(originalAmount) => patch({ originalAmount })}
      />
      <NumberField
        label="Meses"
        value={draft.installmentsTotal}
        onChange={(installmentsTotal) =>
          patch({ installmentsTotal: installmentsTotal ?? Number.NaN })
        }
      />
      <NumberField
        label="Pagados"
        value={draft.installmentsPaid}
        onChange={(installmentsPaid) =>
          patch({ installmentsPaid: installmentsPaid ?? Number.NaN })
        }
      />
      <CardSelect
        label="Tarjeta"
        cards={cards}
        value={draft.cardId}
        optional
        onChange={(cardId) => patch({ cardId })}
      />
      <div className="fin-editor__field fin-editor__field--wide fin-editor__computed">
        <span className="fin-editor__label">Mensualidad</span>
        <span className="fin-editor__computed-value">
          {valid ? formatMoney(monthlyInstallment(draft)) : "—"}
          {valid ? (
            <span className="fin-editor__computed-note">
              {" "}
              · restante {formatMoney(remainingInstallmentDebt(draft))}
            </span>
          ) : null}
        </span>
      </div>
    </>
  );
}
