// "Registrar" — write down what you just spent or received, in seconds:
// amount (focused) → a quick selector (Mandado, Gasolina, Gustito…) →
// Enter. Date and time default to now; concept, card and notes are there
// when wanted. The movement goes to the journal ("Lo que pasó") and its
// effect is booked on today's cash — or on the card's debt — of every
// future at once (Futures.commitMovement). Every movement stands alone:
// it is never matched against the plan, even with the same name.
//
// Dated after today it has not happened yet: it becomes a one-time item of
// the plan instead (an undo step of the plan).
//
// The same dialog edits a recorded movement (`movement`): "Guardar" books
// the difference, "Borrar" takes it back. Both announced with "Deshacer".
//
// Form: Mantine Form, CONTROLLED, validated with the shared schemas
// (MovementSchema's amount, ISODate, time of day). Each error shows under
// its field; one role="alert" line names the first. One open / close
// contract (useOverlay "modal").
import * as React from "react";
import { schemaResolver, useForm } from "@mantine/form";
import { z } from "zod";
import { ISODateSchema, MovementSchema, TimeOfDaySchema } from "@slicex/contracts";
import {
  movementChangeEffect,
  quickCategories,
  type ISODate,
  type Movement,
  type MovementKind,
} from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import type { Futures } from "../futures";
import { formatDateShort } from "../format";
import {
  describeEffect,
  localTimeOf,
  MOVEMENT_KIND_LABELS,
  movementHeadline,
  planCards,
  plannedFromCapture,
  plannedKindOf,
  timeOptions,
} from "../movements-ui";
import { useAnnounce } from "../../ui/announcer";
import { Select } from "../../ui/select";
import { useOverlay } from "../../ui/use-overlay";
import { DateField } from "./DateField";
import { amountTextSchema, amountValue, bindField, FieldErrorsContext, firstError } from "./form-kit";

export interface MovementCaptureDialogProps {
  bridge: FinancialBridgeApi;
  futures: Futures;
  /** The plan's today (its start date). */
  today: ISODate;
  /** A recorded movement to edit; absent = a new one. */
  movement?: Movement | null;
  /** A new one starts as this kind (default "expense"). */
  initialKind?: MovementKind;
  onClose: () => void;
  /** Where the focus goes on close when its opener is gone. */
  fallbackFocus?: () => HTMLElement | null;
  /** The clock, for the default time (tests pass a fixed one). */
  now?: () => Date;
  /** Reopen with what was being written before a reload (form-draft.ts). */
  restoreValues?: CaptureValues;
  /** Every change of the values: to keep the draft across a reload. */
  onValuesChange?: (values: CaptureValues) => void;
}

export interface CaptureValues {
  kind: MovementKind;
  /** As typed ("$1,250.50"). */
  amount: string;
  concept: string;
  category: string;
  /** "cash" or a card id. */
  paidWith: string;
  /** ISO date ("" while what is typed is not a date). */
  date: string;
  /** "HH:MM" or "". */
  time: string;
  notes: string;
}

export const CASH = "cash";

/** The capture as typed. `editing`: a recorded movement can't move to the future. Exported for tests. */
export function captureSchema(today: ISODate, editing: boolean) {
  return z
    .object({
      kind: z.enum(["expense", "income"]),
      amount: amountTextSchema({
        required: true,
        requiredMessage: "Escribe cuánto fue",
        number: MovementSchema.shape.amount,
      }),
      concept: z.string(),
      category: z.string(),
      paidWith: z.string(),
      date: ISODateSchema,
      time: z.union([z.literal(""), TimeOfDaySchema]),
      notes: z.string(),
    })
    .superRefine((values, ctx) => {
      if (!values.concept.trim() && !values.category.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["concept"],
          message: "Escribe qué fue o elige uno de arriba",
        });
      }
      if (editing && values.date > today) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["date"],
          message: "Ya pasó: la fecha no puede ser después de hoy",
        });
      }
    });
}

/** The movement the (valid) values describe. Exported for tests. */
export function movementFromCapture(values: CaptureValues, id: string): Movement {
  const amount = Math.round((amountValue(values.amount) ?? 0) * 100) / 100;
  const category = values.category.trim();
  const concept = values.concept.trim() || category;
  const movement: Movement = { id, kind: values.kind, amount, date: values.date, concept };
  if (values.time) movement.time = values.time;
  if (category) movement.category = category;
  const notes = values.notes.trim();
  if (notes) movement.notes = notes;
  if (values.paidWith !== CASH) movement.cardId = values.paidWith;
  return movement;
}

/** The form's starting values: an existing movement, or a new one now. Exported for tests. */
export function initialCaptureValues(
  movement: Movement | null,
  kind: MovementKind,
  today: ISODate,
  now: Date,
): CaptureValues {
  if (movement) {
    return {
      kind: movement.kind,
      amount: String(movement.amount),
      concept: movement.concept,
      category: movement.category ?? "",
      paidWith: movement.cardId ?? CASH,
      date: movement.date,
      time: movement.time ?? "",
      notes: movement.notes ?? "",
    };
  }
  return {
    kind,
    amount: "",
    concept: "",
    category: "",
    paidWith: CASH,
    date: today,
    time: localTimeOf(now),
    notes: "",
  };
}

export function MovementCaptureDialog({
  bridge,
  futures,
  today,
  movement = null,
  initialKind = "expense",
  onClose,
  fallbackFocus,
  now = () => new Date(),
  restoreValues,
  onValuesChange,
}: MovementCaptureDialogProps) {
  const editing = movement !== null;
  const announce = useAnnounce();
  const schema = React.useMemo(() => captureSchema(today, editing), [today, editing]);
  const form = useForm<CaptureValues>({
    mode: "controlled",
    initialValues: restoreValues ?? initialCaptureValues(movement, initialKind, today, now()),
    validate: schemaResolver(schema, { sync: true }),
    // Checked on "Registrar", not when hopping between controls: an error
    // appearing on blur moved the controls under the pointer mid-click (the
    // first click on "Ingreso" or a quick selector was lost). An error goes
    // away as soon as its field changes.
    validateInputOnBlur: false,
  });
  const dialogRef = React.useRef<HTMLFormElement | null>(null);
  const amountRef = React.useRef<HTMLInputElement | null>(null);
  const conceptRef = React.useRef<HTMLInputElement | null>(null);
  useOverlay({
    open: true,
    onClose,
    kind: "modal",
    containerRef: dialogRef,
    initialFocusRef: amountRef,
    fallbackFocus,
  });

  const values = form.getValues();
  // Keep the draft for a reload (the shell stores it while the dialog is open).
  const onValuesChangeRef = React.useRef(onValuesChange);
  onValuesChangeRef.current = onValuesChange;
  React.useEffect(() => {
    onValuesChangeRef.current?.(values);
  }, [values]);
  const doc = bridge.getDocument();
  const cards = planCards(doc);
  // A card that is gone from the plan still shows on a recorded movement.
  const paidWithGone = values.paidWith !== CASH && !cards.some((card) => card.id === values.paidWith);
  const chips = React.useMemo(
    () => quickCategories(futures.getMovements(), values.kind, 10),
    [futures, values.kind],
  );

  // What saving does, said before saving (deferred: one line per settled change).
  const parsed = schema.safeParse(values);
  const draft = parsed.success ? movementFromCapture(values, movement?.id ?? "draft") : null;
  const settled = React.useDeferredValue(draft);
  const outcome = React.useMemo(() => {
    if (!settled) return null;
    if (!editing && settled.date > today) {
      return `Todavía no pasa: queda en tu plan como ${
        settled.kind === "income" ? "ingreso" : "gasto"
      } único el ${formatDateShort(settled.date)}.`;
    }
    return describeEffect(doc, movementChangeEffect(movement, settled));
  }, [settled, editing, today, doc, movement]);

  const submit = form.onSubmit((valid) => {
    const id = movement?.id ?? futures.newMovementId(now().getTime());
    const next = movementFromCapture(valid, id);
    if (!editing && next.date > today) {
      // Not yet happened: a one-time item of the plan (a plan undo step).
      const kind = plannedKindOf(next);
      const item = plannedFromCapture(bridge.createDraftItem(kind, bridge.beatAtDate(next.date)), next);
      bridge.addItem(item);
      announce({
        message: `En tu plan: ${movementHeadline(next)} el ${formatDateShort(next.date)}`,
        undo: () => bridge.core.undo(),
      });
      onClose();
      return;
    }
    const before = movement;
    const docBefore = bridge.getDocument();
    const effect = futures.commitMovement(before, next);
    announce({
      message: `${editing ? "Actualizado" : "Registrado"}: ${movementHeadline(next)}. ${describeEffect(docBefore, effect)}`,
      undo: () => {
        const current = futures.getMovement(next.id);
        if (current || before) futures.commitMovement(current, before);
      },
    });
    onClose();
  });

  const remove = () => {
    if (!movement) return;
    const docBefore = bridge.getDocument();
    const effect = futures.commitMovement(movement, null);
    announce({
      message: `Borrado: ${movementHeadline(movement)}. ${describeEffect(docBefore, effect)}`,
      undo: () => {
        if (!futures.getMovement(movement.id)) futures.commitMovement(null, movement);
      },
    });
    onClose();
  };

  const pickCategory = (label: string) => {
    const previous = values.category;
    const same = previous.trim().toLocaleLowerCase("es-MX") === label.toLocaleLowerCase("es-MX");
    const nextCategory = same ? "" : label;
    form.setFieldValue("category", nextCategory);
    // The concept follows the selector while the person has not written one of their own.
    const concept = values.concept.trim();
    if (!concept || concept === previous.trim()) form.setFieldValue("concept", nextCategory);
    form.clearFieldError("concept");
    // Enter from there saves.
    conceptRef.current?.focus();
  };

  const amount = bindField(form, "amount", "fin-capture");
  const concept = bindField(form, "concept", "fin-capture");
  const time = bindField(form, "time", "fin-capture");
  const titleId = React.useId();
  const kindLabel = MOVEMENT_KIND_LABELS[values.kind].toLowerCase();
  const title = editing ? `Editar ${kindLabel}` : "Registrar lo que pasó";

  return (
    <div className="playlist-shell__modal-overlay" role="presentation">
      <form
        ref={dialogRef}
        className="playlist-shell__modal fin-editor fin-capture"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-kind={values.kind}
        noValidate
        onSubmit={submit}
      >
        <header className="playlist-shell__modal-header fin-editor__header">
          <h2 id={titleId} className="fin-editor__title">
            {title}
          </h2>
          <button
            type="button"
            className="playlist-shell__modal-close"
            aria-label="Cerrar sin guardar"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="playlist-shell__modal-body fin-editor__body">
          <FieldErrorsContext.Provider value={form.errors}>
            <div className="fin-capture__kind" role="group" aria-label="Tipo de movimiento">
              {(["expense", "income"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="fin-capture__kind-option"
                  aria-pressed={values.kind === kind}
                  data-checked={values.kind === kind}
                  onClick={() => {
                    if (values.kind === kind) return;
                    form.setFieldValue("kind", kind);
                    // A card only pays expenses here; a chip of the other kind no longer applies.
                    if (kind === "income") form.setFieldValue("paidWith", CASH);
                    amountRef.current?.focus();
                  }}
                >
                  {MOVEMENT_KIND_LABELS[kind]}
                </button>
              ))}
            </div>

            <label className="fin-editor__field fin-capture__amount-field">
              <span className="fin-editor__label">¿Cuánto?</span>
              <span className="fin-capture__amount-row">
                <span className="fin-capture__sign" aria-hidden="true">
                  {values.kind === "income" ? "+$" : "−$"}
                </span>
                <input
                  key={amount.key}
                  {...amount.input}
                  ref={amountRef}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  className="fin-capture__amount"
                  placeholder="0"
                />
              </span>
              {amount.error}
            </label>

            <div className="fin-capture__chips" role="group" aria-label="Rápidos">
              {chips.map((label) => {
                const checked =
                  values.category.trim().toLocaleLowerCase("es-MX") === label.toLocaleLowerCase("es-MX");
                return (
                  <button
                    key={label}
                    type="button"
                    className="fin-repeat__preset fin-capture__chip"
                    aria-pressed={checked}
                    data-checked={checked}
                    onClick={() => pickCategory(label)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="fin-editor__grid fin-capture__grid">
              <label className="fin-editor__field fin-editor__field--wide">
                <span className="fin-editor__label">Concepto</span>
                <input
                  key={concept.key}
                  {...concept.input}
                  ref={conceptRef}
                  type="text"
                  autoComplete="off"
                  placeholder={values.kind === "income" ? "Venta de la bici" : "Tacos con Ana"}
                />
                {concept.error}
              </label>

              {values.kind === "expense" && (cards.length > 0 || paidWithGone) ? (
                <div className="fin-editor__field fin-editor__field--wide">
                  <span className="fin-editor__label" id={`${titleId}-paid`}>
                    Pagado con
                  </span>
                  <Select
                    aria-labelledby={`${titleId}-paid`}
                    value={values.paidWith}
                    onValueChange={(next) => form.setFieldValue("paidWith", next)}
                    options={[
                      { value: CASH, label: "Efectivo o débito", hint: "sale de tu liquidez" },
                      ...cards.map((card) => ({ value: card.id, label: card.name, hint: "sube su deuda" })),
                      ...(paidWithGone ? [{ value: values.paidWith, label: "Tarjeta borrada", disabled: true }] : []),
                    ]}
                  />
                </div>
              ) : null}

              <DateField
                path="date"
                label="Fecha"
                value={values.date}
                reference={today}
                today={today}
                prefer="nearest"
                onChange={(iso) => form.setFieldValue("date", iso)}
              />
              <div className="fin-editor__field">
                <span className="fin-editor__label" id={`${titleId}-time`}>
                  Hora <em className="fin-editor__optional">(opcional)</em>
                </span>
                <Select
                  aria-labelledby={`${titleId}-time`}
                  value={values.time}
                  onValueChange={(next) => form.setFieldValue("time", next)}
                  options={timeOptions(values.time)}
                  placeholder="Sin hora"
                />
                {time.error}
              </div>

              <label className="fin-editor__field fin-editor__field--wide">
                <span className="fin-editor__label">
                  Notas <em className="fin-editor__optional">(opcional)</em>
                </span>
                <textarea
                  className="fin-capture__notes"
                  rows={2}
                  value={values.notes}
                  onChange={(event) => form.setFieldValue("notes", event.currentTarget.value)}
                  // Quick like every other field: Enter saves, Shift+Enter is a new line.
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    dialogRef.current?.requestSubmit();
                  }}
                  placeholder="Ticket, con quién, para qué… (Shift+Enter: otra línea)"
                />
              </label>
            </div>

            <p className="fin-capture__outcome" aria-live="polite">
              {outcome ?? "Escribe cuánto fue y qué fue; Enter lo registra."}
            </p>
          </FieldErrorsContext.Provider>

          <footer className="fin-editor__actions">
            <p className="fin-editor__error" role="alert" aria-live="polite">
              {firstError(form.errors)}
            </p>
            <div className="fin-editor__buttons">
              {editing ? (
                <button type="button" className="fin-editor__button fin-editor__button--danger" onClick={remove}>
                  Borrar
                </button>
              ) : null}
              <span className="fin-editor__actions-spacer" />
              <button type="button" className="fin-editor__button" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="fin-editor__button fin-editor__button--primary">
                {editing ? "Guardar" : "Registrar"}
              </button>
            </div>
          </footer>
        </div>
      </form>
    </div>
  );
}
