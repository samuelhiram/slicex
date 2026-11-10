// Editor for one financial item. Two modes:
// - edit:   opened by double-clicking a clip (`itemId`). "Guardar" replaces
//           the item in one undo entry; "Eliminar" deletes it.
// - create: opened by "+ Ingreso" & co. with a `draft` from
//           bridge.createDraftItem. Nothing exists until "Guardar", which
//           adds it; Cancelar / Escape / × / overlay leave the document as is.
// Either way the form works on a local draft and nothing reaches the bridge
// before "Guardar". Items on a locked track open read-only.
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
  RecurrenceFrequency,
} from "@slicex/core";
import type { FinancialBridgeApi, FinancialPlacement } from "../bridge-api";
import { formatDateWeekday, formatMoney, parseNumberInput } from "../format";
import { KIND_COLORS, KIND_LABELS, KIND_ORDER } from "../labels";
import { useFinancialRevision } from "./FinancialUi";
import { DateField } from "./DateField";
import { FieldError, FieldErrorsContext, useEditableText, useFieldError } from "./form-kit";
import { SchedulePicker } from "./SchedulePicker";
import { cleanItem, firstFieldError, itemFormErrors } from "../item-schema";
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

/** A monthly start on its month's last day (or already "último día"). */
function endsMonth(rule: FinancialRecurrence): boolean {
  if (monthlyDay(rule) === LAST_DAY) return true;
  if (!isISODate(rule.startDate)) return false;
  const [y, m, d] = rule.startDate.split("-").map(Number) as [number, number, number];
  return d === new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Day of month of the start (the payday of a monthly rule). */
function startDayOfMonth(rule: FinancialRecurrence): number {
  return isISODate(rule.startDate) ? Number(rule.startDate.slice(8, 10)) : 1;
}

// Values of the form while the edited item does not exist (the modal is
// closing): never shown.
const MISSING_ITEM: FinancialItem = {
  id: "",
  kind: "expense",
  name: "",
  amount: 0,
  recurrence: { frequency: "once", startDate: "1970-01-01", endDate: "1970-01-01" },
};

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
): string | null {
  return firstFieldError(itemFormErrors(draft, cards), draft);
}

// Field errors are shown under their field and tied to its input (form-kit:
// FieldErrorsContext, provided around the fields with the form's errors).

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
  path,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  optional?: boolean;
  suffix?: string;
  placeholder?: string;
  /** Form path of the value (its schema error shows under the field). */
  path?: string;
}) {
  const fieldError = useFieldError(path);
  const { text, setText, emit } = useEditableText(value, numberToText, sameNumber);
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
          aria-invalid={fieldError.message ? true : undefined}
          aria-describedby={fieldError.message ? fieldError.id : undefined}
          onChange={(event) => {
            const raw = event.target.value;
            setText(raw);
            const parsed = parseNumberInput(raw);
            const next =
              parsed === null ? (optional ? undefined : Number.NaN) : parsed;
            if (emit(next)) onChange(next);
          }}
        />
        {suffix ? <span className="fin-editor__suffix">{suffix}</span> : null}
      </span>
      <FieldError {...fieldError} />
    </label>
  );
}

// Plain-words readback of the "Cuándo" block: what will happen, and the
// next dates — so the person sees the schedule, not just the controls.
function ScheduleReadback({
  draft,
  payments,
  last,
}: {
  draft: FinancialItem;
  payments: number | null;
  last: string | null;
}) {
  const rule = draft.recurrence;
  if (!isISODate(rule.startDate)) return null;
  const amount = primaryAmount(draft);
  const money = amount !== undefined && Number.isFinite(amount) ? ` ${formatMoney(amount)}` : "";
  const verb = draft.kind === "income" ? "Cobras" : "Pagas";
  const once = rule.frequency === "once";
  const upcoming = once ? [] : upcomingPayments(rule, 4);
  let sentence: string;
  if (once) {
    sentence = `${verb}${money} una sola vez, el ${formatDateWeekday(rule.startDate)}.`;
  } else {
    const end =
      rule.endDate === undefined
        ? ", sin fecha de fin"
        : payments && last
          ? `, hasta el ${formatDateWeekday(last)}: ${payments} ${payments === 1 ? "pago" : "pagos"}`
          : ": ningún pago en ese rango";
    sentence = `${verb}${money} ${cadenceText(rule)}, desde el ${formatDateWeekday(rule.startDate)}${end}.`;
  }
  return (
    <div className="fin-editor__field--wide fin-readback" role="status" aria-live="polite">
      <p className="fin-readback__sentence">{sentence}</p>
      {upcoming.length > 0 ? (
        <p className="fin-readback__next">
          <span className="fin-readback__label">Próximos:</span>
          {upcoming.map((date) => (
            <span key={date} className="fin-readback__date">
              {formatDateWeekday(date)}
            </span>
          ))}
          {rule.endDate === undefined || (payments ?? 0) > upcoming.length ? (
            <span className="fin-readback__more">…</span>
          ) : null}
        </p>
      ) : null}
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
  const fieldError = useFieldError("cardId");
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
        <FieldError {...fieldError} />
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
        aria-invalid={fieldError.message ? true : undefined}
        aria-describedby={fieldError.message ? fieldError.id : undefined}
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
      <FieldError {...fieldError} />
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

  // State: Mantine Form, controlled — the "Cuándo" readback, the payments
  // preview and the presets derive from every value as you type. Validation:
  // the shared Zod schema (item-schema.ts), per field.
  const initialItem = props.draft !== undefined ? props.draft : bridge.getItem(itemId);
  const [missing, setMissing] = React.useState(initialItem === null);
  const form = useForm<FinancialItem>({
    mode: "controlled",
    initialValues: initialItem ?? MISSING_ITEM,
  });
  const draft: FinancialItem | null = missing ? null : form.getValues();
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
  const missingRef = React.useRef(missing);
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

  // Every hook runs before the early return below (rules of hooks: the item
  // can vanish while the editor is open — deleted / undone elsewhere).
  const fieldErrors = React.useMemo(
    () => (draft ? itemFormErrors(draft, cards) : {}),
    [draft, cards],
  );
  // "Termina": on a date (default) or after N payments — both store an end
  // date; this only says which one the form shows.
  const [endBy, setEndBy] = React.useState<"date" | "count">("date");

  if (!draft || !exists) return null;

  const error = firstFieldError(fieldErrors, draft);

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

  // "Cada [N] [unit]" changed (either control).
  const onScheduleChange = (unit: FrequencyUnit, every: number) =>
    setDraft((prev) => {
      if (!prev) return prev;
      const recurrence = withFrequencyParts(prev.recurrence, unit, every);
      if (recurrence.frequency === "once") {
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
          recurrence: withPaymentCount(recurrence, defaultPaymentCount(recurrence)),
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
    if (locked || error !== null) return;
    if (creating) {
      bridge.addItem(cleanItem(normalizeForSave(draft)), props.placement);
      onClose();
      return;
    }
    if (bridge.replaceItem(cleanItem(normalizeForSave(draft)))) {
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
  // Every kind ends on a date ("Fecha final"); for a recurring one the
  // preview counts its payments and names the last one (the saved end snaps
  // to it).
  const byPayments = showFrequency && recurrence.frequency !== "once";
  const schedule = frequencyParts(recurrence);
  const indefinite = recurrence.endDate === undefined;
  const payments = byPayments ? paymentCount(recurrence) : null;
  const endMode: "never" | "date" | "count" = indefinite ? "never" : endBy;
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
          <FieldErrorsContext.Provider value={fieldErrors}>
          <fieldset className="fin-editor__grid" disabled={locked}>
            <label className="fin-editor__field fin-editor__field--wide">
              <span className="fin-editor__label">Nombre</span>
              <input
                ref={nameRef}
                type="text"
                value={draft.name}
                aria-invalid={fieldErrors.name ? true : undefined}
                aria-describedby={fieldErrors.name ? "fin-editor-name-error" : undefined}
                onChange={(event) => patch({ name: event.target.value })}
              />
              <FieldError id="fin-editor-name-error" message={fieldErrors.name} />
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

            {/* Cuándo — ONE way to say when it happens, is paid, comes in and
                ends, the same for every kind (like a calendar's "Repetir"):
                Se repite [presets | Personalizado: cada N días / meses] ·
                Empieza (Fecha if it doesn't repeat; its day is the payday) ·
                Termina ◉ Nunca ○ El [fecha] ○ Después de [N] pagos — and a
                plain-words readback with the next dates. */}
            <div className="fin-editor__when" role="group" aria-labelledby="fin-editor-when">
              <span id="fin-editor-when" className="fin-editor__section-title">
                Cuándo
              </span>
              {showFrequency ? (
                <div className="fin-editor__field fin-editor__field--wide">
                  <span className="fin-editor__label" id="fin-editor-repeat">
                    Se repite
                  </span>
                  <SchedulePicker
                    labelledBy="fin-editor-repeat"
                    unit={schedule.unit}
                    every={schedule.every}
                    onChange={onScheduleChange}
                  />
                  {byPayments && recurrence.frequency === "monthly" && endsMonth(recurrence) ? (
                    <label className="fin-editor__check">
                      <input
                        type="checkbox"
                        checked={monthlyDay(recurrence) === LAST_DAY}
                        onChange={(event) =>
                          onMonthlyDayChange(
                            event.target.checked ? LAST_DAY : startDayOfMonth(recurrence),
                          )
                        }
                      />
                      <span>Siempre el último día del mes</span>
                    </label>
                  ) : null}
                </div>
              ) : null}
              <DateField
                path="recurrence.startDate"
                label={showFrequency && recurrence.frequency === "once" ? "Fecha" : "Empieza"}
                value={recurrence.startDate}
                reference={doc.startDate}
                onChange={onStartDateChange}
              />
              {draft.kind === "credit-card" ? (
                <>
                  <NumberField
                    label="Día de corte" path="cutDay"
                    value={draft.cutDay}
                    onChange={(cutDay) => patch({ cutDay: cutDay ?? Number.NaN })}
                  />
                  <NumberField
                    label="Día de pago" path="dueDay"
                    value={draft.dueDay}
                    onChange={(dueDay) => patch({ dueDay: dueDay ?? Number.NaN })}
                  />
                </>
              ) : null}
              {showEndDate ? (
                <div
                  className="fin-editor__field fin-editor__field--wide"
                  role="radiogroup"
                  aria-labelledby="fin-editor-end"
                >
                  <span className="fin-editor__label" id="fin-editor-end">
                    Termina
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
                      {/* Typing a date picks this option by itself. */}
                      <span
                        className="fin-ends__input"
                        onFocusCapture={() => setEndBy("date")}
                      >
                        <DateField
                          inline
                          path="recurrence.endDate"
                          label="Fecha de fin"
                          value={endMode === "date" ? recurrence.endDate : undefined}
                          // "15 nov" for an end date means the next 15 NOV on
                          // or after the start, never one before it.
                          reference={
                            isISODate(recurrence.startDate)
                              ? recurrence.startDate
                              : doc.startDate
                          }
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
                          placeholder="12"
                          onFocus={() => setEndBy("count")}
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
              ) : null}
              {showFrequency ? (
                <ScheduleReadback draft={draft} payments={payments} last={last} />
              ) : null}
            </div>
          </fieldset>
          </FieldErrorsContext.Provider>

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
          label="Monto" path="amount"
          value={draft.amount}
          onChange={(amount) => patch({ amount })}
        />
      );
    case "card-purchase":
      return (
        <>
          <NumberField
            label="Monto" path="amount"
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
            label="Pago" path="paymentAmount"
            value={draft.paymentAmount}
            onChange={(paymentAmount) => patch({ paymentAmount })}
          />
          <NumberField
            label="Saldo" path="balance"
            optional
            value={draft.balance}
            onChange={(balance) => patch({ balance })}
          />
          <NumberField
            label="Tasa anual" path="annualRate"
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
            label="Saldo" path="balance"
            value={draft.balance}
            onChange={(balance) => patch({ balance })}
          />
          <NumberField
            label="Tasa anual" path="annualRate"
            suffix="%"
            value={draft.annualRate}
            onChange={(annualRate) => patch({ annualRate })}
          />
          <NumberField
            label="Pago mínimo" path="minimumPayment"
            value={draft.minimumPayment}
            onChange={(minimumPayment) => patch({ minimumPayment })}
          />
          {draft.paymentMode === "statement" ? null : (
            <NumberField
              label="Pago planeado" path="paymentAmount"
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
        label="Monto original" path="originalAmount"
        value={draft.originalAmount}
        onChange={(originalAmount) => patch({ originalAmount })}
      />
      <NumberField
        label="Meses" path="installmentsTotal"
        value={draft.installmentsTotal}
        onChange={(installmentsTotal) =>
          patch({ installmentsTotal: installmentsTotal ?? Number.NaN })
        }
      />
      <NumberField
        label="Pagados" path="installmentsPaid"
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
