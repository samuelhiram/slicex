// SliceX renderer colour palette. Kept in sync with apps/web/src/styles
// (frontend-canon.md). Adjust both sides together when the visual baseline
// shifts; do NOT clone FL Studio colours — SliceX has its own dark theme
// with #f4d35e as the accent.

export const COLORS = {
  background: 0x181818,
  panel: 0x222222,
  panelStrong: 0x2a2a2a,
  panelHeaderA: 0x272727,
  panelHeaderB: 0x242424,
  panelMenu: 0x202020,
  rowA: 0x1d1d1d,
  rowB: 0x202020,
  rowLine: 0x303030,
  gridMinor: 0x2d2d2d,
  gridMajor: 0x414141,
  text: 0xf1f1e8,
  textMuted: 0xb8b3a5,
  selected: 0xf4d35e,
  hover: 0xffffff,
  playPosition: 0xf05d3b,
  marquee: 0x9ecbff,
  automationLine: 0x111111,
  disabled: 0x6f6f6f,
  scrollbarTrack: 0x151515,
  scrollbarThumb: 0x5f5f5f,
  markerLabel: 0xc9b977,
  markerLoop: 0x6fd28a,
  markerSkip: 0xe6a85a,
  markerPause: 0xc975e0,
  markerTimeSig: 0x7ec1ff,
  markerRecording: 0xe85c5c,
  loopRegion: 0x6fd28a,
  recordingIndicator: 0xe85c5c,
} as const;

export type PlaylistRendererColors = typeof COLORS;

// Parse a CSS-style hex colour (#rrggbb) to a Pixi-friendly integer. Falls
// back to a caller-supplied default if the input is malformed; never throws
// because clip colours come from user data and we don't want a render crash
// from a typo.
export function parseHexColor(value: string, fallback: number): number {
  const normalized = value.trim();
  if (!normalized.startsWith("#")) return fallback;
  const hex = normalized.slice(1);
  if (hex.length !== 6) return fallback;
  const parsed = Number.parseInt(hex, 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Resolve a marker's display colour from its `kind`. Centralised here so
// the renderer doesn't carry the switch inside its frame loop.
export function markerColor(kind: string): number {
  switch (kind) {
    case "loop":
    case "marker-loop":
      return COLORS.markerLoop;
    case "marker-skip":
      return COLORS.markerSkip;
    case "marker-pause":
      return COLORS.markerPause;
    case "time-signature":
      return COLORS.markerTimeSig;
    case "rec-start":
    case "rec-stop":
      return COLORS.markerRecording;
    case "start":
      return COLORS.markerLoop;
    case "label":
    default:
      return COLORS.markerLabel;
  }
}
