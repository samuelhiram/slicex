// Paste a bank / card statement onto a card. Rows dated up to today are
// already owed (they move the card's balance: charges up, payments down);
// rows dated after today become card purchases on the timeline. Preview
// first, nothing changes until "Aplicar".
import * as React from "react";
import type { CardPurchaseItem, CreditCardItem, ISODate } from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateShort, formatMoneyWhole, formatSignedMoneyWhole } from "../format";
import { parseStatement, summarizeStatement } from "../statement";

export interface StatementDialogProps {
  bridge: FinancialBridgeApi;
  cardId: string;
  today: ISODate;
  initialText?: string;
  onClose: () => void;
}

export function StatementDialog({ bridge, cardId, today, initialText = "", onClose }: StatementDialogProps) {
  const [text, setText] = React.useState(initialText);
  const card = bridge.getItem(cardId);
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);

  React.useEffect(() => {
    areaRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = React.useMemo(() => parseStatement(text, { today }), [text, today]);
  const past = rows.filter((row) => row.date <= today);
  const future = rows.filter((row) => row.date > today);
  const pastSummary = summarizeStatement(past);
  const all = summarizeStatement(rows);

  if (!card || card.kind !== "credit-card") return null;
  const newBalance = Math.max(0, Math.round((card.balance + pastSummary.net) * 100) / 100);

  const apply = () => {
    if (rows.length === 0) return;
    if (past.length > 0) {
      const next: CreditCardItem = { ...card, balance: newBalance };
      bridge.replaceItem(next);
    }
    for (const row of future) {
      if (row.amount <= 0) continue;
      const purchase: CardPurchaseItem = {
        id: "",
        kind: "card-purchase",
        name: row.description || "Compra",
        cardId: card.id,
        amount: row.amount,
        recurrence: { frequency: "once", startDate: row.date, endDate: row.date },
      };
      bridge.addItem(purchase);
    }
    onClose();
  };

  return (
    <div className="playlist-shell__modal-overlay" role="presentation">
      <div
        className="playlist-shell__modal fin-statement"
        role="dialog"
        aria-modal="true"
        aria-label={`Estado de cuenta de ${card.name}`}
      >
        <header className="playlist-shell__modal-header">
          <strong className="fin-editor__title">Estado de cuenta · {card.name}</strong>
          <button type="button" className="playlist-shell__modal-close" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="playlist-shell__modal-body fin-editor__body">
          <label className="fin-editor__field fin-editor__field--wide">
            <span className="fin-editor__label">Pega aquí los movimientos (de tu banca en línea o del PDF)</span>
            <textarea
              ref={areaRef}
              className="fin-statement__input"
              rows={6}
              spellCheck={false}
              placeholder={"15/11/2026 OXXO REFORMA 123.45\n16/11/2026 PAGO RECIBIDO -1,500.00"}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          {rows.length > 0 ? (
            <>
              <div className="fin-statement__table">
                <table className="fin-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Concepto</th>
                      <th className="fin-table__num">Monto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr key={`${row.date}:${index}`} data-future={row.date > today}>
                        <td>{formatDateShort(row.date)}</td>
                        <td className="fin-table__name" title={row.description}>
                          {row.description || "—"}
                        </td>
                        <td className="fin-table__num">{formatSignedMoneyWhole(row.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="fin-statement__summary">
                {rows.length} movimientos · cargos {formatMoneyWhole(all.charges)} · pagos{" "}
                {formatMoneyWhole(all.payments)}
              </p>
              {past.length > 0 ? (
                <p className="fin-statement__effect">
                  Saldo de {card.name}: {formatMoneyWhole(card.balance)} →{" "}
                  <strong>{formatMoneyWhole(newBalance)}</strong>
                </p>
              ) : null}
              {future.length > 0 ? (
                <p className="fin-statement__effect">
                  {future.length} {future.length === 1 ? "cargo futuro se agrega" : "cargos futuros se agregan"} como compras en
                  el timeline.
                </p>
              ) : null}
            </>
          ) : text.trim() ? (
            <p className="fin-editor__error">No encontré movimientos con fecha y monto.</p>
          ) : null}
          <div className="fin-editor__actions">
            <span className="fin-editor__actions-spacer" />
            <button type="button" className="fin-editor__button" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="button"
              className="fin-editor__button fin-editor__button--primary"
              disabled={rows.length === 0}
              onClick={apply}
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
