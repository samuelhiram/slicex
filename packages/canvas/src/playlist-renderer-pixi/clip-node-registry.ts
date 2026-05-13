import { Container, Graphics, Text } from "pixi.js";
import type { PlaylistClipPresentation } from "../playlist-core";

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

function clipVisualHash(view: PlaylistClipPresentation): string {
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
    view.rect.width,
    view.rect.height,
    Math.round(view.titleRect.height * 100),
    ratio,
    offset,
    view.groupId ?? "",
  ].join("|");
}

function drawClipBodyLocal(
  body: Graphics,
  view: PlaylistClipPresentation,
  palette: PixiPaletteColors,
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

  overlay.roundRect(0, 0, width, height, 4).stroke({
    color: view.selected
      ? palette.selected
      : view.hovered
        ? palette.hover
        : palette.rowLine,
    width: view.selected ? 2 : 1,
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
  key: "label" | "ratioBadge" | "offsetBadge",
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
): ClipNodeRegistry {
  const cache = new Map<string, ClipNode>();

  function applyLabels(node: ClipNode, view: PlaylistClipPresentation): void {
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
      badge.y = 18;
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
      const hash = clipVisualHash(view);
      if (
        hash !== node.hash ||
        node.width !== view.rect.width ||
        node.height !== view.rect.height
      ) {
        drawClipBodyLocal(node.body, view, palette);
        drawClipOverlayLocal(node.overlay, view, palette);
        node.hash = hash;
        node.width = view.rect.width;
        node.height = view.rect.height;
      }
      applyLabels(node, view);
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
      } catch {
        // noop — best-effort cleanup
      }
    }
    cache.clear();
  }

  return { syncFrame, destroy };
}
