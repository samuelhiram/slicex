// Left-docked analysis rail (mirror of PlaylistInspector on the right):
// collapsed = a narrow tab under the ruler; open = 280px column stacking
// the scenario comparison and the avalanche strategy.
import * as React from "react";
import type { FinancialProjection } from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import { DebtStrategyPanel } from "./DebtStrategyPanel";
import { ScenarioPanel } from "./ScenarioPanel";

export interface FinancialSidePanelProps {
  bridge: FinancialBridgeApi;
  /** Start expanded (default false, like the inspector). */
  defaultOpen?: boolean;
}

export function FinancialSidePanel({
  bridge,
  defaultOpen = false,
}: FinancialSidePanelProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  // The scenario base lives here, not in ScenarioPanel: collapsing the rail
  // unmounts the panels, and the what-if flow ("mutea…") needs the track
  // headers the open rail covers. The base survives until "Soltar base".
  const [pinned, setPinned] = React.useState<FinancialProjection | null>(null);

  if (!open) {
    return (
      <aside
        className="fin-side fin-side--collapsed"
        aria-label="Análisis financiero"
      >
        <button
          type="button"
          className="fin-side__tab"
          onClick={() => setOpen(true)}
          aria-label="Abrir análisis financiero"
          title="Abrir análisis (escenario · deudas)"
        >
          <span className="fin-side__tab-arrow" aria-hidden="true">
            ▶
          </span>
          <span className="fin-side__tab-label">Análisis</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="fin-side" aria-label="Análisis financiero">
      <header className="fin-side__header">
        <strong>Análisis</strong>
        <button
          type="button"
          className="fin-side__close"
          onClick={() => setOpen(false)}
          aria-label="Cerrar análisis financiero"
          title="Cerrar análisis"
        >
          ◀
        </button>
      </header>
      <div className="fin-side__body">
        <ScenarioPanel
          bridge={bridge}
          pinned={pinned}
          onPinnedChange={setPinned}
        />
        <DebtStrategyPanel bridge={bridge} />
      </div>
    </aside>
  );
}
