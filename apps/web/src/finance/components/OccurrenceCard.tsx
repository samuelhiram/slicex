// One payment of an item, edited where it is drawn. A quick click on a clip
// (press + release, no drag) opens this card for the CELL under the pointer
// — the stretch between that payment's mark and the next one — and lets the
// person change it without creating another item:
//
//   Gas · vie 5 dic 2026 · pago 2 de 13                                  ×
//   Monto  [ 400 ]
//   ( Solo este pago ) ( Este y los siguientes )
//   Cada cuánto  [Cada semana] [Cada quincena] [Cada mes] …   (following)
//   Tu caja: mínimo … → …
//   [Editar objeto…]                               [Cancelar] [Aplicar]
//
// - "Solo este pago": a one-off edit of that payment (0 = no pago).
// - "Este y los siguientes": the rule changes from that payment on (amount
//   and / or cadence); on the item's first payment it is the rule itself.
//   Picking another cadence switches to it (one payment has no cadence).
// - One-time items: the amount (and "Se repite" turns it recurring from
//   that date). Statement cards and MSI: read-only, with the form.
// - Live what-if on the money lane while editing (EffectLine); "Aplicar"
//   is ONE undo step, announced with "Deshacer". Enter applies, Escape and a
//   click outside close; ‹ › (Alt+← / Alt+→) walk to the previous / next
//   payment without closing.
import * as React from "react";
import {
  editItemOccurrence,
  ruleSegmentAt,
  type FinancialItem,
  type OccurrenceEditRequest,
  type OccurrenceScope,
} from "@slicex/core";
import type { FinancialBridgeApi, FinancialPreview } from "../bridge-api";
import { formatDateShort, formatDateWeekday, formatMoney, parseNumberInput } from "../format";
import { KIND_LABELS } from "../labels";
import { itemColor } from "../mapping";
import { describeOccurrenceEdit, signedAmount, type OccurrenceInfo } from "../occurrence";
import { frequencyParts, withFrequencyParts, type FrequencyUnit } from "../schedule-ui";
import { useAnnounce } from "../../ui/announcer";
import { useDismiss } from "../../ui/use-dismiss";
import { useFitInViewport } from "../../ui/fit-in-viewport";
import { useEscapeLayer, useRestoreFocus } from "../../ui/use-overlay";
import { EffectLine, useLivePreviewEffect } from "./EffectLine";
import { useFinancialRevision } from "./FinancialUi";
import { ItemIcon } from "./ItemIcon";
import { SchedulePicker } from "./SchedulePicker";

/** Where the card opens: the clip, the beat clicked and the pointer (client px). */
export interface OccurrenceTarget {
  clipId: string;
  beat: number;
  clientX: number;
  clientY: number;
}

export interface OccurrenceCardProps {
  bridge: FinancialBridgeApi;
  target: OccurrenceTarget | null;
  onClose: () => void;
  /** "Editar objeto…": the full form of the item. */
  onOpenEditor: (itemId: string) => void;
  /** ‹ / › (Alt+← / Alt+→): the card moves to the previous / next payment. */
  onNavigate?: (target: OccurrenceTarget) => void;
  /** Where the focus goes when the card closes (the canvas host). */
  fallbackFocus?: () => HTMLElement | null;
}

/** Gap between the pointer and the card. */
const POINTER_GAP = 12;

function amountInputText(amount: number): string {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export function OccurrenceCard({
  bridge,
  target,
  onClose,
  onOpenEditor,
  onNavigate,
  fallbackFocus,
}: OccurrenceCardProps) {
  const revision = useFinancialRevision(bridge);
  const item = target ? bridge.getItem(target.clipId) : null;
  // The cell is fixed when the card opens (an undo meanwhile re-reads it).
  const info = React.useMemo<OccurrenceInfo | null>(
    () => (target && item ? bridge.occurrenceAt(target.clipId, target.beat) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bridge, target, item, revision],
  );
  const open = target !== null && item !== null && info !== null;
  return open ? (
    <OccurrenceCardBody
      key={`${info.itemId}@${info.date}`}
      bridge={bridge}
      item={item}
      info={info}
      target={target}
      onClose={onClose}
      onOpenEditor={onOpenEditor}
      onNavigate={onNavigate}
      fallbackFocus={fallbackFocus}
    />
  ) : null;
}

interface BodyProps extends Omit<OccurrenceCardProps, "target"> {
  item: FinancialItem;
  info: OccurrenceInfo;
  target: OccurrenceTarget;
}

function OccurrenceCardBody({
  bridge,
  item,
  info,
  target,
  onClose,
  onOpenEditor,
  onNavigate,
  fallbackFocus,
}: BodyProps) {
  const announce = useAnnounce();
  const cardRef = React.useRef<HTMLElement | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const titleId = React.useId();
  const cadenceLabelId = React.useId();
  const errorId = React.useId();

  const [amountText, setAmountText] = React.useState(() => amountInputText(info.amount));
  const [scope, setScope] = React.useState<OccurrenceScope>("this");
  const initialParts = React.useMemo(() => frequencyParts(info.rule), [info.rule]);
  const [parts, setParts] = React.useState<{ unit: FrequencyUnit; every: number }>(initialParts);

  const parsed = parseNumberInput(amountText);
  // parseNumberInput gives NaN for text that is not a number ("abc").
  const amountError =
    amountText.trim() === ""
      ? "Escribe un monto"
      : parsed === null || !Number.isFinite(parsed) || parsed < 0
        ? "Escribe un monto válido"
        : null;
  const cadenceChanged = parts.unit !== initialParts.unit || parts.every !== initialParts.every;
  // One payment has no cadence: changing it means "from here on".
  const effectiveScope: OccurrenceScope = info.once || cadenceChanged ? "following" : scope;

  const request = React.useMemo<OccurrenceEditRequest | null>(() => {
    if (!info.editable || amountError !== null || parsed === null) return null;
    const next: OccurrenceEditRequest = { date: info.date, scope: effectiveScope, amount: parsed };
    if (cadenceChanged) {
      const rule = withFrequencyParts(info.rule, parts.unit, parts.every);
      next.frequency = rule.frequency;
      if (rule.interval !== undefined) next.interval = rule.interval;
    }
    return next;
  }, [info, amountError, parsed, effectiveScope, cadenceChanged, parts]);

  const candidate = React.useMemo(
    () => (request ? editItemOccurrence(item, request) : item),
    [item, request],
  );
  const changed = candidate !== item;

  // What-if on the money lane while editing (plan untouched).
  const preview = React.useMemo<FinancialPreview | null>(() => {
    if (!changed) return null;
    const doc = bridge.getDocument();
    return { kind: "document", doc: { ...doc, items: doc.items.map((it) => (it.id === candidate.id ? candidate : it)) } };
  }, [bridge, changed, candidate]);
  const effect = useLivePreviewEffect(bridge, preview);

  const close = React.useCallback(() => {
    bridge.setPreview(null);
    onClose();
  }, [bridge, onClose]);
  useDismiss(true, [cardRef], close);
  useEscapeLayer(true, close, { within: [cardRef] });
  useRestoreFocus(true, fallbackFocus, { containerRef: cardRef });
  useFitInViewport(cardRef, true, [target.clientX, target.clientY]);

  React.useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    input.select();
  }, []);

  const commit = (req: OccurrenceEditRequest, message: string) => {
    bridge.setPreview(null);
    if (!bridge.editOccurrence(item.id, req)) {
      onClose();
      return;
    }
    announce({ message, undo: () => bridge.core.undo() });
    onClose();
  };

  const apply = () => {
    if (!request || !changed) {
      if (!changed && amountError === null) close();
      return;
    }
    const rule = cadenceChanged ? withFrequencyParts(info.rule, parts.unit, parts.every) : ruleSegmentAt(candidate, info.date).recurrence;
    commit(request, describeOccurrenceEdit(item, info, request, rule));
  };

  // The previous / next payment, in the same spot (the edit in progress is
  // dropped: nothing was applied). The focus stays in the card.
  const goTo = (date: string | null) => {
    if (date === null || !onNavigate) return;
    bridge.setPreview(null);
    onNavigate({ ...target, beat: bridge.beatAtDate(date) });
  };

  const revertEdit = () =>
    commit(
      { date: info.date, scope: "this", amount: info.ruleAmount },
      `${item.name}: vuelve a ${signedAmount(info.direction, info.ruleAmount)} el ${formatDateShort(info.date)}`,
    );

  const color = itemColor(item);
  const showScope = info.editable && !info.once;
  const showCadence = info.editable && info.cadenceEditable && (info.once || effectiveScope === "following");
  const style: React.CSSProperties = {
    left: target.clientX + POINTER_GAP,
    top: target.clientY + POINTER_GAP,
  };

  return (
    <section
      ref={cardRef}
      className="fin-occ"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={style}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey && (event.target as HTMLElement).tagName === "INPUT") {
          event.preventDefault();
          apply();
          return;
        }
        if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight") && !info.once) {
          event.preventDefault();
          goTo(event.key === "ArrowLeft" ? info.prevDate : info.nextDate);
        }
      }}
    >
      <header className="fin-occ__header">
        <span className="fin-occ__icon" style={{ color }} aria-hidden="true">
          <ItemIcon id={item.icon} size={18} />
        </span>
        <div className="fin-occ__heading">
          <h2 id={titleId} className="fin-occ__title" style={{ color }}>
            {item.name || KIND_LABELS[item.kind]}
          </h2>
          <p className="fin-occ__date">
            <span className="fin-occ__nowrap">{formatDateWeekday(info.date)}</span>
            {info.once ? null : (
              <>
                {" · "}
                <span className="fin-occ__nowrap">{`pago ${info.index} de ${info.count}`}</span>
              </>
            )}
          </p>
        </div>
        {onNavigate && !info.once ? (
          <span className="fin-occ__nav">
            <button
              type="button"
              className="fin-icon-button"
              aria-label="Pago anterior"
              title="Pago anterior (Alt+←)"
              disabled={info.prevDate === null}
              onClick={() => goTo(info.prevDate)}
            >
              ‹
            </button>
            <button
              type="button"
              className="fin-icon-button"
              aria-label="Pago siguiente"
              title="Pago siguiente (Alt+→)"
              disabled={info.nextDate === null}
              onClick={() => goTo(info.nextDate)}
            >
              ›
            </button>
          </span>
        ) : null}
        <button type="button" className="fin-icon-button fin-occ__close" aria-label="Cerrar" onClick={close}>
          ×
        </button>
      </header>

      {info.editable ? (
        <>
          <label className="fin-occ__field">
            <span className="fin-occ__label">
              {info.once ? "Monto" : effectiveScope === "following" ? "Monto desde este pago" : "Monto de este pago"}
            </span>
            <span className="fin-occ__amount">
              <span className="fin-occ__currency" aria-hidden="true">
                {info.direction > 0 ? "+$" : "−$"}
              </span>
              <input
                ref={inputRef}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className="fin-occ__input"
                value={amountText}
                aria-invalid={amountError !== null || undefined}
                aria-describedby={amountError ? errorId : undefined}
                onChange={(event) => setAmountText(event.target.value)}
              />
            </span>
            {amountError ? (
              <span id={errorId} className="fin-occ__error">
                {amountError}
              </span>
            ) : null}
          </label>

          {showScope ? (
            <div className="fin-occ__scope" role="radiogroup" aria-label="Aplicar a">
              {(
                [
                  ["this", "Solo este pago"],
                  ["following", "Este y los siguientes"],
                ] as const
              ).map(([value, label]) => {
                const checked = effectiveScope === value;
                const disabled = value === "this" && cadenceChanged;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={disabled}
                    className="fin-occ__scope-option"
                    data-checked={checked || undefined}
                    title={disabled ? "Cambiar cada cuánto aplica de aquí en adelante" : undefined}
                    onClick={() => setScope(value)}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          ) : null}

          {showCadence ? (
            <div className="fin-occ__cadence">
              <span id={cadenceLabelId} className="fin-occ__label">
                {info.once ? "Se repite" : `Cada cuánto, desde el ${formatDateShort(info.date)}`}
              </span>
              <SchedulePicker
                labelledBy={cadenceLabelId}
                unit={parts.unit}
                every={parts.every}
                allowOnce={info.once}
                onChange={(unit, every) => {
                  setParts({ unit, every });
                  if (!info.once) setScope("following");
                }}
              />
            </div>
          ) : null}

          {info.edited ? (
            <p className="fin-occ__note">
              Ajustaste este pago; tu regla dice {signedAmount(info.direction, info.ruleAmount)}.{" "}
              <button type="button" className="fin-link" onClick={revertEdit}>
                Volver a {formatMoney(info.ruleAmount)}
              </button>
            </p>
          ) : info.changeStartsHere ? (
            <p className="fin-occ__note">Desde este pago rige un cambio de tu regla.</p>
          ) : null}

          {effect ? (
            <EffectLine effect={effect} reserve={bridge.getDocument().minimumCashReserve} />
          ) : null}
        </>
      ) : (
        <p className="fin-occ__readonly">
          <strong>{signedAmount(info.direction, info.amount)}</strong>{" "}
          {item.kind === "installment-plan"
            ? "· mensualidad de meses sin intereses: siempre la misma."
            : "· pagas el estado de cuenta completo (totalero): el monto sale de tus compras."}
        </p>
      )}

      <footer className="fin-occ__footer">
        <button
          type="button"
          className="fin-button fin-occ__more"
          onClick={() => {
            close();
            onOpenEditor(item.id);
          }}
        >
          Editar objeto…
        </button>
        {info.editable ? (
          <span className="fin-occ__actions">
            <button type="button" className="fin-button" onClick={close}>
              Cancelar
            </button>
            <button
              type="button"
              className="fin-button fin-button--primary"
              disabled={amountError !== null}
              onClick={apply}
            >
              Aplicar
            </button>
          </span>
        ) : null}
      </footer>
    </section>
  );
}
