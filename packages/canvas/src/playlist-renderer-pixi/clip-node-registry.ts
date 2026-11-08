import { Container, Graphics, Text } from "pixi.js";
import {
  sortedUpperBound,
  type PlaylistClipContent,
  type PlaylistClipPresentation,
} from "../playlist-core";

// Canon §3.8 — per-clip factory + cache with diffed redraws.
//
// Why this exists: every frame the previous renderer cleared one big
// `clipGraphics` and re-emitted roundRect/fill/stroke for every visible
// clip. That re-uploaded the whole batch to the GPU on each rAF, which
// at brush-tool firing rate (dozens of clips painted per second) saturates
// the batcher.
//
// With this registry, every clip owns a small Container with its own
// Graphics + Text children, drawn ONCE in local coordinates. Re-positions
// are just transform updates (Pixi v8 batcher reuses the cached mesh).
// Visual changes (color, label, muted state, selection ring) only redraw
// the affected node — never the whole scene.

interface PixiPaletteColors {
  text: number;
  textMuted: number;
  selected: number;
  hover: number;
  rowLine: number;
  panel: number;
  panelStrong: number;
  automationLine: number;
}

const CLIP_BODY_ALPHA = 1;
const CLIP_BODY_ALPHA_MUTED = 0.28;
const CLIP_TITLE_ALPHA = 0.34;
const CLIP_RESIZE_ALPHA = 0.2;

interface ClipNode {
  container: Container;
  body: Graphics;
  overlay: Graphics;
  // Lazy Text instances. We never destroy them (Pixi v8 TexturePool crash);
  // we just toggle visibility when the label drops below the draw threshold.
  label: Text | null;
  ratioBadge: Text | null;
  offsetBadge: Text | null;
  // Secondary line under the title (host-provided via getClipDetail).
  detail: Text | null;
  // Truncation cache for the detail line: the display string is only
  // recomputed when the source text or the clip width changes, so steady
  // frames never allocate a new string.
  detailSource: string;
  detailWidth: number;
  detailDisplay: string;
  // Sparkline array the body was last drawn with, as returned by the
  // per-renderer getClipSparkline provider (null = provider absent / returned
  // null). A different reference forces a body redraw even when the visual
  // hash is unchanged — see ClipNodeProviders.
  bars: readonly number[] | null;
  // Content the body was last drawn with (getClipContent; null = none) and
  // the clip geometry it was laid out for. Content sits at absolute beats,
  // so a move (start) or zoom (px per beat) re-lays it out even when the
  // host keeps the same reference.
  content: PlaylistClipContent | null;
  contentStart: number;
  contentPxPerBeat: number;
  // Visual hash captures everything that would force a redraw. Position and
  // size are kept separate so we can skip a redraw when only x/y changed.
  hash: string;
  width: number;
  height: number;
}

function parseHexColor(value: string, fallback: number): number {
  const normalized = value.trim();
  if (!normalized.startsWith("#")) return fallback;
  const hex = normalized.slice(1);
  if (hex.length !== 6) return fallback;
  const parsed = Number.parseInt(hex, 16);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// F9: deterministic hash → seed → sparkline bar count + heights. Picks N
// in [8, 19] from the clip id so two clips with the same id always get
// the same sparkline (no per-frame allocation). The motor financiero can
// replace this default later via setSparklineProvider.
function hashStringToSeed(value: string): number {
  let hash = 2166136261 >>> 0; // FNV-1a basis
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

export function defaultSparklineBars(clipId: string): number[] {
  return sparklineBarsForClipImpl(clipId);
}

function sparklineBarsForClipImpl(clipId: string): number[] {
  const seed = hashStringToSeed(clipId);
  const count = 8 + (seed % 12);
  const out: number[] = [];
  let s = seed || 1;
  for (let i = 0; i < count; i += 1) {
    // xorshift 32 — cheap and deterministic.
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s = s >>> 0;
    const ratio = (s % 1000) / 1000;
    out.push(0.2 + ratio * 0.65);
  }
  return out;
}

// Allow consumers to swap in a real provider (e.g. financial engine).
// Defaults to the deterministic hash above. Setting null reverts to default.
let sparklineProvider: ((clipId: string) => number[] | null) | null = null;

export function setSparklineProvider(
  provider: ((clipId: string) => number[] | null) | null,
): void {
  sparklineProvider = provider;
}

export type ClipSparklineProvider = (
  clipId: string,
) => readonly number[] | null;
export type ClipDetailProvider = (clipId: string) => string | null;
export type ClipContentProvider = (
  clipId: string,
) => PlaylistClipContent | null;

// Per-renderer providers (PlaylistRendererCallbacks.getClipDetail /
// getClipSparkline). Both are called by syncFrame for VISIBLE clips only,
// once per frame each (getClipSparkline only for pattern clips). Both must
// be O(1) cached lookups — no projection work inside the frame.
//
// getClipDetail: return a stable string; a changed string redraws the clip
// (it is part of clipVisualHash).
//
// getClipSparkline: return the SAME array reference for as long as the bars
// are unchanged, and a NEW array when they change (never mutate a returned
// array in place — the registry cannot see that). The body redraws when the
// visual hash changes OR when the returned reference differs from the one
// it was last drawn with, so the bars may depend on anything the host likes
// (e.g. the clip's position on a calendar) without being in the hash. A
// provider that allocates a fresh array per call defeats the cache and
// redraws that clip every frame (canon §3.8). null falls back to the global
// setSparklineProvider / the deterministic default; [] draws no bars.
//
// Neither provider schedules a frame by itself: when provider data changes
// without a core notify, the host calls PlaylistRenderer.invalidate().
//
// getClipContent: same identity contract as getClipSparkline (SAME object
// while unchanged, a NEW object when it changes). Queried once per VISIBLE
// non-automation clip per frame. Non-null wins over the sparkline for that
// clip (getClipSparkline is then not queried). The body redraws only when
// the visual hash, the content reference, the clip start or the zoom
// changes; see drawClipContent for the layout.
export interface ClipNodeProviders {
  getClipDetail?: ClipDetailProvider;
  getClipSparkline?: ClipSparklineProvider;
  getClipContent?: ClipContentProvider;
}

function getSparklineBars(
  clipId: string,
  localBars: readonly number[] | null,
): readonly number[] {
  // Per-renderer provider wins over the global one; null falls through.
  // syncFrame already queried it this frame and passes the result in.
  if (localBars !== null) return localBars;
  if (sparklineProvider) {
    const custom = sparklineProvider(clipId);
    if (custom !== null) return custom;
  }
  return sparklineBarsForClipImpl(clipId);
}

// Exported for tests. `detail` is the host-provided secondary line (or null);
// including it lets a changed detail (and the sparkline that is derived from
// the same data, see ClipNodeProviders) trigger a redraw.
export function clipVisualHash(
  view: PlaylistClipPresentation,
  detail: string | null = null,
): string {
  const ratio = view.clip.stretchRatio ?? 1;
  const offset = view.clip.contentOffset ?? 0;
  return [
    view.clip.color,
    view.clip.label,
    view.effectivelyMuted ? 1 : 0,
    view.trackLocked ? 1 : 0,
    view.selected ? 1 : 0,
    view.hovered ? 1 : 0,
    view.isAutomation ? 1 : 0,
    // F9 invalidation: a clip becoming a pattern or losing pattern-ness
    // changes whether we draw the sparkline at all.
    view.clip.type,
    view.rect.width,
    view.rect.height,
    Math.round(view.titleRect.height * 100),
    ratio,
    offset,
    view.groupId ?? "",
    detail ?? "",
  ].join("|");
}

// Detail line layout (local coords). Shown only when the body has room.
const DETAIL_FONT_SIZE = 10;
const DETAIL_LINE_HEIGHT = 13;
const DETAIL_MIN_BODY_HEIGHT = 14;
const DETAIL_MIN_WIDTH = 36;
const DETAIL_PAD_X = 12;
// Conservative average glyph width for the 10px detail font. Same estimate
// style as the ratio badge (tagText.length * 6): no canvas measuring, so the
// truncation is deterministic and works headless.
const DETAIL_CHAR_PX = 6;

export function isClipDetailVisible(
  view: PlaylistClipPresentation,
  detail: string | null,
): boolean {
  return (
    detail !== null &&
    detail.length > 0 &&
    view.rect.width >= DETAIL_MIN_WIDTH &&
    view.rect.height >= view.titleRect.height + DETAIL_MIN_BODY_HEIGHT
  );
}

// Truncates `text` with an ellipsis so it fits inside a clip of `width` px
// (left pad DETAIL_PAD_X, right pad 4). Pure; returns the input when it fits.
export function truncateClipDetail(text: string, width: number): string {
  const maxChars = Math.floor((width - DETAIL_PAD_X - 4) / DETAIL_CHAR_PX);
  if (maxChars <= 0) return "";
  if (text.length <= maxChars) return text;
  if (maxChars === 1) return "…";
  return `${text.slice(0, maxChars - 1)}…`;
}

// Content area of the body: below the title bar (and the detail line when
// it is shown, so the text stays readable), 3px above the bottom edge.
const CONTENT_BOTTOM_PAD = 3;
const CONTENT_EVENT_ALPHA_POS = 0.62;
const CONTENT_EVENT_ALPHA_NEG = 0.5;
const CONTENT_LEVEL_FILL_ALPHA = 0.26;
const CONTENT_LEVEL_LINE_ALPHA = 0.7;
const CONTENT_DARK = 0x0b0b0b;

// Draws PlaylistClipContent in the body (local coords). Beats are absolute:
// x = (beat - clip.start) * pxPerBeat. Only what falls inside the clip window
// [start, start + duration] is drawn; the window start is found by binary
// search, so a long series costs O(log n + items inside the clip).
//   events: one 2-3px bar per event; value > 0 rises from the bottom of the
//           content area, value < 0 hangs from its top; |value| = height.
//   level:  filled step area from the bottom; value / max = height.
export function drawClipContent(
  body: Graphics,
  view: PlaylistClipPresentation,
  palette: PixiPaletteColors,
  content: PlaylistClipContent,
  detailVisible: boolean,
): void {
  const width = view.rect.width;
  const height = view.rect.height;
  const clip = view.clip;
  const pxPerBeat = width / Math.max(clip.duration, 1e-9);
  const top =
    view.titleRect.height + (detailVisible ? DETAIL_LINE_HEIGHT : 0) + 2;
  const bottom = height - CONTENT_BOTTOM_PAD;
  const available = bottom - top;
  if (available < 2 || width < 4) return;
  const start = clip.start;
  const end = start + clip.duration;
  const alphaScale = view.effectivelyMuted ? 0.45 : 1;

  if (content.kind === "events") {
    const beats = content.beats;
    const values = content.values;
    const count = Math.min(beats.length, values.length);
    const barWidth = Math.min(3, Math.max(2, pxPerBeat * 0.6));
    const maxX = width - barWidth - 1;
    // First event at or after the clip start.
    let index = sortedUpperBound(beats, start - 1e-9);
    for (; index < count; index += 1) {
      const beat = beats[index]!;
      if (beat > end + 1e-9) break;
      const raw = values[index]!;
      if (raw === 0 || !Number.isFinite(raw)) continue;
      const magnitude = Math.min(1, Math.abs(raw));
      const h = Math.max(1, Math.round(available * magnitude));
      const center = (beat - start) * pxPerBeat;
      const x = Math.min(maxX, Math.max(1, Math.round(center - barWidth / 2)));
      if (raw > 0) {
        body.rect(x, bottom - h, barWidth, h).fill({
          color: palette.text,
          alpha: CONTENT_EVENT_ALPHA_POS * alphaScale,
        });
      } else {
        body.rect(x, top, barWidth, h).fill({
          color: CONTENT_DARK,
          alpha: CONTENT_EVENT_ALPHA_NEG * alphaScale,
        });
      }
    }
    return;
  }

  // level
  const series = content.series;
  const max = content.max;
  if (!(max > 0)) return;
  const beats = series.beats;
  const values = series.values;
  const count = Math.min(beats.length, values.length);
  const yOf = (value: number): number => {
    const ratio = value <= 0 ? 0 : value >= max ? 1 : value / max;
    return bottom - ratio * available;
  };
  const firstIndex = Math.min(sortedUpperBound(beats, start), count);
  const firstValue = firstIndex === 0 ? series.initial : values[firstIndex - 1]!;
  // Filled area.
  let y = yOf(firstValue);
  body.moveTo(0, bottom).lineTo(0, y);
  for (let index = firstIndex; index < count; index += 1) {
    const beat = beats[index]!;
    if (beat >= end) break;
    const x = (beat - start) * pxPerBeat;
    const nextY = yOf(values[index]!);
    body.lineTo(x, y).lineTo(x, nextY);
    y = nextY;
  }
  body
    .lineTo(width, y)
    .lineTo(width, bottom)
    .closePath()
    .fill({
      color: palette.text,
      alpha: CONTENT_LEVEL_FILL_ALPHA * alphaScale,
    });
  // Top edge as a crisp line (same walk, stroke only).
  y = yOf(firstValue);
  body.moveTo(0, y);
  for (let index = firstIndex; index < count; index += 1) {
    const beat = beats[index]!;
    if (beat >= end) break;
    const x = (beat - start) * pxPerBeat;
    const nextY = yOf(values[index]!);
    body.lineTo(x, y).lineTo(x, nextY);
    y = nextY;
  }
  body.lineTo(width, y).stroke({
    color: palette.text,
    width: 1.25,
    alpha: CONTENT_LEVEL_LINE_ALPHA * alphaScale,
  });
}

function drawClipBodyLocal(
  body: Graphics,
  view: PlaylistClipPresentation,
  palette: PixiPaletteColors,
  localBars: readonly number[] | null,
  detailVisible: boolean,
  content: PlaylistClipContent | null = null,
): void {
  body.clear();
  const width = view.rect.width;
  const height = view.rect.height;
  const color = parseHexColor(view.clip.color, 0x777777);
  const muted = view.effectivelyMuted;
  const bodyAlpha = muted ? CLIP_BODY_ALPHA_MUTED : CLIP_BODY_ALPHA;
  body.roundRect(0, 0, width, height, 4).fill({ color, alpha: bodyAlpha });
  body.rect(0, 0, width, view.titleRect.height).fill({
    color: palette.panel,
    alpha: muted ? CLIP_TITLE_ALPHA * 0.6 : CLIP_TITLE_ALPHA,
  });
  if (muted) {
    const step = 8;
    for (let x = -height; x <= width + height; x += step) {
      const x1 = x;
      const x2 = x + height;
      const clampedX1 = Math.max(0, x1);
      const clampedX2 = Math.min(width, x2);
      if (clampedX1 >= clampedX2) continue;
      body
        .moveTo(clampedX1, clampedX1 - x1)
        .lineTo(clampedX2, clampedX2 - x1)
        .stroke({ color: palette.text, alpha: 0.18, width: 1 });
    }
  }
  // Host content (getClipContent) replaces the sparkline for this clip.
  if (content !== null) {
    drawClipContent(body, view, palette, content, detailVisible);
    return;
  }
  // F9: sparkline stub for pattern clips. Skipped on automation (drawn by
  // the overlay polyline) and on audio (no internal preview today). The
  // bars are pure visual filler until the financial engine plugs in real
  // data via setSparklineProvider.
  if (view.clip.type === "pattern" && width >= 60 && height >= 18) {
    const bars = getSparklineBars(view.clip.id, localBars);
    if (bars.length > 0) {
      // Reserve the detail line so the bars don't run under its text.
      const titleH =
        view.titleRect.height + (detailVisible ? DETAIL_LINE_HEIGHT : 0);
      const drawableHeight = height - titleH - 6;
      if (drawableHeight > 2) {
        const padX = 8;
        const usable = Math.max(0, width - padX * 2);
        const barWidth = 2;
        const slot = bars.length > 1 ? usable / (bars.length - 1) : usable;
        for (let i = 0; i < bars.length; i += 1) {
          const ratio = bars[i]!;
          const h = Math.max(1, Math.round(drawableHeight * ratio));
          const x = padX + Math.round(i * slot);
          if (x + barWidth > width - padX) continue;
          const yTop = titleH + 3 + (drawableHeight - h);
          body
            .rect(x, yTop, barWidth, h)
            .fill({ color: palette.text, alpha: 0.32 });
        }
      }
    }
  }
}

function drawClipOverlayLocal(
  overlay: Graphics,
  view: PlaylistClipPresentation,
  palette: PixiPaletteColors,
): void {
  overlay.clear();
  const width = view.rect.width;
  const height = view.rect.height;
  const resizeHandleWidth = view.resizeLeftRect.width;
  const handleHeight =
    view.resizeLeftRect.height ?? view.titleRect.height ?? height;

  // F10: outer-glow halo around selected clips. Drawn first so the
  // crisper inner stroke sits on top. Reuses palette.selected so the
  // halo stays in the SliceX accent.
  if (view.selected) {
    overlay
      .roundRect(-2, -2, width + 4, height + 4, 5)
      .stroke({ color: palette.selected, width: 1, alpha: 0.35 });
  }
  overlay.roundRect(0, 0, width, height, 4).stroke({
    color: view.selected
      ? palette.selected
      : view.hovered
        ? palette.hover
        : palette.rowLine,
    width: view.selected ? 2.5 : 1,
    alpha: view.hovered || view.selected ? 1 : 0.8,
  });

  overlay.rect(0, 0, resizeHandleWidth, handleHeight).fill({
    color: palette.text,
    alpha: CLIP_RESIZE_ALPHA,
  });
  overlay
    .rect(width - resizeHandleWidth, 0, resizeHandleWidth, handleHeight)
    .fill({ color: palette.text, alpha: CLIP_RESIZE_ALPHA });

  // F6: subtle dot in the top-right corner when a clip belongs to a group
  // and the user is hovering. Renders only on hover so a fully-grouped
  // playlist doesn't look noisy. Outside the resize handle band so it
  // doesn't interfere with the resize affordance.
  if (view.groupId && view.hovered) {
    const dotX = Math.max(8, width - 10);
    const dotY = 8;
    overlay.circle(dotX, dotY, 3).fill({
      color: palette.selected,
      alpha: 0.85,
    });
  }

  if (view.isAutomation && view.automationPoints.length > 0) {
    const points = view.automationPoints;
    const localX = (px: number) => px - view.rect.x;
    const localY = (py: number) => py - view.rect.y;
    overlay.moveTo(localX(points[0]!.position.x), localY(points[0]!.position.y));
    for (let i = 1; i < points.length; i += 1) {
      overlay.lineTo(localX(points[i]!.position.x), localY(points[i]!.position.y));
    }
    overlay.stroke({ color: palette.automationLine, width: 4, alpha: 0.55 });
    overlay.moveTo(localX(points[0]!.position.x), localY(points[0]!.position.y));
    for (let i = 1; i < points.length; i += 1) {
      overlay.lineTo(localX(points[i]!.position.x), localY(points[i]!.position.y));
    }
    overlay.stroke({ color: palette.text, width: 2, alpha: 0.9 });
    for (const point of points) {
      overlay
        .circle(
          localX(point.position.x),
          localY(point.position.y),
          point.selected ? 6.5 : 5,
        )
        .fill({
          color: point.selected ? palette.selected : palette.panelStrong,
        })
        .stroke({ color: palette.text, width: 1.5 });
    }
  }
}

function ensureText(
  node: ClipNode,
  key: "label" | "ratioBadge" | "offsetBadge" | "detail",
  factory: () => Text,
): Text {
  let existing = node[key];
  if (!existing) {
    existing = factory();
    existing.eventMode = "none";
    node.container.addChild(existing);
    node[key] = existing;
  }
  return existing;
}

function hideText(t: Text | null): void {
  if (t) t.visible = false;
}

function applyText(
  text: Text,
  value: string,
  color: number,
  size: number,
  weight: string,
): void {
  if (text.text !== value) text.text = value;
  const style = text.style;
  if (style.fill !== color) style.fill = color;
  if (style.fontSize !== size) style.fontSize = size;
  if (style.fontWeight !== weight) style.fontWeight = weight as any;
  text.visible = true;
}

export interface ClipNodeRegistry {
  syncFrame(parent: Container, views: PlaylistClipPresentation[]): void;
  destroy(): void;
}

export function createClipNodeRegistry(
  palette: PixiPaletteColors,
  providers: ClipNodeProviders = {},
): ClipNodeRegistry {
  const cache = new Map<string, ClipNode>();
  const getClipDetail = providers.getClipDetail;
  const getClipSparkline = providers.getClipSparkline;
  const getClipContent = providers.getClipContent;

  // Secondary line under the title bar. Created lazily ONCE per node (same
  // factory pattern as the title label), never per frame.
  function applyDetail(
    node: ClipNode,
    view: PlaylistClipPresentation,
    detail: string | null,
    visible: boolean,
  ): void {
    if (!visible || detail === null) {
      hideText(node.detail);
      return;
    }
    const width = view.rect.width;
    if (node.detailSource !== detail || node.detailWidth !== width) {
      node.detailSource = detail;
      node.detailWidth = width;
      node.detailDisplay = truncateClipDetail(detail, width);
    }
    if (node.detailDisplay.length === 0) {
      hideText(node.detail);
      return;
    }
    const text = ensureText(node, "detail", () =>
      new Text({
        text: node.detailDisplay,
        style: {
          fill: palette.textMuted,
          fontFamily: "Segoe UI, Arial, sans-serif",
          fontSize: DETAIL_FONT_SIZE,
          fontWeight: "600" as any,
        },
      }),
    );
    applyText(
      text,
      node.detailDisplay,
      palette.textMuted,
      DETAIL_FONT_SIZE,
      "600",
    );
    text.x = DETAIL_PAD_X;
    text.y = view.titleRect.height + 1;
  }

  function applyLabels(
    node: ClipNode,
    view: PlaylistClipPresentation,
    detailVisible: boolean,
  ): void {
    const width = view.rect.width;
    const height = view.rect.height;
    if (width < 44 || height < 24) {
      hideText(node.label);
      hideText(node.ratioBadge);
      hideText(node.offsetBadge);
      return;
    }
    const label = ensureText(node, "label", () =>
      new Text({
        text: view.clip.label,
        style: {
          fill: palette.text,
          fontFamily: "Segoe UI, Arial, sans-serif",
          fontSize: 12,
          fontWeight: "700" as any,
        },
      }),
    );
    applyText(label, view.clip.label, palette.text, 12, "700");
    label.x = 12;
    label.y = 4;

    const ratio = view.clip.stretchRatio ?? 1;
    if (Math.abs(ratio - 1) > 0.001 && width >= 60) {
      const tagText = `×${ratio.toFixed(2).replace(/\.?0+$/, "")}`;
      const badge = ensureText(node, "ratioBadge", () =>
        new Text({
          text: tagText,
          style: {
            fill: palette.text,
            fontFamily: "Segoe UI, Arial, sans-serif",
            fontSize: 10,
            fontWeight: "700" as any,
          },
        }),
      );
      applyText(badge, tagText, palette.text, 10, "700");
      badge.x = width - 8 - tagText.length * 6;
      badge.y = 4;
    } else {
      hideText(node.ratioBadge);
    }

    const offset = view.clip.contentOffset ?? 0;
    if (Math.abs(offset) > 0.001 && width >= 80) {
      const offsetText = `↻${offset.toFixed(2).replace(/\.?0+$/, "")}`;
      const badge = ensureText(node, "offsetBadge", () =>
        new Text({
          text: offsetText,
          style: {
            fill: palette.textMuted,
            fontFamily: "Segoe UI, Arial, sans-serif",
            fontSize: 10,
            fontWeight: "600" as any,
          },
        }),
      );
      applyText(badge, offsetText, palette.textMuted, 10, "600");
      badge.x = 12;
      // With a detail line present the badge drops below it (or hides when
      // there is no room) so the two never overlap.
      if (detailVisible) {
        const y = view.titleRect.height + 1 + DETAIL_LINE_HEIGHT;
        badge.y = y;
        if (y + DETAIL_LINE_HEIGHT > height) badge.visible = false;
      } else {
        badge.y = 18;
      }
    } else {
      hideText(node.offsetBadge);
    }
  }

  function createNode(): ClipNode {
    const container = new Container();
    container.eventMode = "none";
    const body = new Graphics();
    const overlay = new Graphics();
    container.addChild(body, overlay);
    return {
      container,
      body,
      overlay,
      label: null,
      ratioBadge: null,
      offsetBadge: null,
      detail: null,
      detailSource: "",
      detailWidth: -1,
      detailDisplay: "",
      bars: null,
      content: null,
      contentStart: 0,
      contentPxPerBeat: 0,
      hash: "",
      width: 0,
      height: 0,
    };
  }

  function syncFrame(
    parent: Container,
    views: PlaylistClipPresentation[],
  ): void {
    const seen = new Set<string>();
    for (const view of views) {
      seen.add(view.clip.id);
      let node = cache.get(view.clip.id);
      if (!node) {
        node = createNode();
        cache.set(view.clip.id, node);
        parent.addChild(node.container);
      }
      node.container.visible = true;
      node.container.x = Math.round(view.rect.x);
      node.container.y = Math.round(view.rect.y);
      const detail = getClipDetail ? getClipDetail(view.clip.id) : null;
      const detailVisible = isClipDetailVisible(view, detail);
      // Queried every frame for visible pattern clips (O(1) by contract) so
      // bars that depend on data outside the hash — e.g. the clip's calendar
      // position — still repaint; the reference compare keeps it free.
      const content =
        getClipContent && !view.isAutomation
          ? getClipContent(view.clip.id)
          : null;
      const bars =
        content === null && getClipSparkline && view.clip.type === "pattern"
          ? getClipSparkline(view.clip.id)
          : null;
      const hash = clipVisualHash(view, detail);
      const visualChanged =
        hash !== node.hash ||
        node.width !== view.rect.width ||
        node.height !== view.rect.height;
      // Content is laid out at absolute beats: a move or a zoom re-lays it
      // out even with the same reference (number compares, no allocation).
      const contentPxPerBeat =
        content !== null
          ? view.rect.width / Math.max(view.clip.duration, 1e-9)
          : 0;
      const contentChanged =
        content !== node.content ||
        (content !== null &&
          (node.contentStart !== view.clip.start ||
            node.contentPxPerBeat !== contentPxPerBeat));
      if (visualChanged || bars !== node.bars || contentChanged) {
        // New bars / content alone only touch the body; the overlay
        // (outline, handles, automation polyline) does not depend on them.
        drawClipBodyLocal(
          node.body,
          view,
          palette,
          bars,
          detailVisible,
          content,
        );
        node.bars = bars;
        node.content = content;
        node.contentStart = view.clip.start;
        node.contentPxPerBeat = contentPxPerBeat;
      }
      if (visualChanged) {
        drawClipOverlayLocal(node.overlay, view, palette);
        node.hash = hash;
        node.width = view.rect.width;
        node.height = view.rect.height;
      }
      applyLabels(node, view, detailVisible);
      applyDetail(node, view, detail, detailVisible);
    }
    // Hide nodes whose clips are off-screen this frame. We keep them
    // parented so future frames can show them again in O(1) — only
    // destroy() runs on registry tear-down. PERF-EXEMPT n/a: this is
    // exactly the cache + recycle pattern §3.8 prescribes.
    for (const [id, node] of cache) {
      if (seen.has(id)) continue;
      node.container.visible = false;
      hideText(node.label);
      hideText(node.ratioBadge);
      hideText(node.offsetBadge);
      hideText(node.detail);
    }
  }

  function destroy(): void {
    for (const node of cache.values()) {
      try {
        node.container.removeFromParent();
        // Graphics destroys are safe; Text is left to GC to avoid the v8
        // TexturePool tear-down crash (canon §3 + dispose-text history).
        node.body.destroy();
        node.overlay.destroy();
        if (node.label) node.label.removeFromParent();
        if (node.ratioBadge) node.ratioBadge.removeFromParent();
        if (node.offsetBadge) node.offsetBadge.removeFromParent();
        if (node.detail) node.detail.removeFromParent();
      } catch {
        // noop — best-effort cleanup
      }
    }
    cache.clear();
  }

  return { syncFrame, destroy };
}
