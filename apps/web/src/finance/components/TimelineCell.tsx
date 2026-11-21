// The money lane's header cell (left of the green chart, under the corner
// pad): icon buttons that act on the timeline itself, each one click and
// one undo step (no visible title since 2026-11-20; the group is named
// "Plano de eventos" for screen readers):
//   - "alto normal" (three equal rows + a height arrow opening out): every
//     event line back to its normal height;
//   - "compactar" (the rows squeezed into lines, two arrows closing in):
//     every event line at HALF its normal height;
//   - "ordenar por tipo" (an "A" and a curved arrow): every item on its
//     own line, incomes first, then expenses, then the debts, from the
//     first line down (bridge.arrangeByKind) — announced with "Deshacer".
import * as React from "react";
import type { PlaylistCore } from "@slicex/canvas";
import { useAnnounce } from "../../ui/announcer";
import type { FinancialBridgeApi } from "../bridge-api";
import { compactRowHeight, compactRowHeights, normalRowHeights, useAtDefaults } from "./ZoomPad";

export interface TimelineCellProps {
  core: PlaylistCore;
  /** The lines' normal height ("Alto normal"). */
  normalHeight: number;
  /** The default zoom (only read to share the pad's defaults hook). */
  defaultPxPerBeat: number;
  /** "Ordenar por tipo" acts on the plan's items (absent: no button). */
  bridge?: FinancialBridgeApi | null;
}

/** Whether the rows already are "by kind" (O(1) per notify: the bridge caches it). */
function useArranged(core: PlaylistCore, bridge: FinancialBridgeApi | null): boolean {
  const subscribe = React.useCallback(
    (listener: () => void) => {
      const sub = core.subscribe(listener);
      return () => sub.unsubscribe();
    },
    [core],
  );
  const read = React.useCallback(() => (bridge ? bridge.isArrangedByKind() : true), [bridge]);
  return React.useSyncExternalStore(subscribe, read, read);
}

export function TimelineCell({ core, normalHeight, defaultPxPerBeat, bridge = null }: TimelineCellProps) {
  const atDefaults = useAtDefaults(core, normalHeight, defaultPxPerBeat);
  const arranged = useArranged(core, bridge);
  const announce = useAnnounce();
  const compactHeight = compactRowHeight(normalHeight);
  return (
    <div
      className="fin-lanecell"
      role="group"
      // No visible title (2026-11-20): the buttons speak for themselves; the
      // group keeps its name for screen readers.
      aria-label="Plano de eventos"
    >
      <div className="fin-lanecell__actions">
        {/* Icon only: three equal rows with the height arrow beside them. */}
        <button
          type="button"
          className="fin-lanecell__button"
          aria-label="Todas las líneas a su alto normal"
          disabled={atDefaults.rows}
          title={`Alto normal: todas las líneas de evento a ${normalHeight} px`}
          onClick={() => normalRowHeights(core, normalHeight)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <rect x="8" y="3" width="9.5" height="3.6" rx="1" />
            <rect x="8" y="8.2" width="9.5" height="3.6" rx="1" />
            <rect x="8" y="13.4" width="9.5" height="3.6" rx="1" />
            <path d="M4 3.5v13M2.2 5.3 4 3.5l1.8 1.8M2.2 14.7 4 16.5l1.8-1.8" />
          </svg>
        </button>
        {/* Icon only: the rows squeezed into lines, two arrows closing in. */}
        <button
          type="button"
          className="fin-lanecell__button"
          aria-label="Compactar todas las líneas"
          disabled={atDefaults.compact}
          title={`Compactar: todas las líneas de evento a ${compactHeight} px (la mitad de lo normal)`}
          onClick={() => compactRowHeights(core, normalHeight)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M8 7.5h9.5M8 10h9.5M8 12.5h9.5" />
            <path d="M4 2.5v5M2.2 5.7 4 7.5l1.8-1.8M4 17.5v-5M2.2 14.3 4 12.5l1.8 1.8" />
          </svg>
        </button>
        {/* Icon only: an "A" and a curved arrow — put in order. */}
        {bridge ? (
          <button
            type="button"
            className="fin-lanecell__button"
            aria-label="Ordenar por tipo"
            disabled={arranged}
            title={
              arranged
                ? "Ya están ordenados por tipo: cada uno en su línea, ingresos, gastos y deudas"
                : "Ordenar por tipo: cada uno en su línea, primero ingresos, luego gastos y deudas, desde la primera línea"
            }
            onClick={() => {
              if (!bridge.arrangeByKind()) return;
              // The items now fill the first lines: show them.
              core.updateViewport({ scrollY: 0 });
              announce({
                message: "Ordenado por tipo: cada uno en su línea, ingresos, gastos y deudas.",
                undo: () => core.undo(),
              });
            }}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M2.5 15.5 6 4.5l3.5 11M3.7 11.8h4.6" />
              <path d="M12.5 4.5c3.3 0 5 2.2 5 5.2s-1.7 5.3-5 5.3" />
              <path d="M14.4 12.9 12.5 15l1.9 2" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  );
}
