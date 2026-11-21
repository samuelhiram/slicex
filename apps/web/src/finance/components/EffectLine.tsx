// What a what-if does to your cash, BEFORE you commit it — the line of the
// "/" bar, made reusable for the editor, Rec, valley fixes and strategies:
//
//   Tu caja: mínimo −$1,292 → −$58,792 (27 nov) · al horizonte −$114,000 · entras en rojo
//
// Two pieces:
//   - useLivePreviewEffect(bridge, preview, { delayMs }) puts the what-if on
//     the money lane (`bridge.setPreview`, plan untouched) after a short
//     pause in typing, and returns its effect (`bridge.getPreviewEffect`),
//     recomputed when the plan changes; it takes the preview off the lane
//     when `preview` turns null or the component unmounts.
//   - <EffectLine effect={…} /> writes that effect as one sentence, toned
//     (positive / negative / neutral) like the "/" bar's line.
// No `role="status"` here: whether the line is announced is the host's
// call (and the shell's announcer says what was committed).
import * as React from "react";
import type { FinancialBridgeApi, FinancialPreview, PreviewEffect } from "../bridge-api";
import { formatDateShort, formatMoneyWhole, formatSignedMoneyWhole } from "../format";
import { useFinancialRevision } from "./FinancialUi";

/** Pause after the last change before the what-if is recomputed (≤ 200 ms criterion of UX-23). */
export const DEFAULT_PREVIEW_DELAY_MS = 150;

export interface LivePreviewOptions {
  /**
   * Wait this long after `preview` last changed before applying it (default
   * 150 ms; 0 = at once, as the "/" bar does). A change of the plan itself
   * (bridge revision) refreshes the effect at once.
   */
  delayMs?: number;
}

function sameEffect(a: PreviewEffect | null, b: PreviewEffect | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.text === b.text &&
    a.tone === b.tone &&
    a.minBefore === b.minBefore &&
    a.minAfter === b.minAfter &&
    a.minAfterDate === b.minAfterDate &&
    a.finalBefore === b.finalBefore &&
    a.finalAfter === b.finalAfter
  );
}

/**
 * Live what-if on the money lane + its effect on your cash.
 *
 * - `preview` is compared BY IDENTITY: memoize it (`React.useMemo`) on what
 *   actually defines it (e.g. the draft item without its name), or every
 *   render restarts the pause and recomputes the projection.
 * - While a new `preview` waits for its pause, the previous effect (and the
 *   previous what-if on the lane) stays: no flicker while typing.
 * - `null` takes the what-if off the lane at once and returns null; so does
 *   unmounting. Only a preview this hook put on the bridge is cleared (a
 *   what-if set meanwhile by someone else is left alone).
 * - Re-renders only when the effect changes (never per frame: the bridge
 *   revision moves on plan changes only).
 *
 * @example
 * const preview = React.useMemo<FinancialPreview | null>(
 *   () => (valid ? { kind: "add", item: draftKey } : null), [valid, draftKey]);
 * const effect = useLivePreviewEffect(bridge, preview);
 * return <EffectLine effect={effect} />;
 */
export function useLivePreviewEffect(
  bridge: FinancialBridgeApi,
  preview: FinancialPreview | null,
  opts: LivePreviewOptions = {},
): PreviewEffect | null {
  const delayMs = Math.max(0, opts.delayMs ?? DEFAULT_PREVIEW_DELAY_MS);
  const revision = useFinancialRevision(bridge);
  const [effect, setEffect] = React.useState<PreviewEffect | null>(null);
  // The what-if this hook last put on the bridge (null: none).
  const appliedRef = React.useRef<FinancialPreview | null>(null);

  React.useEffect(() => {
    if (preview === null) {
      release(bridge, appliedRef);
      setEffect(null);
      return undefined;
    }
    const apply = () => {
      appliedRef.current = preview;
      bridge.setPreview(preview);
      const next = bridge.getPreviewEffect();
      setEffect((previous) => (sameEffect(previous, next) ? previous : next));
    };
    // Already on the lane (only the plan moved): refresh now. A new
    // what-if waits for the pause.
    if (delayMs === 0 || appliedRef.current === preview) {
      apply();
      return undefined;
    }
    const timer = setTimeout(apply, delayMs);
    return () => clearTimeout(timer);
  }, [bridge, preview, revision, delayMs]);

  React.useEffect(() => () => release(bridge, appliedRef), [bridge]);

  return preview === null ? null : effect;
}

function release(
  bridge: FinancialBridgeApi,
  appliedRef: React.RefObject<FinancialPreview | null>,
): void {
  const applied = appliedRef.current;
  appliedRef.current = null;
  if (applied !== null && bridge.getPreview() === applied) bridge.setPreview(null);
}

const MINUS = "−";

/** "$12,000" / "−$1,292" (typographic minus, like the signed deltas). */
function cash(n: number): string {
  const text = formatMoneyWhole(n);
  return text.startsWith("-") ? MINUS + text.slice(1) : text;
}

export interface DescribeEffectOptions {
  /** Who the line talks about (default "Tu caja"). */
  label?: string;
  /** The plan's reserve: adds "rompes tu reserva" / "recuperas tu reserva". */
  reserve?: number;
}

/**
 * The effect as one sentence:
 * "Tu caja: mínimo −$1,292 → −$58,792 (27 nov) · al horizonte −$114,000 · entras en rojo".
 * A side that does not move says so ("mínimo sin cambio"); nothing moving
 * at all is "Tu caja: sin cambios". Also usable in an announcement.
 */
export function describePreviewEffect(
  effect: PreviewEffect,
  options: DescribeEffectOptions = {},
): string {
  const label = options.label ?? "Tu caja";
  const { minBefore, minAfter, finalBefore, finalAfter } = effect;
  const finalDelta = finalAfter - finalBefore;
  const minMoves = Math.abs(minAfter - minBefore) >= 0.5;
  const finalMoves = Math.abs(finalDelta) >= 0.5;
  if (!minMoves && !finalMoves) return `${label}: sin cambios`;
  const parts = [
    minMoves
      ? `mínimo ${cash(minBefore)} → ${cash(minAfter)} (${formatDateShort(effect.minAfterDate)})`
      : "mínimo sin cambio",
    finalMoves ? `al horizonte ${formatSignedMoneyWhole(finalDelta)}` : "al horizonte sin cambio",
  ];
  const reserve = options.reserve;
  if (minBefore < 0 && minAfter >= 0) parts.push("sales del rojo");
  else if (minBefore >= 0 && minAfter < 0) parts.push("entras en rojo");
  else if (reserve !== undefined && minBefore >= reserve && minAfter < reserve) parts.push("rompes tu reserva");
  else if (reserve !== undefined && minBefore < reserve && minAfter >= reserve) parts.push("recuperas tu reserva");
  return `${label}: ${parts.join(" · ")}`;
}

export interface EffectLineProps {
  /** From `useLivePreviewEffect`; null renders nothing. */
  effect: PreviewEffect | null;
  /** Default "Tu caja". */
  label?: string;
  /** The plan's reserve (adds the reserve verdict). */
  reserve?: number;
  id?: string;
  /** Extra class (placement); the look is `.fin-effect`. */
  className?: string;
}

/**
 * One line: "Tu caja: mínimo A → B (fecha) · al horizonte ±C", with
 * `data-tone` = `effect.tone` (green better / red worse / muted neutral).
 * Not a live region by itself.
 *
 * @example
 * <EffectLine effect={useLivePreviewEffect(bridge, preview)} reserve={doc.minimumCashReserve} />
 */
export function EffectLine({ effect, label, reserve, id, className }: EffectLineProps) {
  if (!effect) return null;
  return (
    <p id={id} className={className ? `fin-effect ${className}` : "fin-effect"} data-tone={effect.tone}>
      {describePreviewEffect(effect, { label, reserve })}
    </p>
  );
}
