// Renderer-impl: orchestrator only.
//
// All DisplayObjects (Container/Graphics/Text) are created here in the init
// block — that's the one place the static lint
// (scripts/check-perf-patterns.mjs) allows `new Pixi*()` calls. Per-layer
// draw routines live under ./layers and operate on pre-created Graphics
// instances (canon §3.8).
//
// renderNow() is the rAF-coalesced frame painter: every notify from the
// core schedules at most one render per animation frame, and the static
// layers (mask, grid) keep a dirty-key cache so hover/selection updates
// don't redraw them.
import { Application, Container, Graphics } from "pixi.js";
import type { PlaylistCore } from "../playlist-core";
import { createClipNodeRegistry } from "./clip-node-registry";
import { COLORS } from "./palette";
import {
  clearTextLayer,
  disposeTextLayer,
} from "./text-pool";
import {
  drawSceneBackground,
  drawTrackRowsBackground,
} from "./layers/background";
import { drawRulerChrome, drawTimelineGrid } from "./layers/ruler";
import { drawTrackRows } from "./layers/track-rows";
import { drawMarkers } from "./layers/markers";
import { drawLoopRegion } from "./layers/loop-region";
import { drawPlayPositionRulerMarker } from "./layers/play-position";
import { drawTimelineOverlay } from "./layers/overlay";
import { drawScrollbars } from "./layers/scrollbars";
import { drawSnapIndicator } from "./layers/snap-indicator";
import { drawDropGhost } from "./layers/drop-ghost";
import { drawTooltip } from "./layers/tooltip";

export interface PlaylistRendererCallbacks {
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

export interface PlaylistRenderer {
  destroy: () => void;
}

export function createPlaylistRenderer(
  container: HTMLElement,
  core: PlaylistCore,
  callbacks: PlaylistRendererCallbacks = {},
): PlaylistRenderer {
  const app = new Application();
  const root = new Container();
  const sceneGraphics = new Graphics();
  const timelineMask = new Graphics();
  const timelineContainer = new Container();
  const timelineGridGraphics = new Graphics();
  // Per-clip cached scene graph. Each clip owns a small Container drawn in
  // local coords; renderNow only diffs visual hashes and updates transforms.
  // See clip-node-registry.ts (canon §3.8).
  const clipsLayer = new Container();
  clipsLayer.eventMode = "none";
  const clipNodeRegistry = createClipNodeRegistry({
    text: COLORS.text,
    textMuted: COLORS.textMuted,
    selected: COLORS.selected,
    hover: COLORS.hover,
    rowLine: COLORS.rowLine,
    panel: COLORS.panel,
    panelStrong: COLORS.panelStrong,
    automationLine: COLORS.automationLine,
  });
  const overlayGraphics = new Graphics();
  // Drag-preview ghost + snap indicator sit inside the timeline mask so they
  // disappear behind the ruler/header instead of bleeding into the chrome.
  const dropGhostGraphics = new Graphics();
  const snapIndicatorGraphics = new Graphics();
  const chromeGraphics = new Graphics();
  // F10: recording pulse — top-edge band that breathes while the
  // transport is recording. Its own Graphics so we can repaint just this
  // layer on the rAF tick without touching the rest of chrome.
  const recordingPulseGraphics = new Graphics();
  const chromeTextLayer = new Container();
  const foregroundGraphics = new Graphics();
  const foregroundTextLayer = new Container();
  // Tooltip layer — one Container with its own background Graphics + text
  // pool, lives above the foreground so it's never clipped. F3 will wire
  // the actual draw call; in F2 the layer exists but draws nothing.
  const tooltipContainer = new Container();
  tooltipContainer.eventMode = "none";
  const tooltipBackground = new Graphics();
  const tooltipTextLayer = new Container();
  tooltipContainer.addChild(tooltipBackground, tooltipTextLayer);

  let destroyed = false;
  let ready = false;
  let appDisposed = false;

  // Idempotent shutdown of the Pixi Application. Calling app.destroy twice
  // (e.g. once from the React cleanup and again from the resolved init
  // promise) corrupts shared globals in Pixi v8 and surfaces later as
  // "Cannot read properties of null (reading 'geometry')" inside the
  // batcher pipeline. This helper makes the order-of-operations safe.
  const disposeApp = (): void => {
    if (appDisposed) return;
    appDisposed = true;
    try {
      app.stage.removeChild(root);
    } catch {
      // noop
    }
    try {
      app.destroy(true);
    } catch {
      // noop
    }
  };

  root.eventMode = "none";
  timelineContainer.mask = timelineMask;
  timelineContainer.addChild(
    timelineGridGraphics,
    clipsLayer,
    overlayGraphics,
    dropGhostGraphics,
    snapIndicatorGraphics,
  );
  root.addChild(
    sceneGraphics,
    timelineMask,
    timelineContainer,
    chromeGraphics,
    chromeTextLayer,
    foregroundGraphics,
    foregroundTextLayer,
    recordingPulseGraphics,
    tooltipContainer,
  );

  // Canon §3.10: coalesce notifications into a single rAF frame.
  // dispatch() invokes notify() synchronously, so a fast burst (pointermove
  // batch, brush stroke, scrollbar drag) used to produce one render per
  // notify. Now every notify schedules at most one render per animation
  // frame; if N notifies arrive within the same frame, the renderer reads
  // the latest state and paints once.
  let renderFrameId = 0;
  let renderQueuedNow = false;
  // Caches keyed on the inputs that actually affect each static layer.
  // Layers fall back to their previous frame's geometry when the key
  // hasn't changed — saves clear() + re-emit on every render.
  let maskKey = "";
  let gridKey = "";

  const renderNow = (): void => {
    if (!ready || destroyed) {
      return;
    }
    renderQueuedNow = false;
    renderFrameId = 0;

    const presentation = core.getPresentation();
    const layout = presentation.layout;
    const viewport = presentation.state.viewport;

    sceneGraphics.clear();
    overlayGraphics.clear();
    dropGhostGraphics.clear();
    snapIndicatorGraphics.clear();
    chromeGraphics.clear();
    clearTextLayer(chromeTextLayer);
    foregroundGraphics.clear();
    clearTextLayer(foregroundTextLayer);
    tooltipBackground.clear();
    clearTextLayer(tooltipTextLayer);

    drawSceneBackground(sceneGraphics, presentation);
    drawTrackRowsBackground(sceneGraphics, presentation);

    // Mask depends only on viewport size + header/ruler metrics. Skip the
    // clear()+rect()+fill() unless those changed.
    const nextMaskKey = `${layout.timelineRect.x}|${layout.timelineRect.y}|${layout.timelineRect.width}|${layout.timelineRect.height}`;
    if (nextMaskKey !== maskKey) {
      maskKey = nextMaskKey;
      timelineMask.clear();
      timelineMask
        .rect(
          layout.timelineRect.x,
          layout.timelineRect.y,
          layout.timelineRect.width,
          layout.timelineRect.height,
        )
        .fill({ color: 0xffffff });
    }

    // Grid only changes with zoom, horizontal scroll, viewport width, or
    // total scene height. Hover/selection/etc. don't touch it.
    const ticks = presentation.rulerTicks;
    const nextGridKey = `${viewport.pxPerBeat}|${viewport.scrollX}|${viewport.width}|${layout.sceneRect.height}|${ticks.length}|${ticks[0]?.x ?? 0}`;
    if (nextGridKey !== gridKey) {
      gridKey = nextGridKey;
      timelineGridGraphics.clear();
      drawTimelineGrid(timelineGridGraphics, presentation);
    }

    // Per-clip cached scene graph: each clip is a Container with its own
    // Graphics + Text drawn once in local coords. Frame-to-frame work is
    // just transform updates unless the clip's visual hash changed.
    clipNodeRegistry.syncFrame(clipsLayer, presentation.visibleClipViews);
    drawTimelineOverlay(overlayGraphics, presentation);
    // F3 overlays: ghost outline at the snapped destination + vertical
    // snap-indicator line. Both are no-ops until F3 lands; the Graphics
    // layers exist now so the renderer-impl init stays the single source
    // of DisplayObject creation.
    drawDropGhost(dropGhostGraphics, presentation);
    drawSnapIndicator(snapIndicatorGraphics, presentation);

    drawRulerChrome(chromeGraphics, chromeTextLayer, presentation);
    drawTrackRows(chromeGraphics, chromeTextLayer, presentation);
    drawLoopRegion(chromeGraphics, presentation);
    drawMarkers(chromeGraphics, chromeTextLayer, presentation);
    drawPlayPositionRulerMarker(chromeGraphics, presentation);

    drawScrollbars(foregroundGraphics, presentation);

    // F10: recording pulse — only emit when transport.recording is true.
    // The alpha breathes between 0.5 and 1 with a sin over performance.now,
    // so the strip looks alive even when the rest of the scene is static.
    recordingPulseGraphics.clear();
    if (presentation.state.transport.recording) {
      const alpha = 0.5 + 0.5 * Math.sin(performance.now() / 250);
      recordingPulseGraphics
        .rect(0, 0, layout.sceneRect.width, 2)
        .fill({ color: COLORS.recordingIndicator, alpha });
    }

    drawTooltip(
      {
        container: tooltipContainer,
        background: tooltipBackground,
        textLayer: tooltipTextLayer,
      },
      presentation,
    );

    (app as any).render?.();
  };

  const requestRender = (): void => {
    if (renderQueuedNow || renderFrameId !== 0 || destroyed) return;
    if (typeof requestAnimationFrame === "undefined") {
      renderQueuedNow = true;
      renderNow();
      return;
    }
    renderFrameId = requestAnimationFrame(() => renderNow());
  };

  const resize = (): void => {
    if (!ready || destroyed) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const viewport = core.getPresentation().state.viewport;
    const sizeChanged =
      viewport.width !== width || viewport.height !== height;

    app.renderer.resize(width, height);

    if (sizeChanged) {
      // setViewportSize dispatches + notifies → requestRender via subscribe.
      core.setViewportSize(width, height);
      return;
    }

    // Size unchanged: nothing dispatches, so the subscribe path won't
    // fire. Schedule a render anyway so the first frame after init isn't
    // skipped when the container already matches the model's initial
    // viewport (1×1 from the demo when getBoundingClientRect briefly
    // reports 0×0 during a StrictMode remount).
    requestRender();
  };

  const resizeObserver =
    typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  const subscription = core.subscribe(requestRender);

  // F10: dedicated rAF that keeps the recording pulse animating while
  // transport.recording is true. Canon §3.11 — no idle tick: the loop
  // only runs while recording, and stops the moment it flips back.
  let recordingFrameId = 0;
  let recordingActive = false;
  const recordingTick = (): void => {
    if (!recordingActive || destroyed) {
      recordingFrameId = 0;
      return;
    }
    requestRender();
    recordingFrameId = requestAnimationFrame(recordingTick);
  };
  const recordingSubscription = core.subscribe((state) => {
    const nextActive = state.transport.recording;
    if (nextActive === recordingActive) return;
    recordingActive = nextActive;
    if (nextActive && recordingFrameId === 0 && typeof requestAnimationFrame !== "undefined") {
      recordingFrameId = requestAnimationFrame(recordingTick);
    }
  });

  void app
    .init({
      antialias: true,
      autoDensity: true,
      backgroundColor: COLORS.background,
      resolution:
        typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    })
    .then(() => {
      if (destroyed) {
        // React already tore the renderer down while init was in flight.
        // Hand off to the idempotent disposer so we don't double-destroy.
        disposeApp();
        return;
      }

      const canvas = (app as any).canvas as HTMLCanvasElement;
      canvas.style.display = "block";
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      container.appendChild(canvas);
      app.stage.addChild(root);
      ready = true;
      resizeObserver?.observe(container);
      resize();
      // Catch a layout that wasn't ready during the initial resize call
      // (StrictMode double-mount can land the .then() before the browser
      // has paint-resolved the container's real size). One follow-up tick
      // is enough — if the size has stabilized by then, the call is a
      // cheap no-op via setViewportSize idempotency.
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(() => {
          if (!destroyed) resize();
        });
      }
      callbacks.onReady?.();
    })
    .catch((error: unknown) => {
      callbacks.onError?.(error);
    });

  return {
    destroy() {
      destroyed = true;
      subscription.unsubscribe();
      recordingSubscription.unsubscribe();
      recordingActive = false;
      if (
        recordingFrameId !== 0 &&
        typeof cancelAnimationFrame !== "undefined"
      ) {
        cancelAnimationFrame(recordingFrameId);
        recordingFrameId = 0;
      }
      resizeObserver?.disconnect();
      // If the Pixi app hasn't finished initialising yet, leave disposal to
      // the .then() handler above. Touching app.stage / app.destroy before
      // init() resolves leads to a double-destroy in Pixi v8 once the
      // promise lands — that's what corrupts the batcher pipeline and
      // surfaces as a null-geometry crash on the next mount.
      if (!ready) {
        return;
      }
      if (renderFrameId !== 0 && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(renderFrameId);
        renderFrameId = 0;
      }
      sceneGraphics.clear();
      timelineMask.clear();
      timelineGridGraphics.clear();
      clipNodeRegistry.destroy();
      overlayGraphics.clear();
      dropGhostGraphics.clear();
      snapIndicatorGraphics.clear();
      chromeGraphics.clear();
      recordingPulseGraphics.clear();
      disposeTextLayer(chromeTextLayer);
      foregroundGraphics.clear();
      disposeTextLayer(foregroundTextLayer);
      tooltipBackground.clear();
      disposeTextLayer(tooltipTextLayer);
      disposeApp();
    },
  };
}
