export type PlaylistClipType = "audio" | "pattern" | "automation";

// FL Studio toolbar identifiers. `select` is the default. Every id has a live
// tool implementation in playlist-interaction/tools — `slip` slides a clip's
// inner content (contentOffset) and `slice` splits clips at the cut time.
export type PlaylistToolId =
  | "select"
  | "draw"
  | "paint"
  | "delete"
  | "mute"
  | "slip"
  | "slice"
  | "zoom";

export const PLAYLIST_TOOL_HOTKEYS: Readonly<Record<PlaylistToolId, string>> = {
  select: "E",
  draw: "P",
  paint: "B",
  delete: "D",
  mute: "T",
  slip: "S",
  slice: "C",
  zoom: "Z",
};

export interface PlaylistPoint {
  x: number;
  y: number;
}

export interface PlaylistRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlaylistTrack {
  id: string;
  label: string;
  color: string;
  muted?: boolean;
  soloed?: boolean;
  locked?: boolean;
  // Per-track height in px. Falls back to metrics.trackHeight when unset.
  height?: number;
}

export interface PlaylistAutomationPoint {
  id: string;
  time: number;
  value: number;
}

interface PlaylistClipBase {
  id: string;
  type: PlaylistClipType;
  trackId: string;
  start: number;
  duration: number;
  label: string;
  color: string;
  muted?: boolean;
  // Identity of the underlying source. Two clips share data when sourceId
  // matches. createClip defaults this to the clip id; "Make unique" resets
  // it to a fresh value so subsequent edits don't propagate.
  sourceId?: string;
  // Slip offset (beats): how far the inner content is shifted to the right
  // relative to the clip start. start/duration stay fixed during a slip.
  contentOffset?: number;
  // Time-stretch factor applied to the inner content. 1 means no stretch,
  // 2 means the content is twice as long as a 1x source, etc. The financial
  // engine multiplies recurrence intervals by this ratio.
  stretchRatio?: number;
  // Optional group identifier. Clips sharing a groupId move together when
  // any of them is dragged or nudged. Cleared by Ctrl+Shift+G or by paste
  // (paste reassigns a fresh groupId so a pasted group becomes a sibling).
  groupId?: string;
  // Host-owned "this object cannot be cut" flag. Every slice path skips a
  // clip with noSlice === true: core.sliceClipsAtTime (Slice tool release,
  // Insert at the playhead) and the SLICE_CLIPS_AT_TIME reducer itself.
  // Copy / paste / clone / duplicate keep it (they spread the clip). Toggled
  // with core.setClipNoSlice (undoable). Absent / false = sliceable.
  noSlice?: boolean;
}

export interface PlaylistRegularClip extends PlaylistClipBase {
  type: "audio" | "pattern";
}

export interface PlaylistAutomationClip extends PlaylistClipBase {
  type: "automation";
  points: PlaylistAutomationPoint[];
}

export type PlaylistClip = PlaylistRegularClip | PlaylistAutomationClip;

export interface PlaylistViewport {
  scrollX: number;
  scrollY: number;
  pxPerBeat: number;
  width: number;
  height: number;
}

export interface PlaylistPlayPosition {
  time: number;
  isRunning: boolean;
}

// FL Studio snap modes. Sourced from the official Image-Line manual.
// Mapping (assuming 4 beats per bar, 4 steps per beat — FL defaults):
//   sixth-step  = 1/24 beat   sixth-beat  = 1/6 beat
//   quarter-step= 1/16 beat   quarter-beat= 1/4 beat
//   third-step  = 1/12 beat   third-beat  = 1/3 beat
//   half-step   = 1/8 beat    half-beat   = 1/2 beat
//   step        = 1/4 beat    beat        = 1 beat
//   bar         = beatsPerBar (4)
//   line        = bar         cell        = beat
//   main        = beat (alias for the global default)
//   none        = no snap     events      = snap to clip edges / markers
export type PlaylistSnapMode =
  | "main"
  | "line"
  | "cell"
  | "none"
  | "sixth-step"
  | "quarter-step"
  | "third-step"
  | "half-step"
  | "step"
  | "sixth-beat"
  | "quarter-beat"
  | "third-beat"
  | "half-beat"
  | "beat"
  | "bar"
  | "events"
  // Snap to the host time axis' targets (PlaylistTimeAxis.snapTargets),
  // e.g. the start of each pay period. Falls back to "beat" when the axis
  // provides none.
  | "axis";

export interface PlaylistSnap {
  mode: PlaylistSnapMode;
  // Remembered mode used by Backspace to restore after toggling to "none".
  lastActiveMode: PlaylistSnapMode;
}

export interface PlaylistSelection {
  clipIds: string[];
  automationPointIds: string[];
}

// Snapshot of clips on the clipboard. Each entry stores the source clip plus
// the offset relative to a reference point (anchor) so paste/duplicate-right
// can place them correctly.
export interface PlaylistClipboardEntry {
  clip: PlaylistClip;
  startOffset: number;
  trackOffset: number;
}

export interface PlaylistClipboard {
  entries: PlaylistClipboardEntry[];
  span: number;
}

// FL Studio marker kinds. Sourced from playlist.htm Time markers section.
export type PlaylistMarkerKind =
  | "label"
  | "start"
  | "loop"
  | "marker-loop"
  | "marker-skip"
  | "marker-pause"
  | "time-signature"
  | "rec-start"
  | "rec-stop";

export interface PlaylistMarker {
  id: string;
  time: number; // beats
  kind: PlaylistMarkerKind;
  label?: string;
  color?: string;
  // For kind === "time-signature": numerator / denominator of the new TS.
  // For all other kinds these are undefined.
  timeSignatureNumerator?: number;
  timeSignatureDenominator?: number;
}

export interface PlaylistTransport {
  // Song = play the full playlist. Pattern = play only the current pattern.
  // We track the mode but the actual pattern-mode behaviour is not yet
  // implemented (Fase 10 / 11). For now, this is a UI / model placeholder
  // so the hotkey L is reversible.
  mode: "song" | "pattern";
  // Toggled by R. Visual indicator only until a recording backend lands.
  recording: boolean;
}

export interface PlaylistMarquee {
  start: PlaylistPoint;
  current: PlaylistPoint;
}

// Drag preview: ghost outline rendered at the snapped destination while a
// drag/resize gesture is active. The state is held separately from clip
// positions so the live clip keeps following the cursor while the ghost
// shows where the gesture would commit if released right now.
export type PlaylistDragPreview =
  | {
      kind: "clip-move";
      primaryClipId: string;
      previewTrackIndex: number;
      previewStart: number;
      // Precomputed by the controller; the reducer/presentation never
      // re-derives positions to avoid coupling with movement math.
      allMoves: ReadonlyArray<{
        id: string;
        start: number;
        trackIndex: number;
      }>;
    }
  | {
      kind: "clip-resize";
      clipId: string;
      edge: "left" | "right";
      previewStart: number;
      previewDuration: number;
      // Screen x where the extend grabber is held (clip-extend gesture);
      // absent for an edge resize.
      handleX?: number;
    }
  | {
      kind: "marker";
      markerId: string;
      previewTime: number;
    }
  | null;

// Snap indicator hint: time at which the nearest snap point sits during a
// drag/resize. `visible` is false when snap is off or Alt is held.
export interface PlaylistSnapHint {
  time: number;
  visible: boolean;
}

// Time tooltip floating near the cursor. Kind tells the renderer how to
// format/colour it; anchor is in screen coordinates.
export interface PlaylistTooltip {
  kind: "time" | "ratio" | "offset";
  text: string;
  anchor: PlaylistPoint;
  // Beat a "time" tooltip is about: lets the host add a detail line under
  // the date (PlaylistRendererCallbacks.getTooltipDetail).
  time?: number;
}

export interface PlaylistTrackContextMenu {
  kind: "track";
  trackIndex: number;
  position: PlaylistPoint;
}

export interface PlaylistClipContextMenu {
  kind: "clip";
  clipId: string;
  position: PlaylistPoint;
}

export interface PlaylistBackgroundContextMenu {
  kind: "background";
  // Beats coordinate where the right-click happened, used as the paste anchor.
  time: number;
  trackIndex: number;
  position: PlaylistPoint;
}

export interface PlaylistMarkerContextMenu {
  kind: "marker";
  markerId: string;
  position: PlaylistPoint;
}

export type PlaylistContextMenu =
  | PlaylistTrackContextMenu
  | PlaylistClipContextMenu
  | PlaylistBackgroundContextMenu
  | PlaylistMarkerContextMenu
  | null;

export type PlaylistHover =
  | { kind: "clip"; clipId: string }
  | { kind: "resize-left"; clipId: string }
  | { kind: "resize-right"; clipId: string }
  // The extend grabber of the selected clip (getClipExtendHandle).
  | { kind: "clip-extend"; clipId: string }
  | { kind: "automation-point"; clipId: string; pointId: string }
  | { kind: "track"; trackId: string }
  | { kind: "marker"; markerId: string }
  | null;

export interface PlaylistState {
  tracks: PlaylistTrack[];
  clips: PlaylistClip[];
  viewport: PlaylistViewport;
  snap: PlaylistSnap;
  selection: PlaylistSelection;
  marquee: PlaylistMarquee | null;
  contextMenu: PlaylistContextMenu;
  hover: PlaylistHover;
  playPosition: PlaylistPlayPosition;
  tool: PlaylistToolId;
  clipboard: PlaylistClipboard | null;
  // FL Studio: when true, edge-resize stretches the clip content (multiplies
  // stretchRatio) instead of cropping. Toggled by Shift+M.
  stretchMode: boolean;
  // FL Studio: timeline markers (labels, loop bounds, time signature changes,
  // recording fences). Always sorted by `time` ascending after dispatch.
  markers: PlaylistMarker[];
  transport: PlaylistTransport;
  // Drag/resize ghost outline emitted during active gestures (Fase 8 / F3).
  dragPreview: PlaylistDragPreview;
  // Snap-indicator vertical line during drag/resize (Fase 8 / F3).
  snapHint: PlaylistSnapHint | null;
  // Floating tooltip near the cursor during drag/hover (Fase 8 / F3).
  tooltip: PlaylistTooltip | null;
}

export interface PlaylistMetrics {
  rulerHeight: number;
  trackHeaderWidth: number;
  trackHeight: number;
  trackMinHeight: number;
  trackMaxHeight: number;
  trackResizeHandleSize: number;
  trackButtonSize: number;
  clipPaddingY: number;
  clipTitleHeight: number;
  resizeHandleWidth: number;
  automationPointRadius: number;
  minClipDuration: number;
  minPxPerBeat: number;
  maxPxPerBeat: number;
  beatsPerBar: number;
  trackOverscan: number;
  timelineOverscanPx: number;
  playMarkerHitWidth: number;
  scrollbarSize: number;
  scrollbarThumbMin: number;
  scrollbarVirtualRangePx: number;
  contextMenuWidth: number;
  contextMenuItemHeight: number;
  // Height of the overview lane between the ruler and the first track.
  // 0 = no lane (default; layout identical to before).
  overviewLaneHeight: number;
}

export type PlaylistStateListener = (state: PlaylistState) => void;

// Pluggable time axis. When a PlaylistCore is created with one, the ruler
// ticks and every time tooltip (drag / resize / slice / ruler hover) come
// from it instead of the built-in "bar.beat.tick" grid. The canvas stays
// agnostic of what a beat means — the host decides (e.g. 1 beat = 1 day).
export interface PlaylistTimeAxisTick {
  beat: number;
  // Major ticks draw the taller ruler line, the stronger grid line and their
  // label (when non-null). Minor ticks only draw a short line.
  major: boolean;
  label: string | null;
  // Label centred in the [beat, beat + 1) cell (e.g. one label per day)
  // instead of starting at the tick line.
  centered?: boolean;
  // Highlighted label (e.g. "today"): drawn on a pill in the "now" colour.
  emphasis?: boolean;
  // De-emphasised label (e.g. weekend days).
  dim?: boolean;
}

// A span of the axis. "group": a labelled span on the ruler's upper tier
// (e.g. a month) — its presence turns the ruler into two tiers. "shade": a
// tinted column behind the tracks (e.g. a weekend).
export interface PlaylistTimeAxisBand {
  start: number;
  end: number;
  kind: "group" | "shade";
  label?: string | null;
}

export interface PlaylistTimeAxis {
  // Ticks covering [fromBeat, toBeat] at zoom pxPerBeat, ascending beats.
  // Called at most once per presentation build; may allocate. Must be a pure
  // function of its arguments (the renderer's grid cache relies on it).
  ticks(fromBeat: number, toBeat: number, pxPerBeat: number): PlaylistTimeAxisTick[];
  // Text for time tooltips (drag / resize / slice / ruler hover). Replaces
  // the default bar.beat.tick format.
  formatTime(beat: number): string;
  // Optional text for an EXCLUSIVE end (a clip's right edge), e.g. "hasta"
  // + the last whole unit the clip still covers. Absent: formatTime.
  formatEnd?(beat: number): string;
  // Optional: the beat that names an exclusive end's last covered unit
  // (e.g. beat - 1 for whole days). Used as the tooltip's beat for host
  // details. Absent: the end itself.
  lastCoveredBeat?(endBeat: number): number;
  // Optional snap targets for the "axis" snap mode, ascending, covering at
  // least [fromBeat, toBeat]. Pure function of its arguments.
  snapTargets?(fromBeat: number, toBeat: number): readonly number[];
  // Optional bands intersecting [fromBeat, toBeat] at zoom pxPerBeat (any
  // order; bands may start before fromBeat). Same call contract as
  // ticks(): at most once per presentation build, pure function of its
  // arguments.
  bands?(
    fromBeat: number,
    toBeat: number,
    pxPerBeat: number,
  ): PlaylistTimeAxisBand[];
}

// ---------------------------------------------------------------------------
// Host-provided visual data. The canvas never interprets the domain: it
// draws step series, events and annotations expressed in beats. Every
// provider follows the same contract as getClipSparkline: called from the
// render loop, it must be an O(1) cached lookup that returns the SAME object
// while its data is unchanged (a new reference = repaint).

/**
 * Step function over beats: values[i] holds on [beats[i], beats[i+1]);
 * before beats[0] the value is `initial`. `beats` ascending, same length as
 * `values`.
 */
export interface PlaylistStepSeries {
  initial: number;
  beats: readonly number[];
  values: readonly number[];
}

export interface PlaylistOverviewThreshold {
  value: number;
  // Below a "warning" threshold the area is tinted warning; below a
  // "danger" threshold it is tinted danger. Above all thresholds: positive.
  tone: "warning" | "danger";
  label?: string;
}

export interface PlaylistOverviewAnnotation {
  beat: number;
  value: number;
  label: string;
  tone: "danger" | "warning" | "info";
}

/** Data of the overview lane (a "master" band between ruler and tracks). */
export interface PlaylistOverviewData {
  title: string;
  /** Main curve (e.g. cash), drawn as a filled step area toned by thresholds. */
  primary: PlaylistStepSeries;
  /** Secondary curve (e.g. total debt), faint, on its own scale. */
  secondary?: PlaylistStepSeries | null;
  /** Ghost curve on the primary scale (e.g. before the current gesture). */
  baseline?: PlaylistStepSeries | null;
  thresholds: readonly PlaylistOverviewThreshold[];
  annotations: readonly PlaylistOverviewAnnotation[];
  /** Formats values for annotation / scale labels (called only on rebuild). */
  formatValue?: (value: number) => string;
  /**
   * Vertical scale of the primary curve. "symlog" (sign(v)·log(1+|v|/c))
   * keeps detail near zero when values span orders of magnitude; `constant`
   * is the value where it turns from linear-ish to logarithmic. Default
   * linear.
   */
  scale?: { kind: "linear" } | { kind: "symlog"; constant: number };
  /** Data ends here (e.g. a projection horizon): no curve past it. */
  endBeat?: number;
}

/** Content drawn inside a clip body, positioned at absolute beats. */
export type PlaylistClipContent =
  | {
      kind: "events";
      beats: readonly number[];
      // In [-1, 1]. > 0: bar rising from the body bottom; < 0: bar hanging
      // from under the title bar. |value| = relative height.
      values: readonly number[];
      // Optional vertical guide lines at these beats (e.g. a billing cut).
      marks?: readonly number[];
    }
  | {
      kind: "level";
      // A level over time (e.g. remaining debt) drawn as a filled area from
      // the body bottom; value / max = relative height.
      series: PlaylistStepSeries;
      max: number;
      // Optional vertical guide lines at these beats (e.g. a billing cut).
      marks?: readonly number[];
    };

/** A pill attached to the drag tooltip (e.g. the effect of the gesture). */
export interface PlaylistDragAnnotation {
  text: string;
  tone: "positive" | "negative" | "neutral";
}

/** Extra header info for a track (e.g. its yearly impact). */
export interface PlaylistTrackMeta {
  subtitle?: string;
  /** In [-1, 1]: a thin meter bar, right/positive or left/negative. */
  meter?: number;
}

export const DEFAULT_PLAYLIST_METRICS: PlaylistMetrics = {
  rulerHeight: 38,
  trackHeaderWidth: 148,
  trackHeight: 72,
  trackMinHeight: 28,
  trackMaxHeight: 280,
  trackResizeHandleSize: 5,
  trackButtonSize: 16,
  clipPaddingY: 7,
  clipTitleHeight: 20,
  resizeHandleWidth: 8,
  automationPointRadius: 6,
  minClipDuration: 0.25,
  minPxPerBeat: 8,
  maxPxPerBeat: 96,
  beatsPerBar: 4,
  trackOverscan: 3,
  timelineOverscanPx: 120,
  playMarkerHitWidth: 14,
  scrollbarSize: 14,
  scrollbarThumbMin: 44,
  scrollbarVirtualRangePx: 120000,
  contextMenuWidth: 228,
  contextMenuItemHeight: 28,
  overviewLaneHeight: 0,
};
