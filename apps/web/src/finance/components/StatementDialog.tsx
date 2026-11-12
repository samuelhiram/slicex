// Paste a bank / card statement onto a card. Rows dated up to today are
// already owed (they move the card's balance: charges up, payments down);
// rows dated after today become card purchases on the timeline. Preview
// first, nothing changes until "Aplicar".
//
// Form: Mantine Form, CONTROLLED (the preview follows every keystroke),
// validated with a Zod schema as you type: text that holds no movement is
// an error of the text area (aria-invalid + aria-describedby). The text is
// parsed once per change — the preview and the schema share the parse.
//
// UX audit 2026-11-11: what happens to each row is said in words, not only
// in colour — two sections, "Ya los debes" (move the balance) and "Cargos
// futuros" (become purchases), with "Cargo" / "Abono" columns instead of
// signs (UX-52). Applying is ONE undo step, announced with "Deshacer"
// (UX-26). One open / close contract (useOverlay "modal", UX-27); the title
// is a heading (UX-58).
import * as React from "react";
import { schemaResolver, useForm } from "@mantine/form";
import { z } from "zod";
import type { CardPurchaseItem, CreditCardItem, ISODate } from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateShort, formatMoneyWhole } from "../format";
import { parseStatement, summarizeStatement, type StatementRow } from "../statement";
import { useAnnounce } from "../../ui/announcer";
import { useOverlay } from "../../ui/use-overlay";
import { inOneUndoStep } from "../undo-step";
import { bindField } from "./form-kit";

export interface StatementDialogProps {
  bridge: FinancialBridgeApi;
  cardId: string;
  today: ISODate;
  initialText?: string;
  onClose: () => void;
  /** Where the focus goes on close when its opener is gone. */
  fallbackFocus?: () => HTMLElement | null;
}

function StatementTable({ rows, caption }: { rows: readonly StatementRow[]; caption: string }) {
  return (
    <table className="fin-table">
      <caption className="fin-sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Fecha</th>
          <th scope="col">Concepto</th>
          <th scope="col" className="fin-table__num">
            Cargo
          </th>
          <th scope="col" className="fin-table__num">
            Abono
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={`${row.date}:${index}`}>
            <td>{formatDateShort(row.date)}</td>
            <td className="fin-table__name" title={row.description}>
              {row.description || "—"}
            </td>
            <td className="fin-table__num">{row.amount > 0 ? formatMoneyWhole(row.amount) : ""}</td>
            <td className="fin-table__num">{row.amount < 0 ? formatMoneyWhole(-row.amount) : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
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

export function StatementDialog({
  bridge,
  cardId,
  today,
  initialText = "",
  onClose,
  fallbackFocus,
}: StatementDialogProps) {
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
  const announce = useAnnounce();
  const areaRef = React.useRef<HTMLTextAreaElement | null>(null);
  const dialogRef = React.useRef<HTMLFormElement | null>(null);
  useOverlay({
    open: true,
    onClose,
    kind: "modal",
    containerRef: dialogRef,
    initialFocusRef: areaRef,
    fallbackFocus,
  });

  // On open only: text handed in (the "/" command) says at once whether it
  // holds movements.
  React.useEffect(() => {
    if (form.getValues().text.trim() !== "") form.validate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { text } = form.getValues();
  const rows = parse(text);
  const past = rows.filter((row) => row.date <= today);
  const future = rows.filter((row) => row.date > today);
  const futureCharges = future.filter((row) => row.amount > 0);
  const futureCredits = future.length - futureCharges.length;
  const pastSummary = summarizeStatement(past);
  const all = summarizeStatement(rows);
  const titleId = React.useId();

  if (!card || card.kind !== "credit-card") return null;
  const newBalance = Math.max(0, Math.round((card.balance + pastSummary.net) * 100) / 100);

  const submit = form.onSubmit(() => {
    if (rows.length === 0) return;
    const before = card.balance;
    const revision = bridge.getRevision();
    inOneUndoStep(bridge.core, () => {
      if (past.length > 0) {
        const next: CreditCardItem = { ...card, balance: newBalance };
        bridge.replaceItem(next);
      }
      for (const row of futureCharges) {
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
    });
    if (bridge.getRevision() !== revision) {
      const parts: string[] = [];
      if (past.length > 0) {
        parts.push(`saldo de ${card.name} ${formatMoneyWhole(before)} → ${formatMoneyWhole(newBalance)}`);
      }
      if (futureCharges.length > 0) {
        parts.push(
          futureCharges.length === 1
            ? "1 cargo futuro agregado"
            : `${futureCharges.length} cargos futuros agregados`,
        );
      }
      announce({
        message: `Estado de cuenta aplicado: ${parts.join(" · ")}`,
        undo: () => bridge.core.undo(),
      });
    }
    onClose();
  });

  const field = bindField(form, "text", "fin-statement");

  return (
    <div className="playlist-shell__modal-overlay" role="presentation">
      <form
        ref={dialogRef}
        className="playlist-shell__modal fin-statement"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        noValidate
        onSubmit={submit}
      >
        <header className="playlist-shell__modal-header">
          <h2 id={titleId} className="fin-editor__title">
            Estado de cuenta · {card.name}
          </h2>
          <button
            type="button"
            className="playlist-shell__modal-close"
            aria-label="Cerrar sin aplicar"
            title="Cerrar sin aplicar"
            onClick={onClose}
          >
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
              <p className="fin-statement__summary">
                {rows.length} movimientos · cargos {formatMoneyWhole(all.charges)} · abonos{" "}
                {formatMoneyWhole(all.payments)}
              </p>
              {past.length > 0 ? (
                <section className="fin-statement__section" data-section="past">
                  <h3 className="fin-statement__heading">Ya los debes (hasta hoy)</h3>
                  <p className="fin-statement__effect">
                    Cambian el saldo de {card.name}: {formatMoneyWhole(card.balance)} →{" "}
                    <strong>{formatMoneyWhole(newBalance)}</strong>
                  </p>
                  <div className="fin-statement__table">
                    <StatementTable rows={past} caption="Ya los debes: cambian el saldo de la tarjeta" />
                  </div>
                </section>
              ) : null}
              {future.length > 0 ? (
                <section className="fin-statement__section" data-section="future">
                  <h3 className="fin-statement__heading">Cargos futuros</h3>
                  <p className="fin-statement__effect">
                    {futureCharges.length === 1
                      ? "1 cargo se agrega como compra en la línea de tiempo."
                      : `${futureCharges.length} cargos se agregan como compras en la línea de tiempo.`}
                    {futureCredits > 0
                      ? futureCredits === 1
                        ? " El abono futuro no se agrega."
                        : ` Los ${futureCredits} abonos futuros no se agregan.`
                      : ""}
                  </p>
                  <div className="fin-statement__table">
                    <StatementTable rows={future} caption="Cargos futuros: se agregan como compras" />
                  </div>
                </section>
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
