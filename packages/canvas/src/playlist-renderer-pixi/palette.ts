// SliceX renderer palette — two themes (light / dark) with the same keys.
// Kept in sync with the CSS tokens in apps/web/src/styles/globals.css
// (`:root[data-theme=…]`). Adjust both sides together.
//
// Design language: calm, high-contrast, minimal. Neutral surfaces, hairline
// separators, ONE accent (selection) and one "now" colour (playhead /
// today). Text always meets WCAG AA on its surface (≥ 4.5:1 for body text,
// ≥ 3:1 for large / non-essential labels).
//
// `COLORS` is the LIVE palette every layer reads at draw time. It is mutated
// in place by applyPlaylistTheme (never reassigned), so importers keep the
// same reference. A theme switch must be followed by a full invalidation of
// the cached layers — PlaylistRenderer.setTheme does both.

export type PlaylistThemeName = "light" | "dark";

export interface PlaylistThemePalette {
  // Canvas surfaces.
  background: number; // track area
  panel: number; // track headers, ruler, corner
  panelStrong: number; // raised surfaces drawn on the canvas (pills)
  panelHeaderA: number;
  panelHeaderB: number;
  panelMenu: number;
  rowA: number;
  rowB: number;
  rowLine: number; // hairline separators
  gridMinor: number; // day lines
  gridMajor: number; // week / month lines
  weekend: number; // shaded columns (axis bands)
  // Text.
  text: number;
  textMuted: number; // secondary text (AA on every surface, incl. weekend)
  textSubtle: number; // icons, inactive glyphs — never for text
  textInverse: number; // text on accent / "now" fills
  // Interaction.
  selected: number; // selection accent
  hover: number;
  playPosition: number; // playhead + "today" (line, knob, pill fill)
  nowText: number; // text on the "today" pill (AA on playPosition)
  marquee: number;
  automationLine: number;
  disabled: number;
  scrollbarTrack: number;
  scrollbarThumb: number;
  tooltipBackground: number;
  tooltipText: number;
  // Markers.
  markerLabel: number;
  markerLoop: number;
  markerSkip: number;
  markerPause: number;
  markerTimeSig: number;
  markerRecording: number;
  loopRegion: number;
  recordingIndicator: number;
  // Generic value tones (overview lane, meters, drag annotation). The
  // canvas does not know what they mean; the host picks the tone. Dark
  // enough to read as text on the theme surfaces.
  tonePositive: number;
  toneWarning: number;
  toneDanger: number;
  toneInfo: number;
  // Overview lane chrome.
  overviewBackground: number;
  overviewZeroLine: number;
  overviewBaseline: number;
  overviewSecondary: number;
  // Opacities that depend on the surface luminance.
  areaAlpha: number; // overview lane area fill
  clipTint: number; // clip card fill: mix(clip colour, background, t)
  clipBorderAlpha: number;
  shadowAlpha: number;
}

export const LIGHT_PALETTE: Readonly<PlaylistThemePalette> = {
  background: 0xffffff,
  panel: 0xffffff,
  panelStrong: 0xffffff,
  panelHeaderA: 0xffffff,
  panelHeaderB: 0xffffff,
  panelMenu: 0xffffff,
  rowA: 0xffffff,
  rowB: 0xffffff,
  rowLine: 0xebedf1,
  gridMinor: 0xf3f4f7,
  gridMajor: 0xe6e8ed,
  weekend: 0xf5f5f8,
  text: 0x111113,
  textMuted: 0x5c5c66,
  textSubtle: 0x8b8b95,
  textInverse: 0xffffff,
  selected: 0x3e6ae1,
  hover: 0x111113,
  playPosition: 0xd1292f,
  nowText: 0xffffff,
  marquee: 0x3e6ae1,
  automationLine: 0xffffff,
  disabled: 0xb4b4bc,
  scrollbarTrack: 0xffffff,
  scrollbarThumb: 0xc8c8d0,
  tooltipBackground: 0x111113,
  tooltipText: 0xffffff,
  markerLabel: 0x8a6d1f,
  markerLoop: 0x1f8a4c,
  markerSkip: 0xb45309,
  markerPause: 0x8e4ec6,
  markerTimeSig: 0x2f5bd3,
  markerRecording: 0xdc2626,
  loopRegion: 0x1f8a4c,
  recordingIndicator: 0xdc2626,
  tonePositive: 0x15803d,
  toneWarning: 0xb45309,
  toneDanger: 0xdc2626,
  toneInfo: 0x2f5bd3,
  overviewBackground: 0xfafafb,
  overviewZeroLine: 0xc4c4cc,
  overviewBaseline: 0x7d7d88,
  overviewSecondary: 0x6b6b76,
  areaAlpha: 0.12,
  clipTint: 0.13,
  clipBorderAlpha: 0.38,
  shadowAlpha: 0.06,
};

export const DARK_PALETTE: Readonly<PlaylistThemePalette> = {
  background: 0x0e0e10,
  panel: 0x131316,
  panelStrong: 0x1c1c20,
  panelHeaderA: 0x131316,
  panelHeaderB: 0x131316,
  panelMenu: 0x1c1c20,
  rowA: 0x0e0e10,
  rowB: 0x0e0e10,
  rowLine: 0x26262c,
  gridMinor: 0x18181c,
  gridMajor: 0x24242a,
  weekend: 0x1a1a1f,
  text: 0xf4f4f6,
  textMuted: 0xa3a3ad,
  textSubtle: 0x6e6e78,
  textInverse: 0xffffff,
  selected: 0x7091ff,
  hover: 0xf4f4f6,
  playPosition: 0xff5c61,
  nowText: 0x0e0e10,
  marquee: 0x7091ff,
  automationLine: 0x0e0e10,
  disabled: 0x4a4a52,
  scrollbarTrack: 0x0e0e10,
  scrollbarThumb: 0x3a3a42,
  tooltipBackground: 0xf4f4f6,
  tooltipText: 0x0e0e10,
  markerLabel: 0xd9bf6a,
  markerLoop: 0x4cc982,
  markerSkip: 0xf5a524,
  markerPause: 0xc08af0,
  markerTimeSig: 0x7091ff,
  markerRecording: 0xff5c61,
  loopRegion: 0x4cc982,
  recordingIndicator: 0xff5c61,
  tonePositive: 0x3ccf7f,
  toneWarning: 0xf5a524,
  toneDanger: 0xff5c61,
  toneInfo: 0x7091ff,
  overviewBackground: 0x111114,
  overviewZeroLine: 0x45454e,
  overviewBaseline: 0x9a9aa5,
  overviewSecondary: 0x8a8a95,
  areaAlpha: 0.16,
  clipTint: 0.2,
  clipBorderAlpha: 0.42,
  shadowAlpha: 0,
};

export const PLAYLIST_THEMES: Readonly<
  Record<PlaylistThemeName, Readonly<PlaylistThemePalette>>
> = {
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
};

// Live palette (see header). Starts light; the host picks the theme.
export const COLORS: PlaylistThemePalette = { ...LIGHT_PALETTE };

let currentTheme: PlaylistThemeName = "light";

export function getPlaylistTheme(): PlaylistThemeName {
  return currentTheme;
}

// Copies the theme into the live palette. Returns false (and touches
// nothing) when it is already active. Callers that cache drawn geometry
// must invalidate it afterwards (PlaylistRenderer.setTheme does).
export function applyPlaylistTheme(name: PlaylistThemeName): boolean {
  if (name === currentTheme) return false;
  const palette = PLAYLIST_THEMES[name];
  if (!palette) return false;
  Object.assign(COLORS, palette);
  currentTheme = name;
  return true;
}

export type PlaylistRendererColors = PlaylistThemePalette;

// One family for every canvas label (Pixi resolves the list like CSS).
// Inter is shipped by the web app; the rest are system fallbacks.
export const CANVAS_FONT_FAMILY = [
  "Inter Variable",
  "Inter",
  "Segoe UI Variable Text",
  "Segoe UI",
  "-apple-system",
  "BlinkMacSystemFont",
  "Roboto",
  "Helvetica Neue",
  "Arial",
  "sans-serif",
];

// Linear mix of two 0xRRGGBB colours: t = 0 → a, t = 1 → b. Pure integer
// math, no allocation (called only when a cached node is redrawn).
export function mixColor(a: number, b: number, t: number): number {
  const k = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const ar = (a >> 16) & 0xff;
  const ag = (a >> 8) & 0xff;
  const ab = a & 0xff;
  const br = (b >> 16) & 0xff;
  const bg = (b >> 8) & 0xff;
  const bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * k);
  const g = Math.round(ag + (bg - ag) * k);
  const bl = Math.round(ab + (bb - ab) * k);
  return (r << 16) | (g << 8) | bl;
}

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
