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
export function getTrackIndexById(state, trackId) {
    return Math.max(0, state.tracks.findIndex((track) => track.id === trackId));
}
export function getTrackIdByIndex(state, trackIndex) {
    const index = clamp(trackIndex, 0, Math.max(0, state.tracks.length - 1));
    return state.tracks[index]?.id ?? state.tracks[0]?.id ?? "track-1";
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
    return clamp(Math.floor(raw), 0, Math.max(0, state.tracks.length - 1));
}
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
    return Math.max(32, state.playhead + 16);
}
export function getMaxScrollY(state, metrics = DEFAULT_PLAYLIST_METRICS) {
    const visibleTrackHeight = Math.max(0, state.viewport.height - metrics.rulerHeight);
    const contentHeight = state.tracks.length * metrics.trackHeight;
    return Math.max(0, contentHeight - visibleTrackHeight);
}
export function getMaxScrollX(state, metrics = DEFAULT_PLAYLIST_METRICS) {
    const visibleTimelineWidth = Math.max(0, state.viewport.width - metrics.trackHeaderWidth);
    const contentWidth = (getContentEndBeat(state) + 16) * state.viewport.pxPerBeat;
    return Math.max(0, contentWidth - visibleTimelineWidth);
}
