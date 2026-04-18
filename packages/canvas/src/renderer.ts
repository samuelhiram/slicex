import * as PIXI from "pixi.js";
import { ObjectLayer, PlayheadLayer, RulerLayer, TrackLayer } from "./scene";
import {
  OBJECT_HEIGHT_PX,
  OBJECT_VERTICAL_PADDING_PX,
  RULER_HEIGHT_PX,
  TRACK_HEIGHT_PX,
} from "./scene/types";
import { DAY_WIDTH_PX, dateToPixel } from "./coordinate-system";
import type { FinancialObject } from "@slicex/core";
import type {
  CanvasStoreSnapshot,
  CanvasViewportSnapshot,
  StoreAdapter,
} from "./types";
import type {
  SceneThemePalette,
  SceneObjectPlacement,
  ScenePlayheadState,
  SceneTrack,
  SceneViewportState,
} from "./scene/types";

export interface CanvasSceneProjection {
  tracks: SceneTrack[];
  objects: SceneObjectPlacement[];
  viewport: SceneViewportState;
  playhead: ScenePlayheadState;
}

export interface RendererLifecycleCallbacks {
  onReady?: () => void;
  onError?: (error: unknown) => void;
}

interface CanvasScene {
  root: PIXI.Container;
  rulerLayer: RulerLayer;
  trackLayer: TrackLayer;
  objectLayer: ObjectLayer;
  playheadLayer: PlayheadLayer;
}

const FALLBACK_THEME: SceneThemePalette = {
  rulerBackground: 0xf8fafc,
  rulerBorder: 0xcbd5e1,
  gridLine: 0xdbe2ea,
  trackRowEven: 0xf8fafc,
  trackRowOdd: 0xffffff,
  trackRowDivider: 0xe2e8f0,
};

const TRACK_COLORS = [
  0x0f766e, 0x2563eb, 0x7c3aed, 0xd97706, 0x0891b2, 0x4f46e5,
];

function canUseCanvas(container: any): boolean {
  return (
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    container &&
    typeof container.appendChild === "function" &&
    (() => {
      try {
        const canvas = document.createElement("canvas");
        return typeof (canvas as HTMLCanvasElement).getContext === "function";
      } catch {
        return false;
      }
    })()
  );
}

function parseCssHexColor(
  value: string | null | undefined,
  fallback: number,
): number {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim();

  if (!normalized.startsWith("#")) {
    return fallback;
  }

  const hex = normalized.slice(1);

  if (hex.length === 3) {
    return Number.parseInt(
      hex
        .split("")
        .map((character) => character + character)
        .join(""),
      16,
    );
  }

  if (hex.length === 6) {
    return Number.parseInt(hex, 16);
  }

  return fallback;
}

function resolveCanvasTheme(): SceneThemePalette {
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle !== "function"
  ) {
    return FALLBACK_THEME;
  }

  const styles = getComputedStyle(document.documentElement);

  return {
    rulerBackground: parseCssHexColor(
      styles.getPropertyValue("--canvas-ruler-bg"),
      FALLBACK_THEME.rulerBackground,
    ),
    rulerBorder: parseCssHexColor(
      styles.getPropertyValue("--canvas-ruler-border"),
      FALLBACK_THEME.rulerBorder,
    ),
    gridLine: parseCssHexColor(
      styles.getPropertyValue("--canvas-grid-line"),
      FALLBACK_THEME.gridLine,
    ),
    trackRowEven: parseCssHexColor(
      styles.getPropertyValue("--canvas-track-even"),
      FALLBACK_THEME.trackRowEven,
    ),
    trackRowOdd: parseCssHexColor(
      styles.getPropertyValue("--canvas-track-odd"),
      FALLBACK_THEME.trackRowOdd,
    ),
    trackRowDivider: parseCssHexColor(
      styles.getPropertyValue("--canvas-track-divider"),
      FALLBACK_THEME.trackRowDivider,
    ),
  };
}

function toUtcMidnight(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function parseDate(value: string | Date | null | undefined): Date | null {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeViewport(viewport: CanvasViewportSnapshot | undefined): {
  scrollX: number;
  zoom: number;
} {
  return {
    scrollX: viewport?.x ?? 0,
    zoom: viewport?.zoom && viewport.zoom > 0 ? viewport.zoom : 1,
  };
}

function resolveOriginDate(snapshot: CanvasStoreSnapshot): Date {
  const viewportOriginDate = parseDate(snapshot.viewport?.originDate);
  if (viewportOriginDate) {
    return toUtcMidnight(viewportOriginDate);
  }

  const candidates: Date[] = [];

  for (const item of snapshot.document?.items ?? []) {
    const itemDate = parseDate(item.date);
    if (itemDate) {
      candidates.push(itemDate);
    }
  }

  const playheadDate = parseDate(snapshot.playheadAt);
  if (playheadDate) {
    candidates.push(playheadDate);
  }

  if (candidates.length === 0) {
    return toUtcMidnight(new Date());
  }

  const earliest = candidates.reduce((minimum, candidate) =>
    candidate.getTime() < minimum.getTime() ? candidate : minimum,
  );

  return toUtcMidnight(earliest);
}

function resolveDimensions(app: any, container: any) {
  return {
    width: Number(app?.renderer?.width) || Number(container?.clientWidth) || 0,
    height:
      Number(app?.renderer?.height) || Number(container?.clientHeight) || 0,
  };
}

function resolveSnapshot(store: StoreAdapter): CanvasStoreSnapshot {
  if (typeof store.getState === "function") {
    return store.getState();
  }

  return { document: store.getDocument() };
}

function subscribeToSnapshot(
  store: StoreAdapter,
  cb: (snapshot: CanvasStoreSnapshot) => void,
) {
  if (typeof store.subscribeState === "function") {
    return store.subscribeState(cb);
  }

  return store.subscribe((document) => {
    cb({ document });
  });
}

function createScene(app: any, theme: SceneThemePalette): CanvasScene {
  const root = new PIXI.Container();
  const rulerLayer = new RulerLayer();
  const trackLayer = new TrackLayer();
  const objectLayer = new ObjectLayer();
  const playheadLayer = new PlayheadLayer();

  rulerLayer.setTheme(theme);
  trackLayer.setTheme(theme);

  trackLayer.position.set(0, RULER_HEIGHT_PX);
  objectLayer.position.set(0, RULER_HEIGHT_PX);
  playheadLayer.position.set(0, 0);

  root.addChild(rulerLayer, trackLayer, objectLayer, playheadLayer);
  app.stage.addChild(root);

  return { root, rulerLayer, trackLayer, objectLayer, playheadLayer };
}

function applyProjection(
  scene: CanvasScene,
  projection: CanvasSceneProjection,
): void {
  scene.rulerLayer.setViewportState(projection.viewport);
  scene.trackLayer.setTracks(
    projection.tracks,
    projection.viewport.width,
    projection.viewport.height,
  );
  scene.objectLayer.setViewportState(projection.viewport);
  scene.objectLayer.setObjects(projection.objects);
  scene.playheadLayer.setPlayheadState(projection.playhead);
}

export function projectCanvasScene(
  snapshot: CanvasStoreSnapshot,
  dimensions: { width: number; height: number },
): CanvasSceneProjection {
  const items = snapshot.document?.items ?? [];
  const { scrollX, zoom } = normalizeViewport(snapshot.viewport);
  const originDate = resolveOriginDate(snapshot);
  const tracks = items.map((item, index) => ({
    id: item.id,
    label: item.name,
    color: TRACK_COLORS[index % TRACK_COLORS.length],
  }));
  const objects = items.map((object: FinancialObject, trackIndex) => {
    const objectDate = parseDate(object.date) ?? originDate;
    const durationDays = Math.max(1, object.durationDays ?? 1);
    const objectWidth = Math.max(4, DAY_WIDTH_PX * zoom * durationDays);
    const x = dateToPixel(objectDate, originDate, zoom) - scrollX;
    const y = trackIndex * TRACK_HEIGHT_PX + OBJECT_VERTICAL_PADDING_PX;

    return {
      object,
      trackIndex,
      x,
      y,
      widthPx: objectWidth,
      heightPx: OBJECT_HEIGHT_PX,
    };
  });
  const trackAreaHeight = Math.max(
    dimensions.height - RULER_HEIGHT_PX,
    Math.max(tracks.length, 1) * TRACK_HEIGHT_PX,
  );

  return {
    tracks,
    objects,
    viewport: {
      originDate,
      scrollX,
      zoom,
      width: Math.max(dimensions.width, 0),
      height: trackAreaHeight,
    },
    playhead: {
      originDate,
      scrollX,
      zoom,
      width: Math.max(dimensions.width, 0),
      height: Math.max(dimensions.height, 0),
      playheadAt: parseDate(snapshot.playheadAt),
    },
  };
}

export function createRenderer(
  container: any,
  store: StoreAdapter,
  callbacks: RendererLifecycleCallbacks = {},
) {
  const useDom = canUseCanvas(container);
  let currentTheme = resolveCanvasTheme();

  const stage = new PIXI.Container();
  const canvasElement = useDom ? document.createElement("canvas") : null;
  if (canvasElement) {
    canvasElement.width = Math.max(Number(container?.clientWidth) || 0, 1);
    canvasElement.height = Math.max(Number(container?.clientHeight) || 0, 1);
    canvasElement.style.display = "block";
    canvasElement.style.width = "100%";
    canvasElement.style.height = "100%";
  }

  const app: any = {
    stage,
    renderer: {
      width: 0,
      height: 0,
      canvas: null as HTMLCanvasElement | null,
      resize: (_width: number, _height: number) => {},
      render: (_options?: { container: PIXI.Container }) => {},
      destroy: (_options?: any) => {},
    },
    render() {
      app.renderer.render({ container: stage });
    },
    destroy(rendererDestroyOptions = true) {
      stage.removeChildren();

      try {
        app.renderer.destroy(rendererDestroyOptions);
      } catch {
        // noop
      }
    },
  };

  let scene: CanvasScene | null = null;
  let subscription: { unsubscribe: () => void } | null = null;
  let destroyed = false;
  let initComplete = false;
  const themeMediaQuery =
    useDom && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  const resizeObserver =
    useDom && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (destroyed || !scene) {
            return;
          }

          refreshScene(resolveSnapshot(store));
        })
      : null;

  const handleThemeChange = () => {
    if (destroyed) {
      return;
    }

    currentTheme = resolveCanvasTheme();

    if (scene) {
      scene.rulerLayer.setTheme(currentTheme);
      scene.trackLayer.setTheme(currentTheme);
      refreshScene(resolveSnapshot(store));
    }
  };

  if (themeMediaQuery) {
    if (typeof themeMediaQuery.addEventListener === "function") {
      themeMediaQuery.addEventListener("change", handleThemeChange);
    } else if (typeof themeMediaQuery.addListener === "function") {
      themeMediaQuery.addListener(handleThemeChange);
    }
  }

  function refreshScene(snapshot: CanvasStoreSnapshot): void {
    if (!scene) {
      return;
    }

    const dimensions = resolveDimensions(app, container);
    const nextDimensions = {
      width: Math.max(dimensions.width, 1),
      height: Math.max(dimensions.height, 1),
    };

    try {
      app.renderer.resize(nextDimensions.width, nextDimensions.height);
    } catch {
      // noop
    }

    applyProjection(scene, projectCanvasScene(snapshot, nextDimensions));
    app.render();
  }

  subscription = subscribeToSnapshot(store, (snapshot) => {
    if (!scene) {
      return;
    }

    refreshScene(snapshot);
  });

  if (useDom) {
    const initPromise = PIXI.autoDetectRenderer({
      canvas: canvasElement ?? undefined,
      backgroundAlpha: 0,
    })
      .then((renderer: any) => {
        initComplete = true;

        if (destroyed) {
          try {
            renderer.destroy(true);
          } catch {
            // noop
          }

          return;
        }

        app.renderer = renderer;
        container.appendChild(canvasElement as HTMLCanvasElement);
        scene = createScene(app, currentTheme);

        if (resizeObserver) {
          resizeObserver.observe(container);
        }

        const initialSnapshot = resolveSnapshot(store);
        refreshScene(initialSnapshot);
        callbacks.onReady?.();
      })
      .catch((error) => {
        callbacks.onError?.(error);
        console.error("[SliceX] Failed to initialize canvas renderer", error);
      });

    void initPromise;
  } else {
    callbacks.onReady?.();
  }

  return {
    app,
    destroy() {
      destroyed = true;

      try {
        subscription?.unsubscribe();
      } catch {
        // noop
      }

      try {
        resizeObserver?.disconnect();
      } catch {
        // noop
      }

      if (themeMediaQuery) {
        try {
          if (typeof themeMediaQuery.removeEventListener === "function") {
            themeMediaQuery.removeEventListener("change", handleThemeChange);
          } else if (typeof themeMediaQuery.removeListener === "function") {
            themeMediaQuery.removeListener(handleThemeChange);
          }
        } catch {
          // noop
        }
      }

      if (!initComplete) {
        return;
      }

      try {
        app.destroy(true);
      } catch {
        // noop
      }
    },
  };
}
