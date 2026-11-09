// "Rec": record what really happened since the last visit. On load, a plan
// saved on an earlier day is rolled forward to today assuming everything
// happened as planned; this dialog lets the person correct that — a
// payment that didn't happen, a different amount, the real balance in the
// bank today. The corrections become ledger entries and adjust today's
// cash / debts.
import * as React from "react";
import type { ActualRecord, FinancialProjectionPoint, ISODate } from "@slicex/core";
import { formatDateShort, formatMoneyWhole, formatSignedMoneyWhole } from "../format";
import { parseNumberInput } from "./FinancialUi";

export interface RecDialogProps {
  /** Past events (old start → yesterday) that moved cash. */
  pending: readonly FinancialProjectionPoint[];
  /** Day the plan was saved on (its old start). */
  since: ISODate;
  onApply: (actuals: ActualRecord[], cashOverride: number | undefined) => void;
  onClose: () => void;
}

type RowState = { status: "happened" | "edited" | "skipped"; amount: string };

export function RecDialog({ pending, since, onApply, onClose }: RecDialogProps) {
  const rows = React.useMemo(
    () => pending.filter((point) => point.cashDelta !== 0),
    [pending],
  );
  const [state, setState] = React.useState<Record<string, RowState>>({});
  const [cash, setCash] = React.useState("");
  const dialogRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    dialogRef.current?.querySelector<HTMLElement>("select, input, button")?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rowState = (id: string): RowState =>
    state[id] ?? { status: "happened", amount: "" };

  const cashValue = cash.trim() ? parseNumberInput(cash) : null;
  const cashInvalid = cashValue !== null && !Number.isFinite(cashValue);

  const apply = () => {
    const actuals: ActualRecord[] = [];
    for (const point of rows) {
      const row = rowState(point.eventId);
      if (row.status === "happened") continue;
      if (row.status === "skipped") {
        actuals.push({ eventId: point.eventId, status: "skipped" });
        continue;
      }
      const amount = parseNumberInput(row.amount);
      if (amount === null || !Number.isFinite(amount) || amount < 0) continue;
      actuals.push({ eventId: point.eventId, status: "edited", amount });
    }
    onApply(actuals, cashValue !== null && Number.isFinite(cashValue) ? cashValue : undefined);
  };

  return (
    <div className="playlist-shell__modal-overlay" role="presentation">
      <div
        ref={dialogRef}
        className="playlist-shell__modal fin-rec"
        role="dialog"
        aria-modal="true"
        aria-label="Pon tu año al día"
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
                {rows.map((point) => {
                  const row = rowState(point.eventId);
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
                            aria-label={`Qué pasó con ${point.name} el ${formatDateShort(point.date)}`}
                            value={row.status}
                            onChange={(event) =>
                              setState((prev) => ({
                                ...prev,
                                [point.eventId]: {
                                  ...row,
                                  status: event.target.value as RowState["status"],
                                },
                              }))
                            }
                          >
                            <option value="happened">Pasó</option>
                            <option value="edited">Otro monto</option>
                            <option value="skipped">No pasó</option>
                          </select>
                          {row.status === "edited" ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              aria-label="Monto real"
                              placeholder={formatMoneyWhole(Math.abs(point.cashDelta))}
                              value={row.amount}
                              onChange={(event) =>
                                setState((prev) => ({
                                  ...prev,
                                  [point.eventId]: { ...row, amount: event.target.value },
                                }))
                              }
                            />
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
              type="text"
              inputMode="decimal"
              value={cash}
              placeholder="Lo que dice tu banco ahora"
              aria-invalid={cashInvalid}
              onChange={(event) => setCash(event.target.value)}
            />
            <span className="fin-editor__hint">
              Si lo escribes, manda sobre todo lo demás: la diferencia queda registrada como
              ajuste.
            </span>
          </label>
          <div className="fin-editor__actions">
            <span className="fin-editor__actions-spacer" />
            <button type="button" className="fin-editor__button" onClick={onClose}>
              Después
            </button>
            <button
              type="button"
              className="fin-editor__button fin-editor__button--primary"
              disabled={cashInvalid}
              onClick={apply}
            >
              Guardar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
