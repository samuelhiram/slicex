// Dense financial status bar that sits above the playlist: editable starting
// cash / reserve, headline projection numbers, liquidity warnings and the
// "+ item" buttons. Re-renders only when the bridge revision changes.
import * as React from "react";
import { addDays } from "@slicex/core";
import type {
  FinancialItem,
  FinancialItemKind,
  LiquidityWarning,
} from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateLong, formatDateShort, formatMoney, formatMoneyWhole } from "../format";
import { KIND_COLORS } from "../labels";
import {
  InlineNumberInput,
  jumpPlayheadToDate,
  useFinancialRevision,
} from "./FinancialUi";

export interface FinancialSummaryBarProps {
  bridge: FinancialBridgeApi;
  /**
   * "+ Ingreso" & co.: called with a NEW draft (bridge.createDraftItem).
   * Nothing is added yet — the editor adds it on "Guardar" only, so
   * cancelling leaves the document untouched.
   */
  onCreateDraft: (draft: FinancialItem) => void;
  /** Makes the bar inert (e.g. while a modal editor is open). */
  inert?: boolean;
}

const ADD_BUTTONS: ReadonlyArray<{ kind: FinancialItemKind; label: string }> = [
  { kind: "income", label: "Ingreso" },
  { kind: "expense", label: "Gasto" },
  { kind: "loan", label: "Préstamo" },
  { kind: "credit-card", label: "Tarjeta" },
  { kind: "card-purchase", label: "Compra" },
  { kind: "installment-plan", label: "MSI" },
];

export function FinancialSummaryBar({
  bridge,
  onCreateDraft,
  inert = false,
}: FinancialSummaryBarProps) {
  const revision = useFinancialRevision(bridge);

  const data = React.useMemo(() => {
    const doc = bridge.getDocument();
    const projection = bridge.getProjection();
    return {
      doc,
      projection,
      nextPayment: bridge.nextPaymentAfter(addDays(doc.startDate, -1)),
      warnings: bridge.getWarnings(),
    };
    // `revision` is the cache key: the bridge bumps it on every data change.
  }, [bridge, revision]);

  const { doc, projection, nextPayment, warnings } = data;
  const reserve = doc.minimumCashReserve;
  // Short date ("15 NOV") inside the start year, long ("15 MAR 2027") beyond.
  const startYear = doc.startDate.slice(0, 4);
  const fmtDate = (iso: string) =>
    iso.slice(0, 4) === startYear ? formatDateShort(iso) : formatDateLong(iso);
  // Brief: the projected minimum turns red as soon as it dips below the reserve.
  const minimumState = projection.minimumCash.cash < reserve ? "negative" : "ok";
  const finalState =
    projection.finalCash < 0
      ? "negative"
      : projection.finalCash < reserve
        ? "low"
        : "ok";

  return (
    <div
      className="fin-summary"
      role="region"
      aria-label="Resumen financiero"
      inert={inert}
    >
      <div className="fin-summary__metric">
        <span className="fin-summary__label">Liquidez hoy</span>
        <InlineNumberInput
          className="fin-summary__input"
          ariaLabel="Liquidez hoy"
          value={doc.initialCash}
          format={formatMoney}
          onCommit={(amount) => bridge.setInitialCash(amount)}
        />
      </div>
      <div className="fin-summary__metric">
        <span className="fin-summary__label">Reserva mínima</span>
        <InlineNumberInput
          className="fin-summary__input"
          ariaLabel="Reserva mínima"
          value={reserve}
          min={0}
          format={formatMoney}
          onCommit={(amount) => bridge.setMinimumCashReserve(amount)}
        />
      </div>
      <div className="fin-summary__metric">
        <span className="fin-summary__label">Deuda hoy</span>
        <span className="fin-summary__value">
          {formatMoneyWhole(projection.initialDebt)}
        </span>
      </div>
      {nextPayment ? (
        <button
          type="button"
          className="fin-summary__metric fin-summary__metric--action"
          title={`Ir al ${fmtDate(nextPayment.date)}`}
          onClick={() => jumpPlayheadToDate(bridge, nextPayment.date)}
        >
          <span className="fin-summary__label">Próximo pago</span>
          <span className="fin-summary__value">
            <span className="fin-summary__name">{nextPayment.name}</span>{" "}
            {formatMoneyWhole(nextPayment.amount)}{" "}
            <span className="fin-summary__date">
              {fmtDate(nextPayment.date)}
            </span>
          </span>
        </button>
      ) : (
        <div className="fin-summary__metric">
          <span className="fin-summary__label">Próximo pago</span>
          <span className="fin-summary__value fin-summary__value--muted">—</span>
        </div>
      )}
      <button
        type="button"
        className="fin-summary__metric fin-summary__metric--action"
        data-state={minimumState}
        title={`Ir al ${fmtDate(projection.minimumCash.date)}`}
        onClick={() => jumpPlayheadToDate(bridge, projection.minimumCash.date)}
      >
        <span className="fin-summary__label">Mínimo proyectado</span>
        <span className="fin-summary__value">
          {formatMoneyWhole(projection.minimumCash.cash)}{" "}
          <span className="fin-summary__date">
            {fmtDate(projection.minimumCash.date)}
          </span>
        </span>
      </button>
      <div className="fin-summary__metric" data-state={finalState}>
        <span className="fin-summary__label">
          Cash al horizonte
          <span className="fin-summary__label-date">
            {" "}
            {fmtDate(projection.endDate)}
          </span>
        </span>
        <span className="fin-summary__value">
          {formatMoneyWhole(projection.finalCash)}
        </span>
      </div>
      <WarningsChip bridge={bridge} warnings={warnings} formatDate={fmtDate} />
      <div className="fin-summary__spacer" />
      <div className="fin-summary__add" role="group" aria-label="Agregar">
        {ADD_BUTTONS.map((button) => (
          <button
            key={button.kind}
            type="button"
            className="fin-summary__add-button"
            style={
              { "--fin-kind-color": KIND_COLORS[button.kind] } as React.CSSProperties
            }
            onClick={() => onCreateDraft(bridge.createDraftItem(button.kind))}
          >
            + {button.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function WarningsChip({
  bridge,
  warnings,
  formatDate,
}: {
  bridge: FinancialBridgeApi;
  warnings: LiquidityWarning[];
  formatDate: (iso: string) => string;
}) {
  // Popover anchor in viewport coordinates (`null` = closed). The popover
  // is `position: fixed` so the bar's horizontal overflow never clips it.
  const [anchor, setAnchor] = React.useState<{ left: number; top: number } | null>(
    null,
  );
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const count = warnings.length;
  const open = anchor !== null;

  React.useEffect(() => {
    if (count === 0) setAnchor(null);
  }, [count]);

  React.useEffect(() => {
    if (!open) return undefined;
    const close = () => setAnchor(null);
    const handleDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      close();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("mousedown", handleDown);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", handleDown);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  if (count === 0) {
    return (
      <div className="fin-summary__metric" data-state="ok">
        <span className="fin-summary__label">Alertas</span>
        <span className="fin-summary__value fin-summary__value--muted">
          Ninguna
        </span>
      </div>
    );
  }

  const hasNegative = warnings.some((w) => w.severity === "negative");

  return (
    <div className="fin-summary__metric fin-summary__warnings" ref={rootRef}>
      <span className="fin-summary__label">Alertas</span>
      <button
        type="button"
        className="fin-summary__chip"
        data-state={hasNegative ? "negative" : "low"}
        aria-expanded={open}
        aria-haspopup="menu"
        title="Alertas de liquidez"
        onClick={(event) => {
          if (open) {
            setAnchor(null);
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({
            left: Math.max(4, Math.min(rect.left, window.innerWidth - 300)),
            top: rect.bottom + 4,
          });
        }}
      >
        ⚠ {count}
      </button>
      {anchor ? (
        <div
          className="fin-popover"
          role="menu"
          aria-label="Alertas de liquidez"
          style={{ left: anchor.left, top: anchor.top }}
        >
          {warnings.map((warning) => (
            <button
              key={`${warning.startDate}:${warning.eventId}`}
              type="button"
              role="menuitem"
              className="fin-popover__item"
              data-state={warning.severity === "negative" ? "negative" : "low"}
              title={`${warning.name} · desde ${formatDate(warning.startDate)}`}
              onClick={() => {
                jumpPlayheadToDate(bridge, warning.date);
                setAnchor(null);
              }}
            >
              ⚠ {formatDate(warning.date)} · Liquidez proyectada:{" "}
              {formatMoneyWhole(warning.cash)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
