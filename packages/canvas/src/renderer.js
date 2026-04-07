import * as PIXI from "pixi.js";
import { ObjectLayer, PlayheadLayer, RulerLayer, TrackLayer } from "./scene";
import { RULER_HEIGHT_PX, TRACK_HEIGHT_PX } from "./scene/types";
const TRACK_COLORS = [
    0x0f766e, 0x2563eb, 0x7c3aed, 0xd97706, 0x0891b2, 0x4f46e5,
];
function canUseCanvas(container) {
    return (typeof window !== "undefined" &&
        typeof document !== "undefined" &&
        container &&
        typeof container.appendChild === "function" &&
        (() => {
            try {
                const canvas = document.createElement("canvas");
                return typeof canvas.getContext === "function";
            }
            catch {
                return false;
            }
        })());
}
function toUtcMidnight(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function parseDate(value) {
    if (value == null) {
        return null;
    }
    const date = value instanceof Date ? new Date(value) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
function normalizeViewport(viewport) {
    return {
        scrollX: viewport?.x ?? 0,
        zoom: viewport?.zoom && viewport.zoom > 0 ? viewport.zoom : 1,
    };
}
function resolveOriginDate(snapshot) {
    const candidates = [];
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
    const earliest = candidates.reduce((minimum, candidate) => candidate.getTime() < minimum.getTime() ? candidate : minimum);
    return toUtcMidnight(earliest);
}
function resolveDimensions(app, container) {
    return {
        width: Number(app?.renderer?.width) || Number(container?.clientWidth) || 0,
        height: Number(app?.renderer?.height) || Number(container?.clientHeight) || 0,
    };
}

function resolveSnapshot(store) {
    if (typeof store.getState === "function") {
        return store.getState();
    }
    return { document: store.getDocument() };
}

function subscribeToSnapshot(store, cb) {
    if (typeof store.subscribeState === "function") {
        return store.subscribeState(cb);
    }
    return store.subscribe((document) => {
        cb({ document });
    });
}

function createScene(app) {
    const root = new PIXI.Container();
    const rulerLayer = new RulerLayer();
    const trackLayer = new TrackLayer();
    const objectLayer = new ObjectLayer();
    const playheadLayer = new PlayheadLayer();
    trackLayer.position.set(0, RULER_HEIGHT_PX);
    objectLayer.position.set(0, RULER_HEIGHT_PX);
    playheadLayer.position.set(0, RULER_HEIGHT_PX);
    root.addChild(rulerLayer, trackLayer, objectLayer, playheadLayer);
    app.stage.addChild(root);
    return { root, rulerLayer, trackLayer, objectLayer, playheadLayer };
}

function applyProjection(scene, projection) {
    scene.rulerLayer.setViewportState(projection.viewport);
    scene.trackLayer.setTracks(projection.tracks, projection.viewport.width);
    scene.objectLayer.setViewportState(projection.viewport);
    scene.objectLayer.setObjects(projection.objects);
    scene.playheadLayer.setPlayheadState(projection.playhead);
}

export function projectCanvasScene(snapshot, dimensions) {
    const items = snapshot.document?.items ?? [];
    const { scrollX, zoom } = normalizeViewport(snapshot.viewport);
    const originDate = resolveOriginDate(snapshot);
    const tracks = items.map((item, index) => ({
        id: item.id,
        label: item.name,
        color: TRACK_COLORS[index % TRACK_COLORS.length],
    }));
    const objects = items.map((object, trackIndex) => ({
        object,
        trackIndex,
    }));
    const trackAreaHeight = Math.max(dimensions.height - RULER_HEIGHT_PX, Math.max(tracks.length, 1) * TRACK_HEIGHT_PX);
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
            height: trackAreaHeight,
            playheadAt: parseDate(snapshot.playheadAt),
        },
    };
}

export function createRenderer(container, store) {
    const useDom = canUseCanvas(container);
    const stage = new PIXI.Container();
    const canvasElement = useDom ? document.createElement("canvas") : null;
    if (canvasElement) {
        canvasElement.width = Math.max(Number(container?.clientWidth) || 0, 1);
        canvasElement.height = Math.max(Number(container?.clientHeight) || 0, 1);
    }
    const app = {
        stage,
        renderer: {
            width: 0,
            height: 0,
            canvas: null,
            resize: (_width, _height) => { },
            render: (_options) => { },
            destroy: (_options) => { },
        },
        render() {
            app.renderer.render({ container: stage });
        },
        destroy(rendererDestroyOptions = true) {
            stage.removeChildren();
            try {
                app.renderer.destroy(rendererDestroyOptions);
            }
            catch {
                // noop
            }
        },
    };
    let scene = null;
    let subscription = null;
    let destroyed = false;
    let initComplete = false;
    subscription = subscribeToSnapshot(store, (snapshot) => {
        if (!scene) {
            return;
        }
        applyProjection(scene, projectCanvasScene(snapshot, resolveDimensions(app, container)));
    });
    if (useDom) {
        const initPromise = PIXI.autoDetectRenderer({
            canvas: canvasElement ?? undefined,
            backgroundAlpha: 0,
        })
            .then((renderer) => {
            initComplete = true;
            if (destroyed) {
                try {
                    renderer.destroy(true);
                }
                catch {
                    // noop
                }
                return;
            }
            app.renderer = renderer;
            container.appendChild(canvasElement);
            scene = createScene(app);
            const initialSnapshot = resolveSnapshot(store);
            applyProjection(scene, projectCanvasScene(initialSnapshot, resolveDimensions(app, container)));
            app.render();
        })
            .catch(() => {
            // noop
        });
        void initPromise;
    }
    return {
        app,
        destroy() {
            destroyed = true;
            try {
                subscription?.unsubscribe();
            }
            catch {
                // noop
            }
            if (!initComplete) {
                return;
            }
            try {
                app.destroy(true);
            }
            catch {
                // noop
            }
        },
    };
}
