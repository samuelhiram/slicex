// The item form's "Cambios en tus pagos": what was changed payment by
// payment on the timeline (OccurrenceCard) — the rule changes ("desde el
// 23 dic, −$300 /semana") and the one-off payments ("9 dic: −$700") — each
// one with "Quitar". Edits the form's draft (saved with the item, one undo
// step like any save). Nothing to show: renders nothing.
import * as React from "react";
import {
  clearOccurrenceEdit,
  occurrenceEditAmounts,
  removeRuleChange,
  ruleSegments,
  type FinancialItem,
} from "@slicex/core";
import { formatDateShort, formatMoneyWhole } from "../format";
import { frequencyShort } from "../labels";

export interface PaymentChangesProps {
  draft: FinancialItem;
  onChange: (next: FinancialItem) => void;
}

interface Row {
  key: string;
  when: string;
  what: string;
  remove: (item: FinancialItem) => FinancialItem;
}

/** The rows of the block (pure; exported for tests). */
export function paymentChangeRows(item: FinancialItem): Row[] {
  if (item.recurrence.frequency === "once") return [];
  const sign = item.kind === "income" ? "+" : "−";
  const rows: Row[] = [];
  for (const segment of ruleSegments(item)) {
    const change = segment.change;
    if (change === undefined || segment.from !== change.from) continue;
    const cadence = item.kind === "credit-card" ? "" : ` ${frequencyShort(segment.recurrence)}`;
    rows.push({
      key: `rule-${change.from}`,
      when: `Desde el ${formatDateShort(change.from)}`,
      what: `${sign}${formatMoneyWhole(segment.amount ?? 0)}${cadence}`,
      remove: (current) => removeRuleChange(current, change.from),
    });
  }
  const edits = occurrenceEditAmounts(item);
  if (edits !== null) {
    for (const date of [...edits.keys()].sort()) {
      const amount = edits.get(date)!;
      rows.push({
        key: `edit-${date}`,
        when: `Solo el ${formatDateShort(date)}`,
        what: amount === 0 ? "sin pago" : `${sign}${formatMoneyWhole(amount)}`,
        remove: (current) => clearOccurrenceEdit(current, date),
      });
    }
  }
  return rows;
}

export function PaymentChanges({ draft, onChange }: PaymentChangesProps) {
  const titleId = React.useId();
  const rows = paymentChangeRows(draft);
  if (rows.length === 0) return null;
  return (
    <div className="fin-editor__section fin-editor__section--changes fin-changes" role="group" aria-labelledby={titleId}>
      <h3 id={titleId} className="fin-editor__section-title">
        Cambios en tus pagos
      </h3>
      <p className="fin-changes__hint">
        Hechos pago por pago en el timeline (clic en un pago). Tu monto de arriba aplica hasta el primer cambio.
      </p>
      <ul className="fin-changes__list">
        {rows.map((row) => (
          <li key={row.key} className="fin-changes__row">
            <span className="fin-changes__when">{row.when}</span>
            <span className="fin-changes__what">{row.what}</span>
            <button
              type="button"
              className="fin-editor__button fin-changes__remove"
              aria-label={`Quitar: ${row.when.toLowerCase()}, ${row.what}`}
              onClick={() => onChange(row.remove(draft))}
            >
              Quitar
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
