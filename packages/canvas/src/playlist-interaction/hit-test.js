import { pointInRect, } from "../playlist-core";
function distance(left, right) {
    return Math.hypot(left.x - right.x, left.y - right.y);
}
function getAutomationPointHit(clipView, point, metrics) {
    for (let index = clipView.automationPoints.length - 1; index >= 0; index -= 1) {
        const automationPoint = clipView.automationPoints[index];
        if (distance(point, automationPoint.position) <= metrics.automationPointRadius + 4) {
            return {
                kind: "automation-point",
                clip: clipView.clip,
                clipId: clipView.clip.id,
                pointId: automationPoint.point.id,
            };
        }
    }
    return null;
}
export function hitTestPlaylist(presentation, point, metrics) {
    const { contextMenu, playPosition, scrollbars, trackRows, visibleClipViews } = presentation;
    if (contextMenu && pointInRect(point, contextMenu.rect)) {
        const itemIndex = contextMenu.items.findIndex((item) => pointInRect(point, item.rect));
        if (itemIndex >= 0) {
            const item = contextMenu.items[itemIndex];
            return {
                kind: "context-menu",
                action: item.action,
                disabled: item.disabled,
            };
        }
    }
    if (pointInRect(point, scrollbars.horizontal.trackRect)) {
        return {
            kind: "scrollbar-horizontal",
            onThumb: pointInRect(point, scrollbars.horizontal.thumbRect),
        };
    }
    if (pointInRect(point, scrollbars.vertical.trackRect)) {
        return {
            kind: "scrollbar-vertical",
            onThumb: pointInRect(point, scrollbars.vertical.thumbRect),
        };
    }
    if (playPosition.isVisible &&
        point.y <= metrics.rulerHeight &&
        point.x >= metrics.trackHeaderWidth &&
        Math.abs(point.x - playPosition.x) <= metrics.playMarkerHitWidth) {
        return { kind: "play-position-marker" };
    }
    if (point.y <= metrics.rulerHeight && point.x >= metrics.trackHeaderWidth) {
        return { kind: "ruler" };
    }
    if (point.x < metrics.trackHeaderWidth && point.y > metrics.rulerHeight) {
        const row = trackRows.find((candidate) => pointInRect(point, candidate.headerRect));
        if (row) {
            return {
                kind: "track-header",
                trackIndex: row.index,
                trackId: row.track.id,
            };
        }
    }
    for (let index = visibleClipViews.length - 1; index >= 0; index -= 1) {
        const clipView = visibleClipViews[index];
        if (!pointInRect(point, clipView.rect)) {
            continue;
        }
        const automationPointHit = getAutomationPointHit(clipView, point, metrics);
        if (automationPointHit) {
            return automationPointHit;
        }
        if (pointInRect(point, clipView.resizeLeftRect)) {
            return {
                kind: "resize-left",
                clip: clipView.clip,
                clipId: clipView.clip.id,
            };
        }
        if (pointInRect(point, clipView.resizeRightRect)) {
            return {
                kind: "resize-right",
                clip: clipView.clip,
                clipId: clipView.clip.id,
            };
        }
        if (clipView.isAutomation && !pointInRect(point, clipView.titleRect)) {
            return {
                kind: "automation-body",
                clip: clipView.clip,
                clipId: clipView.clip.id,
            };
        }
        return {
            kind: "clip",
            clip: clipView.clip,
            clipId: clipView.clip.id,
        };
    }
    return { kind: "empty" };
}
