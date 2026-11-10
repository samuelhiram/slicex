// Paste a bank / card statement onto a card. Rows dated up to today are
// already owed (they move the card's balance: charges up, payments down);
// rows dated after today become card purchases on the timeline. Preview
// first, nothing changes until "Aplicar".
//
// Form: Mantine Form, CONTROLLED (the preview follows every keystroke),
// validated with a Zod schema as you type: text that holds no movement is
// an error of the text area (aria-invalid + aria-describedby). The text is
// parsed once per change — the preview and the schema share the parse.
import * as React from "react";
import { schemaResolver, useForm } from "@mantine/form";
import { z } from "zod";
import type { CardPurchaseItem, CreditCardItem, ISODate } from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateShort, formatMoneyWhole, formatSignedMoneyWhole } from "../format";
import { parseStatement, summarizeStatement, type StatementRow } from "../statement";
import { bindField } from "./form-kit";

export interface StatementDialogProps {
  bridge: FinancialBridgeApi;
  cardId: string;
  today: ISODate;
  initialText?: string;
  onClose: () => void;
}

interface StatementValues {
  text: string;
}

export const NO_MOVEMENTS = "No encontré movimientos con fecha y monto.";

/**
 * The pasted text: empty (nothing to apply yet) or holding at least one
 * movement. `parse` is the dialog's own (cached) parser. Exported for tests.
 */
export function statementSchema(parse: (text: string) => readonly StatementRow[]) {
  return z.object({
    text: z.string().refine((text) => text.trim() === "" || parse(text).length > 0, NO_MOVEMENTS),
  });
}

/** `fn` remembering its last call: the same text is parsed once. */
function lastCall<R>(fn: (text: string) => R): (text: string) => R {
  let lastText: string | null = null;
  let last: R;
  return (text) => {
    if (text !== lastText) {
      last = fn(text);
      lastText = text;
    }
    return last;
  };
}

export function StatementDialog({ bridge, cardId, today, initialText = "", onClose }: StatementDialogProps) {
  const parse = React.useMemo(
    () => lastCall((text: string) => parseStatement(text, { today })),
    [today],
  );
  const form = useForm<StatementValues>({
    mode: "controlled",
    initialValues: { text: initialText },
    validate: schemaResolver(statementSchema(parse), { sync: true }),
    validateInputOnChange: true,
  });
  const card = bridge.getItem(cardId);
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  onCloseRef.current = onClose;

  // On open only (the shell passes a new onClose every render).
  React.useEffect(() => {
    areaRef.current?.focus();
    // Text handed in (the "/" command): say at once whether it holds movements.
    if (form.getValues().text.trim() !== "") form.validate();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { text } = form.getValues();
  const rows = parse(text);
  const past = rows.filter((row) => row.date <= today);
  const future = rows.filter((row) => row.date > today);
  const pastSummary = summarizeStatement(past);
  const all = summarizeStatement(rows);

  if (!card || card.kind !== "credit-card") return null;
  const newBalance = Math.max(0, Math.round((card.balance + pastSummary.net) * 100) / 100);

  const submit = form.onSubmit(() => {
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
  });

  const field = bindField(form, "text", "fin-statement");

  return (
    <div className="playlist-shell__modal-overlay" role="presentation">
      <form
        className="playlist-shell__modal fin-statement"
        role="dialog"
        aria-modal="true"
        aria-label={`Estado de cuenta de ${card.name}`}
        noValidate
        onSubmit={submit}
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
              key={field.key}
              {...field.input}
              ref={areaRef}
              className="fin-statement__input"
              rows={6}
              spellCheck={false}
              placeholder={"15/11/2026 OXXO REFORMA 123.45\n16/11/2026 PAGO RECIBIDO -1,500.00"}
            />
            {field.error}
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
          ) : null}
          <div className="fin-editor__actions">
            <span className="fin-editor__actions-spacer" />
            <button type="button" className="fin-editor__button" onClick={onClose}>
              Cancelar
            </button>
            <button
              type="submit"
              className="fin-editor__button fin-editor__button--primary"
              disabled={rows.length === 0}
            >
              Aplicar
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
