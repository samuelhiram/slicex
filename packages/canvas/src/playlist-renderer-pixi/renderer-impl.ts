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
import {
  Application,
  CanvasTextMetrics,
  Container,
  Graphics,
  Text,
} from "pixi.js";
import type {
  PlaylistClipContent,
  PlaylistCore,
  PlaylistDragAnnotation,
  PlaylistOverviewData,
  PlaylistTrackMeta,
} from "../playlist-core";
import {
  createClipExtendHandle,
  getClipExtendHandle,
  getClipLevelGripX,
  type PlaylistPresentation,
} from "../playlist-core";
import { createClipNodeRegistry } from "./clip-node-registry";
import {
  COLORS,
  applyPlaylistTheme,
  type PlaylistThemeName,
} from "./palette";
import {
  clearTextLayer,
  disposeTextLayer,
} from "./text-pool";
import {
  drawSceneBackground,
  drawTrackRowsBackground,
} from "./layers/background";
import { drawRulerChrome, drawTimelineGrid } from "./layers/ruler";
import { createTrackLabelFormatter, createTrackMetaSource, drawTrackRows } from "./layers/track-rows";
import { createOverviewLaneLayer } from "./layers/overview-lane";
import { createDragAnnotationLayer } from "./layers/drag-annotation";
import { drawMarkers } from "./layers/markers";
import { drawLoopRegion } from "./layers/loop-region";
import { drawPlayPositionRulerMarker } from "./layers/play-position";
import { drawTimelineOverlay } from "./layers/overlay";
import { drawClipExtendHandle } from "./layers/extend-handle";
import { createNavigatorLayer, drawScrollbars } from "./layers/scrollbars";
import { drawSnapIndicator } from "./layers/snap-indicator";
import { drawHoverTime } from "./layers/hover-time";
import { drawDropGhost } from "./layers/drop-ghost";
import { drawTooltip } from "./layers/tooltip";

export interface PlaylistRendererCallbacks {
  // Initial theme (light / dark). Default: whatever the live palette holds
  // (light unless a previous renderer switched it). Change it later with
  // PlaylistRenderer.setTheme.
  theme?: PlaylistThemeName;
  // Hovered clips show the level grip on their top edge (pair with the
  // interaction controller's onClipLevelDrag).
  clipLevelHandles?: boolean;
  // The grip is a fixed target (pair with the controller's clipLevelGrip):
  // drawn on the hovered and the selected clip where the hit-test expects
  // it (getClipLevelGripX), in the per-frame overlay — at most two shapes.
  clipLevelGrip?: boolean;
  // The selected clip shows the extend grabber (pair with the interaction
  // controller's clipExtend, passing the SAME predicate). Called once per
  // frame for the selected clip: O(1), a plain boolean.
  clipExtend?: (clipId: string) => boolean;
  // Host emphasis per clip: true = warm ring, "danger" = a red ring and a
  // dimmed card (e.g. what a delete sweep will remove). Called once per
  // VISIBLE clip per frame: O(1), a primitive; call invalidate() when it
  // changes.
  getClipHighlight?: (clipId: string) => boolean | "danger";
  // Lines of a clip's info card (a "clip" tooltip, see the interaction
  // controller's hoverCardDelayMs), "\n"-separated. Called once per frame
  // while the card shows: O(1) cached, the SAME string while unchanged.
  getClipInfo?: (clipId: string) => string | null;
  // Show the FL slip / stretch badges ("↻ offset", "×ratio") on clips.
  // Default true; a host whose clips have no such meaning turns them off.
  // Read once.
  clipBadges?: boolean;
  // A second line under the date of a time tooltip (e.g. the cash that
  // day). Called once per frame while such a tooltip shows: O(1) cached,
  // the SAME string while unchanged; null = no line.
  getTooltipDetail?: (beat: number) => string | null;
  onReady?: () => void;
  onError?: (error: unknown) => void;
  // Secondary line drawn inside the clip body under the title. Called once
  // per VISIBLE clip per frame: must be an O(1) cached lookup returning a
  // stable string. null → no detail line.
  getClipDetail?: (clipId: string) => string | null;
  // Per-renderer sparkline data; takes precedence over the global
  // setSparklineProvider. null → existing behaviour, [] → no bars. Called
  // once per VISIBLE pattern clip per frame: must be an O(1) cached lookup
  // that returns the SAME array reference while the bars are unchanged (a
  // new reference repaints that clip body). See ClipNodeProviders in
  // clip-node-registry.ts.
  getClipSparkline?: (clipId: string) => readonly number[] | null;
  // Content drawn inside a clip body at absolute beats (events / level).
  // Non-null wins over the sparkline for that clip. Called once per VISIBLE
  // non-automation clip per frame: O(1) lookup returning the SAME object
  // while unchanged (a new reference repaints that body).
  getClipContent?: (clipId: string) => PlaylistClipContent | null;
  // Data of the overview lane (metrics.overviewLaneHeight > 0). Called once
  // per frame: O(1), the SAME object while unchanged. A new reference (or
  // a scroll / zoom / resize) rebuilds the lane geometry; nothing else does.
  getOverviewData?: () => PlaylistOverviewData | null;
  // Pill attached below the floating tooltip while it is visible. Called
  // once per frame while a tooltip shows: O(1), same object while unchanged
  // (a new reference repaints the pill; following the cursor is free).
  getDragAnnotation?: () => PlaylistDragAnnotation | null;
  // Header extras per track (subtitle + meter). Called once per VISIBLE
  // real row per frame: O(1), same object while unchanged.
  getTrackMeta?: (trackId: string) => PlaylistTrackMeta | null;
  // Name shown for a row (e.g. the host's own word for the engine's
  // auto-named "Track N" rows). Called once per distinct label: the result
  // is cached, so a steady frame allocates nothing.
  formatTrackLabel?: (label: string) => string;
}

export interface PlaylistRenderer {
  destroy: () => void;
  // Ask for a repaint without a core notify — for hosts whose provider data
  // (getClipDetail / getClipSparkline) changed while PlaylistState did not.
  // Goes through the same rAF-coalesced requestRender as core notifies
  // (canon §3.10): any number of calls (and notifies) within one frame
  // paint once; no extra tick is started (canon §3.11). Safe before the
  // Pixi app is ready (the first ready frame picks it up) and a no-op after
  // destroy().
  invalidate: () => void;
  // Switches the live palette (palette.ts) and repaints every cached layer
  // once (grid, clip nodes, overview lane, drag pill). No-op when the theme
  // is already active. Rare event: never call it per frame.
  setTheme: (theme: PlaylistThemeName) => void;
  // Re-rasterises every canvas label with the fonts available now. Call it
  // once when a web font finishes loading after the renderer was created
  // (Pixi rasterises a Text once and caches it by text + style key). Never
  // per frame.
  refreshFonts: () => void;
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
  if (callbacks.theme) applyPlaylistTheme(callbacks.theme);
  // The LIVE palette object: a theme switch mutates it in place and
  // invalidates the registry, so nodes repaint with the new colours.
  const clipNodeRegistry = createClipNodeRegistry(
    COLORS,
    {
      levelHandles: callbacks.clipLevelHandles === true,
      levelGrip: callbacks.clipLevelGrip === true,
      isClipHighlighted: callbacks.getClipHighlight,
      badges: callbacks.clipBadges !== false,
      getClipDetail: callbacks.getClipDetail,
      getClipSparkline: callbacks.getClipSparkline,
      getClipContent: callbacks.getClipContent,
    },
  );
  // Overview lane (canon §3.10 cached layer): frame + curves rebuilt only
  // on their dirty keys; a tiny dynamic Graphics for the playhead.
  const overviewContainer = new Container();
  overviewContainer.eventMode = "none";
  overviewContainer.visible = false;
  const overviewFrameGraphics = new Graphics();
  const overviewFrameText = new Container();
  const overviewCurveGraphics = new Graphics();
  const overviewCurveText = new Container();
  const overviewDynamicGraphics = new Graphics();
  overviewContainer.addChild(
    overviewFrameGraphics,
    overviewFrameText,
    overviewCurveGraphics,
    overviewCurveText,
    overviewDynamicGraphics,
  );
  const overviewLane = createOverviewLaneLayer({
    container: overviewContainer,
    frameGraphics: overviewFrameGraphics,
    frameText: overviewFrameText,
    curveGraphics: overviewCurveGraphics,
    curveText: overviewCurveText,
    dynamicGraphics: overviewDynamicGraphics,
  });
  const getOverviewData = callbacks.getOverviewData;
  const trackMetaSource = callbacks.getTrackMeta
    ? createTrackMetaSource(callbacks.getTrackMeta)
    : null;
  const trackLabel = callbacks.formatTrackLabel
    ? createTrackLabelFormatter(callbacks.formatTrackLabel)
    : null;
  const overlayGraphics = new Graphics();
  const levelGrip = callbacks.clipLevelGrip === true;
  // The level grip of one clip (O(1): a map lookup + a rounded rect).
  const drawLevelGripOf = (presentation: PlaylistPresentation, clipId: string): void => {
    const view = presentation.clipViewsById.get(clipId);
    if (!view || !view.isVisible || view.isAutomation || view.trackLocked) return;
    if (view.rect.width < 24 || view.rect.height < 12) return;
    const x = getClipLevelGripX(view, presentation.metrics, presentation.state.viewport.width);
    overlayGraphics
      .roundRect(x - 9, view.rect.y + 1.5, 18, 3.5, 1.75)
      .fill({ color: view.selected ? COLORS.selected : COLORS.text, alpha: view.selected ? 0.9 : 0.45 });
  };
  const drawLevelGrips = (presentation: PlaylistPresentation): void => {
    const state = presentation.state;
    const hover = state.hover;
    const hovered = hover && hover.kind === "clip" ? hover.clipId : null;
    if (hovered) drawLevelGripOf(presentation, hovered);
    const selected = state.selection.clipIds;
    if (selected.length === 1 && selected[0] !== hovered) drawLevelGripOf(presentation, selected[0]!);
  };
  // Extend grabber: one reusable handle (no per-frame allocation).
  const clipExtend = callbacks.clipExtend;
  const extendHandle = createClipExtendHandle();
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
  // Track rows (headers + row lines) in their own container, masked to the
  // band below the ruler + money lane: rows scrolled up never paint over
  // the ruler or the header corner (tracks are endless, so they do scroll).
  const trackRowsContainer = new Container();
  trackRowsContainer.eventMode = "none";
  const trackRowsGraphics = new Graphics();
  const trackRowsTextLayer = new Container();
  const trackRowsMask = new Graphics();
  trackRowsContainer.addChild(trackRowsGraphics, trackRowsTextLayer);
  trackRowsContainer.mask = trackRowsMask;
  let trackRowsMaskKey = "";
  // Navigator track + miniature (cached layer under the scrollbar thumbs).
  // Hover-time indicator (state.hoverTime): the line + the ruler pill, above
  // the money lane so it crosses it. The label is cached per cell.
  const hoverTimeGraphics = new Graphics();
  const hoverTimeTextLayer = new Container();
  let hoverLabelTime: number | null = null;
  let hoverLabel: string | null = null;
  const navigatorGraphics = new Graphics();
  const navigatorLayer = createNavigatorLayer(navigatorGraphics);
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
  // Drag annotation pill under the tooltip: drawn once per reference in
  // local coords, moved by transform (see layers/drag-annotation.ts).
  const dragAnnotationContainer = new Container();
  dragAnnotationContainer.eventMode = "none";
  dragAnnotationContainer.visible = false;
  const dragAnnotationBackground = new Graphics();
  const dragAnnotationTextLayer = new Container();
  dragAnnotationContainer.addChild(
    dragAnnotationBackground,
    dragAnnotationTextLayer,
  );
  const dragAnnotation = createDragAnnotationLayer({
    container: dragAnnotationContainer,
    background: dragAnnotationBackground,
    textLayer: dragAnnotationTextLayer,
  });
  const getDragAnnotation = callbacks.getDragAnnotation;
  const getTooltipDetail = callbacks.getTooltipDetail;
  const getClipInfo = callbacks.getClipInfo;

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
    trackRowsMask,
    trackRowsContainer,
    // Above the chrome so track headers scrolled up under the lane never
    // bleed into it; below the scrollbars / tooltip.
    overviewContainer,
    hoverTimeGraphics,
    hoverTimeTextLayer,
    navigatorGraphics,
    foregroundGraphics,
    foregroundTextLayer,
    recordingPulseGraphics,
    tooltipContainer,
    dragAnnotationContainer,
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
    trackRowsGraphics.clear();
    clearTextLayer(trackRowsTextLayer);
    foregroundGraphics.clear();
    clearTextLayer(foregroundTextLayer);
    tooltipBackground.clear();
    clearTextLayer(tooltipTextLayer);
    hoverTimeGraphics.clear();
    clearTextLayer(hoverTimeTextLayer);

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
    const nextGridKey = `${viewport.pxPerBeat}|${viewport.scrollX}|${viewport.width}|${layout.sceneRect.height}|${ticks.length}|${ticks[0]?.x ?? 0}|${presentation.rulerBands.length}`;
    if (nextGridKey !== gridKey) {
      gridKey = nextGridKey;
      timelineGridGraphics.clear();
      drawTimelineGrid(timelineGridGraphics, presentation);
    }

    // Per-clip cached scene graph: each clip is a Container with its own
    // Graphics + Text drawn once in local coords. Frame-to-frame work is
    // just transform updates unless the clip's visual hash changed.
    clipNodeRegistry.syncFrame(
      clipsLayer,
      presentation.visibleClipViews,
      presentation.metrics.trackHeaderWidth,
    );
    drawTimelineOverlay(overlayGraphics, presentation);
    if (levelGrip) drawLevelGrips(presentation);
    if (clipExtend) {
      const handle = getClipExtendHandle(presentation, clipExtend, extendHandle);
      if (handle) drawClipExtendHandle(overlayGraphics, handle);
    }
    // F3 overlays: ghost outline at the snapped destination + vertical
    // snap-indicator line. Both are no-ops until F3 lands; the Graphics
    // layers exist now so the renderer-impl init stays the single source
    // of DisplayObject creation.
    drawDropGhost(dropGhostGraphics, presentation);
    drawSnapIndicator(snapIndicatorGraphics, presentation);

    drawRulerChrome(chromeGraphics, chromeTextLayer, presentation);
    const tracksTop = layout.timelineRect.y;
    const nextRowsMaskKey = `${tracksTop}|${viewport.width}|${viewport.height}`;
    if (nextRowsMaskKey !== trackRowsMaskKey) {
      trackRowsMaskKey = nextRowsMaskKey;
      trackRowsMask.clear();
      trackRowsMask
        .rect(0, tracksTop, viewport.width, Math.max(0, viewport.height - tracksTop))
        .fill({ color: 0xffffff });
    }
    drawTrackRows(trackRowsGraphics, trackRowsTextLayer, presentation, trackMetaSource, trackLabel);
    drawLoopRegion(chromeGraphics, presentation);
    drawMarkers(chromeGraphics, chromeTextLayer, presentation);
    drawPlayPositionRulerMarker(chromeGraphics, presentation);

    // Overview lane: returns immediately (and stays hidden) with no lane;
    // otherwise rebuilds only on its dirty keys (data ref, scroll, zoom,
    // width, lane geometry). The provider is not queried without a lane.
    // One provider call per frame feeds the lane and the navigator's
    // miniature — only when the host has a lane (provider contract).
    const overviewData =
      presentation.layout.overviewRect.height > 0 && getOverviewData
        ? getOverviewData()
        : null;
    overviewLane.sync(presentation, overviewData);

    const hoverTime = presentation.state.hoverTime ?? null;
    if (hoverTime !== hoverLabelTime) {
      hoverLabelTime = hoverTime;
      hoverLabel = hoverTime === null ? null : core.formatTime(hoverTime);
    }
    drawHoverTime(hoverTimeGraphics, hoverTimeTextLayer, presentation, hoverLabel);

    navigatorLayer.sync(presentation, overviewData);
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

    const tooltipView = presentation.tooltipView;
    const tooltipDetail = !tooltipView
      ? null
      : tooltipView.kind === "clip"
        ? tooltipView.clipId && getClipInfo
          ? getClipInfo(tooltipView.clipId)
          : null
        : tooltipView.time !== null && getTooltipDetail
          ? getTooltipDetail(tooltipView.time)
          : null;
    const tooltipHeight = drawTooltip(
      {
        container: tooltipContainer,
        background: tooltipBackground,
        textLayer: tooltipTextLayer,
      },
      presentation,
      tooltipDetail,
    );
    dragAnnotation.sync(
      presentation,
      tooltipView && getDragAnnotation ? getDragAnnotation() : null,
      tooltipHeight,
    );

    (app as any).render?.();
  };

  // The rAF callback clears the pending id BEFORE renderNow: renderNow bails
  // out while the Pixi app is still initialising, and an id left set there
  // would make every later requestRender (notify, resize, invalidate) a
  // no-op forever. Hoisted so scheduling a frame allocates no closure.
  const flushRender = (): void => {
    renderFrameId = 0;
    renderNow();
  };

  const requestRender = (): void => {
    if (renderQueuedNow || renderFrameId !== 0 || destroyed) return;
    if (typeof requestAnimationFrame === "undefined") {
      renderQueuedNow = true;
      renderNow();
      renderQueuedNow = false;
      return;
    }
    renderFrameId = requestAnimationFrame(flushRender);
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
      // Render on demand only (requestRender, canon §3.10/§3.11). Pixi's
      // default ticker repaints the whole stage EVERY frame even when
      // nothing changed: a constant full-canvas GPU load that, under the
      // editor's blurred backdrop on a modest machine, froze the browser.
      autoStart: false,
      sharedTicker: false,
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

      // Pixi's EventSystem is unused (the interaction controller owns all
      // input): detach it. Attached, it listens to every document
      // pointermove and keeps a rAF ticker alive that re-dispatches a fake
      // pointermove every 10 ms while the pointer rests on the canvas.
      (app.renderer as any).events?.setTargetElement?.(null);

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

  // Drops every dirty-key cache so the next frame repaints all layers with
  // the current palette (theme switch).
  const invalidateCachedLayers = (): void => {
    maskKey = "";
    gridKey = "";
    clipNodeRegistry.invalidate();
    overviewLane.invalidate();
    dragAnnotation.invalidate();
    navigatorLayer.invalidate();
  };

  const refreshTextLayer = (layer: Container): void => {
    for (const child of layer.children) {
      // style.update() bumps the style key → Pixi rasterises a new texture.
      if (child instanceof Text) child.style.update();
    }
  };

  return {
    invalidate() {
      requestRender();
    },
    refreshFonts() {
      if (destroyed) return;
      // Metrics measured with the fallback face would keep stale widths.
      CanvasTextMetrics.clearMetrics();
      refreshTextLayer(chromeTextLayer);
      refreshTextLayer(trackRowsTextLayer);
      refreshTextLayer(foregroundTextLayer);
      refreshTextLayer(tooltipTextLayer);
      refreshTextLayer(overviewFrameText);
      refreshTextLayer(overviewCurveText);
      refreshTextLayer(dragAnnotationTextLayer);
      refreshTextLayer(hoverTimeTextLayer);
      clipNodeRegistry.refreshText();
      requestRender();
    },
    setTheme(theme) {
      if (destroyed) return;
      if (!applyPlaylistTheme(theme)) return;
      if (ready) {
        (app.renderer as any).background.color = COLORS.background;
      }
      invalidateCachedLayers();
      requestRender();
    },
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
      trackRowsGraphics.clear();
      trackRowsMask.clear();
      disposeTextLayer(trackRowsTextLayer);
      foregroundGraphics.clear();
      navigatorGraphics.clear();
      disposeTextLayer(foregroundTextLayer);
      tooltipBackground.clear();
      disposeTextLayer(tooltipTextLayer);
      disposeTextLayer(hoverTimeTextLayer);
      overviewLane.dispose();
      dragAnnotation.dispose();
      disposeApp();
    },
  };
}
