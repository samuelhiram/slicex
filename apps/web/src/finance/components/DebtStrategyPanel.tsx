// Avalanche strategy at the playhead day: the debts still owed that day
// (balances from the projection, paid-off debts dropped) ranked by annual
// rate, plus a suggested split of that day's cash (after the reserve and
// every minimum) towards the most expensive debt first. Balances and cash
// come from the same projection and the same date, so they always agree.
import * as React from "react";
import {
  debtByAccountAt,
  rankDebtsByAvalanche,
  suggestAvalanchePayments,
} from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateShort, formatMoneyWhole, formatPercent } from "../format";
import { KIND_COLORS } from "../labels";
import { FinSection, useFinancialRevision, usePlayheadDay } from "./FinancialUi";

export interface DebtStrategyPanelProps {
  bridge: FinancialBridgeApi;
  defaultOpen?: boolean;
}

export function DebtStrategyPanel({
  bridge,
  defaultOpen = true,
}: DebtStrategyPanelProps) {
  const revision = useFinancialRevision(bridge);
  const day = usePlayheadDay(bridge);

  const view = React.useMemo(() => {
    const doc = bridge.getDocument();
    const date = bridge.dateAtBeat(day);
    const snapshot = bridge.snapshotAt(date);
    // Once per playhead DAY / revision, never per frame (usePlayheadDay).
    const balances = debtByAccountAt(bridge.getProjection(), date);
    const debts = rankDebtsByAvalanche(doc, balances);
    const plan = suggestAvalanchePayments({
      debts,
      availableCash: snapshot.cash,
      minimumCashReserve: doc.minimumCashReserve,
    });
    const extraById = new Map<string, number>();
    for (const allocation of plan.allocations) {
      extraById.set(allocation.id, allocation.extra);
    }
    return { date, snapshot, debts, plan, extraById };
    // `revision` is the cache key for document / projection changes.
  }, [bridge, revision, day]);

  const { date, snapshot, debts, plan, extraById } = view;

  return (
    <FinSection
      title="Estrategia avalancha"
      defaultOpen={defaultOpen}
      aside={
        debts.length > 0 ? (
          <span className="fin-section__count">{debts.length}</span>
        ) : null
      }
    >
      {debts.length === 0 ? (
        <p className="fin-panel__empty">Sin deudas registradas.</p>
      ) : (
        <>
          <table className="fin-table">
            <thead>
              <tr>
                <th className="fin-table__rank">#</th>
                <th>Deuda</th>
                <th className="fin-table__num">Tasa</th>
                <th className="fin-table__num">Saldo</th>
                <th className="fin-table__num">Mín.</th>
                <th className="fin-table__num">Extra</th>
              </tr>
            </thead>
            <tbody>
              {debts.map((debt, index) => {
                const extra = extraById.get(debt.id) ?? 0;
                return (
                  <tr key={debt.id}>
                    <td className="fin-table__rank">{index + 1}</td>
                    <td className="fin-table__name" title={debt.name}>
                      <span
                        className="fin-table__swatch"
                        style={{ background: KIND_COLORS[debt.kind] }}
                        aria-hidden="true"
                      />
                      {debt.name}
                    </td>
                    <td className="fin-table__num">
                      {formatPercent(debt.annualRate)}
                    </td>
                    <td className="fin-table__num">{formatMoneyWhole(debt.balance)}</td>
                    <td className="fin-table__num">
                      {formatMoneyWhole(debt.minimumPayment)}
                    </td>
                    <td
                      className="fin-table__num fin-table__extra"
                      data-active={extra > 0 ? "true" : "false"}
                    >
                      {extra > 0 ? `+${formatMoneyWhole(extra)}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="fin-panel__line">
            Disponible para extra al {formatDateShort(date)}:{" "}
            <strong>{formatMoneyWhole(plan.availableForExtra)}</strong>
            <span className="fin-panel__muted">
              {" "}
              (liquidez {formatMoneyWhole(snapshot.cash)})
            </span>
          </p>
          <p className="fin-panel__note">
            Estimación: usa los saldos y la liquidez del día del playhead
            menos la reserva y los mínimos; no descuenta pagos futuros.
          </p>
        </>
      )}
    </FinSection>
  );
}
