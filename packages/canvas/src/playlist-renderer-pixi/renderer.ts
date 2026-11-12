export * from "./renderer-impl";
// Theme palettes (read-only), for hosts that check their own colours
// against the canvas surfaces (e.g. contrast tests of clip kinds).
export {
  DARK_PALETTE,
  LIGHT_PALETTE,
  mixColor,
  type PlaylistThemeName,
  type PlaylistThemePalette,
} from "./palette";
