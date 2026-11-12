// Compact reading of the projection on the marked day (the red line): date,
// cash and total debt. It lives in the money lane's header cell (never over
// the canvas), and its two figures double as the lane's legend: the thick
// line is the cash ("Caja"), the thin grey one the debt ("Deuda").
// Re-renders only when the integer day or the bridge revision changes
// (never per frame).
//
// Screen readers: the reading itself is not live (it would talk on every
// drag of the day); a separate polite region reads it once the day settles
// AFTER a keyboard move (arrows, Inicio / Fin), like the visible range in
// NavControls.
import * as React from "react";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateLong, formatDateWeekday, formatMoneyWhole } from "../format";
import { useFinancialRevision, useHoverDay, usePlayheadDay } from "./FinancialUi";

// How recent a key press must be for a day change to count as keyboard
// driven, and how long the day must rest before it is read.
export const KEYBOARD_INTENT_MS = 1500;
export const DAY_ANNOUNCE_DELAY_MS = 450;

export interface PlayheadReadoutProps {
  bridge: FinancialBridgeApi;
  /** Extra class (placement is up to the container; in-flow by default). */
  className?: string;
  /**
   * Time (performance.now) of the last navigation key on the canvas; a day
   * change right after one is announced. Absent: never announced.
   */
  keyboardIntentRef?: React.RefObject<number>;
  /**
   * Show the day under the pointer while it hovers the timeline (the hover
   * line names it on the ruler; the values live here, never over the curve),
   * back to the playhead's day when it leaves. Hovering is never announced.
   */
  followHover?: boolean;
}

export function PlayheadReadout({ bridge, className, keyboardIntentRef, followHover }: PlayheadReadoutProps) {
  const revision = useFinancialRevision(bridge);
  const day = usePlayheadDay(bridge);
  const hoverDay = useHoverDay(bridge);
  const hovering = followHover === true && hoverDay !== null;
  const shownDay = hovering ? hoverDay : day;

  const view = React.useMemo(() => {
    const date = bridge.dateAtBeat(shownDay);
    const snapshot = bridge.snapshotAt(date);
    const reserve = bridge.getDocument().minimumCashReserve;
    const state =
      snapshot.cash < 0 ? "negative" : snapshot.cash < reserve ? "low" : "ok";
    return { date, snapshot, state };
    // `revision` is the cache key for document / projection changes.
  }, [bridge, revision, shownDay]);

  const [spoken, setSpoken] = React.useState("");
  const firstDay = React.useRef(true);
  React.useEffect(() => {
    if (firstDay.current) {
      firstDay.current = false;
      return undefined;
    }
    const last = keyboardIntentRef?.current ?? Number.NEGATIVE_INFINITY;
    if (!(performance.now() - last < KEYBOARD_INTENT_MS)) return undefined;
    const id = setTimeout(() => {
      // The playhead's day (the shown one may be the hovered day).
      const date = bridge.dateAtBeat(day);
      const snapshot = bridge.snapshotAt(date);
      setSpoken(
        `${formatDateLong(date)}: caja ${formatMoneyWhole(snapshot.cash)}, deuda ${formatMoneyWhole(
          snapshot.debt,
        )}`,
      );
    }, DAY_ANNOUNCE_DELAY_MS);
    return () => clearTimeout(id);
    // Only the day: an edit elsewhere is announced by the announcer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);

  return (
    <div
      className={className ? `fin-readout ${className}` : "fin-readout"}
      data-state={view.state}
      data-source={hovering ? "hover" : "playhead"}
      role="group"
      aria-label="Lectura del día"
    >
      <span className="fin-readout__date">{formatDateWeekday(view.date)}</span>
      <span className="fin-readout__cell">
        <span className="fin-readout__swatch fin-readout__swatch--cash" aria-hidden="true" />
        <span className="fin-readout__label">Caja</span>
        <span className="fin-readout__cash">
          {formatMoneyWhole(view.snapshot.cash)}
        </span>
      </span>
      <span className="fin-readout__cell">
        <span className="fin-readout__swatch fin-readout__swatch--debt" aria-hidden="true" />
        <span className="fin-readout__label">Deuda</span>
        <span className="fin-readout__debt">
          {formatMoneyWhole(view.snapshot.debt)}
        </span>
      </span>
      <span className="fin-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {spoken}
      </span>
    </div>
  );
}
