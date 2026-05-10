export type PlaylistClipType = "audio" | "pattern" | "automation";

// FL Studio toolbar identifiers. `select` is the default; `slip` and `slice`
// are recognised by the dispatcher but their behaviour lands in Fase 6.
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
  | "events";

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
}

export type PlaylistStateListener = (state: PlaylistState) => void;

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
};
