// "Ajustes del gráfico" (2026-11-20): a gear built into the balance chart's
// top-left corner opens a dialog to choose what the chart shows besides the
// cash curve and its $0 line — the lowest points, the debt, the reserve,
// the compared future, the scale — and the colour of each (the curve's
// too). Everything starts OFF, for a clean chart (chart-settings.ts).
//
// Each change applies at once: the dialog opens under the gear, over a
// faint veil without blur, so the chart shows the change behind it. One
// open / close contract (useOverlay "modal"): Escape, ×, "Listo"; the focus
// goes back to the gear.
import * as React from "react";
import { useFitInViewport } from "../../ui/fit-in-viewport";
import { useOverlay } from "../../ui/use-overlay";
import {
  CHART_COLORS,
  CHART_LAYERS,
  chartColorHex,
  DEFAULT_CHART_SETTINGS,
  setChartColor,
  setChartLayer,
  setChartSettings,
  useChartSettings,
  type ChartColorId,
  type ChartColorKey,
  type ChartLayer,
} from "../chart-settings";

const GEAR_PATH =
  "M8.2 1.7h1.6l.4 1.9c.5.2 1 .4 1.4.8l1.8-.7 1.1 1.1-.7 1.8c.4.4.6.9.8 1.4l1.9.4v1.6l-1.9.4c-.2.5-.4 1-.8 1.4l.7 1.8-1.1 1.1-1.8-.7c-.4.4-.9.6-1.4.8l-.4 1.9H8.2l-.4-1.9c-.5-.2-1-.4-1.4-.8l-1.8.7-1.1-1.1.7-1.8c-.4-.4-.6-.9-.8-1.4l-1.9-.4V8.2l1.9-.4c.2-.5.4-1 .8-1.4l-.7-1.8 1.1-1.1 1.8.7c.4-.4.9-.6 1.4-.8z";

/** The gear in the chart's corner. */
export function ChartSettingsButton({
  open,
  onOpen,
  buttonRef,
}: {
  open: boolean;
  onOpen: () => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  const settings = useChartSettings();
  const shown = CHART_LAYERS.filter((layer) => settings.layers[layer]).length;
  return (
    <button
      ref={buttonRef}
      type="button"
      className="fin-chart-gear"
      aria-label="Ajustes del gráfico"
      aria-haspopup="dialog"
      aria-expanded={open}
      title={
        shown === 0
          ? "Ajustes del gráfico: qué más ver además de tu caja (todo apagado)"
          : `Ajustes del gráfico: ${shown} de ${CHART_LAYERS.length} encendidos`
      }
      onClick={onOpen}
    >
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <path d={GEAR_PATH} />
        <circle cx="9" cy="9" r="2.3" />
      </svg>
    </button>
  );
}

interface LayerRow {
  layer: ChartLayer;
  title: string;
  description: string;
  /** Its colour (none: the scale). */
  color: ChartColorKey | null;
}

const ROWS: readonly LayerRow[] = [
  {
    layer: "minimums",
    title: "Mínimos",
    description: "Tus puntos más bajos: el monto y el día.",
    color: "minimums",
  },
  {
    layer: "debt",
    title: "Deuda",
    description: "Lo que debes, como una línea en su propia escala.",
    color: "debt",
  },
  {
    layer: "reserve",
    title: "Reserva",
    description: "Tu colchón: su línea y el color cuando tu caja baja de él.",
    color: "reserve",
  },
  {
    layer: "alternate",
    title: "Plan alterno",
    description: "El futuro con el que comparas (menú Futuros), como línea fantasma.",
    color: "alternate",
  },
  {
    layer: "scale",
    title: "Escala",
    description: "Montos de referencia ($20k, $200k…) y los extremos a la derecha.",
    color: null,
  },
];

function Swatches({
  colorKey,
  label,
  disabled,
}: {
  colorKey: ChartColorKey;
  label: string;
  disabled: boolean;
}) {
  const settings = useChartSettings();
  const chosen = settings.colors[colorKey] ?? null;
  const name = `fin-chart-color-${colorKey}`;
  const option = (id: ChartColorId | null, title: string, swatch: string) => (
    <label key={id ?? "auto"} className="fin-swatch" title={title} data-auto={id === null ? "true" : undefined}>
      <input
        type="radio"
        className="fin-swatch__input"
        name={name}
        aria-label={title}
        checked={chosen === id}
        disabled={disabled}
        onChange={() => setChartColor(colorKey, id)}
      />
      <span className="fin-swatch__dot" style={{ background: swatch }} aria-hidden="true" />
    </label>
  );
  return (
    <div className="fin-swatches" role="radiogroup" aria-label={`Color de ${label}`} aria-disabled={disabled || undefined}>
      {option(null, "Automático (el del tema)", `var(--chart-${colorKey})`)}
      {CHART_COLORS.map((color) => option(color.id, color.label, color.hex))}
    </div>
  );
}

export interface ChartSettingsDialogProps {
  onClose: () => void;
  /** The gear's box (screen px): the dialog opens under it. */
  anchor: { left: number; bottom: number } | null;
  fallbackFocus?: () => HTMLElement | null;
}

export function ChartSettingsDialog({ onClose, anchor, fallbackFocus }: ChartSettingsDialogProps) {
  const settings = useChartSettings();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const firstRef = React.useRef<HTMLButtonElement>(null);
  const titleId = React.useId();
  useOverlay({
    open: true,
    onClose,
    kind: "modal",
    containerRef: dialogRef,
    initialFocusRef: firstRef,
    ...(fallbackFocus ? { fallbackFocus } : {}),
  });
  useFitInViewport(dialogRef, true, [anchor]);
  const anyOn = CHART_LAYERS.some((layer) => settings.layers[layer]);
  return (
    <div
      className="playlist-shell__modal-overlay fin-chartset__veil"
      role="presentation"
      onMouseDown={(event) => {
        // A press on the veil (not in the dialog) closes it.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="playlist-shell__modal fin-chartset"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={anchor ? { position: "fixed", top: anchor.bottom + 8, left: anchor.left } : undefined}
      >
        <header className="playlist-shell__modal-header fin-chartset__header">
          <h2 id={titleId} className="fin-chartset__title">
            Ajustes del gráfico
          </h2>
          <button type="button" className="playlist-shell__modal-close" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="playlist-shell__modal-body fin-chartset__body">
          <p className="fin-chartset__intro">
            Elige qué más ves además de tu caja. Todo empieza apagado para que el gráfico se vea limpio.
          </p>
          <ul className="fin-chartset__list">
            <li className="fin-chartset__row" data-on="true">
              <span
                className="fin-chartset__always"
                aria-hidden="true"
                style={{ background: chartColorHex(settings.colors.cash) ?? "var(--chart-cash)" }}
              />
              <span className="fin-chartset__text">
                <span className="fin-chartset__name">Caja</span>
                <span className="fin-chartset__desc">
                  Tu dinero día a día; siempre se ve. Debajo de $0 se pinta en rojo.
                </span>
              </span>
              <Swatches colorKey="cash" label="Caja" disabled={false} />
            </li>
            {ROWS.map((row, index) => {
              const on = settings.layers[row.layer];
              const nameId = `${titleId}-${row.layer}`;
              return (
                <li key={row.layer} className="fin-chartset__row" data-on={on ? "true" : undefined}>
                  <button
                    ref={index === 0 ? firstRef : undefined}
                    type="button"
                    role="switch"
                    className="fin-switch"
                    aria-checked={on}
                    aria-labelledby={nameId}
                    aria-describedby={`${nameId}-desc`}
                    onClick={() => setChartLayer(row.layer, !on)}
                  >
                    <span className="fin-switch__knob" aria-hidden="true" />
                  </button>
                  <span className="fin-chartset__text">
                    <span id={nameId} className="fin-chartset__name">
                      {row.title}
                    </span>
                    <span id={`${nameId}-desc`} className="fin-chartset__desc">
                      {row.description}
                    </span>
                  </span>
                  {row.color ? <Swatches colorKey={row.color} label={row.title} disabled={!on} /> : null}
                </li>
              );
            })}
          </ul>
        </div>
        <footer className="fin-chartset__footer">
          <button
            type="button"
            className="fin-button"
            disabled={!anyOn}
            onClick={() => setChartSettings({ ...settings, layers: DEFAULT_CHART_SETTINGS.layers })}
          >
            Apagar todo
          </button>
          <button type="button" className="fin-button fin-button--primary" onClick={onClose}>
            Listo
          </button>
        </footer>
      </div>
    </div>
  );
}
