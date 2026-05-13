import {
  automationPointFromScreen,
  clamp,
  formatBarBeat,
  getHorizontalScrollableRange,
  getHorizontalScrollbarRect,
  getHorizontalScrollbarThumbRect,
  getTrackHeightByIndex,
  getTrackIdByIndex,
  getVerticalScrollableRange,
  getVerticalScrollbarRect,
  getVerticalScrollbarThumbRect,
  normalizeRect,
  rectsIntersect,
  screenXToTime,
  screenYToTrackIndex,
  snapTime,
} from "../playlist-core";
import { interpolateBrushPath } from "./brush";
import type {
  PlaylistCore,
  PlaylistPoint,
  PlaylistRect,
  PlaylistToolId,
  PlaylistTrackMenuAction,
} from "../playlist-core";
import type { ActiveGesture } from "./gesture-types";
import { hitTestPlaylist, type PlaylistHit } from "./hit-test";
import { getTool, zoomToolApplyOut } from "./tools";

export interface PlaylistInteractionController {
  destroy: () => void;
}

type PlaylistInteractionHost = HTMLElement & {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
};

const TOOL_HOTKEYS: Readonly<Record<string, PlaylistToolId>> = {
  P: "draw",
  B: "paint",
  D: "delete",
  T: "mute",
  S: "slip",
  C: "slice",
  E: "select",
  Z: "zoom",
};

function resolvePoint(
  host: HTMLElement,
  event: MouseEvent | PointerEvent | WheelEvent,
): PlaylistPoint {
  const rect = host.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function setCursor(
  host: HTMLElement,
  hit: PlaylistHit | null,
  active: ActiveGesture | null,
  toolId: PlaylistToolId,
): void {
  if (active?.kind === "pan" || active?.kind === "clip-drag") {
    host.style.cursor = "grabbing";
    return;
  }

  if (active?.kind === "clip-resize") {
    host.style.cursor = "ew-resize";
    return;
  }

  if (active?.kind === "automation-point-drag") {
    host.style.cursor = "grabbing";
    return;
  }

  if (active?.kind === "play-position-drag") {
    host.style.cursor = "ew-resize";
    return;
  }

  if (active?.kind === "scrollbar-horizontal") {
    host.style.cursor = "ew-resize";
    return;
  }

  if (active?.kind === "scrollbar-vertical") {
    host.style.cursor = "ns-resize";
    return;
  }

  if (
    active?.kind === "paint-drag" ||
    active?.kind === "delete-drag" ||
    active?.kind === "mute-drag" ||
    active?.kind === "slip-drag" ||
    active?.kind === "slice-drag"
  ) {
    host.style.cursor = getTool(toolId).cursor;
    return;
  }

  if (active?.kind === "track-resize") {
    host.style.cursor = "ns-resize";
    return;
  }

  if (active?.kind === "track-reorder") {
    host.style.cursor = "grabbing";
    return;
  }

  if (active?.kind === "marker-drag") {
    host.style.cursor = "grabbing";
    return;
  }

  if (!hit) {
    host.style.cursor = "default";
    return;
  }

  // Universal hits override tool cursors.
  if (hit.kind === "scrollbar-horizontal") {
    host.style.cursor = "ew-resize";
    return;
  }

  if (hit.kind === "scrollbar-vertical") {
    host.style.cursor = "ns-resize";
    return;
  }

  if (hit.kind === "play-position-marker" || hit.kind === "ruler") {
    host.style.cursor = "ew-resize";
    return;
  }

  if (hit.kind === "marker") {
    host.style.cursor = "grab";
    return;
  }

  if (hit.kind === "track-header") {
    host.style.cursor = "default";
    return;
  }

  if (
    hit.kind === "track-mute-button" ||
    hit.kind === "track-solo-button" ||
    hit.kind === "track-lock-button"
  ) {
    host.style.cursor = "pointer";
    return;
  }

  if (hit.kind === "track-resize-handle") {
    host.style.cursor = "ns-resize";
    return;
  }

  if (hit.kind === "track-reorder-handle") {
    host.style.cursor = "grab";
    return;
  }

  // Timeline area (clip / automation / empty): cursor follows the active tool.
  if (toolId === "select") {
    if (hit.kind === "resize-left" || hit.kind === "resize-right") {
      host.style.cursor = "ew-resize";
      return;
    }
    if (hit.kind === "automation-point" || hit.kind === "clip") {
      host.style.cursor = "grab";
      return;
    }
    if (hit.kind === "automation-body") {
      host.style.cursor = "crosshair";
      return;
    }
    host.style.cursor = "default";
    return;
  }

  host.style.cursor = getTool(toolId).cursor;
}

function selectClipsInMarquee(core: PlaylistCore, additive: boolean): void {
  const presentation = core.getPresentation();
  const marquee = presentation.state.marquee;

  if (!marquee) {
    return;
  }

  const rect = normalizeRect({
    x: marquee.start.x,
    y: marquee.start.y,
    width: marquee.current.x - marquee.start.x,
    height: marquee.current.y - marquee.start.y,
  });
  const clipIds = presentation.clipViews
    .filter((view) => rectsIntersect(rect, view.rect))
    .map((view) => view.clip.id);

  core.setClipSelection(clipIds, { additive });
}

function segmentIntersectsRect(
  from: PlaylistPoint,
  to: PlaylistPoint,
  rect: PlaylistRect,
): boolean {
  const minX = rect.x;
  const maxX = rect.x + rect.width;
  const minY = rect.y;
  const maxY = rect.y + rect.height;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let t0 = 0;
  let t1 = 1;
  let p = -dx;
  let q = from.x - minX;
  if (p === 0) {
    if (q < 0) return false;
  } else {
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  p = dx;
  q = maxX - from.x;
  if (p === 0) {
    if (q < 0) return false;
  } else {
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  p = -dy;
  q = from.y - minY;
  if (p === 0) {
    if (q < 0) return false;
  } else {
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  p = dy;
  q = maxY - from.y;
  if (p === 0) {
    if (q < 0) return false;
  } else {
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

function clipIdsTouchedBySegment(
  core: PlaylistCore,
  from: PlaylistPoint,
  to: PlaylistPoint,
  seen: Set<string>,
): string[] {
  const ids: string[] = [];
  for (const view of core.getPresentation().visibleClipViews) {
    if (seen.has(view.clip.id)) continue;
    if (!segmentIntersectsRect(from, to, view.rect)) continue;
    seen.add(view.clip.id);
    ids.push(view.clip.id);
  }
  return ids;
}

// Pump the three F3 overlays (snap line / drop ghost / time tooltip) from a
// single call site so the gesture handlers stay focused on their primary
// mutations. `preview` may be null when the gesture only emits a snap/time
// tooltip (play-position-drag). `tooltipTime` overrides the time shown in
// the tooltip — used by play-position-drag where the meaningful time is the
// playhead, not the inferred-from-preview value.
function emitDragOverlays(
  core: PlaylistCore,
  state: import("../playlist-core").PlaylistState,
  point: PlaylistPoint,
  altKey: boolean,
  preview:
    | import("../playlist-core").PlaylistDragPreview
    | null
    | undefined,
  tooltipTime?: number,
): void {
  const snapActive = state.snap.mode !== "none" && !altKey;
  const snapTimeValue =
    preview && preview.kind === "clip-move"
      ? preview.previewStart
      : preview && preview.kind === "clip-resize"
        ? preview.edge === "right"
          ? preview.previewStart + preview.previewDuration
          : preview.previewStart
        : preview && preview.kind === "marker"
          ? preview.previewTime
          : tooltipTime ?? 0;
  core.setSnapHint({ time: snapTimeValue, visible: snapActive });
  if (preview !== undefined) {
    core.setDragPreview(preview);
  }
  const tooltipBeats = tooltipTime ?? snapTimeValue;
  core.setTooltip({
    kind: "time",
    text: formatBarBeat(tooltipBeats, core.metrics.beatsPerBar),
    anchor: point,
  });
}

function clearDragOverlays(core: PlaylistCore): void {
  core.clearSnapHint();
  core.clearDragPreview();
  core.clearTooltip();
}

function setHoverFromHit(core: PlaylistCore, hit: PlaylistHit): void {
  if (hit.kind === "clip" || hit.kind === "automation-body") {
    core.setHover({ kind: "clip", clipId: hit.clip.id });
    return;
  }

  if (hit.kind === "resize-left") {
    core.setHover({ kind: "resize-left", clipId: hit.clip.id });
    return;
  }

  if (hit.kind === "resize-right") {
    core.setHover({ kind: "resize-right", clipId: hit.clip.id });
    return;
  }

  if (hit.kind === "automation-point") {
    core.setHover({
      kind: "automation-point",
      clipId: hit.clip.id,
      pointId: hit.pointId,
    });
    return;
  }

  if (hit.kind === "marker") {
    core.setHover({ kind: "marker", markerId: hit.markerId });
    return;
  }

  if (hit.kind === "play-position-marker" || hit.kind === "ruler") {
    core.setHover(null);
    return;
  }

  if (hit.kind === "track-header") {
    core.setHover({
      kind: "track",
      trackId: getTrackIdByIndex(core.getState(), hit.trackIndex),
    });
    return;
  }

  core.setHover(null);
}

// Track / clip / background context menus are rendered as HTML overlays in
// the React shell now; the controller just routes RMB events to the right
// open* helper on PlaylistCore.

export function createPlaylistInteractionController(
  host: PlaylistInteractionHost,
  core: PlaylistCore,
): PlaylistInteractionController {
  const metrics = core.metrics;
  let activeGesture: ActiveGesture | null = null;

  host.style.touchAction = "none";
  host.style.userSelect = "none";

  const handlePointerDown = (event: PointerEvent): void => {
    host.focus();

    const state = core.getState();
    const point = resolvePoint(host, event);
    const hit = hitTestPlaylist(core.getPresentation(), point, metrics);

    if (state.contextMenu) {
      // The HTML menu overlay handles its own outside-click, but suppress the
      // first LMB on the canvas so it doesn't act through the menu.
      core.closeContextMenu();
      if (event.button === 0) {
        event.preventDefault();
        return;
      }
    }

    if (event.button === 1) {
      activeGesture = {
        kind: "pan",
        pointerId: event.pointerId,
        startPoint: point,
        startScrollX: state.viewport.scrollX,
        startScrollY: state.viewport.scrollY,
      };
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool);
      event.preventDefault();
      return;
    }

    if (event.button === 2) {
      if (state.tool === "zoom") {
        zoomToolApplyOut({ core, metrics, point, hit, event });
        event.preventDefault();
        return;
      }
      if (hit.kind === "track-header") {
        core.openTrackContextMenu(hit.trackIndex, point);
        event.preventDefault();
        return;
      }

      if (hit.kind === "marker") {
        core.openMarkerContextMenu(hit.markerId, point);
        event.preventDefault();
        return;
      }

      if (hit.kind === "automation-point") {
        core.removeAutomationPoint(hit.clip.id, hit.pointId);
        event.preventDefault();
        return;
      }

      // Draw, Paint and Mute tools: RMB on clips deletes; drag keeps deleting.
      if (
        (state.tool === "draw" ||
          state.tool === "paint" ||
          state.tool === "mute") &&
        (hit.kind === "clip" ||
          hit.kind === "automation-body" ||
          hit.kind === "resize-left" ||
          hit.kind === "resize-right")
      ) {
        const deletedClipIds = new Set<string>([hit.clip.id]);
        core.beginGesture();
        core.deleteClips([hit.clip.id]);
        activeGesture = {
          kind: "delete-drag",
          pointerId: event.pointerId,
          lastPoint: { ...point },
          deletedClipIds,
        };
        host.setPointerCapture?.(event.pointerId);
        setCursor(host, hit, activeGesture, state.tool);
        event.preventDefault();
        return;
      }

      if (hit.kind === "automation-body") {
        const next = automationPointFromScreen(state, hit.clip, point, metrics);
        core.addAutomationPoint(
          hit.clip.id,
          snapTime(next.time, state, event.altKey),
          next.value,
        );
        event.preventDefault();
        return;
      }

      // Select tool (and stubs that fall back to it): RMB opens a context menu.
      if (state.tool === "select" || state.tool === "slip" || state.tool === "slice") {
        if (
          hit.kind === "clip" ||
          hit.kind === "resize-left" ||
          hit.kind === "resize-right"
        ) {
          core.openClipContextMenu(hit.clip.id, point);
          event.preventDefault();
          return;
        }
        if (hit.kind === "empty") {
          const time = Math.max(
            0,
            snapTime(screenXToTime(state, point.x, metrics), state, event.altKey),
          );
          const trackIndex = screenYToTrackIndex(state, point.y, metrics);
          core.openBackgroundContextMenu(time, trackIndex, point);
          event.preventDefault();
          return;
        }
      }

      return;
    }

    if (event.button !== 0) {
      return;
    }

    if (hit.kind === "scrollbar-horizontal") {
      const track = getHorizontalScrollbarRect(state, metrics);
      let thumb = getHorizontalScrollbarThumbRect(state, metrics);
      const scrollableRange = getHorizontalScrollableRange(state, metrics);
      // Click on the track outside the thumb: page-jump so the thumb lands
      // under the cursor, then start a drag from that new origin. Matches
      // the standard browser scrollbar behaviour.
      let startScrollX = state.viewport.scrollX;
      let anchorPoint = point;
      if (!hit.onThumb) {
        const travelInit = Math.max(1, track.width - thumb.width);
        const ratio = clamp(
          (point.x - track.x - thumb.width / 2) / travelInit,
          0,
          1,
        );
        startScrollX = Math.max(0, ratio * scrollableRange);
        core.updateViewport({ scrollX: startScrollX });
        thumb = getHorizontalScrollbarThumbRect(core.getState(), metrics);
        anchorPoint = { x: thumb.x + thumb.width / 2, y: point.y };
      }
      const travel = Math.max(1, track.width - thumb.width);
      activeGesture = {
        kind: "scrollbar-horizontal",
        pointerId: event.pointerId,
        startPoint: anchorPoint,
        startScrollX,
        scrollableRange,
        travel,
      };
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool);
      event.preventDefault();
      return;
    }

    if (hit.kind === "scrollbar-vertical") {
      const track = getVerticalScrollbarRect(state, metrics);
      let thumb = getVerticalScrollbarThumbRect(state, metrics);
      const scrollableRange = getVerticalScrollableRange(state, metrics);
      let startScrollY = state.viewport.scrollY;
      let anchorPoint = point;
      if (!hit.onThumb) {
        const travelInit = Math.max(1, track.height - thumb.height);
        const ratio = clamp(
          (point.y - track.y - thumb.height / 2) / travelInit,
          0,
          1,
        );
        startScrollY = Math.max(0, ratio * scrollableRange);
        core.updateViewport({ scrollY: startScrollY });
        thumb = getVerticalScrollbarThumbRect(core.getState(), metrics);
        anchorPoint = { x: point.x, y: thumb.y + thumb.height / 2 };
      }
      const travel = Math.max(1, track.height - thumb.height);
      activeGesture = {
        kind: "scrollbar-vertical",
        pointerId: event.pointerId,
        startPoint: anchorPoint,
        startScrollY,
        scrollableRange,
        travel,
      };
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool);
      event.preventDefault();
      return;
    }

    if (hit.kind === "track-mute-button") {
      core.toggleTrackMute(hit.trackIndex);
      event.preventDefault();
      return;
    }

    if (hit.kind === "track-solo-button") {
      core.toggleTrackSolo(hit.trackIndex);
      event.preventDefault();
      return;
    }

    if (hit.kind === "track-lock-button") {
      core.toggleTrackLock(hit.trackIndex);
      event.preventDefault();
      return;
    }

    if (hit.kind === "track-resize-handle") {
      const startHeight = getTrackHeightByIndex(state, hit.trackIndex, metrics);
      activeGesture = {
        kind: "track-resize",
        pointerId: event.pointerId,
        trackIndex: hit.trackIndex,
        startY: point.y,
        startHeight,
      };
      core.beginGesture();
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool);
      event.preventDefault();
      return;
    }

    if (hit.kind === "track-reorder-handle") {
      activeGesture = {
        kind: "track-reorder",
        pointerId: event.pointerId,
        fromIndex: hit.trackIndex,
        currentIndex: hit.trackIndex,
      };
      core.beginGesture();
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool);
      event.preventDefault();
      return;
    }

    if (hit.kind === "track-header") {
      core.setSelection({ clipIds: [], automationPointIds: [] });
      event.preventDefault();
      return;
    }

    if (hit.kind === "marker") {
      const marker = state.markers.find((m) => m.id === hit.markerId);
      if (marker) {
        activeGesture = {
          kind: "marker-drag",
          pointerId: event.pointerId,
          markerId: marker.id,
          startTime: marker.time,
          startPointerTime: screenXToTime(state, point.x, metrics),
        };
        core.beginGesture();
        host.setPointerCapture?.(event.pointerId);
        setCursor(host, hit, activeGesture, state.tool);
        event.preventDefault();
        return;
      }
    }

    if (hit.kind === "play-position-marker" || hit.kind === "ruler") {
      core.setPlayPosition(
        snapTime(screenXToTime(state, point.x, metrics), state, event.altKey),
      );
      activeGesture = {
        kind: "play-position-drag",
        pointerId: event.pointerId,
      };
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool);
      event.preventDefault();
      return;
    }

    // F4: double-click on a clip emits a host-level CustomEvent so the
    // React shell can open a clip-detail modal. We bubble through DOM
    // rather than holding modal state in the playlist-core because the
    // modal's contents are a shell concern (the financial engine modal
    // will replace this stub later).
    if (
      (event as { detail?: number }).detail === 2 &&
      (hit.kind === "clip" || hit.kind === "automation-body")
    ) {
      const evt = new CustomEvent("playlist-clip-open", {
        detail: { clipId: hit.clip.id },
        bubbles: true,
      });
      host.dispatchEvent(evt);
      event.preventDefault();
      return;
    }

    // Delegate timeline-area hits to the active tool.
    const tool = getTool(state.tool);
    const gesture = tool.onPointerDown({ core, metrics, point, hit, event });
    if (gesture) {
      activeGesture = gesture;
      if (gestureMutatesDoc(gesture)) {
        core.beginGesture();
      }
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool);
    }
    event.preventDefault();
  };

  function gestureMutatesDoc(gesture: ActiveGesture): boolean {
    return (
      gesture.kind === "clip-drag" ||
      gesture.kind === "clip-resize" ||
      gesture.kind === "clip-create-drag" ||
      gesture.kind === "automation-point-drag" ||
      gesture.kind === "paint-drag" ||
      gesture.kind === "delete-drag" ||
      gesture.kind === "mute-drag" ||
      gesture.kind === "slip-drag" ||
      gesture.kind === "marker-drag"
    );
  }

  const handlePointerMove = (event: PointerEvent): void => {
    const state = core.getState();
    const point = resolvePoint(host, event);

    if (!activeGesture) {
      const hit = hitTestPlaylist(core.getPresentation(), point, metrics);
      setHoverFromHit(core, hit);
      // F3: hover on the ruler emits a B.B.T tooltip; everywhere else the
      // tooltip is cleared. setTooltip short-circuits when the value
      // doesn't change, so calling clearTooltip every pointermove is free
      // when no tooltip was active.
      if (hit.kind === "ruler" || hit.kind === "play-position-marker") {
        const tooltipBeats = Math.max(
          0,
          screenXToTime(state, point.x, metrics),
        );
        core.setTooltip({
          kind: "time",
          text: formatBarBeat(tooltipBeats, metrics.beatsPerBar),
          anchor: point,
        });
      } else {
        core.clearTooltip();
      }
      setCursor(host, hit, null, state.tool);
      return;
    }

    if (activeGesture.pointerId !== event.pointerId) {
      return;
    }

    const gesture = activeGesture;

    if (gesture.kind === "pan") {
      core.updateViewport({
        scrollX: gesture.startScrollX - (point.x - gesture.startPoint.x),
        scrollY: gesture.startScrollY - (point.y - gesture.startPoint.y),
      });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "marquee") {
      core.setMarquee({ start: gesture.startPoint, current: point });
      selectClipsInMarquee(core, gesture.additive);
      event.preventDefault();
      return;
    }

    if (gesture.kind === "clip-drag") {
      const primary = gesture.originals.find(
        (clip) => clip.id === gesture.primaryClipId,
      );

      if (!primary) {
        return;
      }

      const currentTime = screenXToTime(state, point.x, metrics);
      const rawPrimaryStart =
        primary.start + (currentTime - gesture.startPointerTime);
      const primaryStart = snapTime(rawPrimaryStart, state, event.altKey);
      const deltaTime = primaryStart - primary.start;
      const currentTrackIndex = screenYToTrackIndex(state, point.y, metrics);
      const trackDelta = currentTrackIndex - gesture.startTrackIndex;
      const allMoves = gesture.originals.map((clip) => ({
        id: clip.id,
        start: clip.start + deltaTime,
        trackIndex: clamp(
          clip.trackIndex + trackDelta,
          0,
          Number.POSITIVE_INFINITY,
        ),
      }));

      core.moveClips(allMoves);
      emitDragOverlays(core, state, point, event.altKey, {
        kind: "clip-move",
        primaryClipId: gesture.primaryClipId,
        previewTrackIndex: clamp(
          gesture.startTrackIndex + trackDelta,
          0,
          Number.POSITIVE_INFINITY,
        ),
        previewStart: primaryStart,
        allMoves,
      });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "clip-resize") {
      const time = snapTime(
        screenXToTime(state, point.x, metrics),
        state,
        event.altKey,
      );
      if (state.stretchMode) {
        core.stretchResizeClip(gesture.clipId, gesture.edge, time);
      } else {
        core.resizeClip(gesture.clipId, gesture.edge, time);
      }
      const clipAfter = core
        .getState()
        .clips.find((c) => c.id === gesture.clipId);
      if (clipAfter) {
        emitDragOverlays(core, state, point, event.altKey, {
          kind: "clip-resize",
          clipId: gesture.clipId,
          edge: gesture.edge,
          previewStart: clipAfter.start,
          previewDuration: clipAfter.duration,
        });
      }
      event.preventDefault();
      return;
    }

    if (gesture.kind === "clip-create-drag") {
      // Draw-tool drag from empty space. We only commit a clip once the
      // cursor has crossed minClipDuration past the snapped start so a
      // micro-drag (single-click bounce) doesn't leave a stray clip behind.
      // After creation, every subsequent move adjusts the right edge.
      const rawTime = screenXToTime(state, point.x, metrics);
      const endTime = snapTime(rawTime, state, event.altKey);
      const minEnd = gesture.startSnappedStart + metrics.minClipDuration;
      if (endTime <= minEnd && gesture.createdClipId === null) {
        event.preventDefault();
        return;
      }
      const effectiveEnd = Math.max(endTime, minEnd);
      if (gesture.createdClipId === null) {
        const id = core.createClip({
          trackIndex: gesture.startTrackIndex,
          start: gesture.startSnappedStart,
          duration: effectiveEnd - gesture.startSnappedStart,
          type: gesture.template.type,
          label: gesture.template.label,
          color: gesture.template.color,
          sourceId: gesture.template.sourceId,
        });
        gesture.createdClipId = id;
        core.setSelection({ clipIds: [id], automationPointIds: [] });
      } else {
        core.resizeClip(gesture.createdClipId, "right", effectiveEnd);
      }
      emitDragOverlays(core, state, point, event.altKey, {
        kind: "clip-resize",
        clipId: gesture.createdClipId ?? "",
        edge: "right",
        previewStart: gesture.startSnappedStart,
        previewDuration: effectiveEnd - gesture.startSnappedStart,
      });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "slip-drag") {
      const currentTime = screenXToTime(state, point.x, metrics);
      const deltaScreen = currentTime - gesture.startPointerTime;
      // contentOffset is measured in content beats; one screen beat equals
      // stretchRatio content beats, and the slip moves the content opposite
      // to the cursor (drag right = content shifts left under the window).
      const nextOffset =
        gesture.startContentOffset - deltaScreen * gesture.startStretchRatio;
      core.setClipContentOffset(gesture.clipId, nextOffset);
      event.preventDefault();
      return;
    }

    if (gesture.kind === "slice-drag") {
      gesture.currentPoint = { ...point };
      // Drag updates the marquee state so the renderer can draw a guide line
      // without adding a new presentation field.
      core.setMarquee({ start: gesture.startPoint, current: point });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "automation-point-drag") {
      const clip = state.clips.find(
        (candidate) => candidate.id === gesture.clipId,
      );

      if (!clip || clip.type !== "automation") {
        return;
      }

      const next = automationPointFromScreen(state, clip, point, metrics);
      core.moveAutomationPoint(
        gesture.clipId,
        gesture.pointId,
        event.ctrlKey
          ? gesture.originalTime
          : snapTime(next.time, state, event.altKey),
        event.shiftKey ? gesture.originalValue : next.value,
      );
      event.preventDefault();
      return;
    }

    if (gesture.kind === "play-position-drag") {
      const snapped = snapTime(
        screenXToTime(state, point.x, metrics),
        state,
        event.altKey,
      );
      core.setPlayPosition(snapped);
      emitDragOverlays(core, state, point, event.altKey, null, snapped);
      event.preventDefault();
      return;
    }

    if (gesture.kind === "marker-drag") {
      const currentTime = screenXToTime(state, point.x, metrics);
      const raw = gesture.startTime + (currentTime - gesture.startPointerTime);
      const snapped = snapTime(Math.max(0, raw), state, event.altKey, metrics);
      core.updateMarker(gesture.markerId, { time: snapped });
      emitDragOverlays(
        core,
        state,
        point,
        event.altKey,
        {
          kind: "marker",
          markerId: gesture.markerId,
          previewTime: snapped,
        },
        snapped,
      );
      event.preventDefault();
      return;
    }

    if (gesture.kind === "scrollbar-horizontal") {
      const delta =
        ((point.x - gesture.startPoint.x) / gesture.travel) *
        gesture.scrollableRange;
      core.updateViewport({
        scrollX: Math.max(0, gesture.startScrollX + delta),
      });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "scrollbar-vertical") {
      const delta =
        ((point.y - gesture.startPoint.y) / gesture.travel) *
        gesture.scrollableRange;
      core.updateViewport({
        scrollY: Math.max(0, gesture.startScrollY + delta),
      });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "paint-drag") {
      const trackIndex = screenYToTrackIndex(state, point.y, metrics);
      const start = Math.max(
        0,
        snapTime(screenXToTime(state, point.x, metrics), state, event.altKey),
      );
      if (
        trackIndex !== gesture.lastTrackIndex ||
        start !== gesture.lastSnappedStart
      ) {
        // Brush stroke: interpolate every snapped cell along the path so a
        // fast pointermove can't skip cells (canon §3 brush pattern).
        const path = interpolateBrushPath(
          {
            trackIndex: gesture.lastTrackIndex,
            start: gesture.lastSnappedStart,
          },
          { trackIndex, start },
          gesture.snapStep,
        );
        // Collect every new cell in the stroke, then create them all in a
        // single CREATE_CLIPS_BATCH dispatch. Canon §3.7: one move event,
        // one notify, one render — regardless of how many cells were
        // filled. Drop the first entry (previous frame already painted it).
        const toCreate: { trackIndex: number; start: number }[] = [];
        const currentState = core.getState();
        for (let i = 1; i < path.length; i += 1) {
          const cell = path[i]!;
          if (gesture.occupied.has(cell.trackIndex, cell.start, currentState)) {
            continue;
          }
          // Pre-mark as occupied so a self-overlapping stroke doesn't try
          // to enqueue the same cell twice.
          gesture.occupied.add(cell.trackIndex, cell.start, currentState);
          toCreate.push(cell);
        }
        if (toCreate.length > 0) {
          core.createClips(
            toCreate.map((cell) => ({
              trackIndex: cell.trackIndex,
              start: cell.start,
              duration: gesture.duration,
              type: gesture.type,
              label: gesture.label,
              color: gesture.color,
              sourceId: gesture.sourceId,
            })),
          );
        }
        gesture.lastTrackIndex = trackIndex;
        gesture.lastSnappedStart = start;
      }
      event.preventDefault();
      return;
    }

    if (gesture.kind === "delete-drag") {
      const ids = clipIdsTouchedBySegment(
        core,
        gesture.lastPoint,
        point,
        gesture.deletedClipIds,
      );
      if (ids.length > 0) {
        core.deleteClips(ids);
      }
      gesture.lastPoint = { ...point };
      event.preventDefault();
      return;
    }

    if (gesture.kind === "mute-drag") {
      const ids = clipIdsTouchedBySegment(
        core,
        gesture.lastPoint,
        point,
        gesture.touchedClipIds,
      );
      if (ids.length > 0) {
        core.setClipsMuted(ids, gesture.muted);
      }
      gesture.lastPoint = { ...point };
      event.preventDefault();
      return;
    }

    if (gesture.kind === "track-resize") {
      const dy = point.y - gesture.startY;
      core.setTrackHeight(gesture.trackIndex, gesture.startHeight + dy);
      event.preventDefault();
      return;
    }

    if (gesture.kind === "track-reorder") {
      const targetIndex = screenYToTrackIndex(state, point.y, metrics);
      if (targetIndex !== gesture.currentIndex) {
        core.reorderTrack(gesture.currentIndex, targetIndex);
        gesture.currentIndex = targetIndex;
        gesture.fromIndex = targetIndex;
      }
      event.preventDefault();
    }
  };

  const endGesture = (event: PointerEvent): void => {
    if (!activeGesture || activeGesture.pointerId !== event.pointerId) {
      return;
    }

    if (activeGesture.kind === "marquee") {
      core.setMarquee(null);
    }

    if (activeGesture.kind === "slice-drag") {
      const state = core.getState();
      // Snap the slice point to the active grid (Alt bypasses snap).
      const time = snapTime(
        screenXToTime(state, activeGesture.currentPoint.x, metrics),
        state,
        event.altKey,
      );
      core.setMarquee(null);
      if (time > 0) {
        core.sliceClipsAtTime(time);
      }
    }

    if (
      activeGesture.kind === "clip-drag" ||
      activeGesture.kind === "clip-resize" ||
      activeGesture.kind === "clip-create-drag" ||
      activeGesture.kind === "automation-point-drag" ||
      activeGesture.kind === "paint-drag" ||
      activeGesture.kind === "delete-drag" ||
      activeGesture.kind === "mute-drag" ||
      activeGesture.kind === "track-resize" ||
      activeGesture.kind === "track-reorder" ||
      activeGesture.kind === "slip-drag" ||
      activeGesture.kind === "marker-drag"
    ) {
      core.endGesture();
    }

    // F3: every gesture that emitted overlay state during the drag must
    // clear it on release. play-position-drag isn't undoable so it's not
    // in the list above, but it still sets snap/tooltip.
    clearDragOverlays(core);

    activeGesture = null;
    host.releasePointerCapture?.(event.pointerId);
    setCursor(
      host,
      hitTestPlaylist(
        core.getPresentation(),
        resolvePoint(host, event),
        metrics,
      ),
      null,
      core.getState().tool,
    );
  };

  const handleWheel = (event: WheelEvent): void => {
    const state = core.getState();
    const point = resolvePoint(host, event);

    if (event.ctrlKey || event.metaKey) {
      const timelineX = point.x - metrics.trackHeaderWidth;

      if (timelineX >= 0) {
        const anchorTime = screenXToTime(state, point.x, metrics);
        const zoomFactor = Math.exp(-event.deltaY * 0.0015);
        const pxPerBeat = clamp(
          state.viewport.pxPerBeat * zoomFactor,
          metrics.minPxPerBeat,
          metrics.maxPxPerBeat,
        );
        const scrollX = anchorTime * pxPerBeat - timelineX;

        core.updateViewport({ pxPerBeat, scrollX });
        event.preventDefault();
        return;
      }
    }

    core.updateViewport({
      scrollX:
        state.viewport.scrollX +
        event.deltaX +
        (event.shiftKey ? event.deltaY : 0),
      scrollY: state.viewport.scrollY + (event.shiftKey ? 0 : event.deltaY),
    });
    event.preventDefault();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    const cmd = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (cmd && key === "z") {
      if (event.shiftKey) {
        core.redo();
      } else {
        core.undo();
      }
      event.preventDefault();
      return;
    }

    if (cmd && key === "y") {
      core.redo();
      event.preventDefault();
      return;
    }

    if (cmd && !event.shiftKey && key === "a") {
      core.selectAllClips();
      event.preventDefault();
      return;
    }

    if (cmd && !event.shiftKey && key === "d") {
      core.deselectAll();
      event.preventDefault();
      return;
    }

    if (!cmd && event.shiftKey && (event.key === "I" || event.key === "i")) {
      core.invertClipSelection();
      event.preventDefault();
      return;
    }

    if (!cmd && event.altKey && key === "m") {
      core.setClipsMuted(core.getState().selection.clipIds, !event.shiftKey);
      event.preventDefault();
      return;
    }

    if (cmd && !event.shiftKey && key === "c") {
      core.copyToClipboard();
      event.preventDefault();
      return;
    }

    if (cmd && !event.shiftKey && key === "x") {
      core.cutSelection();
      event.preventDefault();
      return;
    }

    if (cmd && !event.shiftKey && key === "v") {
      core.pasteClipboard();
      event.preventDefault();
      return;
    }

    if (cmd && !event.shiftKey && key === "b") {
      core.duplicateSelectionRight();
      event.preventDefault();
      return;
    }

    // Shift+C: FL Studio select-all-similar (every clip with the same source).
    if (!cmd && event.shiftKey && key === "c") {
      const focused = core.getState().selection.clipIds[0];
      if (focused) {
        core.selectAllSimilarClips(focused);
      }
      event.preventDefault();
      return;
    }

    if (event.key === "Backspace") {
      // FL Studio: Backspace toggles global snap None ↔ last mode.
      core.toggleSnapNone();
      event.preventDefault();
      return;
    }

    if (event.key === "Delete") {
      core.removeSelected();
      event.preventDefault();
      return;
    }

    if (event.code === "Space") {
      core.setPlayPositionRunning(!core.getState().playPosition.isRunning);
      event.preventDefault();
      return;
    }

    // Insert: slice every visible clip at the playhead.
    if (event.key === "Insert") {
      core.sliceClipsAtTime(core.getState().playPosition.time);
      event.preventDefault();
      return;
    }

    // FL Studio marker hotkeys.
    if (event.altKey && event.shiftKey && !cmd && key === "t") {
      core.addTimeSignatureMarker(core.getState().playPosition.time);
      event.preventDefault();
      return;
    }
    if (event.altKey && !event.shiftKey && !cmd && key === "t") {
      core.addMarker({ time: core.getState().playPosition.time });
      event.preventDefault();
      return;
    }
    if (cmd && !event.shiftKey && !event.altKey && key === "t") {
      core.addAutoNamedMarker(core.getState().playPosition.time);
      event.preventDefault();
      return;
    }

    // F5: arrow keys nudge the selection (or the playhead when nothing is
    // selected). Modifier scaling matches FL Studio: Shift = ×4 step,
    // Ctrl/Meta = 1 bar.
    if (
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown"
    ) {
      const horizontal =
        event.key === "ArrowLeft" || event.key === "ArrowRight";
      const dir =
        event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : -1;
      const hasSelection = core.getState().selection.clipIds.length > 0;
      if (horizontal) {
        const step = cmd ? metrics.beatsPerBar : event.shiftKey ? 4 : 1;
        if (hasSelection) {
          core.nudgeSelection(dir * step, 0);
        } else {
          core.nudgePlayPositionBy(dir * step);
        }
      } else {
        // Vertical arrows only make sense with a selection.
        if (hasSelection) {
          core.nudgeSelection(0, dir);
        }
      }
      event.preventDefault();
      return;
    }

    // FL Studio transport hotkeys.
    if (event.key === "Home" && !cmd && !event.altKey && !event.shiftKey) {
      core.setPlayPosition(0);
      event.preventDefault();
      return;
    }
    if (event.key === "End" && !cmd && !event.altKey && !event.shiftKey) {
      core.jumpToEnd();
      event.preventDefault();
      return;
    }
    if (!cmd && !event.altKey && !event.shiftKey && key === "l") {
      core.toggleTransportMode();
      event.preventDefault();
      return;
    }
    if (!cmd && !event.altKey && !event.shiftKey && key === "r") {
      core.toggleTransportRecording();
      event.preventDefault();
      return;
    }

    // Shift+M: toggle FL Studio's stretch mode (resize stretches content).
    if (
      !cmd &&
      event.shiftKey &&
      !event.altKey &&
      (event.key === "M" || event.key === "m")
    ) {
      core.toggleStretchMode();
      event.preventDefault();
      return;
    }

    // Tool hotkeys (P/B/D/T/S/C/E/Z) — only when no modifier is held.
    if (!cmd && !event.altKey && !event.shiftKey && event.key.length === 1) {
      const tool = TOOL_HOTKEYS[event.key.toUpperCase()];
      if (tool) {
        core.setTool(tool);
        event.preventDefault();
      }
    }
  };

  const preventContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  host.addEventListener("pointerdown", handlePointerDown);
  host.addEventListener("pointermove", handlePointerMove);
  host.addEventListener("pointerup", endGesture);
  host.addEventListener("pointercancel", endGesture);
  host.addEventListener("wheel", handleWheel, { passive: false });
  host.addEventListener("keydown", handleKeyDown);
  host.addEventListener("contextmenu", preventContextMenu);

  return {
    destroy() {
      activeGesture = null;
      host.style.cursor = "";
      host.removeEventListener("pointerdown", handlePointerDown);
      host.removeEventListener("pointermove", handlePointerMove);
      host.removeEventListener("pointerup", endGesture);
      host.removeEventListener("pointercancel", endGesture);
      host.removeEventListener("wheel", handleWheel);
      host.removeEventListener("keydown", handleKeyDown);
      host.removeEventListener("contextmenu", preventContextMenu);
    },
  };
}
