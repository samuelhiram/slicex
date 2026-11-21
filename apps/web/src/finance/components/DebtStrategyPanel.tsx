// Avalanche strategy at the playhead day: the debts still owed that day
// (balances from the projection, paid-off debts dropped) ranked by annual
// rate, plus a suggested split of that day's cash (after the reserve and
// every minimum) towards the most expensive debt first. Balances and cash
// come from the same projection and the same date, so they always agree.
//
// UX audit 2026-11-11, UX-55: the analysis becomes a decision. "Abonar $X a
// Nu hoy" pays the most expensive debt TODAY with what is safe to spend —
// never more than keeps your cash above your reserve for the whole horizon
// (so it can never break the reserve) — previewed on hover / focus, applied
// as one undo step and announced with "Deshacer". With nothing to spare, it
// says why in your terms ("tu caja baja de tu reserva el 27 nov").
import * as React from "react";
import {
  debtByAccountAt,
  findLiquidityWarnings,
  rankDebtsByAvalanche,
  snapshotAt,
  statementCardCommitments,
  suggestAvalanchePayments,
  type FinancialDocument,
  type FinancialProjection,
} from "@slicex/core";
import type { FinancialBridgeApi, FinancialPreview } from "../bridge-api";
import { formatDateShort, formatMoneyWhole, formatPercent } from "../format";
import { KIND_COLORS } from "../labels";
import { useAnnounce } from "../../ui/announcer";
import { inOneUndoStep } from "../undo-step";
import { EffectLine, useLivePreviewEffect } from "./EffectLine";
import { FinSection, useFinancialRevision, usePlayheadDay } from "./FinancialUi";

export interface DebtStrategyPanelProps {
  bridge: FinancialBridgeApi;
  defaultOpen?: boolean;
}

export interface ExtraPayment {
  debtId: string;
  name: string;
  /** Whole pesos paid today. */
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  cashBefore: number;
  cashAfter: number;
  /** The plan with the payment made (for the preview). */
  doc: FinancialDocument;
}

export type ExtraPaymentPlan = { kind: "pay"; payment: ExtraPayment } | { kind: "none"; reason: string };

/**
 * The avalanche's extra payment for TODAY (the plan's start), pure:
 * avalanche order (highest rate first), at most what is left after the
 * reserve and every minimum today AND at most the cash that stays above the
 * reserve on the plan's lowest day (paying a debt early only lowers later
 * payments, so the reserve is never broken). Only debts whose balance today
 * can be lowered: fixed-payment cards and loans with a balance.
 */
export function todayExtraPayment(doc: FinancialDocument, projection: FinancialProjection): ExtraPaymentPlan {
  const today = doc.startDate;
  const reserve = doc.minimumCashReserve;
  const balances = debtByAccountAt(projection, today);
  const debts = rankDebtsByAvalanche(doc, balances);
  if (debts.length === 0) return { kind: "none", reason: "Sin deudas que abonar." };
  const plan = suggestAvalanchePayments({
    debts,
    availableCash: snapshotAt(projection, today).cash,
    minimumCashReserve: reserve,
    committedPayments: statementCardCommitments(doc, balances),
  });
  const headroom = projection.minimumCash.cash - reserve;
  if (headroom < 1) {
    const first = findLiquidityWarnings(projection, reserve)[0];
    const when = first ? formatDateShort(first.date) : formatDateShort(projection.minimumCash.date);
    const red = (first?.cash ?? projection.minimumCash.cash) < 0;
    return {
      kind: "none",
      reason: red
        ? `Tu caja queda en rojo el ${when}: hoy no te sobra para abonos extra.`
        : `Tu caja baja de tu reserva el ${when}: hoy no te sobra para abonos extra.`,
    };
  }
  const room = Math.floor(Math.min(plan.availableForExtra, headroom));
  if (room < 1) {
    return {
      kind: "none",
      reason: "Hoy, después de tu reserva y los pagos mínimos, no te sobra liquidez para abonos extra.",
    };
  }
  for (const debt of debts) {
    const item = doc.items.find((candidate) => candidate.id === debt.id);
    if (!item) continue;
    const payable =
      (item.kind === "credit-card" && item.paymentMode !== "statement") ||
      (item.kind === "loan" && item.balance !== undefined && Number.isFinite(item.balance));
    if (!payable || !("balance" in item) || item.balance === undefined) continue;
    const amount = Math.floor(Math.min(room, item.balance));
    if (amount < 1) continue;
    const balanceAfter = Math.round((item.balance - amount) * 100) / 100;
    const cashAfter = Math.round((doc.initialCash - amount) * 100) / 100;
    return {
      kind: "pay",
      payment: {
        debtId: item.id,
        name: item.name,
        amount,
        balanceBefore: item.balance,
        balanceAfter,
        cashBefore: doc.initialCash,
        cashAfter,
        doc: {
          ...doc,
          initialCash: cashAfter,
          items: doc.items.map((other) => (other.id === item.id ? { ...item, balance: balanceAfter } : other)),
        },
      },
    };
  }
  return { kind: "none", reason: "Ninguna deuda con saldo se puede abonar hoy desde aquí." };
}

export function DebtStrategyPanel({
  bridge,
  defaultOpen = true,
}: DebtStrategyPanelProps) {
  const revision = useFinancialRevision(bridge);
  const day = usePlayheadDay(bridge);
  const announce = useAnnounce();
  const [inView, setInView] = React.useState(false);

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
      // "Totalero" cards are paid in full: their cash is spoken for.
      committedPayments: statementCardCommitments(doc, balances),
    });
    const extraById = new Map<string, number>();
    for (const allocation of plan.allocations) {
      extraById.set(allocation.id, allocation.extra);
    }
    return { date, snapshot, debts, plan, extraById };
    // `revision` is the cache key for document / projection changes.
  }, [bridge, revision, day]);

  // Today's decision: once per revision.
  const todayPlan = React.useMemo(
    () => todayExtraPayment(bridge.getDocument(), bridge.getProjection()),
    [bridge, revision],
  );
  const payment = todayPlan.kind === "pay" ? todayPlan.payment : null;
  const preview = React.useMemo<FinancialPreview | null>(
    () => (payment && inView ? { kind: "document", doc: payment.doc } : null),
    [payment, inView],
  );
  const effect = useLivePreviewEffect(bridge, preview);

  const pay = () => {
    if (!payment) return;
    setInView(false);
    bridge.setPreview(null);
    const revisionBefore = bridge.getRevision();
    inOneUndoStep(bridge.core, () => {
      bridge.setInitialCash(payment.cashAfter);
      const item = bridge.getItem(payment.debtId);
      if (item && (item.kind === "credit-card" || item.kind === "loan")) {
        bridge.replaceItem({ ...item, balance: payment.balanceAfter });
      }
    });
    if (bridge.getRevision() === revisionBefore) return;
    announce({
      message:
        `Abonaste ${formatMoneyWhole(payment.amount)} a ${payment.name} hoy: saldo ${formatMoneyWhole(payment.balanceBefore)} → ${formatMoneyWhole(payment.balanceAfter)}` +
        ` · Liquidez hoy ${formatMoneyWhole(payment.cashBefore)} → ${formatMoneyWhole(payment.cashAfter)}`,
      undo: () => bridge.core.undo(),
    });
  };

  const { date, snapshot, debts, plan, extraById } = view;

  return (
    <FinSection
      title="Pagar deudas (avalancha)"
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
          <p className="fin-panel__line">
            Avalancha: lo que te sobra va primero a la deuda con la tasa más alta; a las demás, su
            mínimo.
          </p>
          <div className="fin-debt-action">
            {payment ? (
              <>
                <button
                  type="button"
                  className="fin-panel__button fin-panel__button--primary"
                  onMouseEnter={() => setInView(true)}
                  onMouseLeave={() => setInView(false)}
                  onFocus={() => setInView(true)}
                  onBlur={() => setInView(false)}
                  onClick={pay}
                >
                  Abonar {formatMoneyWhole(payment.amount)} a {payment.name} hoy
                </button>
                <p className="fin-panel__note">
                  Saldo {formatMoneyWhole(payment.balanceBefore)} → {formatMoneyWhole(payment.balanceAfter)} ·
                  sin bajar de tu reserva en todo tu horizonte.
                </p>
                {inView ? (
                  <EffectLine effect={effect} reserve={bridge.getDocument().minimumCashReserve} />
                ) : null}
              </>
            ) : todayPlan.kind === "none" ? (
              <p className="fin-panel__note">{todayPlan.reason}</p>
            ) : null}
          </div>
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
            La tabla usa los saldos y la liquidez del día del cursor de tiempo, menos tu reserva y los
            mínimos; no descuenta pagos futuros.
          </p>
        </>
      )}
    </FinSection>
  );
}
