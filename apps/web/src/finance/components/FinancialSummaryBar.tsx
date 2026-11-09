// Financial header above the playlist: the brand, the headline numbers
// (editable starting cash / reserve, debt, next payment, projected minimum,
// cash at the horizon), and a fixed action group (liquidity alerts, theme
// toggle, "Nuevo" menu). Re-renders only when the bridge revision changes.
//
// Only the metrics scroll on narrow windows; the alerts and the actions are
// always visible. Popovers render in a portal (document.body) so no
// clipping / masking ancestor can hide them.
import * as React from "react";
import { useFitInViewport } from "../../ui/fit-in-viewport";
import { useDismiss } from "../../ui/use-dismiss";
import { useWheelScrollX } from "../../ui/wheel-scroll-x";
import { createPortal } from "react-dom";
import { addDays } from "@slicex/core";
import type {
  FinancialItem,
  FinancialItemKind,
  LiquidityWarning,
} from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateLong, formatDateShort, formatMoney, formatMoneyWhole } from "../format";
import { KIND_COLORS, KIND_LABELS } from "../labels";
import {
  InlineNumberInput,
  jumpPlayheadToDate,
  useFinancialRevision,
} from "./FinancialUi";

export interface FinancialSummaryBarProps {
  bridge: FinancialBridgeApi;
  /**
   * "Nuevo" → kind: called with a NEW draft (bridge.createDraftItem).
   * Nothing is added yet — the editor adds it on "Guardar" only, so
   * cancelling leaves the document untouched.
   */
  onCreateDraft: (draft: FinancialItem) => void;
  /** Makes the bar inert (e.g. while a modal editor is open). */
  inert?: boolean;
  /** Current theme + toggle (omitted → no toggle is shown). */
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  /** "Escribir…": opens the "/" command bar (omitted → no entry). */
  onOpenCommand?: () => void;
  /** The tool row, placed inside the header card (one card, not two strips). */
  tools?: React.ReactNode;
}

export const NEW_ITEM_OPTIONS: ReadonlyArray<{
  kind: FinancialItemKind;
  hint: string;
}> = [
  { kind: "income", hint: "Sueldo, honorarios, rentas" },
  { kind: "expense", hint: "Renta, servicios, un gasto" },
  { kind: "loan", hint: "Pagos fijos hasta liquidar" },
  { kind: "credit-card", hint: "Saldo, tasa y pago mensual" },
  { kind: "card-purchase", hint: "Un cargo a una tarjeta" },
  { kind: "installment-plan", hint: "Meses sin intereses" },
];

export function FinancialSummaryBar({
  bridge,
  onCreateDraft,
  inert = false,
  theme,
  onToggleTheme,
  onOpenCommand,
  tools,
}: FinancialSummaryBarProps) {
  const revision = useFinancialRevision(bridge);
  // The metrics strip scrolls sideways: the mouse wheel moves it too.
  const metricsRef = useWheelScrollX();

  const data = React.useMemo(() => {
    const doc = bridge.getDocument();
    const projection = bridge.getProjection();
    return {
      doc,
      projection,
      nextPayment: bridge.nextPaymentAfter(addDays(doc.startDate, -1)),
      warnings: bridge.getWarnings(),
    };
    // `revision` is the cache key: the bridge bumps it on every data change.
  }, [bridge, revision]);

  const { doc, projection, nextPayment, warnings } = data;
  const reserve = doc.minimumCashReserve;
  // Short date ("15 nov") inside the start year, long ("15 mar 2027") beyond.
  const startYear = doc.startDate.slice(0, 4);
  const fmtDate = (iso: string) =>
    iso.slice(0, 4) === startYear ? formatDateShort(iso) : formatDateLong(iso);
  // Brief: the projected minimum turns red as soon as it dips below the reserve.
  const minimumState = projection.minimumCash.cash < reserve ? "negative" : "ok";
  const finalState =
    projection.finalCash < 0
      ? "negative"
      : projection.finalCash < reserve
        ? "low"
        : "ok";

  return (
    <div
      className="fin-summary"
      role="region"
      aria-label="Resumen financiero"
      inert={inert}
    >
      <div className="fin-summary__brand" aria-hidden="true">
        <span className="fin-summary__logo" />
        <span className="fin-summary__wordmark">SliceX</span>
      </div>
      <div className="fin-summary__metrics" ref={metricsRef}>
        <div className="fin-summary__metric">
          <span className="fin-summary__label">Liquidez hoy</span>
          <InlineNumberInput
            className="fin-summary__input"
            ariaLabel="Liquidez hoy"
            value={doc.initialCash}
            format={formatMoney}
            onCommit={(amount) => bridge.setInitialCash(amount)}
          />
        </div>
        <div className="fin-summary__metric">
          <span className="fin-summary__label">Reserva mínima</span>
          <InlineNumberInput
            className="fin-summary__input"
            ariaLabel="Reserva mínima"
            value={reserve}
            min={0}
            format={formatMoney}
            onCommit={(amount) => bridge.setMinimumCashReserve(amount)}
          />
        </div>
        <div className="fin-summary__metric">
          <span className="fin-summary__label">Deuda hoy</span>
          <span className="fin-summary__value">
            {formatMoneyWhole(projection.initialDebt)}
          </span>
        </div>
        {nextPayment ? (
          <button
            type="button"
            className="fin-summary__metric fin-summary__metric--action"
            title={`Ir al ${fmtDate(nextPayment.date)}`}
            onClick={() => jumpPlayheadToDate(bridge, nextPayment.date)}
          >
            <span className="fin-summary__label">
              Próximo pago{" "}
              <span className="fin-summary__date">{fmtDate(nextPayment.date)}</span>
            </span>
            <span className="fin-summary__value">
              {formatMoneyWhole(nextPayment.amount)}{" "}
              <span className="fin-summary__name">{nextPayment.name}</span>
            </span>
          </button>
        ) : (
          <div className="fin-summary__metric">
            <span className="fin-summary__label">Próximo pago</span>
            <span className="fin-summary__value fin-summary__value--muted">—</span>
          </div>
        )}
        <button
          type="button"
          className="fin-summary__metric fin-summary__metric--action"
          data-state={minimumState}
          title={`Ir al ${fmtDate(projection.minimumCash.date)}`}
          onClick={() => jumpPlayheadToDate(bridge, projection.minimumCash.date)}
        >
          <span className="fin-summary__label">
            Mínimo proyectado{" "}
            <span className="fin-summary__date">
              {fmtDate(projection.minimumCash.date)}
            </span>
          </span>
          <span className="fin-summary__value">
            {formatMoneyWhole(projection.minimumCash.cash)}
          </span>
        </button>
        <div className="fin-summary__metric" data-state={finalState}>
          <span className="fin-summary__label">
            Al horizonte{" "}
            <span className="fin-summary__date">{fmtDate(projection.endDate)}</span>
          </span>
          <span className="fin-summary__value">
            {formatMoneyWhole(projection.finalCash)}
          </span>
        </div>
      </div>
      {tools}
      <div className="fin-summary__spacer" />
      <div className="fin-summary__actions">
        <WarningsChip
          bridge={bridge}
          warnings={warnings}
          formatDate={fmtDate}
          inert={inert}
        />
        {onToggleTheme ? (
          <ThemeToggle theme={theme ?? "light"} onToggle={onToggleTheme} />
        ) : null}
        <NewItemMenu
          bridge={bridge}
          onCreateDraft={onCreateDraft}
          onOpenCommand={onOpenCommand}
          inert={inert}
        />
      </div>
    </div>
  );
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: "light" | "dark";
  onToggle: () => void;
}) {
  const next = theme === "dark" ? "claro" : "oscuro";
  return (
    <button
      type="button"
      className="fin-icon-button"
      onClick={onToggle}
      aria-label={`Cambiar a tema ${next}`}
      title={`Tema ${next}`}
      data-theme-toggle={theme}
    >
      {theme === "dark" ? (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="3.6" />
          <path d="M10 2.2v1.9M10 15.9v1.9M2.2 10h1.9M15.9 10h1.9M4.5 4.5l1.3 1.3M14.2 14.2l1.3 1.3M4.5 15.5l1.3-1.3M14.2 5.8l1.3-1.3" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M16.2 12.4A6.6 6.6 0 0 1 7.6 3.8a6.6 6.6 0 1 0 8.6 8.6z" />
        </svg>
      )}
    </button>
  );
}

interface PopoverAnchor {
  top: number;
  right: number;
}

// Shared behaviour of the header's menu buttons (ARIA menu-button
// pattern): opening moves focus to the first item; ↑/↓/Home/End move
// between items; Escape and Tab close and return focus to the trigger; a
// pointer down anywhere outside (capture phase, so the canvas — which
// cancels mousedown — can't swallow it), a resize, a scroll or the bar
// turning inert close it.
function useMenuButton(inert: boolean) {
  const [anchor, setAnchor] = React.useState<PopoverAnchor | null>(null);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const open = anchor !== null;
  // Never off screen (narrow windows, phones): shift / cap / scroll.
  useFitInViewport(menuRef, open, [anchor]);

  const close = React.useCallback((restoreFocus: boolean) => {
    setAnchor(null);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const toggle = React.useCallback(() => {
    if (anchor) {
      setAnchor(null);
      return;
    }
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    setAnchor({
      top: rect.bottom + 6,
      right: Math.max(8, window.innerWidth - rect.right),
    });
  }, [anchor]);

  React.useEffect(() => {
    if (inert && open) setAnchor(null);
  }, [inert, open]);

  React.useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus();
  }, [open]);
  // Outside press / outside scroll / resize close; the wheel over a long
  // menu scrolls it (it used to close it).
  useDismiss(open, [triggerRef, menuRef], () => setAnchor(null));

  const onMenuKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
      );
      if (items.length === 0) return;
      const index = items.indexOf(document.activeElement as HTMLElement);
      let next = -1;
      switch (event.key) {
        case "ArrowDown":
          next = index < 0 ? 0 : (index + 1) % items.length;
          break;
        case "ArrowUp":
          next = index <= 0 ? items.length - 1 : index - 1;
          break;
        case "Home":
          next = 0;
          break;
        case "End":
          next = items.length - 1;
          break;
        case "Escape":
        case "Tab":
          event.preventDefault();
          event.stopPropagation();
          close(true);
          return;
        default:
          return;
      }
      event.preventDefault();
      items[next]?.focus();
    },
    [close],
  );

  return { anchor, open, toggle, close, triggerRef, menuRef, onMenuKeyDown };
}

// "Nuevo": picking a kind hands a draft to the shell; focus goes back to
// the trigger first so the editor returns it there when it closes.
function NewItemMenu({
  bridge,
  onCreateDraft,
  onOpenCommand,
  inert,
}: {
  bridge: FinancialBridgeApi;
  onCreateDraft: (draft: FinancialItem) => void;
  onOpenCommand?: () => void;
  inert: boolean;
}) {
  const menu = useMenuButton(inert);

  return (
    <div className="fin-new">
      <button
        ref={menu.triggerRef}
        type="button"
        className="fin-button fin-button--primary fin-new__trigger"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={menu.toggle}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 3v10M3 8h10" />
        </svg>
        Nuevo
      </button>
      {menu.anchor
        ? createPortal(
            <div
              ref={menu.menuRef}
              className="fin-popover fin-new__menu"
              role="menu"
              aria-label="Nuevo objeto"
              style={{ right: menu.anchor.right, top: menu.anchor.top }}
              onKeyDown={menu.onMenuKeyDown}
            >
              {NEW_ITEM_OPTIONS.map((option) => (
                <button
                  key={option.kind}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="fin-new__item"
                  data-kind={option.kind}
                  onClick={() => {
                    menu.close(true);
                    onCreateDraft(bridge.createDraftItem(option.kind));
                  }}
                >
                  <span
                    className="fin-new__dot"
                    style={{ background: KIND_COLORS[option.kind] }}
                    aria-hidden="true"
                  />
                  <span className="fin-new__text">
                    <span className="fin-new__label">{KIND_LABELS[option.kind]}</span>
                    <span className="fin-new__hint">{option.hint}</span>
                  </span>
                </button>
              ))}
              {onOpenCommand ? (
                <>
                  <div className="fin-futures__divider" role="separator" />
                  <button
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="fin-new__item fin-new__item--command"
                    onClick={() => {
                      menu.close(false);
                      onOpenCommand();
                    }}
                  >
                    <span className="fin-new__slash" aria-hidden="true">/</span>
                    <span className="fin-new__text">
                      <span className="fin-new__label">Escribir…</span>
                      <span className="fin-new__hint">“renta 8000 el 1” · sugerencias del año</span>
                    </span>
                  </button>
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function WarningsChip({
  bridge,
  warnings,
  formatDate,
  inert,
}: {
  bridge: FinancialBridgeApi;
  warnings: LiquidityWarning[];
  formatDate: (iso: string) => string;
  inert: boolean;
}) {
  const menu = useMenuButton(inert);
  const count = warnings.length;
  const { close, open } = menu;

  React.useEffect(() => {
    if (count === 0 && open) close(false);
  }, [count, open, close]);

  if (count === 0) {
    return (
      <span className="fin-summary__chip" data-state="ok" role="status">
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
        Sin alertas
      </span>
    );
  }

  const hasNegative = warnings.some((w) => w.severity === "negative");

  return (
    <div className="fin-summary__warnings">
      <button
        ref={menu.triggerRef}
        type="button"
        className="fin-summary__chip"
        data-state={hasNegative ? "negative" : "low"}
        aria-expanded={menu.open}
        aria-haspopup="menu"
        title="Alertas de liquidez"
        onClick={menu.toggle}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2.5 14.5 13.5h-13z" />
          <path d="M8 6.5v3.2M8 11.6v.1" />
        </svg>
        {count} {count === 1 ? "alerta" : "alertas"}
      </button>
      {menu.anchor
        ? createPortal(
            <div
              ref={menu.menuRef}
              className="fin-popover"
              role="menu"
              aria-label="Alertas de liquidez"
              style={{ right: menu.anchor.right, top: menu.anchor.top }}
              onKeyDown={menu.onMenuKeyDown}
            >
              {warnings.map((warning) => (
                <button
                  key={`${warning.startDate}:${warning.eventId}`}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="fin-popover__item"
                  data-state={warning.severity === "negative" ? "negative" : "low"}
                  title={`${warning.name} · desde ${formatDate(warning.startDate)}`}
                  onClick={() => {
                    jumpPlayheadToDate(bridge, warning.date);
                    close(true);
                  }}
                >
                  <span className="fin-popover__dot" aria-hidden="true" />
                  <span className="fin-popover__date">{formatDate(warning.date)}</span>
                  <span className="fin-popover__text">
                    Liquidez proyectada{" "}
                    <strong>{formatMoneyWhole(warning.cash)}</strong>
                  </span>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
