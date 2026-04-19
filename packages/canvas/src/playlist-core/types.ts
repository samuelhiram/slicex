export type PlaylistClipType = "audio" | "pattern" | "automation";

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

export interface PlaylistSnap {
  enabled: boolean;
  step: number;
}

export interface PlaylistSelection {
  clipIds: string[];
  automationPointIds: string[];
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

export type PlaylistContextMenu = PlaylistTrackContextMenu | null;

export type PlaylistHover =
  | { kind: "clip"; clipId: string }
  | { kind: "resize-left"; clipId: string }
  | { kind: "resize-right"; clipId: string }
  | { kind: "automation-point"; clipId: string; pointId: string }
  | { kind: "track"; trackId: string }
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
}

export interface PlaylistMetrics {
  rulerHeight: number;
  trackHeaderWidth: number;
  trackHeight: number;
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
