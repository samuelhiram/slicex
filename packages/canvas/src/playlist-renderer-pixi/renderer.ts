export * from "./renderer-impl";
// Text width of a clip card (for hosts that size tags to their text).
export { clipCardWidthPx, clipTextWidthPx, type PlaylistClipIcon } from "./clip-node-registry";
// Theme palettes (read-only), for hosts that check their own colours
// against the canvas surfaces (e.g. contrast tests of clip kinds).
export {
  DARK_PALETTE,
  LIGHT_PALETTE,
  mixColor,
  type PlaylistThemeName,
  type PlaylistThemePalette,
} from "./palette";
