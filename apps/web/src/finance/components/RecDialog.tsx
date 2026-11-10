// "Rec": record what really happened since the last visit. On load, a plan
// saved on an earlier day is rolled forward to today assuming everything
// happened as planned; this dialog lets the person correct that — a
// payment that didn't happen, a different amount, the real balance in the
// bank today. The corrections become ledger entries and adjust today's
// cash / debts.
//
// Form: Mantine Form, CONTROLLED (a row's "Otro monto" input appears with
// its choice), validated with the shared schemas — a real amount is a
// MoneySchema amount, today's real cash a plan's cash (may be negative).
// Each error shows under its field; one role="alert" line names the first.
import * as React from "react";
import { schemaResolver, useForm } from "@mantine/form";
import { z } from "zod";
import { FinancialDocumentSchema } from "@slicex/contracts";
import type { ActualRecord, FinancialProjectionPoint, ISODate } from "@slicex/core";
import { formatDateShort, formatMoneyWhole, formatSignedMoneyWhole } from "../format";
import { amountTextSchema, amountValue, bindField, firstError } from "./form-kit";

export interface RecDialogProps {
  /** Past events (old start → yesterday) that moved cash. */
  pending: readonly FinancialProjectionPoint[];
  /** Day the plan was saved on (its old start). */
  since: ISODate;
  onApply: (actuals: ActualRecord[], cashOverride: number | undefined) => void;
  onClose: () => void;
}

export type RecRowStatus = "happened" | "edited" | "skipped";

export interface RecValues {
  /** One per movement that moved cash, in the table's order. */
  rows: Array<{ status: RecRowStatus; amount: string }>;
  /** Today's real cash, as typed ("" = not given). */
  cash: string;
}

const REAL_AMOUNT = amountTextSchema({ required: true, requiredMessage: "Escribe el monto real" });

/** The corrections as typed. Exported for tests. */
export const recFormSchema = z.object({
  rows: z.array(
    z
      .object({ status: z.enum(["happened", "edited", "skipped"]), amount: z.string() })
      .superRefine((row, ctx) => {
        if (row.status !== "edited") return;
        const result = REAL_AMOUNT.safeParse(row.amount);
        if (!result.success) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["amount"],
            message: result.error.issues[0]?.message ?? "Escribe el monto real",
          });
        }
      }),
  ),
  cash: amountTextSchema({ number: FinancialDocumentSchema.shape.initialCash }),
});

/** Movements the dialog lists: the ones that moved cash. */
export function recRows(pending: readonly FinancialProjectionPoint[]): FinancialProjectionPoint[] {
  return pending.filter((point) => point.cashDelta !== 0);
}

/** Ledger entries + cash override of VALID values (pure; exported for tests). */
export function recActuals(
  rows: readonly FinancialProjectionPoint[],
  values: RecValues,
): { actuals: ActualRecord[]; cash: number | undefined } {
  const actuals: ActualRecord[] = [];
  rows.forEach((point, index) => {
    const row = values.rows[index];
    if (!row || row.status === "happened") return;
    if (row.status === "skipped") {
      actuals.push({ eventId: point.eventId, status: "skipped" });
      return;
    }
    const amount = amountValue(row.amount);
    if (amount !== undefined) actuals.push({ eventId: point.eventId, status: "edited", amount });
  });
  return { actuals, cash: amountValue(values.cash) };
}

export function RecDialog({ pending, since, onApply, onClose }: RecDialogProps) {
  const rows = React.useMemo(() => recRows(pending), [pending]);
  const form = useForm<RecValues>({
    mode: "controlled",
    initialValues: {
      rows: rows.map(() => ({ status: "happened", amount: "" })),
      cash: "",
    },
    validate: schemaResolver(recFormSchema, { sync: true }),
    validateInputOnBlur: true,
  });
  const dialogRef = React.useRef<HTMLFormElement | null>(null);

  React.useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("select, input, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = form.onSubmit((values) => {
    const { actuals, cash } = recActuals(rows, values);
    onApply(actuals, cash);
  });

  const values = form.getValues();
  const cash = bindField(form, "cash", "fin-rec");

  return (
    <div className="playlist-shell__modal-overlay" role="presentation">
      <form
        ref={dialogRef}
        className="playlist-shell__modal fin-rec"
        role="dialog"
        aria-modal="true"
        aria-label="Pon tu año al día"
        noValidate
        onSubmit={submit}
      >
        <header className="playlist-shell__modal-header">
          <strong className="fin-editor__title">Pon tu año al día</strong>
          <button
            type="button"
            className="playlist-shell__modal-close"
            aria-label="Cerrar"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="playlist-shell__modal-body fin-editor__body">
          <p className="fin-rec__intro">
            Desde el {formatDateShort(since)} supusimos que todo pasó como lo planeaste.
            Corrige lo que fue distinto.
          </p>
          {rows.length === 0 ? (
            <p className="fin-panel__empty">No hubo movimientos planeados en esos días.</p>
          ) : (
            <table className="fin-table fin-rec__table">
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Movimiento</th>
                  <th className="fin-table__num">Planeado</th>
                  <th>¿Qué pasó?</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((point, index) => {
                  const status = values.rows[index]?.status ?? "happened";
                  const statusInput = form.getInputProps(`rows.${index}.status`);
                  const amount = bindField(form, `rows.${index}.amount`, "fin-rec");
                  return (
                    <tr key={point.eventId}>
                      <td>{formatDateShort(point.date)}</td>
                      <td className="fin-table__name" title={point.name}>
                        {point.name}
                      </td>
                      <td className="fin-table__num">{formatSignedMoneyWhole(point.cashDelta)}</td>
                      <td>
                        <div className="fin-rec__actual">
                          <select
                            {...statusInput}
                            onChange={(event) => {
                              statusInput.onChange(event);
                              // A hidden amount has nothing left to fix.
                              form.clearFieldError(`rows.${index}.amount`);
                            }}
                            aria-label={`Qué pasó con ${point.name} el ${formatDateShort(point.date)}`}
                          >
                            <option value="happened">Pasó</option>
                            <option value="edited">Otro monto</option>
                            <option value="skipped">No pasó</option>
                          </select>
                          {status === "edited" ? (
                            <>
                              <input
                                key={amount.key}
                                {...amount.input}
                                type="text"
                                inputMode="decimal"
                                aria-label="Monto real"
                                placeholder={formatMoneyWhole(Math.abs(point.cashDelta))}
                              />
                              {amount.error}
                            </>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <label className="fin-editor__field fin-rec__cash">
            <span className="fin-editor__label">
              Saldo real hoy <em className="fin-editor__optional">(opcional)</em>
            </span>
            <input
              key={cash.key}
              {...cash.input}
              type="text"
              inputMode="decimal"
              placeholder="Lo que dice tu banco ahora"
            />
            {cash.error}
            <span className="fin-editor__hint">
              Si lo escribes, manda sobre todo lo demás: la diferencia queda registrada como
              ajuste.
            </span>
          </label>
          <p className="fin-editor__error" role="alert">
            {firstError(form.errors)}
          </p>
          <div className="fin-editor__actions">
            <span className="fin-editor__actions-spacer" />
            <button type="button" className="fin-editor__button" onClick={onClose}>
              Después
            </button>
            <button type="submit" className="fin-editor__button fin-editor__button--primary">
              Guardar
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
