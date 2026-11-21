// "Valleys that explain and fix themselves": a card over the timeline when
// the pointer is over a valley of the money lane (transient) or the
// playhead sits inside one (sticky). It names the payments that dig the
// valley (and lights them up on the timeline) and offers one-click fixes,
// each one undoable.
//
// UX audit 2026-11-11:
// - UX-06: each fix says what it costs — "tu punto más bajo $X", the cash
//   (and debt) at the horizon, and a warning when it pays a debt late or
//   costs interest (core: ValleyFix.warning). Hover / focus a fix to see its
//   effect on the lane first (deferred what-if, plan untouched). ONE filled
//   primary: the first fix that does not pay a debt late. "Aplicar" is
//   announced with "Deshacer".
// - UX-50: the card counts as hover area — a ~300 ms grace lets the pointer
//   travel from the valley to "Aplicar"; "Dejar abierta" keeps it without
//   moving the playhead. Escape (from inside) closes a kept card.
// - UX-26 / UX-27 / UX-58: full accessible name, the title is a heading
//   (`#fin-valley-title`, focusable: the header jumps the focus there), and
//   closing gives the focus back to whoever had it.
import * as React from "react";
import type { FinancialDocument, ValleyFix } from "@slicex/core";
import type { FinancialBridgeApi, FinancialPreview } from "../bridge-api";
import { formatDateShort, formatMoneyWhole, formatSignedMoneyWhole } from "../format";
import { useAnnounce } from "../../ui/announcer";
import { useEscapeLayer, useRestoreFocus } from "../../ui/use-overlay";
import { EffectLine, useLivePreviewEffect } from "./EffectLine";
import { useFinancialRevision, usePlayheadDay, VALLEY_TITLE_ID } from "./FinancialUi";

// The title's id lives with the header's focus helper (one source of truth).
export { VALLEY_TITLE_ID };

export interface ValleyCardProps {
  bridge: FinancialBridgeApi;
  /** Day under the pointer over the money lane (null = not over it). */
  hoverDay: number | null;
  /** Where the focus goes when the card closes and its opener is gone. */
  fallbackFocus?: () => HTMLElement | null;
}

/** Pointer grace while it scans other days of the lane (UX-50). */
export const VALLEY_HOVER_GRACE_MS = 300;
/** Pointer grace once it leaves the lane: time to travel to the card (UX-50). */
export const VALLEY_TRAVEL_GRACE_MS = 1200;

const OUTCOME_LABEL: Readonly<Record<ValleyFix["outcome"], string>> = {
  resolves: "Recuperas tu reserva",
  "exits-red": "Sales del rojo",
  improves: "Mejora",
};

/** "Al horizonte: caja +$0 · deuda +$1,200" (pure; exported for tests). */
export function fixHorizonText(fix: ValleyFix): string {
  const cash = Math.abs(fix.finalCashDelta) >= 0.5 ? formatSignedMoneyWhole(fix.finalCashDelta) : "sin cambio";
  const debt = Math.abs(fix.finalDebtDelta) >= 0.5 ? ` · deuda ${formatSignedMoneyWhole(fix.finalDebtDelta)}` : "";
  return `Al horizonte: caja ${cash}${debt}`;
}

/** Index of the one filled primary: the first fix that does not pay a debt late. */
export function primaryFixIndex(fixes: readonly ValleyFix[]): number {
  return fixes.findIndex((fix) => !fix.delaysDebt);
}

function patchedDocument(doc: FinancialDocument, fix: ValleyFix): FinancialDocument {
  return { ...doc, items: doc.items.map((item) => (item.id === fix.itemId ? fix.patch : item)) };
}

export function ValleyCard({ bridge, hoverDay, fallbackFocus }: ValleyCardProps) {
  const revision = useFinancialRevision(bridge);
  const playheadDay = usePlayheadDay(bridge);
  const announce = useAnnounce();
  const [dismissed, setDismissed] = React.useState<string | null>(null);
  // Hover kept alive by the grace / the pointer over the card (UX-50).
  const [heldDay, setHeldDay] = React.useState<number | null>(null);
  // "Dejar abierta": kept without moving the playhead.
  const [keptDay, setKeptDay] = React.useState<number | null>(null);
  const [inView, setInView] = React.useState<string | null>(null);
  const cardRef = React.useRef<HTMLElement | null>(null);
  const pointerInside = React.useRef(false);
  const graceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const graceDelay = React.useRef(0);

  const cancelRelease = React.useCallback(() => {
    if (graceTimer.current !== null) clearTimeout(graceTimer.current);
    graceTimer.current = null;
  }, []);
  // Release the hover card after `delay`, unless the pointer / focus is in
  // it by then. A pending release with the same delay is kept (scanning the
  // lane day after day does not keep pushing it back).
  const scheduleRelease = React.useCallback((delay: number) => {
    if (graceTimer.current !== null && graceDelay.current === delay) return;
    if (graceTimer.current !== null) clearTimeout(graceTimer.current);
    graceDelay.current = delay;
    graceTimer.current = setTimeout(() => {
      graceTimer.current = null;
      const card = cardRef.current;
      const focusInside = card !== null && card.contains(document.activeElement);
      if (!pointerInside.current && !focusInside) setHeldDay(null);
    }, delay);
  }, []);

  // The whole day: the state only changes when the pointer crosses a day
  // (React bails out on the same value), never per pointermove. A day with
  // a valley takes the card; a day without one (or leaving the lane) only
  // starts the grace — the pointer may be on its way to the card.
  const hoverWholeDay = hoverDay === null ? null : Math.floor(hoverDay);
  React.useEffect(() => {
    if (hoverWholeDay !== null && bridge.valleyAt(hoverWholeDay) !== null) {
      cancelRelease();
      setHeldDay(hoverWholeDay);
      return;
    }
    if (heldDay === null || pointerInside.current) return;
    scheduleRelease(hoverWholeDay === null ? VALLEY_TRAVEL_GRACE_MS : VALLEY_HOVER_GRACE_MS);
  }, [bridge, revision, hoverWholeDay, heldDay, cancelRelease, scheduleRelease]);
  React.useEffect(
    () => () => {
      if (graceTimer.current !== null) clearTimeout(graceTimer.current);
    },
    [],
  );

  const hovered = React.useMemo(
    () => (heldDay === null ? null : bridge.valleyAt(heldDay)),
    [bridge, revision, heldDay],
  );
  const kept = React.useMemo(
    () => (keptDay === null ? null : bridge.valleyAt(keptDay)),
    [bridge, revision, keptDay],
  );
  const pinned = React.useMemo(
    () => bridge.valleyAt(playheadDay),
    [bridge, revision, playheadDay],
  );
  const insight = hovered ?? kept ?? pinned;
  const keyOf = (value: typeof insight) =>
    value ? `${value.warning.startDate}:${value.warning.eventId}` : null;
  const key = keyOf(insight);
  const visible = insight !== null && key !== dismissed;
  const sticky =
    insight !== null && ((kept !== null && keyOf(kept) === key) || (pinned !== null && keyOf(pinned) === key));

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
    if (dismissed !== null && pinned && keyOf(pinned) !== dismissed) {
      setDismissed(null);
    }
  }, [pinned, dismissed]);

  const pinnedKey = keyOf(pinned);
  const close = React.useCallback(() => {
    setKeptDay(null);
    setHeldDay(null);
    setInView(null);
    // The playhead's own valley stays closed until another one is under it.
    if (pinnedKey !== null && pinnedKey === key) setDismissed(key);
  }, [key, pinnedKey]);
  useEscapeLayer(visible && sticky, close, { within: [cardRef] });
  useRestoreFocus(visible, fallbackFocus, { containerRef: cardRef });

  // The fix in view (hover / focus) previews on the lane, deferred.
  const fixes = visible && insight ? insight.fixes : [];
  const fixInView = fixes.find((fix) => fix.id === inView) ?? null;
  const preview = React.useMemo<FinancialPreview | null>(
    () => (fixInView ? { kind: "document", doc: patchedDocument(bridge.getDocument(), fixInView) } : null),
    // `revision`: the plan the patch applies to.
    [bridge, fixInView, revision],
  );
  const effect = useLivePreviewEffect(bridge, preview);

  const titleId = VALLEY_TITLE_ID;
  const eyebrowId = React.useId();
  if (!visible || !insight) return null;
  const { warning, explanation } = insight;
  const negative = warning.cash < 0;
  const primary = primaryFixIndex(fixes);
  const reserve = bridge.getDocument().minimumCashReserve;

  const apply = (fix: ValleyFix) => {
    setInView(null);
    bridge.setPreview(null);
    if (!bridge.applyValleyFix(fix)) return;
    // The fixes re-render (or the card goes): never leave the focus on
    // <body> — the card's title when it stays, else where it came from.
    requestAnimationFrame(() => {
      const current = document.activeElement;
      if (current && current !== document.body && current.isConnected) return;
      const title = document.getElementById(VALLEY_TITLE_ID);
      if (title) title.focus({ preventScroll: true });
      else fallbackFocus?.()?.focus({ preventScroll: true });
    });
    const projection = bridge.getProjection();
    const alerts = bridge.getWarnings().length;
    announce({
      message:
        `${fix.title}: aplicado. Tu punto más bajo: ${formatMoneyWhole(projection.minimumCash.cash)} el ${formatDateShort(projection.minimumCash.date)}` +
        ` · ${alerts === 0 ? "sin alertas" : alerts === 1 ? "1 alerta" : `${alerts} alertas`}`,
      undo: () => bridge.core.undo(),
    });
  };

  return (
    <section
      ref={cardRef}
      className="fin-valley"
      data-state={negative ? "negative" : "low"}
      aria-labelledby={`${eyebrowId} ${titleId}`}
      onPointerEnter={() => {
        pointerInside.current = true;
        cancelRelease();
      }}
      onPointerLeave={() => {
        pointerInside.current = false;
        if (hoverWholeDay === null && heldDay !== null) scheduleRelease(VALLEY_HOVER_GRACE_MS);
      }}
    >
      <header className="fin-valley__header">
        <div>
          <p id={eyebrowId} className="fin-valley__eyebrow">
            {negative ? "Te quedas en rojo" : "Rompes tu reserva"}
          </p>
          <h2 id={titleId} className="fin-valley__title" tabIndex={-1}>
            {formatMoneyWhole(warning.cash)} el {formatDateShort(warning.date)}
          </h2>
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
            aria-label="Cerrar la tarjeta del valle"
            title="Cerrar"
            onClick={close}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10M15 5 5 15" />
            </svg>
          </button>
        ) : null}
      </header>

      {explanation.causes.length > 0 ? (
        <div className="fin-valley__block">
          <h3 className="fin-valley__label">Lo cavan</h3>
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
        <h3 className="fin-valley__label">Arreglos</h3>
        {fixes.length === 0 ? (
          <p className="fin-valley__empty">
            No encontré un movimiento que lo resuelva solo. Prueba bajar un gasto o
            mover un pago a después de tu próximo ingreso.
          </p>
        ) : (
          <ul className="fin-valley__fixes" onMouseLeave={() => setInView(null)}>
            {fixes.map((fix, index) => {
              const costId = `${eyebrowId}-cost-${index}`;
              return (
                <li
                  key={fix.id}
                  className="fin-valley__fix"
                  data-risk={fix.delaysDebt ? "debt" : fix.warning ? "cost" : undefined}
                  data-in-view={fix.id === inView ? "true" : undefined}
                  onMouseEnter={() => setInView(fix.id)}
                >
                  <div className="fin-valley__fix-text" id={costId}>
                    <span className="fin-valley__fix-title">{fix.title}</span>
                    <span className="fin-valley__fix-outcome" data-outcome={fix.outcome}>
                      {OUTCOME_LABEL[fix.outcome]} · tu punto más bajo {formatMoneyWhole(fix.after)}
                    </span>
                    <span className="fin-valley__fix-cost">{fixHorizonText(fix)}</span>
                    {fix.warning ? (
                      <span className="fin-valley__fix-warning">{fix.warning}</span>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className={
                      index === primary
                        ? "fin-button fin-button--primary fin-valley__apply"
                        : "fin-button fin-valley__apply"
                    }
                    aria-label={`Aplicar: ${fix.title}`}
                    aria-describedby={costId}
                    onFocus={() => setInView(fix.id)}
                    onBlur={() => setInView((current) => (current === fix.id ? null : current))}
                    onClick={() => apply(fix)}
                  >
                    Aplicar
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {fixInView ? <EffectLine effect={effect} reserve={reserve} className="fin-valley__effect" /> : null}
      </div>
      {!sticky ? (
        <div className="fin-valley__keep">
          <button
            type="button"
            className="fin-button"
            onClick={() => {
              setKeptDay(heldDay);
            }}
          >
            Dejar abierta
          </button>
        </div>
      ) : null}
    </section>
  );
}
