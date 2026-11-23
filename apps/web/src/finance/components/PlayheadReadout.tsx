// Reading of the projection on the marked day (the red line) — or the day
// under the pointer: date, cash and total debt. It lives in the header,
// right after the verdict, big (.fin-readout--header); its two figures
// double as the money lane's legend: the thick line is the cash ("Caja"),
// the thin grey one the debt ("Deuda"). On a day already lived (left of
// today, the plan's memory) it says what you had ("Tenías") and how it
// changed until today ("Hasta hoy"): the memory keeps the cash, not debts.
// Re-renders only when the integer day or the bridge revision changes
// (never per frame).
//
// Screen readers: the reading itself is not live (it would talk on every
// drag of the day); a separate polite region reads it once the day settles
// AFTER a keyboard move (arrows, Inicio / Fin), like the visible range in
// NavControls.
import * as React from "react";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateLong, formatDateWeekday, formatMoneyWhole, formatSignedMoneyWhole } from "../format";
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
  const day = usePlayheadDay(bridge, { past: true });
  const hoverDay = useHoverDay(bridge);
  const hovering = followHover === true && hoverDay !== null;
  const shownDay = hovering ? hoverDay : day;

  const view = React.useMemo(() => {
    const date = bridge.dateAtBeat(shownDay);
    const doc = bridge.getDocument();
    const reserve = doc.minimumCashReserve;
    const stateOf = (cash: number) => (cash < 0 ? "negative" : cash < reserve ? "low" : "ok");
    // A day already lived: what the plan remembers it closed with (the memory
    // keeps the cash, not the debts) and how much more — or less — there is
    // today ("ese día tenías $1,000; hoy +$10,300").
    if (date < doc.startDate) {
      const cash = bridge.pastCashAt(date);
      const since = cash === null ? null : doc.initialCash - cash;
      return { date, snapshot: null, past: { cash, since }, state: cash === null ? "ok" : stateOf(cash) };
    }
    const snapshot = bridge.snapshotAt(date);
    return { date, snapshot, past: null, state: stateOf(snapshot.cash) };
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
      if (date < bridge.getDocument().startDate) {
        const cash = bridge.pastCashAt(date);
        setSpoken(
          cash === null
            ? `${formatDateLong(date)}: sin registro`
            : `${formatDateLong(date)}: tenías ${formatMoneyWhole(cash)}; hasta hoy ${formatSignedMoneyWhole(
                bridge.getDocument().initialCash - cash,
              )}`,
        );
        return;
      }
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

  // "jue 19 nov 2026" in parts, so a layout can stack them (the header's
  // small calendar: weekday and year over the day); the text is unchanged.
  const [weekday = "", dayNumber = "", month = "", year = ""] = formatDateWeekday(view.date).split(" ");

  return (
    <div
      className={className ? `fin-readout ${className}` : "fin-readout"}
      data-state={view.state}
      data-source={hovering ? "hover" : "playhead"}
      role="group"
      aria-label="Lectura del día"
    >
      <span className="fin-readout__date">
        <span className="fin-readout__weekday">{weekday}</span>{" "}
        <span className="fin-readout__day">
          {dayNumber} {month}
        </span>{" "}
        <span className="fin-readout__year">{year}</span>
      </span>
      <span className="fin-readout__cell">
        <span className="fin-readout__swatch fin-readout__swatch--cash" aria-hidden="true" />
        <span className="fin-readout__label">
          {view.past ? "Tenías" : "Caja"}
          {/* Where the date block gives way (narrow headers), the label
              names the day the figures are for. */}
          <span className="fin-readout__label-day">
            {" · "}
            {dayNumber} {month}
          </span>
        </span>
        <span
          className="fin-readout__cash"
          title={view.past && view.past.cash === null ? "Ese día no quedó registrado" : undefined}
        >
          {view.past
            ? view.past.cash === null
              ? "—"
              : formatMoneyWhole(view.past.cash)
            : formatMoneyWhole(view.snapshot!.cash)}
        </span>
      </span>
      {view.past ? (
        // The past keeps the cash, not the debts: this cell says how it
        // changed since that day.
        <span className="fin-readout__cell fin-readout__cell--since">
          <span className="fin-readout__label">Hasta hoy</span>
          <span
            className="fin-readout__debt fin-readout__since"
            data-trend={view.past.since === null ? undefined : view.past.since >= 0 ? "up" : "down"}
          >
            {view.past.since === null ? "—" : formatSignedMoneyWhole(view.past.since)}
          </span>
        </span>
      ) : (
        <span className="fin-readout__cell">
          <span className="fin-readout__swatch fin-readout__swatch--debt" aria-hidden="true" />
          <span className="fin-readout__label">Deuda</span>
          <span className="fin-readout__debt">
            {formatMoneyWhole(view.snapshot!.debt)}
          </span>
        </span>
      )}
      <span className="fin-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {spoken}
      </span>
    </div>
  );
}
