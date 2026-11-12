// "Futuros": alternative versions of the year. The button shows the active
// future; its menu switches between them (the money lane morphs from one to
// the other), creates a new one, compares one as a ghost under the active
// curve, renames, makes one the main plan or discards it. Hold Q anywhere —
// or press "Asomarte" — to peek at the other future.
//
// UX audit 2026-11-11:
// - UX-20: every future shows its figures (horizon, lowest point) and the
//   difference against the active one, read from summaries cached per
//   document (futures.summaryOf); "Asomarte" (FuturesPeekChip) does what
//   holding Q does, without a key (≥ 44 px on touch).
// - UX-54: unique names, "Probar otra versión de mi año" (no fork date that
//   did nothing), "Hacer este mi plan principal" / "Descartar este futuro" in
//   one action each, announced with "Deshacer". "Reiniciar…" lives in the
//   plan menu (UX-48).
// - UX-57: inside `role="menu"` only menu items, a separator and rows with
//   `role="none"`; the heading and the hint sit outside it.
// - UX-27: one open / close contract (useOverlay "menu").
import * as React from "react";
import { createPortal } from "react-dom";
import type { ProjectionSummary } from "@slicex/core";
import { useFitInViewport } from "../../ui/fit-in-viewport";
import { useAnnounce } from "../../ui/announcer";
import { useEscapeLayer, useOverlay } from "../../ui/use-overlay";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatMoneyWhole, formatSignedMoneyWhole } from "../format";
import { MAIN_BRANCH_ID, type Futures } from "../futures";
import { useFinancialRevision, usePlayheadDay } from "./FinancialUi";

export interface FuturesMenuProps {
  bridge: FinancialBridgeApi;
  futures: Futures;
  inert?: boolean;
}

function useFuturesVersion(futures: Futures): number {
  return React.useSyncExternalStore(futures.subscribe, futures.getVersion, futures.getVersion);
}

/** "Al horizonte $95,708 · punto más bajo −$1,292". */
export function futureFigures(summary: ProjectionSummary): string {
  return `Al horizonte ${formatMoneyWhole(summary.finalCash)} · punto más bajo ${formatMoneyWhole(summary.minimumCash)}`;
}

/** "horizonte −$25,000 · punto más bajo +$0" (`mine` − `other`). */
export function futureDelta(mine: ProjectionSummary, other: ProjectionSummary): string {
  const horizon = mine.finalCash - other.finalCash;
  const lowest = mine.minimumCash - other.minimumCash;
  const part = (label: string, value: number) =>
    `${label} ${Math.abs(value) < 0.5 ? "igual" : formatSignedMoneyWhole(value)}`;
  return `${part("horizonte", horizon)} · ${part("punto más bajo", lowest)}`;
}

const ITEM_SELECTOR = '[role="menuitemradio"], [role="menuitemcheckbox"], [role="menuitem"]';

export function FuturesMenu({ bridge, futures, inert = false }: FuturesMenuProps) {
  useFuturesVersion(futures);
  // The active future's figures follow the plan (once per revision).
  useFinancialRevision(bridge);
  const announce = useAnnounce();
  const day = usePlayheadDay(bridge);
  const [anchor, setAnchor] = React.useState<{ top: number; left: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const open = anchor !== null;
  useFitInViewport(popoverRef, open, [anchor]);
  const branches = futures.list();
  const active = futures.activeBranch();
  const compareId = futures.getCompareId();
  const forkDate = bridge.dateAtBeat(day);
  const headingId = React.useId();

  const close = React.useCallback((restoreFocus: boolean) => {
    setAnchor(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  useOverlay({
    open,
    onClose: () => setAnchor(null),
    kind: "menu",
    containerRef: popoverRef,
    triggerRef,
    autoFocus: false,
  });

  React.useEffect(() => {
    if (inert && open) setAnchor(null);
  }, [inert, open]);

  React.useEffect(() => {
    if (!open) return;
    popoverRef.current?.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus();
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(popoverRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      items[event.key === "Home" ? 0 : items.length - 1]?.focus();
    } else if (event.key === "Tab") {
      event.preventDefault();
      close(true);
    }
  };

  // Figures only while the menu is open (cached per document anyway).
  const activeSummary = open ? futures.summaryOf(active.id) : null;

  return (
    <div className="fin-futures">
      <button
        ref={triggerRef}
        type="button"
        className="fin-futures__trigger"
        // Alone on the main plan, the name says nothing new: narrower
        // windows may show just the icon (the name stays its label).
        data-quiet={branches.length === 1 && active.id === MAIN_BRANCH_ID ? "true" : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Futuros: versiones de tu año para probar"
        onClick={() => {
          if (open) {
            setAnchor(null);
            return;
          }
          const rect = triggerRef.current!.getBoundingClientRect();
          setAnchor({ top: rect.bottom + 6, left: rect.left });
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="4" cy="3.5" r="1.6" />
          <circle cx="4" cy="12.5" r="1.6" />
          <circle cx="12" cy="6" r="1.6" />
          <path d="M4 5.1v5.8M12 7.6c0 2.6-3 2.4-6.6 4" />
        </svg>
        <span className="fin-futures__name">{active.name}</span>
        {branches.length > 1 ? (
          <span className="fin-futures__count">{branches.length}</span>
        ) : null}
      </button>
      {anchor
        ? createPortal(
            <div
              ref={popoverRef}
              className="fin-popover fin-futures__menu"
              style={{ top: anchor.top, left: anchor.left }}
              onKeyDown={onKeyDown}
            >
              <p className="fin-futures__heading" id={headingId}>
                Futuros
              </p>
              <div role="menu" aria-labelledby={headingId} className="fin-futures__list">
                {branches.map((branch) => {
                  const isActive = branch.id === active.id;
                  const isCompared = branch.id === compareId;
                  const summary = futures.summaryOf(branch.id);
                  return (
                    <div key={branch.id} role="none" className="fin-futures__row" data-active={isActive}>
                      <button
                        type="button"
                        role="menuitemradio"
                        aria-checked={isActive}
                        tabIndex={-1}
                        className="fin-futures__item"
                        onClick={() => {
                          futures.switchTo(branch.id);
                          close(true);
                          if (!isActive) announce({ message: `Ahora ves ${branch.name}.` });
                        }}
                      >
                        <span className="fin-futures__radio" aria-hidden="true" />
                        <span className="fin-futures__text">
                          <span className="fin-futures__label">
                            {branch.name}
                            {isActive ? <span className="fin-futures__badge"> · activo</span> : null}
                          </span>
                          {summary ? <span className="fin-futures__meta">{futureFigures(summary)}</span> : null}
                          {summary && activeSummary && !isActive ? (
                            <span className="fin-futures__delta">
                              {active.name} contra este: {futureDelta(activeSummary, summary)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      {!isActive ? (
                        <button
                          type="button"
                          role="menuitemcheckbox"
                          aria-checked={isCompared}
                          tabIndex={-1}
                          className="fin-futures__chip"
                          data-on={isCompared}
                          title="Dibujar este futuro como fantasma bajo tu curva"
                          onClick={() => futures.setCompare(isCompared ? null : branch.id)}
                        >
                          {isCompared ? "Comparando" : "Comparar"}
                        </button>
                      ) : null}
                    </div>
                  );
                })}
                <div className="fin-futures__divider" role="separator" />
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="fin-futures__action"
                  onClick={() => {
                    const from = futures.activeBranch();
                    const branch = futures.fork(forkDate);
                    close(true);
                    announce({
                      message: `Creaste ${branch.name}: una copia de ${from.name} para probar sin tocarlo.`,
                      undo: () => {
                        futures.discard(branch.id, from.id);
                      },
                    });
                  }}
                >
                  Probar otra versión de mi año
                </button>
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="fin-futures__action"
                  onClick={() => {
                    const next = window.prompt("Nombre de este futuro", active.name);
                    if (next) futures.rename(active.id, next);
                    close(true);
                  }}
                >
                  Renombrar “{active.name}”…
                </button>
                {active.id !== MAIN_BRANCH_ID ? (
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="fin-futures__action"
                    onClick={() => {
                      const name = active.name;
                      const undo = futures.adopt(active.id);
                      close(true);
                      if (undo) {
                        announce({
                          message: `${name} es ahora tu plan principal.`,
                          undo: () => futures.restore(undo),
                        });
                      }
                    }}
                  >
                    Hacer este mi plan principal
                  </button>
                ) : null}
                {active.id !== MAIN_BRANCH_ID && branches.length > 1 ? (
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="fin-futures__action fin-futures__action--danger"
                    onClick={() => {
                      const name = active.name;
                      const undo = futures.discard(active.id, active.trialOf ?? MAIN_BRANCH_ID);
                      close(true);
                      if (undo) {
                        announce({
                          message: `Descartaste ${name}. Ahora ves ${futures.activeBranch().name}.`,
                          undo: () => futures.restore(undo),
                        });
                      }
                    }}
                  >
                    Descartar este futuro
                  </button>
                ) : null}
                {/* "Reiniciar con el ejemplo…" lives in "Mi plan ▾" (UX-48). */}
              </div>
              {branches.length > 1 ? (
                <p className="fin-futures__hint">
                  Mantén <kbd>Q</kbd> o pulsa «Asomarte» para ver el otro futuro sin cambiarte.
                </p>
              ) : (
                <p className="fin-futures__hint">
                  Prueba otra versión de tu año sin perder esta.
                </p>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

export interface FuturesPeekChipProps {
  bridge: FinancialBridgeApi;
  futures: Futures;
  /** A peek started by this chip is on. */
  peeking: boolean;
  /** Another peek (Q / A held) is on: the button waits. */
  busy?: boolean;
  /** Starts the same peek as holding Q, on future `id`. */
  onPeek: (id: string) => void;
  onEndPeek: () => void;
}

/**
 * UX-20: with two or more futures, the active one against the other in
 * figures ("Este futuro contra «Plan principal»: horizonte −$25,000 · punto
 * más bajo igual") and "Asomarte" — the peek of holding Q, as a toggle
 * (Escape or "Volver" ends it). Summaries are cached per document: O(1) on
 * re-renders.
 */
export const FuturesPeekChip = React.memo(function FuturesPeekChip({
  bridge,
  futures,
  peeking,
  busy = false,
  onPeek,
  onEndPeek,
}: FuturesPeekChipProps) {
  useFuturesVersion(futures);
  useFinancialRevision(bridge);
  useEscapeLayer(peeking, onEndPeek);
  const target = futures.peekTarget();
  if (!target) return null;
  const active = futures.activeBranch();
  const mine = futures.summaryOf(active.id);
  const other = futures.summaryOf(target.id);
  return (
    <div className="fin-compare" role="group" aria-label={`${active.name} contra ${target.name}`}>
      <p className="fin-compare__text">
        <strong>{active.name}</strong> contra <strong>{target.name}</strong>
        {mine && other ? `: ${futureDelta(mine, other)}` : ""}
      </p>
      <button
        type="button"
        className="fin-compare__peek"
        aria-pressed={peeking}
        disabled={busy}
        title={peeking ? "Volver a tu futuro (Esc)" : `Ver ${target.name} en el carril, sin cambiarte (o mantén Q)`}
        onClick={() => (peeking ? onEndPeek() : onPeek(target.id))}
      >
        {peeking ? "Volver" : "Asomarte"}
      </button>
    </div>
  );
});
