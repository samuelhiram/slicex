import React from "react";
import {
  PLAYLIST_TOOL_HOTKEYS,
  createPlaylistCore,
  createPlaylistInteractionController,
  createPlaylistRenderer,
  type PlaylistContextMenu,
  type PlaylistCore,
  type PlaylistCreateRequest,
  type PlaylistEditEvent,
  type PlaylistMarkerKind,
  type PlaylistMetrics,
  type PlaylistNudgeInfo,
  type PlaylistPendingClips,
  type PlaylistSnapMode,
  type PlaylistToolId,
  type ViewportNavigator,
} from "@slicex/canvas";
import {
  diffDays,
  type ActualRecord,
  type FinancialDocument,
  type FinancialItem,
  type FinancialItemKind,
} from "@slicex/core";
import { PlaylistInspector } from "./PlaylistInspector";
import type {
  FinancialBridgeApi,
  FinancialPlacement,
  PreviewEffect,
} from "../finance/bridge-api";
import { describeItem, FinancialBridge } from "../finance/financial-bridge";
import {
  applyRecCorrections,
  bootstrapPlan,
  recAssumed,
  recResultCash,
  type RecState,
} from "../finance/bootstrap";
import { formatDateShort, formatMoneyWhole, formatSignedMoneyWhole } from "../finance/format";
import { inOneUndoStep } from "../finance/undo-step";
import { Futures } from "../finance/futures";
import { loadPlan, savePlan } from "../finance/persistence";
import { parseStatement } from "../finance/statement";
import { CommandBar } from "../finance/components/CommandBar";
import { FuturesMenu, FuturesPeekChip } from "../finance/components/FuturesMenu";
import { OnboardingDialog, WelcomeBanner } from "../finance/components/Onboarding";
import { RecDialog } from "../finance/components/RecDialog";
import { StatementDialog } from "../finance/components/StatementDialog";
import { ValleyCard } from "../finance/components/ValleyCard";
import { NavControls, NavHelp } from "../finance/components/NavControls";
import { createFinancialPlaylistState } from "../finance/mapping";
import {
  displayRowLabel,
  isAutoRowLabel,
  KIND_COLORS,
  KIND_LABELS,
  KIND_ORDER,
  ROW_NAME_MANY,
  ROW_NAME_ONE,
} from "../finance/labels";
import {
  financeShellMetrics,
  shellDensityFor,
  shellLayoutStyle,
} from "../finance/shell-metrics";
import { createCalendarTimeAxis } from "../finance/time-axis";
import {
  FinancialSummaryBar,
  FutureStrip,
  NEW_ITEM_OPTIONS,
  type PlanMenuActions,
} from "../finance/components/FinancialSummaryBar";
import { PlayheadReadout } from "../finance/components/PlayheadReadout";
import { FinancialEditorModal } from "../finance/components/FinancialEditorModal";
import { FinancialSidePanel } from "../finance/components/FinancialSidePanel";
import { SlicexMantineProvider } from "../mantine";
import { useTheme } from "../theme";
import { AnnouncerProvider, type AnnounceFn } from "../ui/announcer";
import { useFitInViewport } from "../ui/fit-in-viewport";
import { focusIfPossible, useEscapeLayer, useOverlay } from "../ui/use-overlay";
import { useWheelScrollX } from "../ui/wheel-scroll-x";

// Playback speed of the financial timeline: 1 beat = 1 day.
const PLAYBACK_DAYS_PER_SECOND = 7;

// The canvas geometry (money lane + row heights) is picked once, from the
// window height, when the shell mounts (src/finance/shell-metrics.ts).
function initialShellDensity() {
  return shellDensityFor(
    typeof window === "undefined" ? Number.POSITIVE_INFINITY : window.innerHeight,
  );
}

const NAV_HINT_KEY = "slicex.navHint";

// UX-27: a banner button that removes itself (× / Entendido / Ver todo)
// leaves the focus on <body>. Once React has committed, send it to `get()`
// — only if it is still lost (the person may have moved on already).
function focusSoon(get: () => HTMLElement | null): void {
  if (typeof requestAnimationFrame !== "function") return;
  requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    focusIfPossible(get());
  });
}

/** The "Mi plan ▾" button, where the global actions of the banners live (UX-48). */
function planTriggerFocus(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".fin-plan__trigger");
}

function navHintSeen(): boolean {
  try {
    return globalThis.localStorage?.getItem(NAV_HINT_KEY) === "1";
  } catch {
    return true;
  }
}

// Financial item editor: edit an existing item (double-click on its clip)
// or create one from a draft ("+ Ingreso" & co.; added only on "Guardar").
type EditorState =
  | { mode: "edit"; id: string }
  | { mode: "create"; draft: FinancialItem; placement?: FinancialPlacement }
  | null;

// Local calendar date of the device ("today" for the projection). The only
// place that reads the clock: @slicex/core stays pure and receives dates.
function localTodayISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// The canvas draws its labels with Inter (shipped by the app). Pixi
// rasterises a Text once, so the renderer is created once the font is ready
// (local file: a few ms) — but never later than FONT_WAIT_MS. If the font
// arrives after that, `lateFont` resolves and the shell asks the renderer to
// re-rasterise its labels once (renderer.refreshFonts).
const FONT_WAIT_MS = 1200;

interface CanvasFontWait {
  // true = the font is ready; false = gave up waiting (fallback face).
  ready: Promise<boolean>;
  // Settles when the font load settles (loaded or failed).
  lateFont: Promise<void>;
}

function waitForCanvasFont(): CanvasFontWait {
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts || typeof fonts.load !== "function") {
    return { ready: Promise.resolve(true), lateFont: Promise.resolve() };
  }
  const loaded = Promise.all([
    fonts.load('500 12px "Inter Variable"'),
    fonts.load('600 12px "Inter Variable"'),
  ]).then(
    () => undefined,
    () => undefined,
  );
  const timeout = new Promise<boolean>((resolve) => {
    setTimeout(() => resolve(false), FONT_WAIT_MS);
  });
  return {
    ready: Promise.race([loaded.then(() => true), timeout]),
    lateFont: loaded,
  };
}

// Finance-native snap ("Imán", UX-17): 1 beat = 1 day, 1 bar = 7 days from
// the plan's first day (beatsPerBar 7), "axis" = the calendar axis' snap
// targets (the 1st and the 16th: where each quincena starts). Its words
// never repeat the visible-range selector's ("Semana", "Mes"…): this is
// where dates stick when dragged, not what you see.
const SNAP_OPTIONS: ReadonlyArray<{ value: PlaylistSnapMode; label: string }> =
  [
    { value: "beat", label: "Cada día" },
    { value: "bar", label: "Cada 7 días" },
    { value: "axis", label: "Quincenas (1 y 16)" },
    { value: "none", label: "Sin imán" },
  ];

const SNAP_VALUES: ReadonlySet<PlaylistSnapMode> = new Set(
  SNAP_OPTIONS.map((option) => option.value),
);

// Paint (B) and Slip (S) keep their hotkeys; they are just not offered in
// the toolbar (no clear financial meaning to advertise). UX-43: the names
// say what happens to the money; FL's letters stay as the keys.
const TOOL_BUTTONS: ReadonlyArray<{
  id: PlaylistToolId;
  label: string;
  // Tooltip: name, effect on the money, key.
  hint: string;
  // Pill on the canvas while the tool is on (UX-16).
  mode: string;
  icon: React.ReactNode;
}> = [
  {
    id: "select",
    label: "Seleccionar",
    hint: "Seleccionar (E): elige objetos; arrastrar uno cambia su fecha",
    mode: "",
    icon: <path d="M3.5 1.5v10l2.8-2.6 1.9 4.1 1.6-.7-1.9-4.1 3.8-.2z" fill="currentColor" stroke="none" />,
  },
  {
    id: "draw",
    label: "Dibujar",
    hint: "Dibujar (P): arrastra en un hueco para crear un movimiento (se agrega al guardar)",
    mode: "Dibujar · arrastra en un hueco para crear un movimiento",
    icon: <path d="M2.5 11.5 3 9l6.6-6.6 2 2L5 11zM8.4 3.6l2 2" />,
  },
  {
    id: "slice",
    label: "Dividir",
    hint: "Dividir (C): parte un objeto en dos el día que elijas, para cambiar el monto desde ahí (Shift: todos los de ese día)",
    mode: "Dividir · clic sobre un objeto lo parte ese día (Shift: todos)",
    icon: (
      <>
        <path d="M7 1.5v11" strokeDasharray="1.6 1.6" />
        <path d="M2 4.5h3.5v5H2zM8.5 4.5H12v5H8.5z" />
      </>
    ),
  },
  {
    id: "mute",
    label: "Excluir",
    hint: "Excluir (T): ¿y si no pasara? Lo saca de tus cifras sin borrarlo",
    mode: "Excluir · clic en un objeto lo saca de tus cifras (otro clic lo regresa)",
    icon: (
      <>
        <circle cx="7" cy="7" r="5" />
        <path d="M3.5 10.5l7-7" />
      </>
    ),
  },
  {
    id: "delete",
    label: "Borrar",
    hint: "Borrar (D): clic o trazo sobre objetos los elimina al soltar (puedes deshacer)",
    mode: "Borrar · clic o trazo sobre objetos los elimina al soltar",
    icon: <path d="M2.5 4h9M5.5 4V2.5h3V4M3.8 4l.6 8h5.2l.6-8" />,
  },
  {
    id: "zoom",
    label: "Zoom",
    hint: "Zoom (Z): clic acerca, clic derecho aleja",
    mode: "Zoom · clic acerca, clic derecho aleja",
    icon: (
      <>
        <circle cx="6" cy="6" r="3.8" />
        <path d="M8.8 8.8 12.5 12.5" />
      </>
    ),
  },
];

// UX-16: each tool has its own cursor — never `not-allowed` for an action
// that is allowed. Small outlined SVGs (dark ink, white halo) that read on
// both themes; a system cursor as fallback.
function svgCursor(body: string, x: number, y: number, fallback: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke-linecap='round' stroke-linejoin='round'><g stroke='white' stroke-width='4'>${body}</g><g stroke='%23111113' stroke-width='1.8'>${body}</g></svg>`;
  return `url("data:image/svg+xml;utf8,${svg}") ${x} ${y}, ${fallback}`;
}

const FINANCE_TOOL_CURSORS: Partial<Record<PlaylistToolId, string>> = {
  // A pencil whose tip is the hot spot.
  draw: svgCursor("<path d='M4 20l1-4L16 5l3 3L8 19z'/><path d='M14 7l3 3'/>", 4, 20, "crosshair"),
  // A cutting line with a blade: where the object will be split.
  slice: svgCursor("<path d='M12 2v20'/><path d='M7 7l5 5 5-5'/>", 12, 12, "col-resize"),
  // An eye crossed out: "out of your figures".
  mute: svgCursor(
    "<path d='M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z'/><path d='M4 20L20 4'/>",
    12,
    12,
    "pointer",
  ),
  // An eraser: what it touches goes.
  delete: svgCursor("<path d='M8 20h12'/><path d='M4 15l9-9 6 6-7 7H8z'/><path d='M9 10l6 6'/>", 4, 15, "pointer"),
  zoom: "zoom-in",
};

interface ToolbarProps {
  core: PlaylistCore | null;
}

interface MenuItemDef {
  label: string;
  hotkey?: string;
  onSelect: () => void;
  disabled?: boolean;
  divider?: boolean;
  // A choice among several (e.g. the row height): role menuitemradio.
  checked?: boolean;
  // A second, muted line under the label (the "Nuevo" kinds' examples).
  hint?: string;
  // A colour dot before the label (the kind's colour).
  swatch?: string;
  // Takes the focus when the menu opens (default: the first item).
  autoFocus?: boolean;
}

function pickColorThen(
  current: string,
  apply: (color: string) => void,
): void {
  if (typeof document === "undefined") return;
  const input = document.createElement("input");
  input.type = "color";
  input.value = current;
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.appendChild(input);
  input.addEventListener("change", () => {
    apply(input.value);
    input.remove();
  });
  input.addEventListener("blur", () => input.remove(), { once: true });
  input.click();
}

// What the context menus can ask of the shell (financial actions).
interface MenuActions {
  /**
   * Open the editor on a NEW item of `kind` dated `day`, to land on row
   * `trackIndex`; `duration` (days, from a drag) sets a repeating draft's end.
   */
  newItem(kind: FinancialItemKind, day: number, trackIndex: number, duration?: number | null): void;
  /** The kind already living on row `trackIndex` (what a new one most likely is). */
  rowKind(trackIndex: number): FinancialItemKind | null;
  /** Open the editor on an existing item (clip id = item id). */
  editItem(clipId: string): void;
  /** "Ver mi año sin esto": the what-if without it, until "Listo" / Esc. */
  peekWithout(clipId: string): void;
  /** Say what a menu just changed, with "Deshacer" (UX-26). */
  announceEdit(message: string): void;
}

const DIVIDER: MenuItemDef = { label: "", onSelect: () => {}, divider: true };

// UX-61: the same six kinds wherever something is created.
const NEW_KIND_LABELS: Readonly<Record<FinancialItemKind, string>> = {
  income: "Nuevo ingreso",
  expense: "Nuevo gasto",
  loan: "Nuevo préstamo",
  "credit-card": "Nueva tarjeta",
  "card-purchase": "Nueva compra con tarjeta",
  "installment-plan": "Nueva compra a MSI",
};

// Names of what was removed, for the notice: "Renta", "Renta y Gasto",
// "Renta, Gasto y 3 más".
export function namesForNotice(labels: readonly string[]): string {
  const names = labels.filter((label) => label.trim() !== "");
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} y ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} y ${names[2]}`;
  return `${names[0]}, ${names[1]} y ${names.length - 2} más`;
}

// Row heights offered by the row menu (UX-28: a choice, no drag needed).
function rowHeights(metrics: PlaylistMetrics): Array<{ label: string; height: number }> {
  const normal = metrics.trackHeight;
  return [
    { label: "Altura: compacta", height: Math.max(metrics.trackMinHeight, 44) },
    { label: "Altura: normal", height: normal },
    { label: "Altura: amplia", height: Math.min(metrics.trackMaxHeight, Math.round(normal * 1.6)) },
  ];
}

// Row menu. The engine's tracks are "líneas de evento" for the person
// (slots in English). Rows are permanent, like FL's playlist: they can be
// emptied, renamed, excluded or locked, moved, resized and new ones
// inserted, but never removed — the endless empty rows below are always
// there anyway. UX-28: moving a row and its height without dragging.
function buildTrackMenuItems(
  core: PlaylistCore,
  trackIndex: number,
  actions: MenuActions,
): MenuItemDef[] {
  const state = core.getState();
  const track = state.tracks[trackIndex];
  if (!track) return [];
  const trackId = track.id;
  const hasClips = state.clips.some((clip) => clip.trackId === trackId);
  const close = () => core.closeContextMenu();
  const day = Math.max(0, Math.floor(state.playPosition.time));
  const create = (kind: FinancialItemKind): MenuItemDef => ({
    label: `${NEW_KIND_LABELS[kind]} en esta línea…`,
    onSelect: () => {
      close();
      actions.newItem(kind, day, trackIndex);
    },
  });
  const lane = track.height ?? core.metrics.trackHeight;
  const heights = rowHeights(core.metrics);
  // The closest preset is the current one (a drag can leave any height).
  let current = 0;
  for (let i = 1; i < heights.length; i += 1) {
    if (Math.abs(heights[i]!.height - lane) < Math.abs(heights[current]!.height - lane)) current = i;
  }
  return [
    // UX-61: the most used here, and the six kinds one step away (the
    // empty-space menu of this row, at the marked day).
    create("income"),
    create("expense"),
    {
      label: "Otro tipo en esta línea…",
      onSelect: () => {
        const position = core.getState().contextMenu?.position ?? { x: 0, y: 0 };
        core.openBackgroundContextMenu(day, trackIndex, position);
      },
    },
    DIVIDER,
    {
      label: track.muted ? "Incluir la línea en tus cifras" : "Excluir la línea de tus cifras",
      onSelect: () => {
        core.toggleTrackMute(trackIndex);
        close();
      },
    },
    {
      label: track.soloed ? "Ver todas las líneas" : "Ver solo esta línea",
      onSelect: () => {
        core.toggleTrackSolo(trackIndex);
        close();
      },
    },
    {
      label: track.locked ? "Desbloquear línea de evento" : "Bloquear línea de evento",
      onSelect: () => {
        core.toggleTrackLock(trackIndex);
        close();
      },
    },
    DIVIDER,
    {
      label: "Subir línea",
      disabled: trackIndex === 0,
      onSelect: () => {
        core.reorderTrack(trackIndex, trackIndex - 1);
        close();
      },
    },
    {
      label: "Bajar línea",
      disabled: trackIndex >= state.tracks.length - 1,
      onSelect: () => {
        core.reorderTrack(trackIndex, trackIndex + 1);
        close();
      },
    },
    ...heights.map<MenuItemDef>((preset, index) => ({
      label: preset.label,
      checked: index === current,
      onSelect: () => {
        core.setTrackHeight(trackIndex, preset.height);
        close();
      },
    })),
    DIVIDER,
    {
      label: "Renombrar línea de evento…",
      onSelect: () => {
        const next = window.prompt(
          "Nombre de la línea de evento (vacío = el que dice lo que tiene)",
          isAutoRowLabel(track.label ?? "") ? "" : track.label,
        );
        if (next !== null) {
          // Empty, or the automatic name itself: back to automatic, so it
          // keeps following what the row holds.
          const name = next.trim();
          core.renameTrack(
            trackIndex,
            name === ROW_NAME_ONE || name === ROW_NAME_MANY ? "" : name,
          );
        }
        close();
      },
    },
    {
      label: "Color de la línea de evento…",
      onSelect: () => {
        pickColorThen(track.color ?? "#888888", (color) => core.recolorTrack(trackIndex, color));
        close();
      },
    },
    DIVIDER,
    {
      label: "Insertar línea de evento arriba",
      onSelect: () => {
        core.insertTrackBelow(trackIndex - 1);
        close();
      },
    },
    {
      label: "Insertar línea de evento abajo",
      onSelect: () => {
        core.insertTrackBelow(trackIndex);
        close();
      },
    },
    {
      label: "Vaciar línea de evento",
      disabled: !hasClips || track.locked === true,
      onSelect: () => {
        const labels = state.clips.filter((clip) => clip.trackId === trackId).map((clip) => clip.label);
        core.clearTrackClips(trackIndex);
        close();
        actions.announceEdit(
          `${labels.length === 1 ? "Borrado" : `Borrados ${labels.length}`}: ${namesForNotice(labels)}`,
        );
      },
    },
  ];
}

function buildClipMenuItems(
  core: PlaylistCore,
  clipId: string,
  actions: MenuActions,
): MenuItemDef[] {
  const state = core.getState();
  const clip = state.clips.find((c) => c.id === clipId);
  if (!clip) return [];
  const close = () => core.closeContextMenu();
  const row = state.tracks.findIndex((track) => track.id === clip.trackId);
  const moveTo = (target: number) => () => {
    core.setClipSelection([clip.id]);
    core.moveClips([{ id: clip.id, start: clip.start, trackIndex: target }]);
    close();
  };
  return [
    {
      label: "Editar…",
      hotkey: "Enter",
      onSelect: () => {
        close();
        actions.editItem(clip.id);
      },
    },
    {
      label: clip.muted ? "Incluir en tus cifras" : "Excluir de tus cifras",
      onSelect: () => {
        core.toggleClipMute(clip.id);
        close();
      },
    },
    {
      // UX-28: the "hold A" what-if without a key held (touch: long-press).
      label: "Ver mi año sin esto",
      hotkey: "Mantén A",
      disabled: clip.muted === true,
      onSelect: () => {
        close();
        actions.peekWithout(clip.id);
      },
    },
    DIVIDER,
    {
      label: "Mover a la línea de arriba",
      disabled: row <= 0,
      onSelect: moveTo(row - 1),
    },
    {
      label: "Mover a la línea de abajo",
      onSelect: moveTo(row + 1),
    },
    DIVIDER,
    {
      label: "Copiar",
      hotkey: "Ctrl+C",
      onSelect: () => {
        if (!state.selection.clipIds.includes(clip.id)) core.setClipSelection([clip.id]);
        core.copyToClipboard();
        close();
      },
    },
    {
      label: "Borrar",
      hotkey: "Supr",
      onSelect: () => {
        core.deleteClip(clip.id);
        close();
        if (!core.getState().clips.some((candidate) => candidate.id === clip.id)) {
          actions.announceEdit(`Borrado: ${clip.label}`);
        }
      },
    },
  ];
}

// Draft for the pencil on empty space: the kind of the selected item (the
// one FL's pencil would stamp), else of what already lives on that row
// ("Sueldo" -> income), else an expense; dated on that day. A drag also
// sets the end of a recurring draft.
function draftForRow(
  bridge: FinancialBridge,
  core: PlaylistCore,
  request: PlaylistCreateRequest,
): FinancialItem {
  const like = request.templateClipId ? bridge.getItem(request.templateClipId) : null;
  const kind = like?.kind ?? rowKindOf(bridge, core, request.trackIndex) ?? "expense";
  return draftAt(bridge, kind, request.start, request.duration);
}

// The kind of what already lives on row `trackIndex` ("Sueldo" -> income).
function rowKindOf(
  bridge: FinancialBridgeApi,
  core: PlaylistCore,
  trackIndex: number,
): FinancialItemKind | null {
  const state = core.getState();
  const rowId = state.tracks[trackIndex]?.id;
  const neighbour = rowId ? state.clips.find((clip) => clip.trackId === rowId) : undefined;
  return neighbour ? (bridge.getItem(neighbour.id)?.kind ?? null) : null;
}

// A draft of `kind` on day `start`; a drag's length (>= 2 days) sets the end
// of a repeating draft.
function draftAt(
  bridge: FinancialBridgeApi,
  kind: FinancialItemKind,
  start: number,
  duration: number | null | undefined,
): FinancialItem {
  const day = Math.max(0, Math.floor(start));
  const draft = bridge.createDraftItem(kind, day);
  if (
    duration !== null &&
    duration !== undefined &&
    duration >= 2 &&
    draft.recurrence.frequency !== "once"
  ) {
    const lastDay = day + Math.round(duration) - 1;
    return {
      ...draft,
      recurrence: { ...draft.recurrence, endDate: bridge.dateAtBeat(lastDay) },
    } as FinancialItem;
  }
  return draft;
}

const MARKER_KIND_OPTIONS: ReadonlyArray<{
  kind: PlaylistMarkerKind;
  label: string;
}> = [
  { kind: "label", label: "Etiqueta" },
  { kind: "start", label: "Inicio" },
  { kind: "loop", label: "Bucle" },
  { kind: "marker-loop", label: "Bucle de marcador" },
  { kind: "marker-skip", label: "Salto" },
  { kind: "marker-pause", label: "Pausa" },
  { kind: "time-signature", label: "Compás" },
  { kind: "rec-start", label: "Inicio de grabación" },
  { kind: "rec-stop", label: "Fin de grabación" },
];

function buildMarkerMenuItems(
  core: PlaylistCore,
  markerId: string,
): MenuItemDef[] {
  const marker = core.getState().markers.find((m) => m.id === markerId);
  if (!marker) return [];
  const close = () => core.closeContextMenu();
  return [
    {
      label: "Renombrar marcador…",
      onSelect: () => {
        const next = window.prompt("Nombre del marcador", marker.label ?? "");
        if (next != null) {
          core.updateMarker(marker.id, { label: next.trim() || undefined });
        }
        close();
      },
    },
    ...MARKER_KIND_OPTIONS.map<MenuItemDef>((option) => ({
      label: `${option.kind === marker.kind ? "✓ " : "   "}${option.label}`,
      onSelect: () => {
        core.updateMarker(marker.id, { kind: option.kind });
        close();
      },
    })),
    DIVIDER,
    {
      label: "Llevar el cursor aquí",
      onSelect: () => {
        core.setPlayPosition(marker.time);
        close();
      },
    },
    {
      label: "Borrar marcador",
      hotkey: "Supr",
      onSelect: () => {
        core.removeMarker(marker.id);
        close();
      },
    },
  ];
}

// Empty space (any row — the endless ones below included): new things
// land exactly there, on that day and that row. UX-61: the six kinds.
function buildBackgroundMenuItems(
  core: PlaylistCore,
  time: number,
  trackIndex: number,
  actions: MenuActions,
): MenuItemDef[] {
  const state = core.getState();
  const close = () => core.closeContextMenu();
  const hasClipboard = state.clipboard != null && state.clipboard.entries.length > 0;
  const day = Math.max(0, Math.floor(time));
  const create = (kind: FinancialItemKind): MenuItemDef => ({
    label: `${NEW_KIND_LABELS[kind]} aquí…`,
    onSelect: () => {
      close();
      actions.newItem(kind, day, trackIndex);
    },
  });
  return [
    ...KIND_ORDER.map(create),
    DIVIDER,
    {
      label: "Pegar aquí",
      hotkey: "Ctrl+V",
      disabled: !hasClipboard,
      onSelect: () => {
        core.pasteClipboard({ atTime: time, atTrackIndex: trackIndex });
        close();
      },
    },
    {
      label: "Seleccionar todo",
      hotkey: "Ctrl+A",
      onSelect: () => {
        core.selectAllClips();
        close();
      },
    },
    {
      label: "Deseleccionar",
      hotkey: "Ctrl+D",
      onSelect: () => {
        core.deselectAll();
        close();
      },
    },
  ];
}

// Click on empty space: "what goes here?" — the six kinds of "Nuevo" (same
// colour, name and example), on that day and that row (and the dragged
// range). The focus starts on the kind the row already holds.
function buildCreateMenuItems(
  core: PlaylistCore,
  menu: { time: number; duration: number | null; trackIndex: number },
  actions: MenuActions,
): MenuItemDef[] {
  const close = () => core.closeContextMenu();
  const day = Math.max(0, Math.floor(menu.time));
  const guess = actions.rowKind(menu.trackIndex);
  return NEW_ITEM_OPTIONS.map((option) => ({
    label: KIND_LABELS[option.kind],
    hint: option.hint,
    swatch: KIND_COLORS[option.kind],
    autoFocus: option.kind === guess,
    onSelect: () => {
      close();
      actions.newItem(option.kind, day, menu.trackIndex, menu.duration);
    },
  }));
}

// UX-57 / UX-27: an APG menu. Items are menuitems (separators apart), the
// first one takes the focus when the menu opens (mouse, long-press, Shift+
// F10 or the Menu key), ↑ ↓ Inicio Fin move, Enter / Espacio choose, Esc
// and Tab close it, and the focus goes back where it was (the canvas).
function PlaylistContextMenuOverlay({
  core,
  actions,
  fallbackFocus,
}: {
  core: PlaylistCore | null;
  actions: MenuActions;
  fallbackFocus: () => HTMLElement | null;
}) {
  const [menu, setMenu] = React.useState<PlaylistContextMenu>(null);
  // Opened at the pointer: near an edge it would hang off screen.
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  useFitInViewport(menuRef, menu !== null, [menu]);

  React.useEffect(() => {
    if (!core) {
      setMenu(null);
      return undefined;
    }
    setMenu(core.getState().contextMenu);
    const sub = core.subscribe((state) => setMenu(state.contextMenu));
    return () => sub.unsubscribe();
  }, [core]);

  const close = React.useCallback(() => core?.closeContextMenu(), [core]);
  useOverlay({
    open: menu !== null && core !== null,
    onClose: close,
    kind: "menu",
    containerRef: menuRef,
    fallbackFocus,
  });

  // Every (re)opened menu — e.g. "Otro tipo…" swapping the row menu for the
  // empty-space one — starts on its first enabled item.
  React.useEffect(() => {
    if (!menu) return;
    const first =
      itemRefs.current.find((item) => item && !item.disabled && item.dataset.autofocus === "true") ??
      itemRefs.current.find((item) => item && !item.disabled);
    first?.focus();
  }, [menu]);

  if (!menu || !core) return null;

  let items: MenuItemDef[] = [];
  if (menu.kind === "track") {
    items = buildTrackMenuItems(core, menu.trackIndex, actions);
  } else if (menu.kind === "clip") {
    items = buildClipMenuItems(core, menu.clipId, actions);
  } else if (menu.kind === "background") {
    items = buildBackgroundMenuItems(core, menu.time, menu.trackIndex, actions);
  } else if (menu.kind === "create") {
    items = buildCreateMenuItems(core, menu, actions);
  } else if (menu.kind === "marker") {
    items = buildMarkerMenuItems(core, menu.markerId);
  }
  itemRefs.current.length = items.length;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const enabled = itemRefs.current.filter(
      (item): item is HTMLButtonElement => item !== null && !item.disabled,
    );
    if (enabled.length === 0) return;
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === "ArrowDown") next = index < 0 ? 0 : (index + 1) % enabled.length;
    else if (event.key === "ArrowUp") next = index <= 0 ? enabled.length - 1 : index - 1;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = enabled.length - 1;
    else if (event.key === "Tab") {
      // APG: Tab leaves the menu (closed); the focus goes back to the canvas.
      event.preventDefault();
      close();
      return;
    }
    if (next !== null) {
      event.preventDefault();
      enabled[next]!.focus();
    }
  };

  const creating = menu.kind === "create";
  const createTitle = creating ? "Nuevo · " + core.formatTime(menu.time) : null;
  const label = creating
    ? "Nuevo objeto el " + core.formatTime(menu.time)
    : menu.kind === "clip"
      ? "Menú del objeto"
      : menu.kind === "track"
        ? "Menú de la línea de evento"
        : menu.kind === "marker"
          ? "Menú del marcador"
          : "Menú del espacio vacío";
  // A left click opens it beside the pointer, not under it: the second
  // press of a double-click lands on the canvas, not on the first item.
  const offset = creating ? 8 : 0;

  return (
    <div
      ref={menuRef}
      className={creating ? "playlist-shell__menu playlist-shell__menu--create" : "playlist-shell__menu"}
      style={{ left: menu.position.x + offset, top: menu.position.y + offset }}
      role="menu"
      aria-label={label}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={onKeyDown}
    >
      {createTitle ? (
        <div className="playlist-shell__menu-title" aria-hidden="true">
          {createTitle}
        </div>
      ) : null}
      {items.map((item, idx) =>
        item.divider ? (
          <div key={`${menu.kind}-${idx}`} className="playlist-shell__menu-divider" role="separator" />
        ) : (
          <button
            key={`${menu.kind}-${idx}`}
            ref={(element) => {
              itemRefs.current[idx] = element;
            }}
            type="button"
            className="playlist-shell__menu-item"
            role={item.checked === undefined ? "menuitem" : "menuitemradio"}
            aria-checked={item.checked === undefined ? undefined : item.checked}
            tabIndex={-1}
            onClick={item.onSelect}
            disabled={item.disabled === true}
            data-autofocus={item.autoFocus ? "true" : undefined}
          >
            {item.swatch ? (
              <span
                className="playlist-shell__menu-swatch"
                style={{ background: item.swatch }}
                aria-hidden="true"
              />
            ) : null}
            <span className="playlist-shell__menu-label">
              {item.checked ? <span aria-hidden="true">✓ </span> : null}
              {item.label}
              {item.hint ? <span className="playlist-shell__menu-hint">{item.hint}</span> : null}
            </span>
            {item.hotkey ? (
              <span className="playlist-shell__menu-hotkey" aria-hidden="true">
                {item.hotkey}
              </span>
            ) : null}
          </button>
        ),
      )}
    </div>
  );
}

// UX-16 / UX-43 / UX-57: the tools are ONE tab stop (roving tabindex:
// ← → ↑ ↓ Inicio Fin move between them, Enter / Espacio pick one). The
// active tool reads at ≥ 3:1 and shows its name; each button's title says
// what it does to the money and its key.
function PlaylistToolbar({ core }: ToolbarProps) {
  const [active, setActive] = React.useState<PlaylistToolId>("select");
  const [snapMode, setSnapMode] = React.useState<PlaylistSnapMode>("beat");
  const [clipCount, setClipCount] = React.useState(0);
  const [selectedCount, setSelectedCount] = React.useState(0);
  const buttonsRef = React.useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(
    0,
    TOOL_BUTTONS.findIndex((button) => button.id === active),
  );
  // The tab stop follows the active tool, and the arrows move it.
  const [stop, setStop] = React.useState(activeIndex);
  React.useEffect(() => setStop(activeIndex), [activeIndex]);

  React.useEffect(() => {
    if (!core) {
      return undefined;
    }
    const s0 = core.getState();
    setActive(s0.tool);
    setSnapMode(s0.snap.mode);
    setClipCount(s0.clips.length);
    setSelectedCount(s0.selection.clipIds.length);
    const sub = core.subscribe((state) => {
      // Primitives only: React bails out (Object.is) on every notify that
      // does not change them — hover, play tick, viewport (canon §2.6).
      setActive(state.tool);
      setSnapMode(state.snap.mode);
      setClipCount(state.clips.length);
      setSelectedCount(state.selection.clipIds.length);
    });
    return () => sub.unsubscribe();
  }, [core]);

  const onToolsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const count = TOOL_BUTTONS.length;
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (stop + 1) % count;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (stop - 1 + count) % count;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = count - 1;
    if (next === null) return;
    event.preventDefault();
    setStop(next);
    buttonsRef.current[next]?.focus();
  };

  return (
    <div className="playlist-shell__toolbar">
      <div
        className="playlist-shell__segmented"
        role="toolbar"
        aria-label="Herramientas"
        onKeyDown={onToolsKeyDown}
      >
      {TOOL_BUTTONS.map((button, index) => {
        const hotkey = PLAYLIST_TOOL_HOTKEYS[button.id];
        const isActive = active === button.id;
        return (
          <button
            key={button.id}
            ref={(element) => {
              buttonsRef.current[index] = element;
            }}
            type="button"
            className="playlist-shell__tool"
            data-active={isActive ? "true" : "false"}
            data-tool={button.id}
            aria-pressed={isActive}
            aria-label={button.label}
            aria-keyshortcuts={hotkey}
            title={button.hint}
            tabIndex={index === stop ? 0 : -1}
            onFocus={() => setStop(index)}
            onClick={() => core?.setTool(button.id)}
          >
            <svg
              className="playlist-shell__tool-icon"
              viewBox="0 0 14 14"
              aria-hidden="true"
            >
              {button.icon}
            </svg>
            <span className="playlist-shell__tool-label">{button.label}</span>
            <span className="playlist-shell__tool-hotkey" aria-hidden="true">
              {hotkey}
            </span>
          </button>
        );
      })}
      </div>
      <label
        className="playlist-shell__snap"
        title="Imán: a qué se pegan las fechas cuando arrastras (Retroceso lo quita o lo pone)"
      >
        {/* UX-17: a visible name at every width, and a magnet. */}
        <span className="playlist-shell__snap-label">Imán</span>
        <span className="playlist-shell__snap-field">
          <svg className="playlist-shell__snap-icon" viewBox="0 0 14 14" aria-hidden="true">
            <path d="M3 2.2v4.6a4 4 0 0 0 8 0V2.2" />
            <path d="M3 2.2h2.4v4.6M8.6 6.8V2.2H11" />
            <path d="M3 4.4h2.4M8.6 4.4H11" />
          </svg>
          <select
            value={snapMode}
            onChange={(event) =>
              core?.setSnapMode(event.target.value as PlaylistSnapMode)
            }
            className="playlist-shell__snap-select"
          >
            {SNAP_VALUES.has(snapMode) ? null : (
              // A mode set elsewhere (e.g. a keyboard shortcut) that the
              // finance toolbar does not offer: shown, not selectable.
              <option value={snapMode} disabled>
                Otro
              </option>
            )}
            {SNAP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </span>
      </label>
      {/* Only a multi-selection is worth a chip (how many will move). */}
      {selectedCount > 1 ? (
        <div
          className="playlist-shell__counter"
          role="status"
          aria-label="Selección"
          title={`${selectedCount} de ${clipCount} objetos seleccionados`}
          data-has-selection="true"
        >
          <span className="playlist-shell__counter-selected">
            {selectedCount} seleccionados
          </span>
        </div>
      ) : null}
    </div>
  );
}

// UX-16: while a tool other than Select is on, the canvas says so — what a
// click does and how to leave — outside the toolbar ("Borrar · clic … ·
// Esc para salir"). UX-45: the first time something is selected, the same
// place teaches the gestures that change money (once, remembered).
const SELECT_HINT_KEY = "slicex.selectHint";

function selectHintSeen(): boolean {
  try {
    return globalThis.localStorage?.getItem(SELECT_HINT_KEY) === "1";
  } catch {
    return true;
  }
}

function ToolModePill({ core }: { core: PlaylistCore | null }) {
  const [tool, setTool] = React.useState<PlaylistToolId>("select");
  const [selected, setSelected] = React.useState(false);
  const [hint, setHint] = React.useState<"pending" | "show" | "done">(() =>
    selectHintSeen() ? "done" : "pending",
  );
  React.useEffect(() => {
    if (!core) return undefined;
    const sync = () => {
      const state = core.getState();
      setTool(state.tool);
      setSelected(state.selection.clipIds.length > 0);
    };
    sync();
    const sub = core.subscribe(sync);
    return () => sub.unsubscribe();
  }, [core]);
  React.useEffect(() => {
    if (hint === "pending" && selected && tool === "select") setHint("show");
  }, [hint, selected, tool]);
  const dismissHint = () => {
    setHint("done");
    try {
      globalThis.localStorage?.setItem(SELECT_HINT_KEY, "1");
    } catch {
      // private mode: shown again next time
    }
  };
  const button = TOOL_BUTTONS.find((candidate) => candidate.id === tool);
  const mode = tool === "select" ? "" : button?.mode || `${tool}`;
  if (mode) {
    return (
      <div className="fin-mode" role="status" data-tool={tool}>
        <span className="fin-mode__text">
          <strong>{mode.split(" · ")[0]}</strong>
          {mode.includes(" · ") ? ` · ${mode.split(" · ").slice(1).join(" · ")}` : ""} · Esc para salir
        </span>
        <button type="button" className="fin-mode__exit" onClick={() => core?.setTool("select")}>
          Salir
        </button>
      </div>
    );
  }
  if (hint === "show") {
    return (
      <div className="fin-mode fin-mode--hint" role="status">
        <span className="fin-mode__text">
          <strong>Con un objeto:</strong> arrastra para cambiar su fecha · su borde derecho cambia
          cuándo termina · la barrita de arriba, el monto · doble clic o Enter lo abre · Supr lo
          borra
        </span>
        <button type="button" className="fin-mode__exit" onClick={dismissHint}>
          Entendido
        </button>
      </div>
    );
  }
  return null;
}

// --- canvas commits in words (UX-26 / UX-09 / UX-38 / UX-04) ---------------

function lineOf(core: PlaylistCore, clipId: string): number {
  const state = core.getState();
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  return clip ? state.tracks.findIndex((track) => track.id === clip.trackId) : -1;
}

// "Partir Sueldo el 23 dic: desde ahí puedes cambiar el monto".
function describeSliceGuide(
  core: PlaylistCore | null,
  clipIds: readonly string[],
  time: number,
  bridge: FinancialBridge,
): string | null {
  const day = formatDateShort(bridge.dateAtBeat(time));
  if (clipIds.length === 0) return `${day} · pasa sobre un objeto para dividirlo`;
  if (clipIds.length > 1) return `Partir ${clipIds.length} objetos el ${day}`;
  const clip = core?.getState().clips.find((candidate) => candidate.id === clipIds[0]);
  const name = clip?.label ?? "el objeto";
  return `Partir ${name} el ${day}: desde ahí puedes cambiar el monto`;
}

function describeCanvasEdit(event: PlaylistEditEvent, bridge: FinancialBridge): string | null {
  const names = namesForNotice(event.labels);
  switch (event.kind) {
    case "delete": {
      const count = event.clipIds.length;
      if (count === 0) return null;
      const head = count === 1 ? "Borrado" : `Borrados ${count}`;
      return names ? `${head}: ${names}` : head;
    }
    case "slice": {
      const day = formatDateShort(bridge.dateAtBeat(event.time));
      return event.clipIds.length === 1
        ? `Dividido: ${names} el ${day}. Desde ahí puedes cambiar el monto`
        : `Divididos ${event.clipIds.length} el ${day}: ${names}`;
    }
    case "nudge": {
      const from = formatDateShort(bridge.dateAtBeat(event.fromStart));
      const to = formatDateShort(bridge.dateAtBeat(event.toStart));
      const where =
        event.deltaTracks === 0
          ? ""
          : ` · ${Math.abs(event.deltaTracks)} ${Math.abs(event.deltaTracks) === 1 ? "línea" : "líneas"} ${
              event.deltaTracks > 0 ? "abajo" : "arriba"
            }`;
      const what = event.clipIds.length > 1 ? `${event.clipIds.length} objetos` : names;
      return from === to ? `Movido: ${what}${where}` : `Movido: ${what}, ${from} → ${to}${where}`;
    }
  }
}

function describeNudgeMove(info: PlaylistNudgeInfo, bridge: FinancialBridge): string {
  const from = formatDateShort(bridge.dateAtBeat(info.fromStart));
  const to = formatDateShort(bridge.dateAtBeat(info.toStart));
  const where =
    info.deltaTracks === 0
      ? ""
      : ` · ${Math.abs(info.deltaTracks)} ${Math.abs(info.deltaTracks) === 1 ? "línea" : "líneas"} ${
          info.deltaTracks > 0 ? "abajo" : "arriba"
        }`;
  return `${info.label}: ${from} → ${to}${where}`;
}

// "Renta · −$8,000 /mes · 1 dic · línea 2".
function describeFocusedClip(
  core: PlaylistCore | null,
  clipId: string,
  bridge: FinancialBridge,
): string {
  const clip = core?.getState().clips.find((candidate) => candidate.id === clipId);
  const item = bridge.getItem(clipId);
  if (!core || !clip || !item) return clip?.label ?? "";
  const parts = [
    item.name,
    describeItem(item, bridge.getDocument()),
    formatDateShort(bridge.dateAtBeat(clip.start)),
    `línea ${lineOf(core, clipId) + 1}`,
  ];
  if (item.enabled === false) parts.push("excluido de tus cifras");
  return parts.join(" · ");
}

export function PlaylistShell() {
  const hostRef = React.useRef<HTMLDivElement | null>(null);
  // Fixed for the life of the playlist (the core's metrics are). The DOM
  // overlays (side rail, inspector, readout) align to the same numbers
  // through CSS variables, so they open BELOW the ruler + money lane. Both
  // objects keep their identity: React never re-applies the style.
  const [density] = React.useState(initialShellDensity);
  const metrics = React.useMemo<PlaylistMetrics>(() => financeShellMetrics(density), [density]);
  const layoutStyle = React.useMemo(() => shellLayoutStyle(metrics), [metrics]);
  // The tool bar scrolls sideways when it can't fit: the wheel moves it.
  const toolBarRef = useWheelScrollX();
  // Light / dark: the DOM follows the CSS tokens; the canvas palette is
  // switched through the renderer (created later, inside the init frame).
  const { theme, toggle: toggleTheme } = useTheme();
  const themeRef = React.useRef(theme);
  themeRef.current = theme;
  const rendererRef = React.useRef<ReturnType<
    typeof createPlaylistRenderer
  > | null>(null);
  const [core, setCore] = React.useState<PlaylistCore | null>(null);
  const [bridge, setBridge] = React.useState<FinancialBridgeApi | null>(null);
  const [futures, setFutures] = React.useState<Futures | null>(null);
  const [navigator, setNavigator] = React.useState<ViewportNavigator | null>(null);
  const [navHint, setNavHint] = React.useState<"hint" | "help" | null>(() =>
    navHintSeen() ? null : "hint",
  );
  const dismissNavHint = React.useCallback(() => {
    setNavHint(null);
    try {
      globalThis.localStorage?.setItem(NAV_HINT_KEY, "1");
    } catch {
      // private mode: the hint just shows again next time
    }
  }, []);
  const [error, setError] = React.useState<string | null>(null);
  // Double-click on a clip surfaces a "playlist-clip-open" CustomEvent from
  // the controller; the shell opens the financial editor for that item
  // (item.id === clip.id). "Nuevo" opens it on a draft.
  const [editor, setEditor] = React.useState<EditorState>(null);
  const closeEditor = React.useCallback(() => setEditor(null), []);
  const openDraft = React.useCallback(
    (draft: FinancialItem) => setEditor({ mode: "create", draft }),
    [],
  );
  // Right-click menus: "Nuevo … aquí" lands on that day and that row.
  const menuActions = React.useMemo<MenuActions>(
    () => ({
      newItem: (kind, day, trackIndex, duration) => {
        if (!bridge) return;
        setEditor({
          mode: "create",
          draft: draftAt(bridge, kind, day, duration),
          placement: { trackIndex },
        });
      },
      rowKind: (trackIndex) => (bridge ? rowKindOf(bridge, bridge.core, trackIndex) : null),
      editItem: (clipId) => {
        if (bridge?.getItem(clipId)) setEditor({ mode: "edit", id: clipId });
      },
      // Set once the peeks exist (below): "Ver mi año sin esto".
      peekWithout: (clipId) => menuPeekRef.current(clipId),
      announceEdit: (message) => {
        const playlist = bridge?.core;
        announceRef.current?.({ message, undo: playlist ? () => playlist.undo() : undefined });
      },
    }),
    [bridge],
  );
  const menuPeekRef = React.useRef<(clipId: string) => void>(() => {});
  // Where focus goes back when the editor closes and its opener is gone.
  const getHost = React.useCallback(() => hostRef.current, []);
  // UX-04: the canvas says which object the keyboard focus is on (Alt+←/→),
  // and the day's reading is read after a keyboard move of the day.
  const [focusText, setFocusText] = React.useState("");
  const keyIntentRef = React.useRef(Number.NEGATIVE_INFINITY);
  // Was a menu open when the current press started? Such a press only
  // closes it (useDismiss closes it first, in the same capture phase, so
  // this listener — registered at mount, before any menu's — looks first).
  const pressClosedMenuRef = React.useRef(false);
  React.useEffect(() => {
    const onPress = () => {
      pressClosedMenuRef.current = document.querySelector('[role="menu"]') !== null;
    };
    window.addEventListener("pointerdown", onPress, true);
    return () => window.removeEventListener("pointerdown", onPress, true);
  }, []);
  // UX-09 / UX-16: what a delete / slice gesture will touch, highlighted
  // by the renderer while it lasts (getClipHighlight, O(1)).
  const pendingRef = React.useRef<PlaylistPendingClips | null>(null);
  // `announce` for the shell's own handlers (it sits above the provider;
  // components below use `useAnnounce()`): announceRef.current?.({ message }).
  const announceRef = React.useRef<AnnounceFn | null>(null);

  // Waves 2–4.
  const [today] = React.useState(localTodayISO);
  const [hoverDay, setHoverDay] = React.useState<number | null>(null);
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [peek, setPeek] = React.useState<{
    label: string;
    effect: PreviewEffect | null;
    /** What holds it: "q" / "a" (keys) or "button" ("Asomarte"). */
    holder?: string;
  } | null>(null);
  const [onboarding, setOnboarding] = React.useState<"banner" | "dialog" | null>(null);
  const [rec, setRec] = React.useState<RecState | null>(null);
  const [recOpen, setRecOpen] = React.useState(false);
  // UX-49: the Rec banner's × is "Después" (hides it; Rec stays pending).
  const [recBanner, setRecBanner] = React.useState(true);
  const recReviewRef = React.useRef<HTMLButtonElement | null>(null);
  // UX-47: where the open analysis rail renders (beside the stage).
  const [sideSlot, setSideSlot] = React.useState<HTMLDivElement | null>(null);
  // `returnTo`: the card editor it was opened from, reopened on close (UX-51).
  const [statement, setStatement] = React.useState<{
    cardId: string;
    text: string;
    returnTo?: string;
  } | null>(null);

  React.useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return undefined;
    }

    // React 18 StrictMode mounts → unmounts → remounts synchronously in
    // dev. Pixi v8 has process-global state (BatcherPipe / TexturePool /
    // GraphicsContextSystem) that gets corrupted when a half-initialised
    // Application is torn down, surfacing in the *next* mount as null
    // geometry or undefined TexturePool entries. Defer creation by one
    // animation frame so the first short-lived mount never builds a Pixi
    // Application at all — the cleanup just cancels the pending init.
    let cancelled = false;
    let instance: PlaylistCore | null = null;
    let interaction: ReturnType<
      typeof createPlaylistInteractionController
    > | null = null;
    let renderer: ReturnType<typeof createPlaylistRenderer> | null = null;
    let financial: FinancialBridge | null = null;
    let unsubscribeBridge: (() => void) | null = null;
    let unsubscribeFutures: (() => void) | null = null;
    let unsubscribeLayout: (() => void) | null = null;
    let tickId = 0;
    let lastFrame = performance.now();
    let pumpId = 0;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;

    let unsubscribeTransport: (() => void) | null = null;

    const initId = requestAnimationFrame(() => {
      if (cancelled) return;
      const font = waitForCanvasFont();
      void font.ready.then((fontReady) => {
        build();
        if (!fontReady) {
          void font.lateFont.then(() => {
            if (!cancelled) rendererRef.current?.refreshFonts();
          });
        }
      });
    });

    function build(): void {
      if (cancelled || !host) return;
      const plan = bootstrapPlan(today, loadPlan());
      const doc = plan.doc;
      instance = createPlaylistCore(createFinancialPlaylistState(doc, plan.layout), {
        metrics,
        timeAxis: createCalendarTimeAxis(doc.startDate),
        // Financial clips have no time-stretch meaning: a stretch would
        // rescale the schedule phase and shift every payday.
        stretchEnabled: false,
        // Tracks are endless (FL): empty rows always wait below the items
        // to draw, paste or drop on; rows are never removed by themselves.
      });
      const bridgeInstance = new FinancialBridge(instance, doc);
      financial = bridgeInstance;
      const futuresInstance = new Futures(bridgeInstance, plan.saved);
      setCore(instance);
      setBridge(bridgeInstance);
      setFutures(futuresInstance);
      if (plan.firstVisit) setOnboarding("banner");
      if (plan.rec) setRec(plan.rec);
      interaction = createPlaylistInteractionController(host, instance, {
        // Amount by hand: drag the grip on a clip's top edge (one undo
        // entry); Shift = a finer step. UX-39: only from the visible grip,
        // and a mostly horizontal drag moves the clip instead (axis lock).
        onClipLevelDrag: ({ clipId, phase, deltaY, fine }) =>
          bridgeInstance.levelDrag(clipId, phase, deltaY, fine),
        clipLevelGrip: true,
        // UX-09 / UX-16 / UX-38 / UX-42 / UX-25: what the host's gestures mean.
        // Dividir cuts the clip under the pointer (or the selection), Shift
        // all of that day; Borrar marks and deletes on release; each
        // destructive commit is announced with "Deshacer".
        sliceScope: "target",
        describeSlice: (clipIds, time) => describeSliceGuide(instance, clipIds, time, bridgeInstance),
        deferDelete: true,
        onPendingChange: (pending) => {
          pendingRef.current = pending;
          rendererRef.current?.invalidate();
        },
        onEdit: (event) => {
          const message = describeCanvasEdit(event, bridgeInstance);
          if (message && instance) {
            const playlist = instance;
            announceRef.current?.({ message, undo: () => playlist.undo() });
          }
        },
        escapeSelectsTool: true,
        toolCursors: FINANCE_TOOL_CURSORS,
        nudgeFeedbackMs: 1500,
        describeNudge: (info) => describeNudgeMove(info, bridgeInstance),
        hoverCardDelayMs: 350,
        trackButtonHints: {
          mute: ["Excluir de tus cifras (la línea sigue ahí)", "Incluir en tus cifras"],
          solo: ["Ver solo esta línea en tus cifras", "Ver todas las líneas"],
          lock: ["Bloquear: nada en la línea se mueve", "Desbloquear"],
          reorder: "Arrastra para subir o bajar la línea (o usa su menú)",
        },
        trackButtonSlop: 4,
        onClipFocus: (clipId) => setFocusText(describeFocusedClip(instance, clipId, bridgeInstance)),
        // Length by hand: the selected item's grabber, at the centre of the
        // screen, moves its end (goal-seek for debts that end at payoff).
        clipExtend: (clipId) => bridgeInstance.canExtend(clipId),
        // Zoomed in it never gets slower than ~a day per 3 px (a month per 100 px).
        clipExtendMinBeatsPerPx: 1 / 3,
        // Valleys explain themselves under the pointer.
        onOverviewHover: (beat) => setHoverDay(beat),
        // A faint line follows the pointer over the timeline and the ruler
        // names that day (it replaces the time tooltip over the curve).
        hoverTimeIndicator: true,
        // The mouse wheel scrolls the rows, like any document; Shift (or
        // the wheel over the ruler / money lane) moves time.
        mouseWheel: "rows",
        // Nothing is added by the canvas itself (the pencil used to stamp
        // an unnamed $500 "Gasto"): a click on empty space — any tool that
        // creates — asks "what goes here?" at that spot (the six kinds; a
        // ghost marks the day and row), a drag asks for that range, and a
        // double-click opens the editor at once on the kind the row holds.
        // Nothing is added until "Guardar".
        clickToCreate: true,
        onCreateRequest: (request) => {
          if (!instance) return;
          const closedMenu = pressClosedMenuRef.current;
          pressClosedMenuRef.current = false;
          if (request.clickCount === 2 || !request.point) {
            instance.closeContextMenu();
            setEditor({
              mode: "create",
              draft: draftForRow(bridgeInstance, instance, request),
              placement: { trackIndex: request.trackIndex },
            });
            return;
          }
          // The press that closed a menu only closes it.
          if (closedMenu) return;
          instance.openCreateMenu({
            time: request.start,
            duration: request.duration,
            trackIndex: request.trackIndex,
            lane: request.lane,
            position: request.point,
          });
        },
      });
      setNavigator(interaction.navigator ?? null);
      renderer = createPlaylistRenderer(host, instance, {
        theme: themeRef.current,
        clipLevelHandles: true,
        // UX-39: the amount grip is a fixed target (where the hit-test is).
        clipLevelGrip: true,
        clipExtend: (clipId) => bridgeInstance.canExtend(clipId),
        onError: (reason) => {
          setError(reason instanceof Error ? reason.message : "Renderer failed.");
        },
        // Render-loop providers: O(1) cached lookups on the bridge that
        // return the SAME object while unchanged (canon: provider contract).
        getClipDetail: (clipId) => bridgeInstance.getClipDetail(clipId),
        getClipSparkline: (clipId) => bridgeInstance.getClipSparkline(clipId),
        getClipContent: (clipId) => bridgeInstance.getClipContent(clipId),
        getOverviewData: () => bridgeInstance.getOverviewData(),
        getDragAnnotation: () => bridgeInstance.getDragAnnotation(),
        getTrackMeta: (trackId) => bridgeInstance.getTrackMeta(trackId),
        // The engine names empty rows "Track N"; for the person they are
        // "Línea de evento N".
        formatTrackLabel: displayRowLabel,
        // What a delete / slice gesture will touch (red / warm ring), else
        // the valley causes. O(1): a Set lookup.
        getClipHighlight: (clipId) => {
          const pending = pendingRef.current;
          if (pending && pending.clipIds.has(clipId)) return pending.kind === "delete" ? "danger" : true;
          return bridgeInstance.isHighlighted(clipId);
        },
        // The cash that day + that day's movements under every date tooltip.
        getTooltipDetail: (beat) => bridgeInstance.getDayDetail(beat),
        // UX-25: the info card of a hovered / tapped clip.
        getClipInfo: (clipId) => bridgeInstance.getClipInfo(clipId),
        // UX-09: no FL slip / stretch badges ("↻42") on financial clips.
        clipBadges: false,
      });
      // Provider data (clip detail / content, the money lane, track meta)
      // comes from the bridge, which can change with no core notify (e.g.
      // only an amount edited in the editor). The bridge notifies only on
      // real data changes, never per frame, and invalidate() just schedules
      // the renderer's coalesced rAF frame. While the lane morphs between
      // futures (~320 ms) a short rAF pump repaints it; it stops by itself.
      const rendererInstance = renderer;
      rendererRef.current = rendererInstance;
      const pump = () => {
        pumpId = 0;
        if (cancelled) return;
        rendererInstance.invalidate();
        if (bridgeInstance.isAnimating()) pumpId = requestAnimationFrame(pump);
      };
      // Autosave (debounced) on real changes of the plan or its futures.
      let savedRevision = bridgeInstance.getRevision();
      const scheduleSave = () => {
        if (saveTimer !== null) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
          saveTimer = null;
          if (!cancelled) savePlan(futuresInstance.toSaved());
        }, 600);
      };
      unsubscribeBridge = bridgeInstance.subscribe(() => {
        rendererInstance.invalidate();
        if (bridgeInstance.isAnimating() && pumpId === 0) {
          pumpId = requestAnimationFrame(pump);
        }
        const revision = bridgeInstance.getRevision();
        if (revision !== savedRevision) {
          savedRevision = revision;
          scheduleSave();
        }
      });
      unsubscribeFutures = futuresInstance.subscribe(scheduleSave);
      // Rows are part of the plan too (a renamed / added / emptied track,
      // an item moved to another row): reference checks only, O(1).
      let lastTracks = instance.getState().tracks;
      let lastClips = instance.getState().clips;
      const layoutSub = instance.subscribe((state) => {
        if (state.tracks === lastTracks && state.clips === lastClips) return;
        lastTracks = state.tracks;
        lastClips = state.clips;
        scheduleSave();
      });
      unsubscribeLayout = () => layoutSub.unsubscribe();
      // A rolled-forward plan is today's plan: persist it right away.
      if (plan.rec) savePlan(futuresInstance.toSaved());

      // Canon §3.5 + §3.10: only run the play-position rAF when playback
      // is actually engaged. While paused there's no animation to advance,
      // so cycling the rAF wastes a callback per frame even with the
      // idempotent dispatch short-circuit.
      const tick = (now: number) => {
        if (!instance || cancelled) return;
        const deltaSeconds = Math.min(0.05, (now - lastFrame) / 1000);
        lastFrame = now;
        instance.advancePlayPosition(deltaSeconds * PLAYBACK_DAYS_PER_SECOND);
        tickId = requestAnimationFrame(tick);
      };
      const startTick = () => {
        if (tickId !== 0 || cancelled) return;
        lastFrame = performance.now();
        tickId = requestAnimationFrame(tick);
      };
      const stopTick = () => {
        if (tickId === 0) return;
        cancelAnimationFrame(tickId);
        tickId = 0;
      };

      let isRunning = instance.getState().playPosition.isRunning;
      if (isRunning) startTick();
      const sub = instance.subscribe((state) => {
        const nextRunning = state.playPosition.isRunning;
        if (nextRunning === isRunning) return;
        isRunning = nextRunning;
        if (nextRunning) startTick();
        else stopTick();
      });
      unsubscribeTransport = () => {
        sub.unsubscribe();
        stopTick();
      };
    }

    const handleClipOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ clipId: string }>).detail;
      if (detail?.clipId) {
        setEditor({ mode: "edit", id: detail.clipId });
      }
    };
    host.addEventListener("playlist-clip-open", handleClipOpen);

    return () => {
      cancelled = true;
      cancelAnimationFrame(initId);
      if (pumpId !== 0) cancelAnimationFrame(pumpId);
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      unsubscribeTransport?.();
      unsubscribeBridge?.();
      unsubscribeFutures?.();
      unsubscribeLayout?.();
      interaction?.destroy();
      rendererRef.current = null;
      renderer?.destroy();
      financial?.destroy();
      host.removeEventListener("playlist-clip-open", handleClipOpen);
      setCore(null);
      setBridge(null);
      setFutures(null);
      setNavigator(null);
    };
  }, [today, metrics]);

  // Theme switch: one repaint of the cached canvas layers (never per frame).
  React.useEffect(() => {
    rendererRef.current?.setTheme(theme);
  }, [theme]);

  // While a dialog is open everything behind it is inert: no Tab into the
  // canvas host, no Delete / Ctrl+Z reaching the playlist.
  const editorOpen =
    (editor !== null ||
      onboarding === "dialog" ||
      recOpen ||
      statement !== null) &&
    bridge !== null;

  // Peeks — hold Q, hold A, or the "Asomarte" button (UX-20: the same
  // what-if without a key held): whoever starts it, the lane morphs to the
  // other future and back. `peekHolderRef` = what holds it ("q" / "a" /
  // "button"); null = no peek.
  const peekHolderRef = React.useRef<string | null>(null);
  const startPeek = React.useCallback(
    (holder: string, label: string, preview: Parameters<FinancialBridgeApi["setPreview"]>[0]) => {
      if (!bridge) return;
      peekHolderRef.current = holder;
      const before = bridge.getOverviewData()?.primary ?? null;
      bridge.setPreview(preview);
      bridge.animateFrom(before);
      setPeek({ label, effect: bridge.getPreviewEffect(), holder });
    },
    [bridge],
  );
  const endPeek = React.useCallback(() => {
    if (!bridge || peekHolderRef.current === null) return;
    peekHolderRef.current = null;
    const before = bridge.getOverviewData()?.primary ?? null;
    bridge.setPreview(null);
    bridge.animateFrom(before);
    setPeek(null);
  }, [bridge]);
  /** "Asomarte" (FuturesPeekChip): like holding Q, without a key. */
  const peekFuture = React.useCallback(
    (id: string) => {
      const branch = futures?.list().find((candidate) => candidate.id === id);
      const doc = futures?.docOf(id) ?? null;
      if (!branch || !doc || peekHolderRef.current !== null) return;
      startPeek("button", `Futuro: ${branch.name}`, { kind: "document", doc });
    },
    [futures, startPeek],
  );
  // UX-28: "Ver mi año sin esto" from the object's menu (or a long-press):
  // the hold-A what-if without a key held. It stays until "Listo" or Esc;
  // the plan is never touched (a preview).
  const peekWithout = React.useCallback(
    (clipId: string) => {
      const item = bridge?.getItem(clipId);
      if (!item || peekHolderRef.current !== null) return;
      startPeek("menu", `Sin ${item.name}`, { kind: "exclude", itemId: item.id });
    },
    [bridge, startPeek],
  );
  menuPeekRef.current = peekWithout;
  useEscapeLayer(peek?.holder === "menu", endPeek);

  // Hold Q: peek at the other future. Hold A over a clip: your year without
  // it. "/": write a movement. Paste on a selected card: its statement.
  React.useEffect(() => {
    if (!bridge || !futures || !core) return undefined;
    const typing = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (editorOpen || commandOpen) return;
      // Undo / redo also work when focus sits on a DOM control outside the
      // canvas (e.g. right after "Aplicar" on a valley fix); the canvas host
      // handles its own shortcuts.
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !typing(event.target) &&
        !hostRef.current?.contains(event.target as Node)
      ) {
        const key = event.key.toLowerCase();
        if (key === "z" && !event.shiftKey) {
          event.preventDefault();
          core.undo();
          return;
        }
        if (key === "y" || (key === "z" && event.shiftKey)) {
          event.preventDefault();
          core.redo();
          return;
        }
      }
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      // UX-60 (WCAG 2.1.4): the single-key shortcuts ("/", Q, A) only with
      // the focus in the stage (the canvas and what floats on it) — never
      // from a header button, nor by a stray key press elsewhere.
      const stage = hostRef.current?.closest(".playlist-shell__stage") ?? null;
      if (!stage || !stage.contains(event.target as Node)) return;
      if (event.key === "/") {
        event.preventDefault();
        setCommandOpen(true);
        return;
      }
      if (event.repeat || peekHolderRef.current !== null) return;
      const key = event.key.toLowerCase();
      if (key === "q") {
        const target = futures.peekTarget();
        const doc = target ? futures.docOf(target.id) : null;
        if (!target || !doc) return;
        startPeek("q", `Futuro: ${target.name}`, { kind: "document", doc });
        return;
      }
      if (key === "a") {
        // The clip under the pointer, else the one selected (keyboard).
        const state = core.getState();
        const hover = state.hover;
        const clipId =
          hover && hover.kind === "clip"
            ? hover.clipId
            : state.selection.clipIds.length === 1
              ? state.selection.clipIds[0]!
              : null;
        if (!clipId) return;
        const item = bridge.getItem(clipId);
        if (!item) return;
        startPeek("a", `Sin ${item.name}`, { kind: "exclude", itemId: item.id });
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const holder = peekHolderRef.current;
      if (holder !== null && holder !== "button" && event.key.toLowerCase() === holder) endPeek();
    };
    const onPaste = (event: ClipboardEvent) => {
      if (editorOpen || typing(event.target)) return;
      const ids = core.getState().selection.clipIds;
      const card = ids.length === 1 ? bridge.getItem(ids[0]!) : null;
      if (!card || card.kind !== "credit-card") return;
      const text = event.clipboardData?.getData("text") ?? "";
      if (parseStatement(text, { today }).length === 0) return;
      event.preventDefault();
      setStatement({ cardId: card.id, text });
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", endPeek);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", endPeek);
      window.removeEventListener("paste", onPaste);
      endPeek();
    };
  }, [bridge, futures, core, editorOpen, commandOpen, today, startPeek, endPeek]);

  const createYear = React.useCallback(
    (doc: FinancialDocument) => {
      bridge?.loadDocument(doc);
      setOnboarding(null);
      setRec(null);
      // UX-26: say what was built (a new plan: there is nothing to undo into).
      if (bridge) {
        const alerts = bridge.getWarnings().length;
        announceRef.current?.({
          message: `Tu año está listo: ${doc.items.length} ${doc.items.length === 1 ? "objeto" : "objetos"}, ${
            alerts === 0 ? "sin alertas" : alerts === 1 ? "1 alerta" : `${alerts} alertas`
          }.`,
        });
      }
    },
    [bridge],
  );

  // Rec (UX-22 / UX-26 / UX-49). One undo step for the whole correction,
  // announced with "Deshacer" (which also brings Rec back as pending).
  const recAssumedRoll = React.useMemo(() => (rec ? recAssumed(rec, today) : null), [rec, today]);
  const recCurrentCash = recOpen && bridge ? bridge.getDocument().initialCash : 0;
  const recResult = React.useCallback(
    (actuals: ActualRecord[], cashOverride: number | undefined) =>
      rec && recAssumedRoll
        ? recResultCash(rec, today, actuals, cashOverride, recCurrentCash, recAssumedRoll)
        : recCurrentCash,
    [rec, recAssumedRoll, today, recCurrentCash],
  );
  const applyRec = React.useCallback(
    (actuals: ActualRecord[], cashOverride: number | undefined) => {
      if (!bridge || !futures || !rec) return;
      const ledgerBefore = futures.getLedger();
      const cashBefore = bridge.getDocument().initialCash;
      const revisionBefore = bridge.getRevision();
      const ledger = inOneUndoStep(bridge.core, () =>
        applyRecCorrections(bridge, rec, today, actuals, cashOverride),
      );
      const wrote = bridge.getRevision() !== revisionBefore;
      futures.upsertLedger(ledger);
      setRecOpen(false);
      setRec(null);
      const cash = bridge.getDocument().initialCash;
      const fixed = actuals.length;
      announceRef.current?.({
        message:
          `Registrado. Liquidez hoy: ${formatMoneyWhole(cash)}` +
          (Math.abs(cash - cashBefore) >= 0.5 ? ` (antes ${formatMoneyWhole(cashBefore)})` : "") +
          (fixed > 0 ? ` · ${fixed === 1 ? "1 movimiento corregido" : `${fixed} movimientos corregidos`}` : ""),
        undo: () => {
          if (wrote) bridge.core.undo();
          futures.replaceLedger(ledgerBefore);
          setRec(rec);
          setRecBanner(true);
        },
      });
    },
    [bridge, futures, rec, today],
  );
  // "Todo pasó así": the plan already assumes it; Rec is no longer pending.
  const acceptRec = React.useCallback(() => {
    if (!rec) return;
    setRec(null);
    announceRef.current?.({
      message: "Listo: tu año quedó como lo planeaste.",
      undo: () => {
        setRec(rec);
        setRecBanner(true);
      },
    });
  }, [rec]);
  /**
   * Contract with the plan menu (H, UX-48 "Revisar lo que pasó"): opens Rec
   * while one is pending (`rec !== null`); a no-op otherwise. The banner's
   * × ("Después") only hides the banner: Rec stays pending and this reopens it.
   */
  const openRec = React.useCallback(() => {
    if (!rec) return;
    setRecOpen(true);
  }, [rec]);
  const recBannerText = React.useMemo(() => {
    if (!rec) return "";
    const days = diffDays(rec.since, today);
    const moved = rec.pending.filter((point) => point.cashDelta !== 0);
    const net = moved.reduce((sum, point) => sum + point.cashDelta, 0);
    const daysText = days === 1 ? "Pasó 1 día" : `Pasaron ${days} días`;
    if (moved.length === 0) return `${daysText}: no había movimientos planeados. ¿Lo revisas?`;
    return `${daysText}: supusimos ${moved.length === 1 ? "1 movimiento" : `${moved.length} movimientos`} (${formatSignedMoneyWhole(net)}). ¿Lo revisas?`;
  }, [rec, today]);

  // UX-48: the plan's global actions, in "Mi plan ▾" (header brand).
  const planActions = React.useMemo<PlanMenuActions>(
    () => ({
      onBuildYear: () => setOnboarding("dialog"),
      onReviewRec: rec ? openRec : null,
      onReset: () => {
        if (
          window.confirm("¿Reiniciar con el año de ejemplo? Se borra tu plan y todos sus futuros.")
        ) {
          window.location.assign(`${window.location.pathname}?reset`);
        }
      },
    }),
    [rec, openRec],
  );
  const navHintRef = React.useRef<HTMLElement | null>(null);

  const shell = (
    <section
      className="playlist-shell playlist-shell--finance"
      aria-label="Tu plan"
      data-density={density}
      style={layoutStyle}
    >
      {/* UX-58: one page heading for the whole app. */}
      <h1 className="fin-sr-only">Tu plan financiero</h1>
      {bridge ? (
        <FinancialSummaryBar
          bridge={bridge}
          onCreateDraft={openDraft}
          inert={editorOpen}
          theme={theme}
          onToggleTheme={toggleTheme}
          onOpenCommand={() => setCommandOpen(true)}
          futures={futures}
          plan={planActions}
          tools={
            // Tools + futures inside the header card: nothing floats over
            // the ruler dates or the money lane.
            <div className="playlist-shell__bar" inert={editorOpen} ref={toolBarRef}>
              <PlaylistToolbar core={core} />
            </div>
          }
          // UX-15/19: the futures button sits with "Nuevo" (never scrolled
          // away with the tools when the header is tight).
          actions={
            futures ? (
              <FuturesMenu bridge={bridge} futures={futures} inert={editorOpen} />
            ) : null
          }
        />
      ) : null}
      {/* UX-19: outside the main plan, say so until the person goes back. */}
      {futures ? <FutureStrip futures={futures} /> : null}
      {/* UX-56: DOM order = visual order. What sits over the top-left of
          the canvas (navigation, the day's readout, Análisis) comes before
          the canvas host; the inspector (bottom right) and the banners
          (bottom) after it. All of them are positioned (z-index), so the
          order does not change what paints on top. */}
      {/* UX-47: the open "Comparar y pagar deudas" rail is a column BESIDE
          the stage (portal into the slot): it pushes the canvas instead of
          covering the row headers; the renderer's ResizeObserver follows. */}
      <div className="playlist-shell__workspace">
      <div className="playlist-shell__side-slot" ref={setSideSlot} inert={editorOpen} />
      <div className="playlist-shell__stage" inert={editorOpen}>
        {core && navigator && bridge ? (
          <NavControls core={core} navigator={navigator} bridge={bridge} />
        ) : null}
        {/* Date · cash · debt at the playhead, in the money lane's header
            cell (rails open below the lane: nothing covers it). */}
        {bridge ? (
          <PlayheadReadout
            bridge={bridge}
            className="fin-readout--lane"
            keyboardIntentRef={keyIntentRef}
            followHover
          />
        ) : null}
        {bridge ? (
          <FinancialSidePanel bridge={bridge} futures={futures} today={today} slot={sideSlot} />
        ) : null}
        {/* UX-04: the keys come first in its name (the gestures are in
            "Cómo moverte"); a navigation key marks the next day change as
            keyboard driven, so the day's reading is spoken. */}
        <div
          ref={hostRef}
          className="playlist-shell__surface"
          tabIndex={0}
          role="application"
          aria-roledescription="línea de tiempo"
          aria-label="Línea de tiempo. Alt+flechas recorre los objetos; Enter abre el seleccionado; Shift+F10 su menú; flechas mueven el día o el objeto; Supr borra; Esc vuelve a Seleccionar"
          aria-describedby="fin-canvas-focus"
          onKeyDownCapture={(event) => {
            const key = event.key;
            if (
              key === "ArrowLeft" ||
              key === "ArrowRight" ||
              key === "Home" ||
              key === "End" ||
              key === "PageUp" ||
              key === "PageDown"
            ) {
              keyIntentRef.current = performance.now();
            }
          }}
        />
        {/* The object the keyboard focus is on (Alt+←/→): "Renta · −$8,000
            /mes · 1 dic · línea 2". */}
        <p id="fin-canvas-focus" className="fin-sr-only" role="status" aria-live="polite">
          {focusText}
        </p>
        <ToolModePill core={core} />
        <PlaylistContextMenuOverlay core={core} actions={menuActions} fallbackFocus={getHost} />
        {error ? (
          <div className="playlist-shell__status" role="alert">
            <strong>Error</strong>
            <span>{error}</span>
          </div>
        ) : null}
        {bridge && !commandOpen ? (
          <ValleyCard bridge={bridge} hoverDay={hoverDay} fallbackFocus={getHost} />
        ) : null}
        {bridge && commandOpen ? (
          // UX-27: the bar gives the focus back to whoever opened it (the
          // canvas only when that element is gone).
          <CommandBar
            bridge={bridge}
            today={today}
            onClose={() => setCommandOpen(false)}
            fallbackFocus={getHost}
          />
        ) : null}
        {/* Always mounted, so screen readers hear the peek when it starts. */}
        <div className="fin-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {peek ? [peek.label, peek.effect?.text].filter(Boolean).join(". ") : ""}
        </div>
        {peek ? (
          <div className={peek.holder === "menu" ? "fin-peek fin-peek--locked" : "fin-peek"}>
            <strong>{peek.label}</strong>
            {peek.effect ? (
              <span data-tone={peek.effect.tone}>{peek.effect.text}</span>
            ) : null}
            {/* UX-28: the menu's "Ver mi año sin esto" stays until Listo / Esc. */}
            {peek.holder === "menu" ? (
              <button type="button" className="fin-peek__done" onClick={endPeek}>
                Listo
              </button>
            ) : null}
          </div>
        ) : null}
        {/* UX-20: the other future in figures + "Asomarte" (= hold Q). */}
        {bridge && futures && !commandOpen ? (
          <FuturesPeekChip
            bridge={bridge}
            futures={futures}
            peeking={peek?.holder === "button"}
            busy={peek !== null && peek.holder !== "button"}
            onPeek={peekFuture}
            onEndPeek={endPeek}
          />
        ) : null}
        <PlaylistInspector core={core} fallbackFocus={getHost} />
        <div className="fin-banners">
          {navHint && navigator && onboarding !== "banner" && !rec ? (
            <section
              ref={navHintRef}
              className="fin-banner fin-banner--hint"
              aria-label="Cómo moverte"
              tabIndex={-1}
            >
              {navHint === "help" ? (
                <div className="fin-banner__text">
                  <NavHelp />
                </div>
              ) : (
                <div className="fin-banner__text">
                  <strong>Muévete libre:</strong> la rueda sube y baja entre líneas de evento,
                  Shift+rueda avanza en el tiempo, Ctrl+rueda o pellizca hace zoom y
                  Espacio+arrastra es la mano.
                </div>
              )}
              {navHint === "hint" ? (
                <button
                  type="button"
                  className="fin-button"
                  onClick={() => {
                    setNavHint("help");
                    // UX-27: "Ver todo" goes away; the help it opened takes the focus.
                    focusSoon(() => navHintRef.current);
                  }}
                >
                  Ver todo
                </button>
              ) : null}
              <button
                type="button"
                className="fin-button fin-button--primary"
                onClick={() => {
                  dismissNavHint();
                  focusSoon(getHost);
                }}
              >
                Entendido
              </button>
            </section>
          ) : null}
          {/* Kept while the dialog is open: "Empezar" gets the focus back on close. */}
          {onboarding === "banner" || onboarding === "dialog" ? (
            <WelcomeBanner
              onStart={() => setOnboarding("dialog")}
              onDismiss={() => {
                setOnboarding(null);
                // UX-27/UX-48: "Armar mi año" now lives in "Mi plan".
                focusSoon(planTriggerFocus);
              }}
            />
          ) : null}
          {rec && !recOpen && recBanner ? (
            // UX-49: says what was assumed; "Revisar" is the primary; × is
            // "Después" (Rec stays pending; the plan menu reopens it).
            <section className="fin-banner fin-banner--rec" aria-label="Revisa lo que pasó">
              <div className="fin-banner__text">{recBannerText}</div>
              <button
                ref={recReviewRef}
                type="button"
                className="fin-button fin-button--primary"
                onClick={openRec}
              >
                Revisar
              </button>
              <button type="button" className="fin-button" onClick={acceptRec}>
                Todo pasó así
              </button>
              <button
                type="button"
                className="fin-icon-button"
                aria-label="Después"
                title="Después: lo revisas cuando quieras"
                onClick={() => {
                  setRecBanner(false);
                  // UX-27/UX-48: the review stays one click away in "Mi plan".
                  focusSoon(planTriggerFocus);
                }}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M5 5l10 10M15 5 5 15" />
                </svg>
              </button>
            </section>
          ) : null}
        </div>
      </div>
      </div>
      {editor && bridge ? (
        editor.mode === "edit" ? (
          <FinancialEditorModal
            key={"edit:" + editor.id}
            bridge={bridge}
            itemId={editor.id}
            onClose={closeEditor}
            returnFocusFallback={getHost}
            today={today}
            // UX-51: the editor only calls it with nothing unsaved; closing
            // the statement comes back to this card's editor.
            onImportStatement={(cardId) => {
              setEditor(null);
              setStatement({ cardId, text: "", returnTo: cardId });
            }}
          />
        ) : (
          <FinancialEditorModal
            key={"create:" + editor.draft.id}
            bridge={bridge}
            draft={editor.draft}
            placement={editor.placement}
            onClose={closeEditor}
            returnFocusFallback={getHost}
            today={today}
          />
        )
      ) : null}
      {onboarding === "dialog" ? (
        <OnboardingDialog
          today={today}
          onCreate={createYear}
          onClose={() => setOnboarding("banner")}
          returnFocusFallback={getHost}
        />
      ) : null}
      {rec && recOpen ? (
        <RecDialog
          pending={rec.pending}
          since={rec.since}
          onApply={applyRec}
          onClose={() => setRecOpen(false)}
          currentCash={recCurrentCash}
          resultCash={recResult}
          fallbackFocus={() => recReviewRef.current ?? hostRef.current}
        />
      ) : null}
      {statement && bridge ? (
        <StatementDialog
          bridge={bridge}
          cardId={statement.cardId}
          today={today}
          initialText={statement.text}
          // UX-27: focus back to whoever opened it (the canvas when gone);
          // opened from a card's editor, back to that editor (UX-51).
          onClose={() => {
            const back = statement.returnTo;
            setStatement(null);
            if (back && bridge.getItem(back)) setEditor({ mode: "edit", id: back });
          }}
          fallbackFocus={getHost}
        />
      ) : null}
    </section>
  );

  // Mantine (forms' calendar) follows the app theme; see mantine.tsx.
  // The announcer (result of each commit + "Deshacer") wraps the shell: its
  // live region stays mounted outside the inert stage; its notice is inert
  // while a dialog is open.
  return (
    <SlicexMantineProvider theme={theme}>
      <AnnouncerProvider fallbackFocus={getHost} inert={editorOpen} announceRef={announceRef}>
        {shell}
      </AnnouncerProvider>
    </SlicexMantineProvider>
  );
}
