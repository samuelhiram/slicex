// Compact readout of the projection at the playhead day: date, cash and
// total debt. It lives in the shell's tool row (never over the canvas), so
// it can't cover the money lane, the ruler or the tools. Re-renders only
// when the integer day or the bridge revision changes (never per frame).
import * as React from "react";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateWeekday, formatMoneyWhole } from "../format";
import { useFinancialRevision, usePlayheadDay } from "./FinancialUi";

export interface PlayheadReadoutProps {
  bridge: FinancialBridgeApi;
  /** Extra class (placement is up to the container; in-flow by default). */
  className?: string;
}

export function PlayheadReadout({ bridge, className }: PlayheadReadoutProps) {
  const revision = useFinancialRevision(bridge);
  const day = usePlayheadDay(bridge);

  const view = React.useMemo(() => {
    const date = bridge.dateAtBeat(day);
    const snapshot = bridge.snapshotAt(date);
    const reserve = bridge.getDocument().minimumCashReserve;
    const state =
      snapshot.cash < 0 ? "negative" : snapshot.cash < reserve ? "low" : "ok";
    return { date, snapshot, state };
    // `revision` is the cache key for document / projection changes.
  }, [bridge, revision, day]);

  return (
    <div
      className={className ? `fin-readout ${className}` : "fin-readout"}
      data-state={view.state}
      role="status"
      aria-live="off"
      aria-label="Lectura del playhead"
    >
      <span className="fin-readout__date">{formatDateWeekday(view.date)}</span>
      <span className="fin-readout__cell">
        <span className="fin-readout__label">Cash</span>
        <span className="fin-readout__cash">
          {formatMoneyWhole(view.snapshot.cash)}
        </span>
      </span>
      <span className="fin-readout__cell">
        <span className="fin-readout__label">Deuda</span>
        <span className="fin-readout__debt">
          {formatMoneyWhole(view.snapshot.debt)}
        </span>
      </span>
    </div>
  );
}
