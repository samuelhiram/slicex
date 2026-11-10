// "Futuros": alternative versions of the year, like git branches. The
// button shows the active future; its menu switches between them (the
// money lane morphs from one to the other), forks a new one at the
// playhead, compares one as a ghost under the active curve, renames and
// deletes. Hold Q anywhere to peek at the other future.
import * as React from "react";
import { useFitInViewport } from "../../ui/fit-in-viewport";
import { useDismiss } from "../../ui/use-dismiss";
import { createPortal } from "react-dom";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateShort } from "../format";
import { MAIN_BRANCH_ID, type Futures } from "../futures";
import { usePlayheadDay } from "./FinancialUi";

export interface FuturesMenuProps {
  bridge: FinancialBridgeApi;
  futures: Futures;
  inert?: boolean;
}

function useFuturesVersion(futures: Futures): number {
  return React.useSyncExternalStore(futures.subscribe, futures.getVersion, futures.getVersion);
}

export function FuturesMenu({ bridge, futures, inert = false }: FuturesMenuProps) {
  useFuturesVersion(futures);
  const day = usePlayheadDay(bridge);
  const [anchor, setAnchor] = React.useState<{ top: number; left: number } | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const open = anchor !== null;
  useFitInViewport(menuRef, open, [anchor]);
  const branches = futures.list();
  const active = futures.activeBranch();
  const compareId = futures.getCompareId();
  const forkDate = bridge.dateAtBeat(day);

  const close = React.useCallback((restoreFocus: boolean) => {
    setAnchor(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  React.useEffect(() => {
    if (inert && open) setAnchor(null);
  }, [inert, open]);

  React.useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"], [role="menuitem"]')?.focus();
  }, [open]);
  useDismiss(open, [triggerRef, menuRef], () => setAnchor(null));

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"], [role="menuitem"]') ?? [],
    );
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      items[(index + step + items.length) % items.length]?.focus();
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
  };

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
        title="Futuros: versiones alternativas de tu año"
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
              ref={menuRef}
              className="fin-popover fin-futures__menu"
              role="menu"
              aria-label="Futuros"
              style={{ top: anchor.top, left: anchor.left }}
              onKeyDown={onKeyDown}
            >
              <p className="fin-futures__heading">Futuros</p>
              {branches.map((branch) => {
                const isActive = branch.id === active.id;
                const isCompared = branch.id === compareId;
                return (
                  <div key={branch.id} className="fin-futures__row" data-active={isActive}>
                    <button
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      tabIndex={-1}
                      className="fin-futures__item"
                      onClick={() => {
                        futures.switchTo(branch.id);
                        close(true);
                      }}
                    >
                      <span className="fin-futures__radio" aria-hidden="true" />
                      <span className="fin-futures__text">
                        <span className="fin-futures__label">{branch.name}</span>
                        <span className="fin-futures__meta">
                          {branch.forkDate
                            ? `Desde ${formatDateShort(branch.forkDate)}`
                            : "Original"}
                          {isActive ? " · activo" : ""}
                        </span>
                      </span>
                    </button>
                    {!isActive ? (
                      <button
                        type="button"
                        className="fin-futures__chip"
                        data-on={isCompared}
                        aria-pressed={isCompared}
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
                  futures.fork(forkDate);
                  close(true);
                }}
              >
                Bifurcar aquí · {formatDateShort(forkDate)}
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
                Renombrar “{active.name}”
              </button>
              {branches.length > 1 ? (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="fin-futures__action fin-futures__action--danger"
                  onClick={() => {
                    if (window.confirm(`¿Borrar el futuro “${active.name}”?`)) {
                      futures.remove(active.id);
                    }
                    close(true);
                  }}
                >
                  Borrar este futuro
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="fin-futures__action fin-futures__action--danger"
                onClick={() => {
                  close(true);
                  if (
                    window.confirm(
                      "¿Reiniciar con el año de ejemplo? Se borra tu plan y todos sus futuros.",
                    )
                  ) {
                    window.location.assign(`${window.location.pathname}?reset`);
                  }
                }}
              >
                Reiniciar con el año de ejemplo…
              </button>
              {branches.length > 1 ? (
                <p className="fin-futures__hint">
                  Mantén <kbd>Q</kbd> para asomarte al otro futuro.
                </p>
              ) : (
                <p className="fin-futures__hint">
                  Bifurca para probar otra versión de tu año sin perder esta.
                </p>
              )}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
