// "Valleys that explain and fix themselves": a card over the timeline when
// the pointer is over a valley of the money lane (transient) or the
// playhead sits inside one (sticky — click the valley to pin it). It names
// the payments that dig the valley (and lights them up on the timeline)
// and offers one-click fixes, each one undoable.
import * as React from "react";
import type { ValleyFix } from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateShort, formatMoneyWhole } from "../format";
import { useFinancialRevision, usePlayheadDay } from "./FinancialUi";

export interface ValleyCardProps {
  bridge: FinancialBridgeApi;
  /** Day under the pointer over the money lane (null = not over it). */
  hoverDay: number | null;
}

const OUTCOME_LABEL: Readonly<Record<ValleyFix["outcome"], string>> = {
  resolves: "Recuperas tu reserva",
  "exits-red": "Sales del rojo",
  improves: "Mejora",
};

export function ValleyCard({ bridge, hoverDay }: ValleyCardProps) {
  const revision = useFinancialRevision(bridge);
  const playheadDay = usePlayheadDay(bridge);
  const [dismissed, setDismissed] = React.useState<string | null>(null);

  const hovered = React.useMemo(
    () => (hoverDay === null ? null : bridge.valleyAt(hoverDay)),
    [bridge, revision, hoverDay],
  );
  const pinned = React.useMemo(
    () => bridge.valleyAt(playheadDay),
    [bridge, revision, playheadDay],
  );
  const insight = hovered ?? pinned;
  const key = insight ? `${insight.warning.startDate}:${insight.warning.eventId}` : null;
  const visible = insight !== null && key !== dismissed;
  const sticky = insight !== null && pinned !== null && insight === pinned;

  // Light up the payments that dig the valley while the card is shown.
  const causeIds = React.useMemo(
    () => (visible && insight ? insight.explanation.causes.map((cause) => cause.itemId) : null),
    [visible, insight],
  );
  React.useEffect(() => {
    bridge.setHighlight(causeIds);
  }, [bridge, causeIds]);
  React.useEffect(() => () => bridge.setHighlight(null), [bridge]);

  // A new valley under the playhead clears a previous dismissal.
  React.useEffect(() => {
    if (dismissed !== null && pinned && `${pinned.warning.startDate}:${pinned.warning.eventId}` !== dismissed) {
      setDismissed(null);
    }
  }, [pinned, dismissed]);

  if (!visible || !insight) return null;
  const { warning, explanation, fixes } = insight;
  const negative = warning.cash < 0;

  return (
    <section
      className="fin-valley"
      data-state={negative ? "negative" : "low"}
      aria-label="Valle de liquidez"
    >
      <header className="fin-valley__header">
        <div>
          <p className="fin-valley__eyebrow">
            {negative ? "Te quedas en rojo" : "Rompes tu reserva"}
          </p>
          <h3 className="fin-valley__title">
            {formatMoneyWhole(warning.cash)} el {formatDateShort(warning.date)}
          </h3>
          <p className="fin-valley__subtitle">
            Te faltan {formatMoneyWhole(explanation.shortfall)} para tu reserva
            {explanation.nextInflow
              ? ` · vuelve a entrar dinero el ${formatDateShort(explanation.nextInflow.date)}`
              : ""}
          </p>
        </div>
        {sticky ? (
          <button
            type="button"
            className="fin-icon-button fin-valley__close"
            aria-label="Cerrar"
            title="Cerrar"
            onClick={() => setDismissed(key)}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5 5 15" />
            </svg>
          </button>
        ) : null}
      </header>

      {explanation.causes.length > 0 ? (
        <div className="fin-valley__block">
          <p className="fin-valley__label">Lo cavan</p>
          <ul className="fin-valley__causes">
            {explanation.causes.map((cause) => (
              <li key={`${cause.itemId}@${cause.date}`}>
                <span className="fin-valley__cause-name">{cause.name}</span>
                <span className="fin-valley__cause-date">{formatDateShort(cause.date)}</span>
                <span className="fin-valley__cause-amount">−{formatMoneyWhole(cause.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="fin-valley__block">
        <p className="fin-valley__label">Arreglos</p>
        {fixes.length === 0 ? (
          <p className="fin-valley__empty">
            No encontré un movimiento que lo resuelva solo. Prueba bajar un gasto o
            mover un pago a después de tu próximo ingreso.
          </p>
        ) : (
          <ul className="fin-valley__fixes">
            {fixes.map((fix) => (
              <li key={fix.id} className="fin-valley__fix">
                <div className="fin-valley__fix-text">
                  <span className="fin-valley__fix-title">{fix.title}</span>
                  <span className="fin-valley__fix-outcome" data-outcome={fix.outcome}>
                    {OUTCOME_LABEL[fix.outcome]} · mínimo {formatMoneyWhole(fix.after)}
                  </span>
                </div>
                <button
                  type="button"
                  className="fin-button fin-button--primary fin-valley__apply"
                  onClick={() => bridge.applyValleyFix(fix)}
                >
                  Aplicar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {!sticky ? (
        <p className="fin-valley__hint">Haz clic en el valle para dejar esta tarjeta abierta.</p>
      ) : null}
    </section>
  );
}
