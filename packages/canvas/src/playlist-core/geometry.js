import { DEFAULT_PLAYLIST_METRICS, } from "./types";
export function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}
export function isAutomationClip(clip) {
    return clip.type === "automation";
}
export function normalizeRect(rect) {
    const x = Math.min(rect.x, rect.x + rect.width);
    const y = Math.min(rect.y, rect.y + rect.height);
    return {
        x,
        y,
        width: Math.abs(rect.width),
        height: Math.abs(rect.height),
    };
}
export function rectsIntersect(left, right) {
    return (left.x < right.x + right.width &&
        left.x + left.width > right.x &&
        left.y < right.y + right.height &&
        left.y + left.height > right.y);
}
export function pointInRect(point, rect) {
    return (point.x >= rect.x &&
        point.x <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height);
}
export function getHorizontalScrollbarRect(state, metrics = DEFAULT_PLAYLIST_METRICS) {
    return {
        x: metrics.trackHeaderWidth,
        y: Math.max(metrics.rulerHeight, state.viewport.height - metrics.scrollbarSize),
        width: Math.max(metrics.scrollbarThumbMin, state.viewport.width - metrics.trackHeaderWidth - metrics.scrollbarSize),
        height: metrics.scrollbarSize,
    };
}
export function getVerticalScrollbarRect(state, metrics = DEFAULT_PLAYLIST_METRICS) {
    return {
        x: Math.max(metrics.trackHeaderWidth, state.viewport.width - metrics.scrollbarSize),
        y: metrics.rulerHeight,
        width: metrics.scrollbarSize,
        height: Math.max(metrics.scrollbarThumbMin, state.viewport.height - metrics.rulerHeight - metrics.scrollbarSize),
    };
}
export function getHorizontalScrollbarThumbRect(state, metrics = DEFAULT_PLAYLIST_METRICS) {
    const track = getHorizontalScrollbarRect(state, metrics);
    const width = clamp(track.width * 0.24, metrics.scrollbarThumbMin, track.width);
    const travel = Math.max(1, track.width - width);
    const local = ((state.viewport.scrollX % metrics.scrollbarVirtualRangePx) /
        metrics.scrollbarVirtualRangePx) *
        travel;
    return {
        x: track.x + local,
        y: track.y + 2,
        width,
        height: Math.max(1, track.height - 4),
    };
}
export function getVerticalScrollbarThumbRect(state, metrics = DEFAULT_PLAYLIST_METRICS) {
    const track = getVerticalScrollbarRect(state, metrics);
    const height = clamp(track.height * 0.24, metrics.scrollbarThumbMin, track.height);
    const travel = Math.max(1, track.height - height);
    const local = ((state.viewport.scrollY % metrics.scrollbarVirtualRangePx) /
        metrics.scrollbarVirtualRangePx) *
        travel;
    return {
        x: track.x + 2,
        y: track.y + local,
        width: Math.max(1, track.width - 4),
        height,
    };
}
export function getContextMenuRect(state, metrics = DEFAULT_PLAYLIST_METRICS) {
    if (!state.contextMenu) {
        return null;
    }
    const itemCount = 6;
    const width = metrics.contextMenuWidth;
    const height = itemCount * metrics.contextMenuItemHeight + 8;
    return {
        x: clamp(state.contextMenu.position.x, 0, Math.max(0, state.viewport.width - width)),
        y: clamp(state.contextMenu.position.y, 0, Math.max(0, state.viewport.height - height)),
        width,
        height,
    };
}
export function getTrackIndexById(state, trackId) {
    const realIndex = state.tracks.findIndex((track) => track.id === trackId);
    if (realIndex >= 0) {
        return realIndex;
    }
    const virtualIndex = /^track-(\d+)$/.exec(trackId)?.[1];
    if (virtualIndex) {
        return Math.max(0, Number.parseInt(virtualIndex, 10) - 1);
    }
    return 0;
}
export function getTrackIdByIndex(state, trackIndex) {
    const index = Math.max(0, Math.floor(trackIndex));
    return state.tracks[index]?.id ?? `track-${index + 1}`;
}
const VIRTUAL_TRACK_COLORS = [
    "#e85d75",
    "#46b871",
    "#d9a441",
    "#39a8c9",
    "#c970d8",
    "#b7d957",
    "#f0703f",
    "#8fd3a8",
];
export function createVirtualTrack(trackIndex) {
    const index = Math.max(0, Math.floor(trackIndex));
    return {
        id: `track-${index + 1}`,
        label: `Track ${index + 1}`,
        color: VIRTUAL_TRACK_COLORS[index % VIRTUAL_TRACK_COLORS.length],
    };
}
export function getTrackByIndex(state, trackIndex) {
    const index = Math.max(0, Math.floor(trackIndex));
    return state.tracks[index] ?? createVirtualTrack(index);
}
export function timeToScreenX(state, time, metrics = DEFAULT_PLAYLIST_METRICS) {
    return (metrics.trackHeaderWidth +
        time * state.viewport.pxPerBeat -
        state.viewport.scrollX);
}
export function screenXToTime(state, screenX, metrics = DEFAULT_PLAYLIST_METRICS) {
    return ((screenX - metrics.trackHeaderWidth + state.viewport.scrollX) /
        state.viewport.pxPerBeat);
}
export function trackIndexToScreenY(state, trackIndex, metrics = DEFAULT_PLAYLIST_METRICS) {
    return (metrics.rulerHeight +
        trackIndex * metrics.trackHeight -
        state.viewport.scrollY);
}
export function screenYToTrackIndex(state, screenY, metrics = DEFAULT_PLAYLIST_METRICS) {
    const raw = (screenY - metrics.rulerHeight + state.viewport.scrollY) /
        metrics.trackHeight;
    return Math.max(0, Math.floor(raw));
}
export const worldToScreenX = timeToScreenX;
export const screenToWorldX = screenXToTime;
export const trackToY = trackIndexToScreenY;
export const yToTrack = screenYToTrackIndex;
export function getClipRect(state, clip, metrics = DEFAULT_PLAYLIST_METRICS) {
    const trackIndex = getTrackIndexById(state, clip.trackId);
    const rowTop = trackIndexToScreenY(state, trackIndex, metrics);
    return {
        x: timeToScreenX(state, clip.start, metrics),
        y: rowTop + metrics.clipPaddingY,
        width: clip.duration * state.viewport.pxPerBeat,
        height: metrics.trackHeight - metrics.clipPaddingY * 2,
    };
}
export function getClipTitleRect(state, clip, metrics = DEFAULT_PLAYLIST_METRICS) {
    const rect = getClipRect(state, clip, metrics);
    return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: Math.min(metrics.clipTitleHeight, rect.height),
    };
}
export function getAutomationPointPosition(state, clip, point, metrics = DEFAULT_PLAYLIST_METRICS) {
    const rect = getClipRect(state, clip, metrics);
    const bodyTop = rect.y + metrics.clipTitleHeight + 4;
    const bodyHeight = Math.max(1, rect.height - metrics.clipTitleHeight - 8);
    return {
        x: rect.x + (point.time / Math.max(clip.duration, 0.001)) * rect.width,
        y: bodyTop + (1 - clamp(point.value, 0, 1)) * bodyHeight,
    };
}
export function automationPointFromScreen(state, clip, point, metrics = DEFAULT_PLAYLIST_METRICS) {
    const rect = getClipRect(state, clip, metrics);
    const bodyTop = rect.y + metrics.clipTitleHeight + 4;
    const bodyHeight = Math.max(1, rect.height - metrics.clipTitleHeight - 8);
    const localTime = ((point.x - rect.x) / Math.max(rect.width, 1)) * clip.duration;
    return {
        time: clamp(localTime, 0, clip.duration),
        value: clamp(1 - (point.y - bodyTop) / bodyHeight, 0, 1),
    };
}
export function snapTime(value, state, ignoreSnap = false) {
    if (ignoreSnap || !state.snap.enabled || state.snap.step <= 0) {
        return Math.max(0, value);
    }
    const snapped = Math.round(value / state.snap.step) * state.snap.step;
    return Math.max(0, Number(snapped.toFixed(4)));
}
export function getContentEndBeat(state) {
    return state.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), metricsDefaultEnd(state));
}
function metricsDefaultEnd(state) {
    return Math.max(32, state.playPosition.time + 16);
}
export function getMaxScrollY(_state, _metrics = DEFAULT_PLAYLIST_METRICS) {
    return Number.POSITIVE_INFINITY;
}
export function getMaxScrollX(_state, _metrics = DEFAULT_PLAYLIST_METRICS) {
    return Number.POSITIVE_INFINITY;
}
