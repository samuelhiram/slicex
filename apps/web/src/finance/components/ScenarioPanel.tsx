// What-if comparison: pin the current projection as the base, then mute /
// edit clips and read the deltas against it. Projections are immutable
// snapshots, so pinning is just keeping the object reference.
import * as React from "react";
import { compareProjections, summarizeProjection } from "@slicex/core";
import type { FinancialProjection } from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateShort, formatMoneyWhole, formatSignedMoneyWhole } from "../format";
import { FinSection, useFinancialRevision } from "./FinancialUi";

export interface ScenarioPanelProps {
  bridge: FinancialBridgeApi;
  defaultOpen?: boolean;
  /**
   * Controlled pinned base. Pass both to keep the base alive while this
   * panel unmounts (the analysis rail collapses); omit both for local state.
   */
  pinned?: FinancialProjection | null;
  onPinnedChange?: (pinned: FinancialProjection | null) => void;
}

type DeltaTone = "good" | "bad" | "neutral";

function tone(delta: number, higherIsBetter: boolean): DeltaTone {
  if (Math.abs(delta) < 0.005) return "neutral";
  return delta > 0 === higherIsBetter ? "good" : "bad";
}

export function ScenarioPanel({
  bridge,
  defaultOpen = true,
  pinned: controlledPinned,
  onPinnedChange,
}: ScenarioPanelProps) {
  const revision = useFinancialRevision(bridge);
  const [localPinned, setLocalPinned] =
    React.useState<FinancialProjection | null>(null);
  const controlled = onPinnedChange !== undefined;
  const pinned = controlled ? (controlledPinned ?? null) : localPinned;
  const setPinned = controlled ? onPinnedChange : setLocalPinned;

  const current = React.useMemo(
    () => bridge.getProjection(),
    // `revision` is the cache key for projection changes.
    [bridge, revision],
  );
  const summary = React.useMemo(() => summarizeProjection(current), [current]);
  const comparison = React.useMemo(
    () => (pinned ? compareProjections(pinned, current) : null),
    [pinned, current],
  );

  const rows: ReadonlyArray<{
    label: string;
    value: number;
    base: number | null;
    delta: number | null;
    higherIsBetter: boolean;
    note?: string;
  }> = [
    {
      label: "Cash final",
      value: summary.finalCash,
      base: comparison ? comparison.base.finalCash : null,
      delta: comparison ? comparison.finalCashDelta : null,
      higherIsBetter: true,
    },
    {
      label: "Deuda final",
      value: summary.finalDebt,
      base: comparison ? comparison.base.finalDebt : null,
      delta: comparison ? comparison.finalDebtDelta : null,
      higherIsBetter: false,
    },
    {
      label: "Mínimo de caja",
      value: summary.minimumCash,
      base: comparison ? comparison.base.minimumCash : null,
      delta: comparison ? comparison.minimumCashDelta : null,
      higherIsBetter: true,
      note: formatDateShort(summary.minimumCashDate),
    },
  ];

  return (
    <FinSection
      title="Escenario"
      defaultOpen={defaultOpen}
      aside={
        pinned ? <span className="fin-section__badge">Base fijada</span> : null
      }
    >
      <table className="fin-table">
        <thead>
          <tr>
            <th>Métrica</th>
            {comparison ? <th className="fin-table__num">Base</th> : null}
            <th className="fin-table__num">Actual</th>
            {comparison ? <th className="fin-table__num">Δ</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="fin-table__name">
                {row.label}
                {row.note ? (
                  <span className="fin-panel__muted"> {row.note}</span>
                ) : null}
              </td>
              {row.base !== null ? (
                <td className="fin-table__num fin-panel__muted">
                  {formatMoneyWhole(row.base)}
                </td>
              ) : null}
              <td className="fin-table__num">{formatMoneyWhole(row.value)}</td>
              {row.delta !== null ? (
                <td
                  className="fin-table__num fin-table__delta"
                  data-tone={tone(row.delta, row.higherIsBetter)}
                >
                  {formatSignedMoneyWhole(row.delta)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="fin-panel__actions">
        <button
          type="button"
          className="fin-panel__button"
          onClick={() => setPinned(bridge.getProjection())}
          title="Guarda la proyección actual como base de comparación"
        >
          {pinned ? "Re-fijar base" : "Fijar base"}
        </button>
        {pinned ? (
          <button
            type="button"
            className="fin-panel__button"
            onClick={() => setPinned(null)}
          >
            Soltar base
          </button>
        ) : null}
      </div>
      <p className="fin-panel__note">
        Mutea o edita clips para simular escenarios what-if.
      </p>
    </FinSection>
  );
}
