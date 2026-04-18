import { DAY_WIDTH_PX, dateToPixel } from "../coordinate-system";
import { projectCanvasScene } from "../renderer";
import { RULER_HEIGHT_PX, TRACK_HEIGHT_PX } from "../scene/types";
const EDGE_HIT_WIDTH_PX = 10;
const DEFAULT_MIN_ZOOM = 0.25;
const DEFAULT_MAX_ZOOM = 8;
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
function toUtcMidnight(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function parseDate(value) {
    if (value == null) {
        return null;
    }
    const parsed = value instanceof Date ? new Date(value) : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function addDays(date, days) {
    return new Date(date.getTime() + days * MS_PER_DAY);
}
function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}
function resolvePoint(host, event) {
    const rect = host.getBoundingClientRect();
    return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
    };
}
function resolveDimensions(host) {
    const rect = host.getBoundingClientRect();
    return {
        width: Math.max(Math.round(rect.width), 1),
        height: Math.max(Math.round(rect.height), 1),
    };
}
function resolveFrame(store, host) {
    const snapshot = store.getState();
    const dimensions = resolveDimensions(host);
    return {
        snapshot,
        projection: projectCanvasScene(snapshot, dimensions),
        dimensions,
    };
}
function resolveViewportSnapshot(frame) {
    return (frame.snapshot.viewport ?? {
        x: frame.projection.viewport.scrollX,
        y: 0,
        zoom: frame.projection.viewport.zoom,
        originDate: frame.projection.viewport.originDate,
    });
}
function pointToDate(pointX, viewport) {
    const originDate = toUtcMidnight(parseDate(viewport.originDate) ?? new Date());
    const dayOffset = Math.round((pointX + viewport.x) / (DAY_WIDTH_PX * viewport.zoom));
    return addDays(originDate, dayOffset);
}
function pointToIsoDate(pointX, viewport) {
    return pointToDate(pointX, viewport).toISOString();
}
function calculateInclusiveDaySpan(startDate, endDate) {
    const start = toUtcMidnight(startDate);
    const end = toUtcMidnight(endDate);
    const span = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
    return Math.max(span, 1);
}
function resolveTrackIndex(pointY) {
    return Math.max(0, Math.floor((pointY - RULER_HEIGHT_PX) / TRACK_HEIGHT_PX));
}
function hitTestObject(projection, point) {
    const localY = point.y - RULER_HEIGHT_PX;
    for (let index = projection.objects.length - 1; index >= 0; index -= 1) {
        const placement = projection.objects[index];
        const withinX = point.x >= placement.x && point.x <= placement.x + placement.widthPx;
        const withinY = localY >= placement.y && localY <= placement.y + placement.heightPx;
        if (!withinX || !withinY) {
            continue;
        }
        const localX = point.x - placement.x;
        const nearStart = localX <= EDGE_HIT_WIDTH_PX;
        const nearEnd = placement.widthPx - localX <= EDGE_HIT_WIDTH_PX;
        return {
            kind: "item",
            placement,
            edge: nearStart ? "start" : nearEnd ? "end" : null,
        };
    }
    return null;
}
function setHostCursor(host, cursor) {
    if (host.style) {
        host.style.cursor = cursor;
    }
}
function createViewportCommand(baseViewport, nextPoint, startPoint) {
    const deltaX = nextPoint.x - startPoint.x;
    return {
        type: "viewport/set",
        viewport: {
            x: baseViewport.x - deltaX,
            y: baseViewport.y,
            zoom: baseViewport.zoom,
            originDate: baseViewport.originDate,
        },
    };
}
function createZoomViewportCommand(frame, point, deltaY, minZoom, maxZoom) {
    const baseViewport = resolveViewportSnapshot(frame);
    const zoomFactor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);
    const nextZoom = clamp(baseViewport.zoom * zoomFactor, minZoom, maxZoom);
    const anchorDate = pointToDate(point.x, baseViewport);
    const nextScrollX = dateToPixel(anchorDate, parseDate(baseViewport.originDate) ?? anchorDate, nextZoom) - point.x;
    return {
        type: "viewport/set",
        viewport: {
            zoom: nextZoom,
            x: nextScrollX,
            y: baseViewport.y,
            originDate: baseViewport.originDate,
        },
    };
}
function createPanViewportCommand(frame, deltaX, deltaY) {
    const baseViewport = resolveViewportSnapshot(frame);
    return {
        type: "viewport/set",
        viewport: {
            x: baseViewport.x + deltaX + deltaY,
            y: baseViewport.y,
            zoom: baseViewport.zoom,
            originDate: baseViewport.originDate,
        },
    };
}
function createDragCommand(viewport, point, placement) {
    return {
        type: "item/move",
        itemId: placement.object.id,
        date: pointToIsoDate(point.x, viewport),
        trackIndex: resolveTrackIndex(point.y),
    };
}
function createResizeCommand(viewport, point, placement, edge) {
    const nextDate = pointToDate(point.x, viewport);
    const baseStartDate = parseDate(placement.object.date) ?? nextDate;
    const baseDurationDays = Math.max(1, placement.object.durationDays ?? 1);
    if (edge === "end") {
        return {
            type: "item/resize",
            itemId: placement.object.id,
            edge,
            date: baseStartDate.toISOString(),
            durationDays: calculateInclusiveDaySpan(baseStartDate, nextDate),
        };
    }
    const endDate = addDays(baseStartDate, baseDurationDays - 1);
    const clampedStart = nextDate.getTime() > endDate.getTime() ? endDate : nextDate;
    return {
        type: "item/resize",
        itemId: placement.object.id,
        edge,
        date: clampedStart.toISOString(),
        durationDays: calculateInclusiveDaySpan(clampedStart, endDate),
    };
}
function createInsertCommand(viewport, point) {
    return {
        type: "item/insert",
        date: pointToIsoDate(point.x, viewport),
        trackIndex: resolveTrackIndex(point.y),
        durationDays: 1,
    };
}
export function createCanvasInteractionController(host, store, options) {
    let activeGesture = null;
    const minZoom = options.minZoom ?? DEFAULT_MIN_ZOOM;
    const maxZoom = options.maxZoom ?? DEFAULT_MAX_ZOOM;
    setHostCursor(host, "grab");
    host.style && (host.style.touchAction = "none");
    host.style && (host.style.userSelect = "none");
    const handlePointerDown = (event) => {
        if (event.button !== 0) {
            return;
        }
        const frame = resolveFrame(store, host);
        const point = resolvePoint(host, event);
        const viewport = resolveViewportSnapshot(frame);
        const objectHit = hitTestObject(frame.projection, point);
        if (objectHit) {
            if (objectHit.edge) {
                activeGesture = {
                    kind: "resize",
                    pointerId: event.pointerId,
                    item: objectHit.placement,
                    edge: objectHit.edge,
                    baseViewport: viewport,
                };
                setHostCursor(host, "ew-resize");
            }
            else {
                activeGesture = {
                    kind: "drag",
                    pointerId: event.pointerId,
                    item: objectHit.placement,
                    baseViewport: viewport,
                };
                setHostCursor(host, "grabbing");
            }
            host.setPointerCapture?.(event.pointerId);
            event.preventDefault();
            return;
        }
        if (point.y < RULER_HEIGHT_PX) {
            activeGesture = {
                kind: "scrub",
                pointerId: event.pointerId,
                baseViewport: viewport,
            };
            options.onCommand({
                type: "playhead/set",
                playheadAt: pointToIsoDate(point.x, viewport),
            });
            setHostCursor(host, "crosshair");
            host.setPointerCapture?.(event.pointerId);
            event.preventDefault();
            return;
        }
        if (event.detail >= 2) {
            options.onCommand(createInsertCommand(viewport, point));
            event.preventDefault();
            return;
        }
        activeGesture = {
            kind: "pan",
            pointerId: event.pointerId,
            startPoint: point,
            baseViewport: viewport,
        };
        setHostCursor(host, "grabbing");
        host.setPointerCapture?.(event.pointerId);
        event.preventDefault();
    };
    const handlePointerMove = (event) => {
        if (!activeGesture || activeGesture.pointerId !== event.pointerId) {
            return;
        }
        const point = resolvePoint(host, event);
        const frame = resolveFrame(store, host);
        if (activeGesture.kind === "pan") {
            options.onCommand(createViewportCommand(activeGesture.baseViewport, point, activeGesture.startPoint));
            event.preventDefault();
            return;
        }
        if (activeGesture.kind === "scrub") {
            options.onCommand({
                type: "playhead/set",
                playheadAt: pointToIsoDate(point.x, activeGesture.baseViewport),
            });
            event.preventDefault();
            return;
        }
        if (activeGesture.kind === "drag") {
            options.onCommand(createDragCommand(activeGesture.baseViewport, point, activeGesture.item));
            event.preventDefault();
            return;
        }
        if (activeGesture.kind === "resize") {
            options.onCommand(createResizeCommand(activeGesture.baseViewport, point, activeGesture.item, activeGesture.edge));
            event.preventDefault();
        }
    };
    const endGesture = (event) => {
        if (!activeGesture || activeGesture.pointerId !== event.pointerId) {
            return;
        }
        activeGesture = null;
        setHostCursor(host, "grab");
        try {
            host.releasePointerCapture?.(event.pointerId);
        }
        catch {
            // noop
        }
    };
    const handleWheel = (event) => {
        const frame = resolveFrame(store, host);
        const point = resolvePoint(host, event);
        if (event.ctrlKey || event.metaKey) {
            options.onCommand(createZoomViewportCommand(frame, point, event.deltaY, minZoom, maxZoom));
            event.preventDefault();
            return;
        }
        options.onCommand(createPanViewportCommand(frame, event.deltaX, event.deltaY));
        event.preventDefault();
    };
    const handleDoubleClick = (event) => {
        if (event.button !== 0) {
            return;
        }
        const frame = resolveFrame(store, host);
        const point = resolvePoint(host, event);
        const viewport = resolveViewportSnapshot(frame);
        if (point.y < RULER_HEIGHT_PX) {
            options.onCommand({
                type: "playhead/set",
                playheadAt: pointToIsoDate(point.x, viewport),
            });
            event.preventDefault();
            return;
        }
        if (hitTestObject(frame.projection, point)) {
            return;
        }
        options.onCommand(createInsertCommand(viewport, point));
        event.preventDefault();
    };
    const handlePointerCancel = (event) => {
        endGesture(event);
    };
    host.addEventListener("pointerdown", handlePointerDown);
    host.addEventListener("pointermove", handlePointerMove);
    host.addEventListener("pointerup", endGesture);
    host.addEventListener("pointercancel", handlePointerCancel);
    host.addEventListener("wheel", handleWheel, {
        passive: false,
    });
    host.addEventListener("dblclick", handleDoubleClick);
    return {
        destroy() {
            activeGesture = null;
            setHostCursor(host, "");
            host.removeEventListener("pointerdown", handlePointerDown);
            host.removeEventListener("pointermove", handlePointerMove);
            host.removeEventListener("pointerup", endGesture);
            host.removeEventListener("pointercancel", handlePointerCancel);
            host.removeEventListener("wheel", handleWheel);
            host.removeEventListener("dblclick", handleDoubleClick);
        },
    };
}
