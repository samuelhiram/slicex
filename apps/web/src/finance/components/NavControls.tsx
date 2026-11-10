// Timeline navigation controls, in the empty corner above the track names
// (right next to the ruler they move): ‹ Hoy › (one screen back / today /
// one screen forward), the visible range as a calendar span (Semana, Mes,
// 3 meses, Año, Todo — short labels: the select fits the 216 px corner
// cell) and "Cómo moverte" — every gesture and shortcut.
// All moves glide through the interaction controller's navigator (reduced
// motion jumps). The visible range is announced to screen readers.
import * as React from "react";
import { useFitInViewport } from "../../ui/fit-in-viewport";
import { useDismiss } from "../../ui/use-dismiss";
import { createPortal } from "react-dom";
import type { PlaylistCore, ViewportNavigator } from "@slicex/canvas";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateLong } from "../format";
import { horizonBeat } from "../mapping";

export interface NavControlsProps {
  core: PlaylistCore;
  navigator: ViewportNavigator;
  bridge: FinancialBridgeApi;
}

const SPANS: ReadonlyArray<{ value: string; label: string; days: number | "all" }> = [
  { value: "week", label: "Semana", days: 8 },
  { value: "2weeks", label: "2 sem", days: 15 },
  { value: "month", label: "Mes", days: 32 },
  { value: "quarter", label: "3 meses", days: 92 },
  { value: "year", label: "Año", days: 366 },
  { value: "all", label: "Todo", days: "all" },
];

function timelineWidth(core: PlaylistCore): number {
  const { viewport } = core.getState();
  return Math.max(1, viewport.width - core.metrics.trackHeaderWidth - core.metrics.scrollbarSize);
}

/** Visible [fromDay, toDay] as integers: React only re-renders when a day changes. */
export function useVisibleDays(core: PlaylistCore): { from: number; to: number } {
  const compute = React.useCallback(() => {
    const { viewport } = core.getState();
    const width = timelineWidth(core);
    return {
      from: Math.max(0, Math.floor(viewport.scrollX / viewport.pxPerBeat)),
      to: Math.max(0, Math.floor((viewport.scrollX + width) / viewport.pxPerBeat)),
    };
  }, [core]);
  const [from, setFrom] = React.useState(() => compute().from);
  const [to, setTo] = React.useState(() => compute().to);
  React.useEffect(() => {
    const sync = () => {
      const next = compute();
      setFrom(next.from);
      setTo(next.to);
    };
    sync();
    const sub = core.subscribe(sync);
    return () => sub.unsubscribe();
  }, [core, compute]);
  return { from, to };
}

export function NavControls({ core, navigator, bridge }: NavControlsProps) {
  const { from, to } = useVisibleDays(core);
  const [help, setHelp] = React.useState<{ top: number; left: number } | null>(null);
  const helpRef = React.useRef<HTMLButtonElement | null>(null);
  const helpPopoverRef = React.useRef<HTMLDivElement | null>(null);
  useFitInViewport(helpPopoverRef, help !== null, [help]);
  const span = Math.max(1, to - from);
  const current =
    SPANS.find((option) => option.days !== "all" && Math.abs(span - option.days) / option.days < 0.15)
      ?.value ?? "";

  const playheadAnchor = (): number => {
    const { viewport, playPosition } = core.getState();
    const x = playPosition.time * viewport.pxPerBeat - viewport.scrollX;
    const width = timelineWidth(core);
    return core.metrics.trackHeaderWidth + (x >= 0 && x <= width ? x : 0);
  };

  const setSpan = (value: string) => {
    const option = SPANS.find((candidate) => candidate.value === value);
    if (!option) return;
    if (option.days === "all") {
      navigator.showRange(0, horizonBeat(bridge.getDocument()) + 2);
      return;
    }
    navigator.zoomTo(timelineWidth(core) / option.days, playheadAnchor());
  };

  // Pressing inside the help (text, rows) keeps it open; outside closes.
  useDismiss(help !== null, [helpRef, helpPopoverRef], () => setHelp(null), { escape: true });

  return (
    <div className="fin-navctl" role="group" aria-label="Navegar el tiempo">
      <button
        type="button"
        className="fin-navctl__button"
        aria-label="Pantalla anterior"
        title="Pantalla anterior (RePág)"
        onClick={() => navigator.scrollBy(-timelineWidth(core) * 0.85, 0)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M10 3.5 5.5 8l4.5 4.5" />
        </svg>
      </button>
      <button
        type="button"
        className="fin-navctl__button fin-navctl__today"
        title="Ir a hoy (Inicio)"
        onClick={() => {
          core.setPlayPosition(0);
          navigator.scrollTo({ scrollX: 0 });
        }}
      >
        Hoy
      </button>
      <button
        type="button"
        className="fin-navctl__button"
        aria-label="Pantalla siguiente"
        title="Pantalla siguiente (AvPág)"
        onClick={() => navigator.scrollBy(timelineWidth(core) * 0.85, 0)}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6 3.5 10.5 8 6 12.5" />
        </svg>
      </button>
      <select
        className="fin-navctl__span"
        aria-label="Rango visible"
        title="Rango visible (+ / − para zoom, 0 para ver todo)"
        value={current}
        onChange={(event) => setSpan(event.target.value)}
      >
        {current === "" ? (
          <option value="" disabled>
            {span} d
          </option>
        ) : null}
        {SPANS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        ref={helpRef}
        type="button"
        className="fin-navctl__button fin-navctl__help"
        aria-label="Cómo moverte"
        aria-expanded={help !== null}
        title="Cómo moverte"
        onClick={() => {
          if (help) {
            setHelp(null);
            return;
          }
          const rect = helpRef.current!.getBoundingClientRect();
          setHelp({ top: rect.bottom + 8, left: rect.left });
        }}
      >
        ?
      </button>
      <p className="fin-sr-only" aria-live="polite">
        <LiveRange bridge={bridge} from={from} to={to} />
      </p>
      {help
        ? createPortal(
            <div
              ref={helpPopoverRef}
              className="fin-popover fin-navhelp"
              role="dialog"
              aria-label="Cómo moverte"
              style={{ top: help.top, left: help.left }}
            >
              <NavHelp />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

// Announces the visible range once it settles (not on every frame of a glide).
function LiveRange({
  bridge,
  from,
  to,
}: {
  bridge: FinancialBridgeApi;
  from: number;
  to: number;
}) {
  const [text, setText] = React.useState("");
  React.useEffect(() => {
    const id = setTimeout(() => {
      setText(
        `Mostrando del ${formatDateLong(bridge.dateAtBeat(from))} al ${formatDateLong(
          bridge.dateAtBeat(to),
        )}`,
      );
    }, 700);
    return () => clearTimeout(id);
  }, [bridge, from, to]);
  return <>{text}</>;
}

export const NAV_GESTURES: ReadonlyArray<{ keys: string; what: string }> = [
  { keys: "Rueda", what: "Sube y baja entre líneas de evento" },
  { keys: "Shift + rueda", what: "Avanza o regresa en el tiempo (también la rueda sobre la regla o la Caja)" },
  { keys: "Ctrl + rueda · pellizca", what: "Zoom donde está el cursor" },
  { keys: "Trackpad", what: "Desliza en cualquier dirección" },
  { keys: "Espacio + arrastra · botón de la rueda", what: "La mano: suelta con impulso" },
  { keys: "Minimapa (abajo)", what: "Arrastra la ventana; sus bordes cambian el zoom; doble clic: todo" },
  { keys: "Arrastrar cerca del borde", what: "El tiempo se desplaza solo mientras cargas un pago" },
  { keys: "← →", what: "Mueve el día del playhead (Shift: 4 días)" },
  { keys: "RePág · AvPág", what: "Una pantalla atrás / adelante" },
  { keys: "Inicio · Fin", what: "Hoy · el final" },
  { keys: "+ · − · 0", what: "Acercar · alejar · ver todo" },
];

export function NavHelp() {
  return (
    <div className="fin-navhelp__body">
      <p className="fin-navhelp__title">Cómo moverte</p>
      <dl className="fin-navhelp__list">
        {NAV_GESTURES.map((gesture) => (
          <div key={gesture.keys} className="fin-navhelp__row">
            <dt>{gesture.keys}</dt>
            <dd>{gesture.what}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
