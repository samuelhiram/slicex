// Timeline navigation controls, in the empty corner above the track names
// (right next to the ruler they move): ‹ Hoy › (one screen back / today /
// one screen forward), the visible range as a calendar span (Semana, Mes,
// 3 meses, Año, Todo — short labels: the select fits the 216 px corner
// cell) and "Cómo moverte" — every gesture and shortcut.
// All moves glide through the interaction controller's navigator (reduced
// motion jumps). The visible range is announced to screen readers.
import * as React from "react";
import { useFitInViewport } from "../../ui/fit-in-viewport";
import { useOverlay } from "../../ui/use-overlay";
import { createPortal } from "react-dom";
import type { PlaylistCore, ViewportNavigator } from "@slicex/canvas";
import type { FinancialBridgeApi } from "../bridge-api";
import { formatDateLong, formatDateShort } from "../format";
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

/** Zoom step of the − / + buttons (the same as the − / + keys). */
const ZOOM_STEP = 1.6;

/**
 * UX-46: the visible span in words, never "118 d": "9 días", "≈ 3 semanas",
 * "≈ 2 meses", "≈ 1 año", "≈ 1.5 años".
 */
export function describeSpanDays(days: number): string {
  const d = Math.max(1, Math.round(days));
  if (d <= 10) return d === 1 ? "1 día" : `${d} días`;
  if (d < 45) {
    const weeks = Math.round(d / 7);
    return weeks === 1 ? "≈ 1 semana" : `≈ ${weeks} semanas`;
  }
  if (d < 335) {
    const months = Math.round(d / 30.44);
    return months === 1 ? "≈ 1 mes" : `≈ ${months} meses`;
  }
  const years = Math.round((d / 365.25) * 2) / 2;
  return years === 1 ? "≈ 1 año" : `≈ ${String(years)} años`;
}

/**
 * The preset the visible days match ("" = none): "all" when the whole plan
 * is in view from its first day (what "0" and "Todo" do), else the calendar
 * span within 15 %.
 */
export function matchSpan(from: number, to: number, horizon: number): string {
  if (from <= 0 && to >= horizon) return "all";
  const span = Math.max(1, to - from);
  return (
    SPANS.find((option) => option.days !== "all" && Math.abs(span - option.days) / option.days < 0.15)
      ?.value ?? ""
  );
}

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
  const horizon = horizonBeat(bridge.getDocument());
  const current = matchSpan(from, to, horizon);
  const rangeDates = `Del ${formatDateShort(bridge.dateAtBeat(from))} al ${formatDateShort(bridge.dateAtBeat(to))}`;

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
  // UX-27 / UX-57: it is a dialog, so it takes the focus when it opens and
  // gives it back to "?" on Escape / close.
  useOverlay({
    open: help !== null,
    onClose: () => setHelp(null),
    kind: "popover",
    containerRef: helpPopoverRef,
    triggerRef: helpRef,
    autoFocus: true,
  });

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
      {/* UX-46: the range in words, with − / + next to it. */}
      <button
        type="button"
        className="fin-navctl__button fin-navctl__zoom fin-navctl__zoom--out"
        aria-label="Alejar"
        title="Alejar: ver más días (−)"
        onClick={() => navigator.zoomBy(1 / ZOOM_STEP, playheadAnchor())}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 8h8" />
        </svg>
      </button>
      <select
        className="fin-navctl__span"
        aria-label="Rango visible"
        title={`${rangeDates} · − / + para zoom, 0 para ver todo`}
        value={current}
        onChange={(event) => setSpan(event.target.value)}
      >
        {current === "" ? (
          <option value="" disabled>
            {describeSpanDays(span)}
          </option>
        ) : null}
        {SPANS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="fin-navctl__button fin-navctl__zoom fin-navctl__zoom--in"
        aria-label="Acercar"
        title="Acercar: ver menos días (+)"
        onClick={() => navigator.zoomBy(ZOOM_STEP, playheadAnchor())}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 8h8M8 4v8" />
        </svg>
      </button>
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
              aria-labelledby="fin-navhelp-title"
              tabIndex={-1}
              style={{ top: help.top, left: help.left }}
            >
              <NavHelp titleId="fin-navhelp-title" />
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

export interface HelpRow {
  keys: string;
  what: string;
}

export const NAV_GESTURES: ReadonlyArray<HelpRow> = [
  { keys: "Rueda", what: "Sube y baja entre líneas de evento" },
  { keys: "Shift + rueda", what: "Avanza o regresa en el tiempo (también la rueda sobre la regla o la Caja)" },
  { keys: "Ctrl + rueda · pellizca", what: "Zoom donde está el cursor" },
  { keys: "Trackpad", what: "Desliza en cualquier dirección" },
  { keys: "Espacio + arrastra · botón de la rueda", what: "La mano: suelta con impulso" },
  { keys: "Minimapa (abajo)", what: "Arrastra la ventana; sus bordes cambian el zoom; doble clic: todo" },
  { keys: "Arrastrar cerca del borde", what: "El tiempo se desplaza solo mientras cargas un pago" },
  { keys: "← →", what: "Sin nada seleccionado: mueve el día marcado (la línea roja; Shift: 4 días)" },
  { keys: "RePág · AvPág", what: "Una pantalla atrás / adelante" },
  { keys: "Inicio · Fin", what: "Hoy · el final" },
  { keys: "+ · − · 0", what: "Acercar · alejar · ver todo" },
];

// UX-45: every gesture that changes money, with its consequence.
export const EDIT_GESTURES: ReadonlyArray<HelpRow> = [
  { keys: "Arrastrar un objeto", what: "Cambia su fecha (y la de todos sus pagos). Alt: sin imán" },
  { keys: "Shift + arrastrar", what: "Hace una copia en la fecha donde la sueltas" },
  { keys: "Borde derecho", what: "Cambia cuándo termina. En una deuda calcula el pago para quedar libre ese día" },
  { keys: "Barrita de arriba", what: "Sube o baja el monto (Shift: paso fino, al peso)" },
  { keys: "Agarrador central", what: "Alarga o acorta un objeto seleccionado aunque su final no se vea" },
  { keys: "Doble clic · Enter", what: "Abre el objeto para editarlo" },
  { keys: "Ctrl+V sobre una tarjeta", what: "Pega su estado de cuenta: actualiza saldo y compras" },
  { keys: "Dividir (C)", what: "Parte un objeto en dos el día que elijas, para cambiar el monto desde ahí. Shift: todos los de ese día" },
  { keys: "Excluir (T)", what: "¿Y si no pasara? Lo saca de tus cifras sin borrarlo" },
];

// UX-45 / UX-04 / UX-38: the keyboard, shortcuts included.
export const SHORTCUTS: ReadonlyArray<HelpRow> = [
  { keys: "Alt + ← →", what: "Recorre los objetos en orden de fecha (los selecciona)" },
  { keys: "← → con un objeto", what: "Mueve su fecha un día (Shift: 4 días); ↑ ↓ lo cambia de línea" },
  { keys: "Shift+F10 · Menú", what: "Abre el menú del objeto seleccionado" },
  { keys: "Supr", what: "Borra lo seleccionado (puedes deshacer)" },
  { keys: "Ctrl+Z · Ctrl+Y", what: "Deshacer · rehacer" },
  { keys: "Mantén A", what: "Tu año sin el objeto bajo el cursor (también en su menú)" },
  { keys: "Mantén Q", what: "Asómate a tu otro futuro" },
  { keys: "/", what: "Escribe un movimiento: «renta 8000 el 1»" },
  { keys: "E · P · C · T · D · Z", what: "Seleccionar · Dibujar · Dividir · Excluir · Borrar · Zoom" },
  { keys: "Esc", what: "Vuelve a Seleccionar; cierra la tarjeta del objeto" },
  { keys: "Insert", what: "Divide lo seleccionado en el día marcado" },
  { keys: "Retroceso", what: "Activa o quita el imán" },
];

function HelpList({ rows }: { rows: ReadonlyArray<HelpRow> }) {
  return (
    <dl className="fin-navhelp__list">
      {rows.map((row) => (
        <div key={row.keys} className="fin-navhelp__row">
          <dt>{row.keys}</dt>
          <dd>{row.what}</dd>
        </div>
      ))}
    </dl>
  );
}

export function NavHelp({ titleId, full = true }: { titleId?: string; full?: boolean } = {}) {
  return (
    <div className="fin-navhelp__body">
      <h2 className="fin-navhelp__title" id={titleId}>
        Cómo moverte
      </h2>
      <HelpList rows={NAV_GESTURES} />
      {full ? (
        <>
          <h3 className="fin-navhelp__section">Editar con la mano</h3>
          <HelpList rows={EDIT_GESTURES} />
          <h3 className="fin-navhelp__section">Atajos</h3>
          <HelpList rows={SHORTCUTS} />
        </>
      ) : null}
    </div>
  );
}
