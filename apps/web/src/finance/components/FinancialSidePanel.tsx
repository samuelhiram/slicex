// "Comparar y pagar deudas" (UX audit 2026-11-11, UX-47 — was "Análisis"):
// a rail with "Probar cambios" (trial future + comparison between futures)
// and the avalanche. ONE toggle button with `aria-expanded`, always mounted
// in the money lane's header cell (UX-27: opening / closing never drops the
// focus). Open, the rail renders in `slot` — a column BESIDE the stage — so
// it pushes the canvas (the renderer's ResizeObserver follows) instead of
// covering the row headers; without a slot it overlays the stage as before.
// Escape from inside the rail (or its toggle) closes it (useOverlay
// "panel"); its title is a heading and its sections `h3 > button`.
import * as React from "react";
import { createPortal } from "react-dom";
import type { ISODate } from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import type { Futures } from "../futures";
import { useOverlay } from "../../ui/use-overlay";
import { DebtStrategyPanel } from "./DebtStrategyPanel";
import { ScenarioPanel } from "./ScenarioPanel";

export interface FinancialSidePanelProps {
  bridge: FinancialBridgeApi;
  /** The plan's futures ("Probar cambios" lives there). */
  futures?: Futures | null;
  today?: ISODate;
  /** Start expanded (default false, like the inspector). */
  defaultOpen?: boolean;
  /** Column beside the stage where the open rail renders (null: overlay). */
  slot?: HTMLElement | null;
}

export const SIDE_PANEL_TITLE = "Comparar y pagar deudas";
/**
 * The collapsed toggle's visible name. It shares the "Caja" title row of the
 * 216 px lane header (the readout fills the rows below at every density), so
 * the full title would touch "Caja"; the short task name leaves it room. The
 * open rail's heading and the tooltip keep the full wording.
 */
export const SIDE_PANEL_TAB_LABEL = "Pagar deudas";

export function FinancialSidePanel({
  bridge,
  futures = null,
  today,
  defaultOpen = false,
  slot = null,
}: FinancialSidePanelProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const toggleRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLElement | null>(null);
  const panelId = React.useId();
  const titleId = React.useId();
  const close = React.useCallback(() => setOpen(false), []);
  useOverlay({
    open,
    onClose: close,
    kind: "panel",
    containerRef: panelRef,
    triggerRef: toggleRef,
    // Opening moves the focus to the rail (it may sit far from the toggle).
    autoFocus: true,
  });

  const panel = open ? (
    <aside
      ref={panelRef}
      id={panelId}
      className={slot ? "fin-side fin-side--docked" : "fin-side"}
      aria-labelledby={titleId}
    >
      <header className="fin-side__header">
        <h2 id={titleId} className="fin-side__title">
          {SIDE_PANEL_TITLE}
        </h2>
        <button
          type="button"
          className="fin-side__close"
          onClick={() => {
            setOpen(false);
            toggleRef.current?.focus();
          }}
          aria-label={`Cerrar ${SIDE_PANEL_TITLE.toLowerCase()}`}
          title="Cerrar (Esc)"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 5l10 10M15 5 5 15" />
          </svg>
        </button>
      </header>
      <div className="fin-side__body">
        <ScenarioPanel bridge={bridge} futures={futures} today={today} />
        <DebtStrategyPanel bridge={bridge} />
      </div>
    </aside>
  ) : null;

  return (
    <>
      <div className="fin-side fin-side--collapsed">
        <button
          ref={toggleRef}
          type="button"
          className="fin-side__tab"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((value) => !value)}
          title={
            open
              ? `Cerrar ${SIDE_PANEL_TITLE.toLowerCase()}`
              : `${SIDE_PANEL_TITLE}: probar cambios sin tocar tu plan y decidir qué deuda pagar`
          }
        >
          <span className="fin-side__tab-arrow" aria-hidden="true">
            {open ? "◀" : "▶"}
          </span>
          <span className="fin-side__tab-label">{SIDE_PANEL_TAB_LABEL}</span>
        </button>
      </div>
      {panel && slot ? createPortal(panel, slot) : panel}
    </>
  );
}
