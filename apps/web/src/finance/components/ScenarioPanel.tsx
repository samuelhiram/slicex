// "Probar cambios" (UX audit 2026-11-11, UX-21): simulating never edits the
// real plan. "Probar cambios" opens a TEMPORARY future (a copy of the one on
// screen); the person adds, moves or silences freely and then keeps the
// changes or discards them — discarding brings the plan back exactly as it
// was (document and undo history). With other futures, the panel is their
// numeric comparison ("Comparar con: [futuro ▾]"). Figures come from
// summaries cached per document (futures.summaryOf), never per frame.
import * as React from "react";
import { summarizeProjection, type ISODate, type ProjectionSummary } from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateShort, formatMoneyWhole, formatSignedMoneyWhole } from "../format";
import { type Futures } from "../futures";
import { useAnnounce } from "../../ui/announcer";
import { FinSection, useFinancialRevision } from "./FinancialUi";

export interface ScenarioPanelProps {
  bridge: FinancialBridgeApi;
  /** The plan's futures (the trial lives there); without them, figures only. */
  futures?: Futures | null;
  /** Today (the trial's "fork" day). */
  today?: ISODate;
  defaultOpen?: boolean;
}

type DeltaTone = "good" | "bad" | "neutral";

function tone(delta: number, higherIsBetter: boolean): DeltaTone {
  if (Math.abs(delta) < 0.005) return "neutral";
  return delta > 0 === higherIsBetter ? "good" : "bad";
}

function useFuturesVersion(futures: Futures | null | undefined): number {
  const subscribe = React.useCallback(
    (listener: () => void) => (futures ? futures.subscribe(listener) : () => {}),
    [futures],
  );
  const get = React.useCallback(() => (futures ? futures.getVersion() : 0), [futures]);
  return React.useSyncExternalStore(subscribe, get, get);
}

interface Row {
  label: string;
  value: number;
  base: number | null;
  higherIsBetter: boolean;
  note?: string;
}

function rowsOf(current: ProjectionSummary, base: ProjectionSummary | null): Row[] {
  return [
    { label: "Al horizonte", value: current.finalCash, base: base ? base.finalCash : null, higherIsBetter: true },
    { label: "Deuda al final", value: current.finalDebt, base: base ? base.finalDebt : null, higherIsBetter: false },
    {
      label: "Tu punto más bajo",
      value: current.minimumCash,
      base: base ? base.minimumCash : null,
      higherIsBetter: true,
      note: formatDateShort(current.minimumCashDate),
    },
  ];
}

function ComparisonTable({
  rows,
  baseLabel,
  currentLabel,
}: {
  rows: readonly Row[];
  baseLabel: string | null;
  currentLabel: string;
}) {
  const compared = baseLabel !== null;
  return (
    <table className="fin-table">
      <thead>
        <tr>
          <th scope="col">Cifra</th>
          {compared ? (
            <th scope="col" className="fin-table__num">
              {baseLabel}
            </th>
          ) : null}
          <th scope="col" className="fin-table__num">
            {currentLabel}
          </th>
          {compared ? (
            <th scope="col" className="fin-table__num">
              Diferencia
            </th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const delta = row.base === null ? null : Math.round((row.value - row.base) * 100) / 100;
          return (
            <tr key={row.label}>
              <th scope="row" className="fin-table__name">
                {row.label}
                {row.note ? <span className="fin-panel__muted"> {row.note}</span> : null}
              </th>
              {row.base !== null ? (
                <td className="fin-table__num fin-panel__muted">{formatMoneyWhole(row.base)}</td>
              ) : null}
              <td className="fin-table__num">{formatMoneyWhole(row.value)}</td>
              {delta !== null ? (
                <td className="fin-table__num fin-table__delta" data-tone={tone(delta, row.higherIsBetter)}>
                  {Math.abs(delta) < 0.5 ? "igual" : formatSignedMoneyWhole(delta)}
                </td>
              ) : null}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function ScenarioPanel({ bridge, futures = null, today, defaultOpen = true }: ScenarioPanelProps) {
  const revision = useFinancialRevision(bridge);
  useFuturesVersion(futures);
  const announce = useAnnounce();
  const actionRef = React.useRef<HTMLButtonElement | null>(null);

  const projection = React.useMemo(
    () => bridge.getProjection(),
    // `revision` is the cache key for projection changes.
    [bridge, revision],
  );
  const current = React.useMemo(() => summarizeProjection(projection), [projection]);

  const trial = futures?.activeTrial() ?? null;
  const origin = trial && futures ? (futures.list().find((branch) => branch.id === trial.trialOf) ?? null) : null;
  const active = futures?.activeBranch() ?? null;
  const others = futures && active ? futures.list().filter((branch) => branch.id !== active.id) : [];
  const compareTarget =
    !trial && futures
      ? (others.find((branch) => branch.id === futures.getCompareId()) ?? futures.peekTarget())
      : null;
  const base = origin && futures
    ? futures.summaryOf(origin.id)
    : compareTarget && futures
      ? futures.summaryOf(compareTarget.id)
      : null;

  // The buttons swap when a trial starts / ends: keep the focus on the new one.
  const trialId = trial?.id ?? null;
  const first = React.useRef(true);
  React.useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const focused = document.activeElement;
    if (!focused || focused === document.body || !focused.isConnected) actionRef.current?.focus();
  }, [trialId]);

  const startTrial = () => {
    if (!futures) return;
    const from = futures.activeBranch().name;
    futures.startTrial(today ?? bridge.getDocument().startDate);
    announce({
      message: `Estás probando cambios en una copia de ${from}. Tu plan no cambia hasta que decidas.`,
    });
  };
  const keep = () => {
    if (!futures || !origin) return;
    const name = origin.name;
    const undo = futures.keepTrial();
    if (undo) {
      announce({ message: `Cambios guardados en ${name}.`, undo: () => futures.restore(undo) });
    }
  };
  const discard = () => {
    if (!futures || !origin) return;
    const name = origin.name;
    const undo = futures.discardTrial();
    if (undo) {
      announce({
        message: `Cambios descartados: ${name} quedó como antes.`,
        undo: () => futures.restore(undo),
      });
    }
  };

  return (
    <FinSection
      title="Probar cambios"
      defaultOpen={defaultOpen}
      aside={trial ? <span className="fin-section__badge">Probando</span> : null}
    >
      {trial && origin ? (
        <>
          <p className="fin-panel__line">
            Estás probando cambios sobre <strong>{origin.name}</strong>. Tu plan no cambia hasta que
            decidas.
          </p>
          <ComparisonTable rows={rowsOf(current, base)} baseLabel={origin.name} currentLabel="Con cambios" />
          <div className="fin-panel__actions">
            <button
              ref={actionRef}
              type="button"
              className="fin-panel__button fin-panel__button--primary"
              onClick={keep}
            >
              Quedarme con los cambios
            </button>
            <button type="button" className="fin-panel__button" onClick={discard}>
              Descartar
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="fin-panel__note">
            Agrega, mueve o silencia en una copia de tu plan; al final te quedas con los cambios o los
            descartas.
          </p>
          {futures ? (
            <div className="fin-panel__actions">
              <button
                ref={actionRef}
                type="button"
                className="fin-panel__button fin-panel__button--primary"
                onClick={startTrial}
              >
                Probar cambios
              </button>
            </div>
          ) : null}
          {compareTarget && futures && active ? (
            <div className="fin-scenario__compare">
              <label className="fin-scenario__select">
                <span>Comparar con</span>
                <select
                  value={compareTarget.id}
                  onChange={(event) => futures.setCompare(event.target.value)}
                >
                  {others.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                    </option>
                  ))}
                </select>
              </label>
              <ComparisonTable rows={rowsOf(current, base)} baseLabel={compareTarget.name} currentLabel={active.name} />
            </div>
          ) : (
            <ComparisonTable rows={rowsOf(current, null)} baseLabel={null} currentLabel="Tu plan" />
          )}
        </>
      )}
    </FinSection>
  );
}
