import { DEFAULT_PLAYLIST_METRICS, } from "./types";
import { getAutomationPointPosition, getClipRect, getClipTitleRect, getContextMenuRect, getHorizontalScrollbarRect, getHorizontalScrollbarThumbRect, getTrackByIndex, getTrackIdByIndex, getTrackIndexById, getVerticalScrollbarRect, getVerticalScrollbarThumbRect, isAutomationClip, normalizeRect, rectsIntersect, screenXToTime, timeToScreenX, trackIndexToScreenY, } from "./geometry";
export const PLAYLIST_TRACK_MENU_ITEMS = [
    { action: "clear-track", label: "Delete track content" },
    { action: "delete-selected", label: "Delete selected clips on track" },
    { action: "rename-track", label: "Rename track" },
    { action: "recolor-track", label: "Recolor track" },
    { action: "insert-track-below", label: "Insert track below" },
    { action: "delete-empty-track", label: "Delete empty track" },
];
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
function createLayout(state, metrics) {
    const sceneRect = {
        x: 0,
        y: 0,
        width: state.viewport.width,
        height: state.viewport.height,
    };
    const trackHeaderRect = {
        x: 0,
        y: 0,
        width: metrics.trackHeaderWidth,
        height: state.viewport.height,
    };
    const rulerRect = {
        x: metrics.trackHeaderWidth,
        y: 0,
        width: Math.max(0, state.viewport.width - metrics.trackHeaderWidth),
        height: metrics.rulerHeight,
    };
    const timelineRect = {
        x: metrics.trackHeaderWidth,
        y: metrics.rulerHeight,
        width: Math.max(0, state.viewport.width - metrics.trackHeaderWidth),
        height: Math.max(0, state.viewport.height - metrics.rulerHeight),
    };
    const trackBodyRect = {
        x: metrics.trackHeaderWidth,
        y: metrics.rulerHeight,
        width: Math.max(0, state.viewport.width - metrics.trackHeaderWidth),
        height: Math.max(0, state.viewport.height - metrics.rulerHeight),
    };
    const scrollbarCornerRect = {
        x: Math.max(metrics.trackHeaderWidth, state.viewport.width - metrics.scrollbarSize),
        y: Math.max(metrics.rulerHeight, state.viewport.height - metrics.scrollbarSize),
        width: metrics.scrollbarSize,
        height: metrics.scrollbarSize,
    };
    return {
        sceneRect,
        trackHeaderRect,
        rulerRect,
        timelineRect,
        trackBodyRect,
        scrollbarCornerRect,
    };
}
function getTrackFlags(state) {
    const selectedClipIds = new Set(state.selection.clipIds);
    const flagsByTrackId = new Map();
    for (const clip of state.clips) {
        const existing = flagsByTrackId.get(clip.trackId) ?? {
            hasClips: false,
            hasSelectedClips: false,
        };
        existing.hasClips = true;
        if (selectedClipIds.has(clip.id)) {
            existing.hasSelectedClips = true;
        }
        flagsByTrackId.set(clip.trackId, existing);
    }
    return flagsByTrackId;
}
function createTrackRows(state, metrics, flagsByTrackId) {
    const startIndex = Math.max(0, Math.floor(state.viewport.scrollY / metrics.trackHeight) -
        metrics.trackOverscan);
    const endIndex = Math.ceil((state.viewport.scrollY + state.viewport.height - metrics.rulerHeight) /
        metrics.trackHeight) + metrics.trackOverscan;
    const rows = [];
    for (let index = startIndex; index <= endIndex; index += 1) {
        const track = getTrackByIndex(state, index);
        const rowTop = trackIndexToScreenY(state, index, metrics);
        const rowRect = {
            x: metrics.trackHeaderWidth,
            y: rowTop,
            width: Math.max(0, state.viewport.width - metrics.trackHeaderWidth),
            height: metrics.trackHeight,
        };
        const headerRect = {
            x: 0,
            y: rowTop,
            width: metrics.trackHeaderWidth,
            height: metrics.trackHeight,
        };
        const stripRect = {
            x: 0,
            y: rowTop,
            width: 5,
            height: metrics.trackHeight,
        };
        const flags = flagsByTrackId.get(track.id) ?? {
            hasClips: false,
            hasSelectedClips: false,
        };
        rows.push({
            index,
            track,
            rowRect,
            headerRect,
            stripRect,
            isVirtual: index >= state.tracks.length,
            hasClips: flags.hasClips,
            hasSelectedClips: flags.hasSelectedClips,
        });
    }
    return rows;
}
function createClipViews(state, metrics) {
    const selectedClipIds = new Set(state.selection.clipIds);
    const hoveredClipId = state.hover != null && "clipId" in state.hover ? state.hover.clipId : null;
    const clipVisibilityBounds = normalizeRect({
        x: Math.max(0, metrics.trackHeaderWidth - metrics.timelineOverscanPx),
        y: Math.max(0, metrics.rulerHeight - metrics.trackOverscan * metrics.trackHeight),
        width: Math.max(0, state.viewport.width - metrics.trackHeaderWidth + metrics.timelineOverscanPx * 2),
        height: Math.max(0, state.viewport.height - metrics.rulerHeight + metrics.trackOverscan * metrics.trackHeight * 2),
    });
    return state.clips.map((clip) => {
        const rect = getClipRect(state, clip, metrics);
        const titleRect = getClipTitleRect(state, clip, metrics);
        const handleHeight = clip.type === "automation" ? titleRect.height : rect.height;
        const bodyRect = clip.type === "automation"
            ? {
                x: rect.x,
                y: rect.y + titleRect.height,
                width: rect.width,
                height: Math.max(0, rect.height - titleRect.height),
            }
            : rect;
        const automationPoints = isAutomationClip(clip)
            ? clip.points.map((point) => ({
                point,
                position: getAutomationPointPosition(state, clip, point, metrics),
                selected: state.selection.automationPointIds.includes(point.id),
            }))
            : [];
        return {
            clip,
            trackIndex: getTrackIndexById(state, clip.trackId),
            rect,
            titleRect,
            bodyRect,
            resizeLeftRect: {
                x: rect.x,
                y: rect.y,
                width: metrics.resizeHandleWidth,
                height: handleHeight,
            },
            resizeRightRect: {
                x: rect.x + rect.width - metrics.resizeHandleWidth,
                y: rect.y,
                width: metrics.resizeHandleWidth,
                height: handleHeight,
            },
            automationPoints,
            isVisible: rectsIntersect(rect, clipVisibilityBounds),
            isAutomation: isAutomationClip(clip),
            selected: selectedClipIds.has(clip.id),
            hovered: hoveredClipId != null &&
                hoveredClipId === clip.id &&
                state.hover?.kind !== "automation-point",
        };
    });
}
function createRulerTicks(state, metrics) {
    const step = pickGridStep(state.viewport.pxPerBeat);
    const startBeat = Math.max(0, Math.floor(screenXToTime(state, metrics.trackHeaderWidth, metrics) / step) *
        step);
    const endBeat = screenXToTime(state, state.viewport.width, metrics) + step;
    const ticks = [];
    for (let beat = startBeat; beat <= endBeat; beat += step) {
        const x = Math.round(timeToScreenX(state, beat, metrics)) + 0.5;
        const isBar = Math.abs(beat % metrics.beatsPerBar) < 0.001;
        if (x < metrics.trackHeaderWidth) {
            continue;
        }
        ticks.push({
            beat,
            x,
            isBar,
            label: isBar ? String(Math.floor(beat / metrics.beatsPerBar) + 1) : null,
        });
    }
    return ticks;
}
function createContextMenu(state, metrics, flagsByTrackId) {
    if (!state.contextMenu) {
        return null;
    }
    const rect = getContextMenuRect(state, metrics);
    if (!rect || state.contextMenu.kind !== "track") {
        return null;
    }
    const trackIndex = state.contextMenu.trackIndex;
    const trackId = getTrackIdByIndex(state, trackIndex);
    const flags = flagsByTrackId.get(trackId) ?? {
        hasClips: false,
        hasSelectedClips: false,
    };
    return {
        rect,
        trackIndex,
        trackId,
        items: PLAYLIST_TRACK_MENU_ITEMS.map((item, index) => {
            const itemRect = {
                x: rect.x + 4,
                y: rect.y + 4 + index * metrics.contextMenuItemHeight,
                width: rect.width - 8,
                height: metrics.contextMenuItemHeight,
            };
            return {
                action: item.action,
                label: item.label,
                rect: itemRect,
                disabled: (item.action === "delete-selected" && !flags.hasSelectedClips) ||
                    (item.action === "delete-empty-track" && flags.hasClips),
            };
        }),
    };
}
function createScrollbars(state, metrics) {
    return {
        horizontal: {
            trackRect: getHorizontalScrollbarRect(state, metrics),
            thumbRect: getHorizontalScrollbarThumbRect(state, metrics),
        },
        vertical: {
            trackRect: getVerticalScrollbarRect(state, metrics),
            thumbRect: getVerticalScrollbarThumbRect(state, metrics),
        },
    };
}
function createPlayPosition(state, metrics) {
    const x = timeToScreenX(state, state.playPosition.time, metrics);
    return {
        time: state.playPosition.time,
        x,
        isVisible: x >= metrics.trackHeaderWidth && x <= state.viewport.width,
        isRunning: state.playPosition.isRunning,
    };
}
function createMarquee(state) {
    if (!state.marquee) {
        return null;
    }
    return {
        rect: normalizeRect({
            x: state.marquee.start.x,
            y: state.marquee.start.y,
            width: state.marquee.current.x - state.marquee.start.x,
            height: state.marquee.current.y - state.marquee.start.y,
        }),
    };
}
export function createPlaylistPresentation(state, metrics = DEFAULT_PLAYLIST_METRICS) {
    const flagsByTrackId = getTrackFlags(state);
    const layout = createLayout(state, metrics);
    const trackRows = createTrackRows(state, metrics, flagsByTrackId);
    const trackRowsByIndex = new Map(trackRows.map((row) => [row.index, row]));
    const clipViews = createClipViews(state, metrics);
    const clipViewsById = new Map(clipViews.map((view) => [view.clip.id, view]));
    const visibleClipViews = clipViews.filter((view) => view.isVisible);
    const rulerTicks = createRulerTicks(state, metrics);
    const scrollbars = createScrollbars(state, metrics);
    const contextMenu = createContextMenu(state, metrics, flagsByTrackId);
    return {
        state,
        metrics,
        layout,
        trackRows,
        trackRowsByIndex,
        clipViews,
        visibleClipViews,
        clipViewsById,
        rulerTicks,
        scrollbars,
        contextMenu,
        playPosition: createPlayPosition(state, metrics),
        marquee: createMarquee(state),
        timeToScreenX: (time) => timeToScreenX(state, time, metrics),
        screenXToTime: (screenX) => screenXToTime(state, screenX, metrics),
        trackIndexToScreenY: (trackIndex) => trackIndexToScreenY(state, trackIndex, metrics),
        screenYToTrackIndex: (screenY) => {
            const raw = (screenY - metrics.rulerHeight + state.viewport.scrollY) /
                metrics.trackHeight;
            return Math.max(0, Math.floor(raw));
        },
    };
}
