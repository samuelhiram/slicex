import { Application, Container, Graphics, Text } from "pixi.js";
import { DEFAULT_PLAYLIST_METRICS, getContextMenuRect, getAutomationPointPosition, getClipRect, getHorizontalScrollbarRect, getHorizontalScrollbarThumbRect, getTrackByIndex, getTrackIdByIndex, getVerticalScrollbarRect, getVerticalScrollbarThumbRect, isAutomationClip, normalizeRect, screenXToTime, timeToScreenX, trackIndexToScreenY, } from "../playlist-core";
const COLORS = {
    background: 0x181818,
    panel: 0x222222,
    panelStrong: 0x2a2a2a,
    panelHeaderA: 0x272727,
    panelHeaderB: 0x242424,
    panelMenu: 0x202020,
    rowA: 0x1d1d1d,
    rowB: 0x202020,
    rowLine: 0x303030,
    gridMinor: 0x2d2d2d,
    gridMajor: 0x414141,
    text: 0xf1f1e8,
    textMuted: 0xb8b3a5,
    selected: 0xf4d35e,
    hover: 0xffffff,
    playPosition: 0xf05d3b,
    marquee: 0x9ecbff,
    automationLine: 0x111111,
    disabled: 0x6f6f6f,
    scrollbarTrack: 0x151515,
    scrollbarThumb: 0x5f5f5f,
    scrollbarThumbHover: 0x7a7a7a,
};
function parseHexColor(value, fallback) {
    const normalized = value.trim();
    if (!normalized.startsWith("#")) {
        return fallback;
    }
    const hex = normalized.slice(1);
    if (hex.length !== 6) {
        return fallback;
    }
    const parsed = Number.parseInt(hex, 16);
    return Number.isFinite(parsed) ? parsed : fallback;
}
function addText(layer, text, x, y, options = {}) {
    const label = new Text({
        text,
        style: {
            fill: options.color ?? COLORS.text,
            fontFamily: "Segoe UI, Arial, sans-serif",
            fontSize: options.size ?? 12,
            fontWeight: (options.weight ?? "500"),
            letterSpacing: 0,
        },
    });
    label.eventMode = "none";
    label.x = Math.round(x);
    label.y = Math.round(y);
    layer.addChild(label);
}
function clearTextLayer(layer) {
    for (const child of layer.removeChildren()) {
        child.destroy();
    }
}
function pickGridStep(pxPerBeat) {
    if (pxPerBeat >= 52) {
        return 0.25;
    }
    if (pxPerBeat >= 28) {
        return 0.5;
    }
    if (pxPerBeat >= 14) {
        return 1;
    }
    if (pxPerBeat >= 9) {
        return 2;
    }
    return 4;
}
function drawGridAndRuler(graphics, textLayer, state, metrics) {
    const { width, height, pxPerBeat } = state.viewport;
    graphics.rect(0, 0, width, height).fill({ color: COLORS.background });
    graphics
        .rect(0, 0, metrics.trackHeaderWidth, height)
        .fill({ color: COLORS.panel });
    graphics
        .rect(metrics.trackHeaderWidth, 0, width - metrics.trackHeaderWidth, metrics.rulerHeight)
        .fill({ color: COLORS.panelStrong });
    graphics
        .rect(0, 0, metrics.trackHeaderWidth, metrics.rulerHeight)
        .fill({ color: COLORS.panel });
    graphics
        .moveTo(0, metrics.rulerHeight - 1)
        .lineTo(width, metrics.rulerHeight - 1)
        .stroke({ color: COLORS.rowLine, width: 1 });
    graphics
        .moveTo(metrics.trackHeaderWidth - 1, 0)
        .lineTo(metrics.trackHeaderWidth - 1, height)
        .stroke({ color: COLORS.rowLine, width: 1 });
    const step = pickGridStep(pxPerBeat);
    const startBeat = Math.floor(screenXToTime(state, metrics.trackHeaderWidth, metrics) / step) * step;
    const endBeat = screenXToTime(state, width, metrics) + step;
    for (let beat = startBeat; beat <= endBeat; beat += step) {
        const x = Math.round(timeToScreenX(state, beat, metrics)) + 0.5;
        const isBar = Math.abs(beat % metrics.beatsPerBar) < 0.001;
        if (x < metrics.trackHeaderWidth) {
            continue;
        }
        graphics
            .moveTo(x, metrics.rulerHeight)
            .lineTo(x, height)
            .stroke({
            alpha: isBar ? 0.95 : 0.55,
            color: isBar ? COLORS.gridMajor : COLORS.gridMinor,
            width: isBar ? 1.25 : 1,
        });
        graphics
            .moveTo(x, metrics.rulerHeight - (isBar ? 15 : 8))
            .lineTo(x, metrics.rulerHeight)
            .stroke({
            color: isBar ? COLORS.textMuted : COLORS.gridMajor,
            width: 1,
        });
        if (isBar) {
            addText(textLayer, String(Math.floor(beat / metrics.beatsPerBar) + 1), x + 5, 10, { color: COLORS.textMuted, size: 11, weight: "600" });
        }
    }
}
function drawTracks(graphics, textLayer, state, metrics) {
    const startIndex = Math.max(0, Math.floor(state.viewport.scrollY / metrics.trackHeight) -
        metrics.trackOverscan);
    const endIndex = Math.ceil((state.viewport.scrollY + state.viewport.height - metrics.rulerHeight) /
        metrics.trackHeight) + metrics.trackOverscan;
    for (let index = startIndex; index <= endIndex; index += 1) {
        const track = getTrackByIndex(state, index);
        const y = trackIndexToScreenY(state, index, metrics);
        const color = parseHexColor(track.color, COLORS.textMuted);
        const rowColor = index % 2 === 0 ? COLORS.rowA : COLORS.rowB;
        const isVirtual = index >= state.tracks.length;
        graphics
            .rect(metrics.trackHeaderWidth, y, state.viewport.width - metrics.trackHeaderWidth, metrics.trackHeight)
            .fill({ color: rowColor });
        graphics
            .rect(0, y, metrics.trackHeaderWidth, metrics.trackHeight)
            .fill({ color: index % 2 === 0 ? COLORS.panelHeaderA : COLORS.panelHeaderB });
        graphics.rect(0, y, 5, metrics.trackHeight).fill({ color });
        graphics
            .moveTo(0, y + metrics.trackHeight - 1)
            .lineTo(state.viewport.width, y + metrics.trackHeight - 1)
            .stroke({ color: COLORS.rowLine, width: 1 });
        graphics
            .moveTo(metrics.trackHeaderWidth - 0.5, y)
            .lineTo(metrics.trackHeaderWidth - 0.5, y + metrics.trackHeight)
            .stroke({ color: COLORS.rowLine, width: 1.5 });
        addText(textLayer, track.label, 16, y + 13, {
            color: COLORS.text,
            size: 13,
            weight: isVirtual ? "500" : "700",
        });
        addText(textLayer, isVirtual ? "Empty" : `Track ${index + 1}`, 16, y + 34, {
            color: COLORS.textMuted,
            size: 11,
        });
    }
}
const TRACK_MENU_ITEMS = [
    "Delete track content",
    "Delete selected clips on track",
    "Rename track",
    "Recolor track",
    "Insert track below",
    "Delete empty track",
];
function hasSelectedClipsOnTrack(state, trackIndex) {
    const trackId = getTrackIdByIndex(state, trackIndex);
    const selected = new Set(state.selection.clipIds);
    return state.clips.some((clip) => clip.trackId === trackId && selected.has(clip.id));
}
function hasClipsOnTrack(state, trackIndex) {
    const trackId = getTrackIdByIndex(state, trackIndex);
    return state.clips.some((clip) => clip.trackId === trackId);
}
function drawContextMenu(graphics, textLayer, state, metrics) {
    const rect = getContextMenuRect(state, metrics);
    if (!rect || state.contextMenu?.kind !== "track") {
        return;
    }
    const trackIndex = state.contextMenu.trackIndex;
    const hasSelected = hasSelectedClipsOnTrack(state, trackIndex);
    const trackHasClips = hasClipsOnTrack(state, trackIndex);
    graphics
        .roundRect(rect.x, rect.y, rect.width, rect.height, 4)
        .fill({ color: COLORS.panelMenu, alpha: 0.98 })
        .stroke({ color: COLORS.rowLine, width: 1 });
    for (let index = 0; index < TRACK_MENU_ITEMS.length; index += 1) {
        const itemY = rect.y + 4 + index * metrics.contextMenuItemHeight;
        const disabled = (index === 1 && !hasSelected) ||
            (index === 5 && trackHasClips);
        if (index % 2 === 0) {
            graphics
                .rect(rect.x + 4, itemY, rect.width - 8, metrics.contextMenuItemHeight)
                .fill({ color: 0x252525, alpha: 0.72 });
        }
        addText(textLayer, TRACK_MENU_ITEMS[index], rect.x + 12, itemY + 7, {
            color: disabled ? COLORS.disabled : COLORS.text,
            size: 12,
            weight: index <= 1 ? "700" : "500",
        });
    }
}
function drawScrollbars(graphics, state, metrics) {
    const horizontal = getHorizontalScrollbarRect(state, metrics);
    const horizontalThumb = getHorizontalScrollbarThumbRect(state, metrics);
    const vertical = getVerticalScrollbarRect(state, metrics);
    const verticalThumb = getVerticalScrollbarThumbRect(state, metrics);
    graphics
        .rect(horizontal.x, horizontal.y, horizontal.width, horizontal.height)
        .fill({ color: COLORS.scrollbarTrack, alpha: 0.96 })
        .stroke({ color: COLORS.rowLine, width: 1 });
    graphics
        .roundRect(horizontalThumb.x, horizontalThumb.y, horizontalThumb.width, horizontalThumb.height, 4)
        .fill({ color: COLORS.scrollbarThumb });
    graphics
        .rect(vertical.x, vertical.y, vertical.width, vertical.height)
        .fill({ color: COLORS.scrollbarTrack, alpha: 0.96 })
        .stroke({ color: COLORS.rowLine, width: 1 });
    graphics
        .roundRect(verticalThumb.x, verticalThumb.y, verticalThumb.width, verticalThumb.height, 4)
        .fill({ color: COLORS.scrollbarThumb });
    graphics
        .rect(vertical.x, horizontal.y, vertical.width, horizontal.height)
        .fill({ color: COLORS.panelStrong });
}
function drawTimelineGridOverlay(graphics, state, metrics) {
    const step = pickGridStep(state.viewport.pxPerBeat);
    const startBeat = Math.floor(screenXToTime(state, metrics.trackHeaderWidth, metrics) / step) *
        step;
    const endBeat = screenXToTime(state, state.viewport.width, metrics) + step;
    for (let beat = startBeat; beat <= endBeat; beat += step) {
        const x = Math.round(timeToScreenX(state, beat, metrics)) + 0.5;
        const isBar = Math.abs(beat % metrics.beatsPerBar) < 0.001;
        if (x < metrics.trackHeaderWidth) {
            continue;
        }
        graphics
            .moveTo(x, metrics.rulerHeight)
            .lineTo(x, state.viewport.height)
            .stroke({
            alpha: isBar ? 0.72 : 0.42,
            color: isBar ? COLORS.gridMajor : COLORS.gridMinor,
            width: isBar ? 1.25 : 1,
        });
    }
}
function drawClipLabel(textLayer, clip, rect) {
    if (rect.width < 44 || rect.height < 24) {
        return;
    }
    addText(textLayer, clip.label, rect.x + 12, rect.y + 4, {
        color: COLORS.text,
        size: 12,
        weight: "700",
    });
}
function drawAutomation(graphics, state, clip, metrics) {
    const sortedPoints = [...clip.points].sort((left, right) => left.time - right.time);
    if (sortedPoints.length === 0) {
        return;
    }
    const first = getAutomationPointPosition(state, clip, sortedPoints[0], metrics);
    graphics.moveTo(first.x, first.y);
    for (const point of sortedPoints.slice(1)) {
        const position = getAutomationPointPosition(state, clip, point, metrics);
        graphics.lineTo(position.x, position.y);
    }
    graphics.stroke({ color: COLORS.automationLine, width: 4, alpha: 0.55 });
    graphics.moveTo(first.x, first.y);
    for (const point of sortedPoints.slice(1)) {
        const position = getAutomationPointPosition(state, clip, point, metrics);
        graphics.lineTo(position.x, position.y);
    }
    graphics.stroke({ color: COLORS.text, width: 2, alpha: 0.9 });
    for (const point of sortedPoints) {
        const position = getAutomationPointPosition(state, clip, point, metrics);
        const selected = state.selection.automationPointIds.includes(point.id);
        graphics
            .circle(position.x, position.y, selected ? 6.5 : 5)
            .fill({ color: selected ? COLORS.selected : COLORS.panelStrong })
            .stroke({ color: COLORS.text, width: 1.5 });
    }
}
function drawClip(graphics, textLayer, state, clip, metrics) {
    const rect = getClipRect(state, clip, metrics);
    if (rect.x + rect.width < metrics.trackHeaderWidth ||
        rect.x > state.viewport.width ||
        rect.y + rect.height < metrics.rulerHeight ||
        rect.y > state.viewport.height) {
        return;
    }
    const color = parseHexColor(clip.color, 0x777777);
    const selected = state.selection.clipIds.includes(clip.id);
    const hovered = state.hover != null &&
        state.hover.kind !== "automation-point" &&
        "clipId" in state.hover &&
        state.hover.clipId === clip.id;
    const handleHeight = clip.type === "automation" ? metrics.clipTitleHeight : rect.height;
    graphics
        .roundRect(rect.x, rect.y, rect.width, rect.height, 4)
        .fill({ color, alpha: clip.type === "automation" ? 0.82 : 0.9 })
        .stroke({
        color: selected ? COLORS.selected : hovered ? COLORS.hover : COLORS.rowLine,
        width: selected ? 2 : 1,
        alpha: hovered || selected ? 1 : 0.8,
    });
    graphics
        .rect(rect.x, rect.y, rect.width, metrics.clipTitleHeight)
        .fill({ color: COLORS.panel, alpha: 0.34 });
    graphics
        .rect(rect.x, rect.y, metrics.resizeHandleWidth, handleHeight)
        .fill({ color: COLORS.text, alpha: 0.2 });
    graphics
        .rect(rect.x + rect.width - metrics.resizeHandleWidth, rect.y, metrics.resizeHandleWidth, handleHeight)
        .fill({ color: COLORS.text, alpha: 0.2 });
    drawClipLabel(textLayer, clip, rect);
    if (isAutomationClip(clip)) {
        drawAutomation(graphics, state, clip, metrics);
    }
}
function drawOverlay(graphics, state, metrics) {
    const markerX = timeToScreenX(state, state.playPosition.time, metrics);
    if (markerX >= metrics.trackHeaderWidth &&
        markerX <= state.viewport.width) {
        graphics
            .roundRect(markerX - 7, 3, 14, metrics.rulerHeight - 6, 3)
            .fill({ color: COLORS.playPosition })
            .stroke({ color: COLORS.text, width: 1, alpha: 0.8 });
        graphics
            .moveTo(markerX - 7, metrics.rulerHeight - 1)
            .lineTo(markerX + 7, metrics.rulerHeight - 1)
            .lineTo(markerX, metrics.rulerHeight + 7)
            .lineTo(markerX - 7, metrics.rulerHeight - 1)
            .fill({ color: COLORS.playPosition });
        graphics
            .moveTo(markerX + 0.5, 0)
            .lineTo(markerX + 0.5, state.viewport.height)
            .stroke({ color: COLORS.playPosition, width: 2 });
    }
    if (state.marquee) {
        const rect = normalizeRect({
            x: state.marquee.start.x,
            y: state.marquee.start.y,
            width: state.marquee.current.x - state.marquee.start.x,
            height: state.marquee.current.y - state.marquee.start.y,
        });
        graphics
            .rect(rect.x, rect.y, rect.width, rect.height)
            .fill({ color: COLORS.marquee, alpha: 0.13 })
            .stroke({ color: COLORS.marquee, width: 1.5, alpha: 0.75 });
    }
}
function drawPlaylist(graphics, textLayer, state, metrics) {
    graphics.clear();
    clearTextLayer(textLayer);
    drawGridAndRuler(graphics, textLayer, state, metrics);
    drawTracks(graphics, textLayer, state, metrics);
    drawTimelineGridOverlay(graphics, state, metrics);
    for (const clip of state.clips) {
        drawClip(graphics, textLayer, state, clip, metrics);
    }
    drawOverlay(graphics, state, metrics);
    drawScrollbars(graphics, state, metrics);
    drawContextMenu(graphics, textLayer, state, metrics);
    addText(textLayer, "SliceX Playlist", 15, 11, {
        color: COLORS.text,
        size: 13,
        weight: "700",
    });
}
export function createPlaylistRenderer(container, core, callbacks = {}) {
    const metrics = core.metrics ?? DEFAULT_PLAYLIST_METRICS;
    const app = new Application();
    const root = new Container();
    const graphics = new Graphics();
    const textLayer = new Container();
    let destroyed = false;
    let ready = false;
    root.eventMode = "none";
    root.addChild(graphics, textLayer);
    const renderNow = () => {
        if (!ready || destroyed) {
            return;
        }
        drawPlaylist(graphics, textLayer, core.getState(), metrics);
        app.render?.();
    };
    const resize = () => {
        if (!ready || destroyed) {
            return;
        }
        const rect = container.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));
        const viewport = core.getState().viewport;
        app.renderer.resize(width, height);
        if (viewport.width !== width || viewport.height !== height) {
            core.setViewportSize(width, height);
            return;
        }
        renderNow();
    };
    const resizeObserver = typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(resize)
        : null;
    const subscription = core.subscribe(renderNow);
    void app
        .init({
        antialias: true,
        autoDensity: true,
        backgroundColor: COLORS.background,
        resolution: typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    })
        .then(() => {
        if (destroyed) {
            app.destroy(true);
            return;
        }
        const canvas = app.canvas;
        canvas.style.display = "block";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        container.appendChild(canvas);
        app.stage.addChild(root);
        ready = true;
        resizeObserver?.observe(container);
        resize();
        callbacks.onReady?.();
    })
        .catch((error) => {
        callbacks.onError?.(error);
    });
    return {
        destroy() {
            destroyed = true;
            subscription.unsubscribe();
            resizeObserver?.disconnect();
            clearTextLayer(textLayer);
            try {
                app.stage.removeChild(root);
            }
            catch {
                // noop
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
