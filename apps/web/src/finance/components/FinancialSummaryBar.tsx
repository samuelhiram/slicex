// Financial header above the playlist ("Resumen de tu plan"). Left to right,
// in DOM order = visual order = priority:
//   1. "Mi plan ▾" — the plan menu in the brand (UX-48): Armar mi año,
//      Revisar lo que pasó, Tema, Reiniciar con el ejemplo…
//   2. The VERDICT (UX-14): "¿me alcanza?" in words, the largest text of the
//      bar, clickable (goes to that day and focuses the valley card), with
//      the alerts button attached (it absorbs their count). It says "en esta
//      rama" outside the main plan (UX-19) and "simulación" while something
//      is left out of the calculation (UX-03). Never clipped.
//   3. The exclusions chip (UX-03) when items are muted / outside a solo:
//      "Sin Nu · Ver · Reactivar todo".
//   4. The numbers: the starting point (Liquidez hoy · Reserva mínima,
//      editable), "Tu punto más bajo", then context with less weight (Al
//      horizonte, Deuda hoy, Próximo pago). When they don't fit they give
//      way from the end — whole, never cut — and "Más cifras" shows the
//      rest (UX-15).
//   5. Tools (from the shell) and "Nuevo".
// Re-renders only when the bridge revision (or the futures) change; the
// verdict / exclusions are computed once per revision (performance canon).
//
// Popovers render in a portal (document.body) so no clipping / masking
// ancestor can hide them.
import * as React from "react";
import { createPortal } from "react-dom";
import { FinancialDocumentSchema } from "@slicex/contracts";
import { addDays, type FinancialItem, type FinancialItemKind, type LiquidityWarning } from "@slicex/core";
import { getTrackIndexById, getTrackTopByIndex, getTracksTop } from "@slicex/canvas";
import { useAnnounce } from "../../ui/announcer";
import { useFitInViewport } from "../../ui/fit-in-viewport";
import { useDismiss } from "../../ui/use-dismiss";
import { useOverlay } from "../../ui/use-overlay";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateLong, formatDateShort, formatMoney, formatMoneyWhole } from "../format";
import { MAIN_BRANCH_ID, type Futures } from "../futures";
import { KIND_COLORS, KIND_LABELS } from "../labels";
import {
  computeVerdict,
  excludedItems,
  exclusionLabel,
  realInitialDebt,
  type Verdict,
} from "../summary";
import { inOneUndoStep } from "../undo-step";
import { useMetricHelp } from "./MetricHelp";
import {
  InlineNumberInput,
  focusValleyTitleSoon,
  jumpPlayheadToDate,
  useFinancialRevision,
} from "./FinancialUi";

// The editable headline numbers follow the plan's shared schema: cash can be
// negative (an overdraft), the reserve cannot.
const CASH_SCHEMA = FinancialDocumentSchema.shape.initialCash;
const RESERVE_SCHEMA = FinancialDocumentSchema.shape.minimumCashReserve;

/** Global actions of the plan, offered in "Mi plan ▾" (UX-48). */
export interface PlanMenuActions {
  /** "Armar mi año" (the onboarding dialog). */
  onBuildYear?: () => void;
  /** "Revisar lo que pasó" (Rec); null / omitted = nothing pending (disabled). */
  onReviewRec?: (() => void) | null;
  /** "Reiniciar con el ejemplo…" (asks first). */
  onReset?: () => void;
}

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
  /** Current theme + toggle (omitted → no theme entry in the plan menu). */
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  /** "Escribir…": opens the "/" command bar (omitted → no entry). */
  onOpenCommand?: () => void;
  /** The tool row, placed inside the header card (one card, not two strips). */
  tools?: React.ReactNode;
  /** Controls placed with "Nuevo" (e.g. the futures button): never scrolled away. */
  actions?: React.ReactNode;
  /** Alternative futures: the verdict says "en esta rama" outside the main plan. */
  futures?: Futures | null;
  /** The plan menu's actions. */
  plan?: PlanMenuActions;
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

/** Keys of the header numbers, in priority order (the last ones give way first). */
export const METRIC_KEYS = ["start", "lowest", "horizon", "debt", "next"] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

const NO_SUBSCRIBE = () => () => {};
const ZERO = () => 0;

/** Re-renders when the futures change (switch, fork, rename); no-op without them. */
function useFuturesVersion(futures: Futures | null | undefined): number {
  return React.useSyncExternalStore(
    futures ? futures.subscribe : NO_SUBSCRIBE,
    futures ? futures.getVersion : ZERO,
    futures ? futures.getVersion : ZERO,
  );
}

/**
 * Which header numbers do not fit their row: the row wraps (one line is
 * visible, the rest is clipped), so a number either fits whole or moves to
 * the hidden line. Measured on resize (ResizeObserver) and when the content
 * changes — never per frame. Not laid out (tests, display:none) → none.
 */
function useOverflowKeys(
  rowRef: React.RefObject<HTMLDivElement | null>,
  contentKey: unknown,
): readonly string[] {
  const [keys, setKeys] = React.useState<readonly string[]>([]);
  React.useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row) return undefined;
    const measure = () => {
      if (row.getClientRects().length === 0) {
        setKeys((prev) => (prev.length === 0 ? prev : []));
        return;
      }
      const box = row.getBoundingClientRect();
      const hidden: string[] = [];
      for (const child of Array.from(row.children)) {
        const el = child as HTMLElement;
        const key = el.dataset.metric;
        if (!key) continue;
        const rect = el.getBoundingClientRect();
        if (rect.right > box.right + 1 || rect.top >= box.bottom - 1 || rect.bottom > box.bottom + 1) {
          hidden.push(key);
        }
      }
      setKeys((prev) =>
        prev.length === hidden.length && prev.every((key, i) => key === hidden[i]) ? prev : hidden,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    for (const child of Array.from(row.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [rowRef, contentKey]);
  return keys;
}

/**
 * Selects the given clips and scrolls the first one (by date) into view.
 * Click handler only (O(clips) once).
 */
function revealClips(bridge: FinancialBridgeApi, ids: readonly string[]): void {
  const core = bridge.core;
  if (ids.length === 0) return;
  core.setClipSelection([...ids]);
  const state = core.getState();
  const wanted = new Set(ids);
  let first: (typeof state.clips)[number] | null = null;
  for (const clip of state.clips) {
    if (wanted.has(clip.id) && (first === null || clip.start < first.start)) first = clip;
  }
  if (!first) return;
  const metrics = core.metrics;
  const { viewport } = state;
  const laneWidth = viewport.width - metrics.trackHeaderWidth - metrics.scrollbarSize;
  const next: { scrollX?: number; scrollY?: number } = {};
  const x = first.start * viewport.pxPerBeat;
  if (laneWidth > 0 && (x < viewport.scrollX || x > viewport.scrollX + laneWidth - 40)) {
    next.scrollX = Math.max(0, x - laneWidth * 0.25);
  }
  const index = getTrackIndexById(state, first.trackId);
  if (index >= 0) {
    const top = getTrackTopByIndex(state, index, metrics);
    const rowsHeight = viewport.height - getTracksTop(metrics) - metrics.scrollbarSize;
    if (rowsHeight > 0 && (top < viewport.scrollY || top + metrics.trackHeight > viewport.scrollY + rowsHeight)) {
      next.scrollY = Math.max(0, top - 8);
    }
  }
  if (next.scrollX !== undefined || next.scrollY !== undefined) core.updateViewport(next);
}

/**
 * Brings every excluded item back into the calculation as ONE undo step:
 * unmutes its clip, unmutes the rows that hold excluded items and clears
 * every solo. Returns how many items are still excluded (locked rows).
 */
function reactivateAll(bridge: FinancialBridgeApi, ids: readonly string[]): number {
  const core = bridge.core;
  const state = core.getState();
  const wanted = new Set(ids);
  const mutedClips: string[] = [];
  const rowsWithExcluded = new Set<string>();
  for (const clip of state.clips) {
    if (!wanted.has(clip.id)) continue;
    rowsWithExcluded.add(clip.trackId);
    if (clip.muted === true) mutedClips.push(clip.id);
  }
  inOneUndoStep(core, () => {
    if (mutedClips.length > 0) core.setClipsMuted(mutedClips, false);
    state.tracks.forEach((track, index) => {
      if (track.muted === true && rowsWithExcluded.has(track.id)) core.toggleTrackMute(index);
      if (track.soloed === true) core.toggleTrackSolo(index);
    });
  });
  return excludedItems(bridge.getDocument()).length;
}

export function FinancialSummaryBar({
  bridge,
  onCreateDraft,
  inert = false,
  theme,
  onToggleTheme,
  onOpenCommand,
  tools,
  actions,
  futures = null,
  plan,
}: FinancialSummaryBarProps) {
  const revision = useFinancialRevision(bridge);
  useFuturesVersion(futures);
  const announce = useAnnounce();
  const metricsRef = React.useRef<HTMLDivElement | null>(null);

  // Short date ("15 nov") inside the start year, long ("15 mar 2027") beyond.
  const data = React.useMemo(() => {
    const doc = bridge.getDocument();
    const projection = bridge.getProjection();
    const warnings = bridge.getWarnings();
    const startYear = doc.startDate.slice(0, 4);
    const fmtDate = (iso: string) =>
      iso.slice(0, 4) === startYear ? formatDateShort(iso) : formatDateLong(iso);
    const excluded = excludedItems(doc);
    return {
      doc,
      projection,
      warnings,
      fmtDate,
      nextPayment: bridge.nextPaymentAfter(addDays(doc.startDate, -1)),
      verdict: computeVerdict(projection, warnings, doc.horizonMonths, fmtDate),
      excluded,
      // UX-03: "Deuda hoy" is the real debt — every item counts.
      realDebt: excluded.length > 0 ? realInitialDebt(doc) : projection.initialDebt,
    };
    // `revision` is the cache key: the bridge bumps it on every data change.
  }, [bridge, revision]);

  const { doc, projection, warnings, fmtDate, nextPayment, verdict, excluded, realDebt } = data;
  const reserve = doc.minimumCashReserve;
  const simulated = excluded.length > 0;
  const branch = futures?.activeBranch() ?? null;
  const inBranch = branch !== null && branch.id !== MAIN_BRANCH_ID;
  const minimum = projection.minimumCash;
  const minimumState = minimum.cash < 0 ? "negative" : minimum.cash < reserve ? "low" : "ok";
  const finalState =
    projection.finalCash < 0 ? "negative" : projection.finalCash < reserve ? "low" : "ok";
  const end = fmtDate(projection.endDate);
  const overflow = useOverflowKeys(metricsRef, `${revision}:${simulated}`);
  const isHidden = (key: MetricKey) => overflow.includes(key);

  // What each number means + what yours say now (hover / focus card).
  const help = {
    cash: useMetricHelp<HTMLDivElement>({
      title: "Liquidez hoy",
      body: "El dinero disponible que tienes hoy (efectivo y cuentas). Es el punto de partida de toda la proyección: la línea «Caja» arranca aquí.",
      action: "Clic en la cifra para corregirla (acepta «12 mil»).",
    }),
    reserve: useMetricHelp<HTMLDivElement>({
      title: "Reserva mínima",
      body: "El colchón que no quieres tocar. Si tu caja proyectada baja de esta cifra, SliceX te avisa: línea punteada amarilla en «Caja» y las alertas.",
      detail:
        warnings.length > 0
          ? `En tu plan, tu caja baja de ella ${warnings.length === 1 ? "1 vez" : `${warnings.length} veces`} (ver alertas).`
          : "En tu plan, tu caja nunca baja de ella.",
      tone: warnings.length > 0 ? "low" : "ok",
      action: "Clic en la cifra para cambiarla.",
    }),
    lowest: useMetricHelp<HTMLButtonElement>({
      title: "Tu punto más bajo",
      body: `El saldo más bajo que tendrá tu caja entre hoy y el ${end}, si todo pasa como en tu plan: tu momento más justo.`,
      detail:
        minimum.cash < 0
          ? `El ${fmtDate(minimum.date)} te faltarían ${formatMoneyWhole(-minimum.cash)}: dinero que tendrías que conseguir o mover antes de esa fecha.`
          : minimum.cash < reserve
            ? `El ${fmtDate(minimum.date)} quedas ${formatMoneyWhole(reserve - minimum.cash)} por debajo de tu reserva mínima (${formatMoneyWhole(reserve)}).`
            : `Ni en ese momento bajas de tu reserva: te sobran ${formatMoneyWhole(minimum.cash - reserve)}.`,
      tone: minimumState,
      action: "Clic: ir a ese día y ver qué lo causa.",
    }),
    horizon: useMetricHelp<HTMLButtonElement>(
      {
        title: "Al horizonte",
        body: `Lo que tendrás en caja al final de tu plan (${doc.horizonMonths} meses, el ${end}) si todo pasa como lo planeaste.`,
        detail: `${projection.finalCash >= doc.initialCash ? "+" : "−"}${formatMoneyWhole(Math.abs(projection.finalCash - doc.initialCash))} frente a tu liquidez de hoy.`,
        tone: finalState,
      },
      { toggle: true },
    ),
    debt: useMetricHelp<HTMLButtonElement>(
      {
        title: "Deuda hoy",
        body: "Lo que debes hoy: los saldos de tus tarjetas más lo que te falta por pagar de tus préstamos. Cuenta todo, también lo que silenciaste.",
        detail: simulated
          ? `Sin ${exclusionLabel(excluded)} serían ${formatMoneyWhole(projection.initialDebt)}; al ${end} deberías ${formatMoneyWhole(projection.finalDebt)} (simulación).`
          : projection.finalDebt < projection.initialDebt
            ? `Al ${end} deberás ${formatMoneyWhole(projection.finalDebt)}: bajará ${formatMoneyWhole(projection.initialDebt - projection.finalDebt)}.`
            : `Al ${end} deberás ${formatMoneyWhole(projection.finalDebt)}.`,
      },
      { toggle: true },
    ),
    next: useMetricHelp<HTMLButtonElement>({
      title: "Próximo pago",
      body: "El siguiente dinero que sale de tu caja según tu plan: un gasto, una mensualidad o el pago de una tarjeta.",
      detail: nextPayment
        ? `${nextPayment.name}: ${formatMoneyWhole(nextPayment.amount)} el ${fmtDate(nextPayment.date)}.`
        : `No hay pagos en tu plan hasta el ${end}.`,
      action: nextPayment ? "Clic: llevar el cursor a esa fecha." : undefined,
    }),
  };

  // UX-18: every change of the base is echoed with "Deshacer".
  const commitCash = (amount: number) => {
    const before = doc.initialCash;
    bridge.setInitialCash(amount);
    const after = computeVerdict(
      bridge.getProjection(),
      bridge.getWarnings(),
      doc.horizonMonths,
      fmtDate,
    );
    announce({
      message: `Liquidez hoy: ${formatMoneyWhole(before)} → ${formatMoneyWhole(amount)}. ${after.title}.`,
      undo: () => bridge.core.undo(),
    });
  };
  const commitReserve = (amount: number) => {
    const before = doc.minimumCashReserve;
    bridge.setMinimumCashReserve(amount);
    const count = bridge.getWarnings().length;
    announce({
      message: `Reserva mínima: ${formatMoneyWhole(before)} → ${formatMoneyWhole(amount)}. ${count === 0 ? "Sin alertas" : count === 1 ? "1 alerta" : `${count} alertas`}.`,
      undo: () => bridge.core.undo(),
    });
  };

  const simMark = simulated ? <span className="fin-summary__sim"> (simulación)</span> : null;

  // One render function per number: the bar shows the ones that fit, "Más
  // cifras" the rest (a second instance, same data).
  const renderStart = (inMore: boolean) => (
    <>
      <div
        className="fin-summary__metric fin-summary__metric--editable"
        {...(inMore ? { "aria-describedby": help.cash.id } : help.cash.triggerProps)}
      >
        <span className="fin-summary__label">Liquidez hoy</span>
        <span className="fin-summary__field">
          <InlineNumberInput
            className="fin-summary__input"
            ariaLabel="Liquidez hoy"
            value={doc.initialCash}
            schema={CASH_SCHEMA}
            format={formatMoney}
            onCommit={commitCash}
            onInvalidChange={(bad) => {
              if (bad) help.cash.hide();
            }}
          />
          <PencilIcon />
        </span>
      </div>
      <div
        className="fin-summary__metric fin-summary__metric--editable"
        {...(inMore ? { "aria-describedby": help.reserve.id } : help.reserve.triggerProps)}
      >
        <span className="fin-summary__label">Reserva mínima</span>
        <span className="fin-summary__field">
          <InlineNumberInput
            className="fin-summary__input"
            ariaLabel="Reserva mínima"
            value={reserve}
            schema={RESERVE_SCHEMA}
            format={formatMoney}
            onCommit={commitReserve}
            onInvalidChange={(bad) => {
              if (bad) help.reserve.hide();
            }}
          />
          <PencilIcon />
        </span>
      </div>
    </>
  );

  const goLowest = () => {
    jumpPlayheadToDate(bridge, minimum.date);
    if (minimumState !== "ok") focusValleyTitleSoon();
  };
  const goNext = () => {
    if (nextPayment) jumpPlayheadToDate(bridge, nextPayment.date);
  };

  return (
    <header
      className="fin-summary"
      role="region"
      aria-label="Resumen de tu plan"
      inert={inert}
      data-overflow={overflow.length > 0 ? "true" : undefined}
    >
      <PlanMenu inert={inert} theme={theme} onToggleTheme={onToggleTheme} plan={plan} />
      <VerdictBlock
        bridge={bridge}
        verdict={verdict}
        warnings={warnings}
        formatDate={fmtDate}
        reserve={reserve}
        inert={inert}
        inBranch={inBranch}
        simulated={simulated}
      />
      {simulated ? (
        <ExclusionChip
          excluded={excluded}
          onView={() => {
            revealClips(bridge, excluded.map((item) => item.id));
            announce({
              message: `Seleccionado${excluded.length === 1 ? "" : "s"}: ${excluded.map((item) => item.name).join(", ")}. Fuera del cálculo.`,
            });
          }}
          onReactivate={() => {
            const label = exclusionLabel(excluded);
            const left = reactivateAll(bridge, excluded.map((item) => item.id));
            const after = computeVerdict(
              bridge.getProjection(),
              bridge.getWarnings(),
              doc.horizonMonths,
              fmtDate,
            );
            announce({
              message:
                `Reactivado${excluded.length === 1 ? "" : "s"}: ${label}. ${after.title}.` +
                (left > 0 ? ` ${left === 1 ? "1 sigue" : `${left} siguen`} fuera (línea bloqueada).` : ""),
              undo: () => bridge.core.undo(),
            });
          }}
        />
      ) : null}
      {/* Every label has a dotted underline: hover or focus explains it
          (useMetricHelp); the descriptions are hidden, out of the flow. */}
      <div className="fin-summary__metrics" ref={metricsRef}>
        <div
          className="fin-summary__start"
          role="group"
          aria-label="Punto de partida"
          data-metric="start"
          data-overflow={isHidden("start") ? "true" : undefined}
          inert={isHidden("start")}
        >
          {renderStart(false)}
        </div>
        <button
          type="button"
          className="fin-summary__metric fin-summary__metric--action fin-summary__metric--dated"
          data-metric="lowest"
          data-state={minimumState}
          data-overflow={isHidden("lowest") ? "true" : undefined}
          inert={isHidden("lowest")}
          {...help.lowest.triggerProps}
          onClick={() => {
            help.lowest.triggerProps.onClick();
            goLowest();
          }}
        >
          <span className="fin-summary__label">Tu punto más bajo{simMark}</span>
          <span className="fin-summary__date">{fmtDate(minimum.date)}</span>
          <span className="fin-summary__value">{formatMoneyWhole(minimum.cash)}</span>
        </button>
        <button
          type="button"
          className="fin-summary__metric fin-summary__metric--context fin-summary__metric--dated"
          data-metric="horizon"
          data-state={finalState}
          data-overflow={isHidden("horizon") ? "true" : undefined}
          inert={isHidden("horizon")}
          {...help.horizon.triggerProps}
        >
          <span className="fin-summary__label">Al horizonte{simMark}</span>
          <span className="fin-summary__date">{end}</span>
          <span className="fin-summary__value">{formatMoneyWhole(projection.finalCash)}</span>
        </button>
        <button
          type="button"
          className="fin-summary__metric fin-summary__metric--context fin-summary__metric--dated"
          data-metric="debt"
          data-overflow={isHidden("debt") ? "true" : undefined}
          inert={isHidden("debt")}
          {...help.debt.triggerProps}
        >
          <span className="fin-summary__label">Deuda hoy</span>
          {simulated ? (
            <span className="fin-summary__date">
              sin {exclusionLabel(excluded)}: {formatMoneyWhole(projection.initialDebt)}
            </span>
          ) : null}
          <span className="fin-summary__value">{formatMoneyWhole(realDebt)}</span>
        </button>
        <button
          type="button"
          className="fin-summary__metric fin-summary__metric--action fin-summary__metric--context fin-summary__metric--dated"
          data-metric="next"
          aria-disabled={nextPayment ? undefined : true}
          data-overflow={isHidden("next") ? "true" : undefined}
          inert={isHidden("next")}
          {...help.next.triggerProps}
          onClick={() => {
            help.next.triggerProps.onClick();
            goNext();
          }}
        >
          <span className="fin-summary__label">Próximo pago{simMark}</span>
          {nextPayment ? (
            <>
              <span className="fin-summary__date">{fmtDate(nextPayment.date)}</span>
              <span className="fin-summary__value">
                {formatMoneyWhole(nextPayment.amount)}{" "}
                <span className="fin-summary__name">{nextPayment.name}</span>
              </span>
            </>
          ) : (
            <span className="fin-summary__value fin-summary__value--muted">—</span>
          )}
        </button>
      </div>
      {help.cash.tip}
      {help.reserve.tip}
      {help.lowest.tip}
      {help.horizon.tip}
      {help.debt.tip}
      {help.next.tip}
      {overflow.length > 0 ? (
        <MoreMetrics count={overflow.length + (overflow.includes("start") ? 1 : 0)} inert={inert}>
          <dl className="fin-more__list">
            {overflow.includes("start") ? (
              <div className="fin-more__start" role="group" aria-label="Punto de partida">
                {renderStart(true)}
              </div>
            ) : null}
            {overflow.includes("lowest") ? (
              <MoreRow
                label={<>Tu punto más bajo{simMark}</>}
                value={formatMoneyWhole(minimum.cash)}
                date={fmtDate(minimum.date)}
                state={minimumState}
                describedBy={help.lowest.id}
                action={{ label: "Ir a ese día", onClick: goLowest }}
              />
            ) : null}
            {overflow.includes("horizon") ? (
              <MoreRow
                label={<>Al horizonte{simMark}</>}
                value={formatMoneyWhole(projection.finalCash)}
                date={end}
                state={finalState}
                describedBy={help.horizon.id}
              />
            ) : null}
            {overflow.includes("debt") ? (
              <MoreRow
                label="Deuda hoy"
                value={formatMoneyWhole(realDebt)}
                date={
                  simulated
                    ? `sin ${exclusionLabel(excluded)}: ${formatMoneyWhole(projection.initialDebt)}`
                    : undefined
                }
                describedBy={help.debt.id}
              />
            ) : null}
            {overflow.includes("next") ? (
              <MoreRow
                label={<>Próximo pago{simMark}</>}
                value={nextPayment ? `${formatMoneyWhole(nextPayment.amount)} ${nextPayment.name}` : "—"}
                date={nextPayment ? fmtDate(nextPayment.date) : undefined}
                describedBy={help.next.id}
                action={nextPayment ? { label: "Ir a esa fecha", onClick: goNext } : undefined}
              />
            ) : null}
          </dl>
        </MoreMetrics>
      ) : null}
      {tools}
      <div className="fin-summary__spacer" />
      <div className="fin-summary__actions">
        {actions}
        <NewItemMenu
          bridge={bridge}
          onCreateDraft={onCreateDraft}
          onOpenCommand={onOpenCommand}
          inert={inert}
        />
      </div>
    </header>
  );
}

function PencilIcon() {
  return (
    <svg className="fin-summary__pencil" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M3 13l.6-2.6L10.8 3.2l2 2L5.6 12.4zM9.6 4.4l2 2" />
    </svg>
  );
}

function MoreRow({
  label,
  value,
  date,
  state,
  describedBy,
  action,
}: {
  label: React.ReactNode;
  value: string;
  date?: string;
  state?: string;
  describedBy: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="fin-more__row" data-state={state}>
      <dt className="fin-more__label">{label}</dt>
      <dd className="fin-more__value" aria-describedby={describedBy}>
        <span className="fin-summary__value">{value}</span>
        {date ? <span className="fin-summary__date"> {date}</span> : null}
      </dd>
      {action ? (
        <dd className="fin-more__action">
          <button type="button" className="fin-button" onClick={action.onClick}>
            {action.label}
          </button>
        </dd>
      ) : null}
    </div>
  );
}

// "Más cifras": the numbers that do not fit the row, one click away (UX-15).
function MoreMetrics({
  count,
  inert,
  children,
}: {
  count: number;
  inert: boolean;
  children: React.ReactNode;
}) {
  const [anchor, setAnchor] = React.useState<{ top: number; right: number } | null>(null);
  const open = anchor !== null;
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  useFitInViewport(panelRef, open, [anchor]);
  const close = React.useCallback(() => setAnchor(null), []);
  useOverlay({ open, onClose: close, kind: "popover", containerRef: panelRef, triggerRef, autoFocus: true });
  React.useEffect(() => {
    if (inert && open) setAnchor(null);
  }, [inert, open]);
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="fin-summary__more"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          if (open) {
            setAnchor(null);
            return;
          }
          const rect = triggerRef.current!.getBoundingClientRect();
          setAnchor({ top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) });
        }}
      >
        <span className="fin-sr-only">Ver </span>
        Más
        <span className="fin-summary__more-words"> cifras</span>
        <span className="fin-summary__more-count" aria-hidden="true">
          +{count}
        </span>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 6.5 8 10l3.5-3.5" />
        </svg>
      </button>
      {anchor
        ? createPortal(
            <div
              ref={panelRef}
              className="fin-popover fin-more"
              role="dialog"
              aria-label="Más cifras de tu plan"
              style={{ right: anchor.right, top: anchor.top }}
            >
              {children}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

// The verdict (UX-14): the answer to "¿me alcanza?", clickable, with the
// alerts attached. "en esta rama" (UX-19) / "simulación" (UX-03) when apply.
function VerdictBlock({
  bridge,
  verdict,
  warnings,
  formatDate,
  reserve,
  inert,
  inBranch,
  simulated,
}: {
  bridge: FinancialBridgeApi;
  verdict: Verdict;
  warnings: LiquidityWarning[];
  formatDate: (iso: string) => string;
  reserve: number;
  inert: boolean;
  inBranch: boolean;
  simulated: boolean;
}) {
  return (
    <div className="fin-verdict" data-tone={verdict.tone}>
      <button
        type="button"
        className="fin-verdict__main"
        onClick={() => {
          jumpPlayheadToDate(bridge, verdict.date);
          if (verdict.tone !== "ok") focusValleyTitleSoon();
        }}
      >
        <span className="fin-verdict__title">
          <span className="fin-verdict__dot" aria-hidden="true" />
          {verdict.title}
          {inBranch ? <span className="fin-verdict__tag">, en esta rama</span> : null}
          {simulated ? <span className="fin-verdict__tag fin-verdict__tag--sim"> (simulación)</span> : null}
        </span>
        <span className="fin-verdict__detail">
          <span className="fin-sr-only">. </span>
          {verdict.detail}
          <span className="fin-sr-only">. Ir a ese día</span>
        </span>
      </button>
      <WarningsChip
        bridge={bridge}
        warnings={warnings}
        formatDate={formatDate}
        inert={inert}
        reserve={reserve}
      />
    </div>
  );
}

// UX-03: what is left out of the calculation, always in sight.
function ExclusionChip({
  excluded,
  onView,
  onReactivate,
}: {
  excluded: readonly FinancialItem[];
  onView: () => void;
  onReactivate: () => void;
}) {
  const label = exclusionLabel(excluded);
  return (
    <div
      className="fin-exclusion"
      role="group"
      aria-label={`Fuera del cálculo: ${excluded.map((item) => item.name).join(", ")}`}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" />
        <path d="M2.5 13.5 13.5 2.5" />
      </svg>
      <span className="fin-exclusion__text">Sin {label}</span>
      <button type="button" className="fin-exclusion__button" onClick={onView}>
        Ver
      </button>
      <button type="button" className="fin-exclusion__button" onClick={onReactivate}>
        Reactivar todo
      </button>
    </div>
  );
}

/** "Estás en <futuro> (hipótesis) · Volver al plan principal" (UX-19). */
export function FutureStrip({ futures }: { futures: Futures }) {
  useFuturesVersion(futures);
  const announce = useAnnounce();
  const active = futures.activeBranch();
  if (active.id === MAIN_BRANCH_ID) return null;
  const main = futures.list().find((branch) => branch.id === MAIN_BRANCH_ID) ?? null;
  return (
    <div className="fin-branch-strip" role="region" aria-label="Futuro activo">
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <circle cx="4" cy="3.5" r="1.6" />
        <circle cx="4" cy="12.5" r="1.6" />
        <circle cx="12" cy="6" r="1.6" />
        <path d="M4 5.1v5.8M12 7.6c0 2.6-3 2.4-6.6 4" />
      </svg>
      <p className="fin-branch-strip__text">
        Estás en <strong>{active.name}</strong> (hipótesis)
        <span className="fin-branch-strip__note">
          : lo que cambies aquí no toca tu plan principal
        </span>
        .
      </p>
      {main ? (
        <button
          type="button"
          className="fin-button"
          onClick={() => {
            futures.switchTo(MAIN_BRANCH_ID);
            announce({ message: `Volviste a ${main.name}.` });
            // The strip goes away: the futures button keeps the focus.
            requestAnimationFrame(() => {
              document.querySelector<HTMLElement>(".fin-futures__trigger")?.focus();
            });
          }}
        >
          Volver al plan principal
        </button>
      ) : null}
    </div>
  );
}

interface PopoverAnchor {
  top: number;
  right?: number;
  left?: number;
}

// Shared behaviour of the header's menu buttons (ARIA menu-button
// pattern): opening moves focus to the first item; ↑/↓/Home/End move
// between items; Escape and Tab close and return focus to the trigger; a
// pointer down anywhere outside (capture phase, so the canvas — which
// cancels mousedown — can't swallow it), a resize, a scroll or the bar
// turning inert close it. `menuRef` is the popover (which may hold a note
// next to the `role="menu"`).
function useMenuButton(inert: boolean, align: "left" | "right" = "right") {
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
    setAnchor(
      align === "left"
        ? { top: rect.bottom + 6, left: Math.max(8, rect.left) }
        : { top: rect.bottom + 6, right: Math.max(8, window.innerWidth - rect.right) },
    );
  }, [anchor, align]);

  React.useEffect(() => {
    if (inert && open) setAnchor(null);
  }, [inert, open]);

  React.useEffect(() => {
    if (!open) return;
    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitem"]')
      ?.focus();
  }, [open]);
  // Outside press / resize close; the wheel over a long menu scrolls it.
  // An outside scroll closes it only when it really moved the trigger: the
  // header re-lays itself out after a commit (numbers change width, "Más
  // cifras" comes and goes, one ↔ two rows) and a container clamping its
  // scroll offset then fires a scroll that used to close "Nuevo" under the
  // pointer, mid-click.
  useDismiss(open, [triggerRef, menuRef], () => setAnchor(null), { scroll: false });
  const anchorRef = React.useRef(anchor);
  anchorRef.current = anchor;
  React.useEffect(() => {
    if (!open) return undefined;
    const onScroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      const placed = anchorRef.current;
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!placed || !rect) return;
      const movedY = Math.abs(rect.bottom + 6 - placed.top) > 2;
      const movedX =
        placed.left !== undefined
          ? Math.abs(Math.max(8, rect.left) - placed.left) > 2
          : placed.right !== undefined &&
            Math.abs(Math.max(8, window.innerWidth - rect.right) - placed.right) > 2;
      if (movedX || movedY) setAnchor(null);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => window.removeEventListener("scroll", onScroll, true);
  }, [open]);

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

// "Mi plan ▾" in the brand: the plan's global actions in one place (UX-48).
function PlanMenu({
  inert,
  theme,
  onToggleTheme,
  plan,
}: {
  inert: boolean;
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  plan?: PlanMenuActions;
}) {
  const menu = useMenuButton(inert, "left");
  const announce = useAnnounce();
  const nextTheme = theme === "dark" ? "claro" : "oscuro";
  const review = plan?.onReviewRec ?? null;
  return (
    <div className="fin-summary__brand">
      <button
        ref={menu.triggerRef}
        type="button"
        className="fin-plan__trigger"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={menu.toggle}
      >
        <span className="fin-summary__logo" aria-hidden="true" />
        <span className="fin-summary__wordmark" aria-hidden="true">
          SliceX
        </span>
        <span className="fin-plan__label">Mi plan</span>
        <svg className="fin-plan__chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4.5 6.5 8 10l3.5-3.5" />
        </svg>
      </button>
      {menu.anchor
        ? createPortal(
            <div
              ref={menu.menuRef}
              className="fin-popover fin-plan__menu"
              role="menu"
              aria-label="Mi plan"
              style={{ left: menu.anchor.left, top: menu.anchor.top }}
              onKeyDown={menu.onMenuKeyDown}
            >
              {plan?.onBuildYear ? (
                <PlanItem
                  label="Armar mi año"
                  hint="Tu sueldo, tus gastos fijos y tus deudas, en un minuto"
                  onSelect={() => {
                    menu.close(true);
                    plan.onBuildYear!();
                  }}
                />
              ) : null}
              {plan ? (
                <PlanItem
                  label="Revisar lo que pasó"
                  hint={review ? "Corrige lo que supusimos desde tu última visita" : "Nada pendiente por revisar"}
                  disabled={review === null}
                  onSelect={() => {
                    if (!review) return;
                    menu.close(true);
                    review();
                  }}
                />
              ) : null}
              {onToggleTheme ? (
                <PlanItem
                  label={`Tema ${nextTheme}`}
                  hint={theme === "dark" ? "Fondo claro" : "Fondo oscuro"}
                  themeToggle={theme ?? "light"}
                  onSelect={() => {
                    menu.close(true);
                    onToggleTheme();
                    announce({ message: `Tema ${nextTheme}.` });
                  }}
                />
              ) : null}
              {plan?.onReset ? (
                <>
                  <div className="fin-futures__divider" role="separator" />
                  <PlanItem
                    label="Reiniciar con el ejemplo…"
                    hint="Borra tu plan y todos sus futuros"
                    danger
                    onSelect={() => {
                      menu.close(true);
                      plan.onReset!();
                    }}
                  />
                </>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function PlanItem({
  label,
  hint,
  onSelect,
  disabled = false,
  danger = false,
  themeToggle,
}: {
  label: string;
  hint: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
  themeToggle?: "light" | "dark";
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className="fin-new__item fin-plan__item"
      aria-disabled={disabled ? true : undefined}
      data-danger={danger ? "true" : undefined}
      data-theme-toggle={themeToggle}
      onClick={onSelect}
    >
      <span className="fin-new__text">
        <span className="fin-new__label">{label}</span>
        <span className="fin-new__hint">{hint}</span>
      </span>
    </button>
  );
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
        <span className="fin-new__trigger-words">Nuevo</span>
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

// The alerts, attached to the verdict. Always the same <button> (UX-26: a
// stable node; with no alerts it says so and does nothing). The menu's note
// lives outside the role="menu" (UX-57); each alert's name says the date,
// the amount and what causes it.
function WarningsChip({
  bridge,
  warnings,
  formatDate,
  inert,
  reserve,
}: {
  bridge: FinancialBridgeApi;
  warnings: LiquidityWarning[];
  formatDate: (iso: string) => string;
  inert: boolean;
  reserve: number;
}) {
  const menu = useMenuButton(inert);
  const count = warnings.length;
  const { close, open } = menu;
  const noteId = React.useId();

  React.useEffect(() => {
    if (count === 0 && open) close(false);
  }, [count, open, close]);

  const hasNegative = warnings.some((w) => w.severity === "negative");
  const words = count === 0 ? "Sin alertas" : count === 1 ? "alerta" : "alertas";

  return (
    <div className="fin-summary__warnings">
      <button
        ref={menu.triggerRef}
        type="button"
        className="fin-summary__chip"
        data-state={count === 0 ? "ok" : hasNegative ? "negative" : "low"}
        aria-expanded={count === 0 ? undefined : menu.open}
        aria-haspopup={count === 0 ? undefined : "menu"}
        aria-disabled={count === 0 ? true : undefined}
        onClick={count === 0 ? undefined : menu.toggle}
      >
        {count === 0 ? (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 2.5 14.5 13.5h-13z" />
            <path d="M8 6.5v3.2M8 11.6v.1" />
          </svg>
        )}
        {count === 0 ? (
          <span className="fin-summary__chip-words">{words}</span>
        ) : (
          <>
            {count}
            <span className="fin-summary__chip-words"> {words}</span>
          </>
        )}
      </button>
      {menu.anchor && count > 0
        ? createPortal(
            <div
              ref={menu.menuRef}
              className="fin-popover fin-alerts"
              style={{ right: menu.anchor.right, top: menu.anchor.top }}
              onKeyDown={menu.onMenuKeyDown}
            >
              <p id={noteId} className="fin-popover__note">
                Cuando tu caja proyectada baja de tu reserva mínima ({formatMoneyWhole(reserve)}) o de
                cero. Elige una para ver qué la causa y cómo arreglarla.
              </p>
              <div role="menu" aria-label="Alertas de liquidez" aria-describedby={noteId}>
                {warnings.map((warning) => (
                  <button
                    key={`${warning.startDate}:${warning.eventId}`}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className="fin-popover__item"
                    data-state={warning.severity === "negative" ? "negative" : "low"}
                    onClick={() => {
                      jumpPlayheadToDate(bridge, warning.date);
                      close(true);
                      focusValleyTitleSoon();
                    }}
                  >
                    <span className="fin-popover__dot" aria-hidden="true" />
                    <span className="fin-popover__date">{formatDate(warning.date)}</span>
                    <span className="fin-sr-only">: </span>
                    <span className="fin-popover__text">
                      <strong>{formatMoneyWhole(warning.cash)}</strong>
                      <span className="fin-sr-only">,</span> lo causa {warning.name}
                      <span className="fin-sr-only">. Ver arreglos</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
