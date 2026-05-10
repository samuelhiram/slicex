import {
  automationPointFromScreen,
  clamp,
  getHorizontalScrollbarRect,
  getHorizontalScrollbarThumbRect,
  getTrackHeightByIndex,
  getTrackIdByIndex,
  getVerticalScrollbarRect,
  getVerticalScrollbarThumbRect,
  normalizeRect,
  rectsIntersect,
  screenXToTime,
  screenYToTrackIndex,
  snapTime,
} from "../playlist-core";
import type {
  PlaylistClip,
  PlaylistCore,
  PlaylistPoint,
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

const PAINT_DEFAULT_DURATION = 4;

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

      if (hit.kind === "automation-point") {
        core.removeAutomationPoint(hit.clip.id, hit.pointId);
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

      // Draw and Paint tools: RMB on a clip deletes it (FL Studio behaviour).
      if (
        (state.tool === "draw" || state.tool === "paint") &&
        (hit.kind === "clip" ||
          hit.kind === "resize-left" ||
          hit.kind === "resize-right")
      ) {
        core.deleteClip(hit.clip.id);
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
      activeGesture = {
        kind: "scrollbar-horizontal",
        pointerId: event.pointerId,
        startPoint: point,
        startScrollX: state.viewport.scrollX,
      };
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture, state.tool);
      event.preventDefault();
      return;
    }

    if (hit.kind === "scrollbar-vertical") {
      activeGesture = {
        kind: "scrollbar-vertical",
        pointerId: event.pointerId,
        startPoint: point,
        startScrollY: state.viewport.scrollY,
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
      gesture.kind === "automation-point-drag" ||
      gesture.kind === "paint-drag" ||
      gesture.kind === "delete-drag" ||
      gesture.kind === "slip-drag"
    );
  }

  const handlePointerMove = (event: PointerEvent): void => {
    const state = core.getState();
    const point = resolvePoint(host, event);

    if (!activeGesture) {
      const hit = hitTestPlaylist(core.getPresentation(), point, metrics);
      setHoverFromHit(core, hit);
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

      core.moveClips(
        gesture.originals.map((clip) => ({
          id: clip.id,
          start: clip.start + deltaTime,
          trackIndex: clamp(
            clip.trackIndex + trackDelta,
            0,
            Number.POSITIVE_INFINITY,
          ),
        })),
      );
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
      core.setPlayPosition(
        snapTime(screenXToTime(state, point.x, metrics), state, event.altKey),
      );
      event.preventDefault();
      return;
    }

    if (gesture.kind === "scrollbar-horizontal") {
      const track = getHorizontalScrollbarRect(state, metrics);
      const thumb = getHorizontalScrollbarThumbRect(state, metrics);
      const travel = Math.max(1, track.width - thumb.width);
      const delta =
        ((point.x - gesture.startPoint.x) / travel) *
        metrics.scrollbarVirtualRangePx;

      core.updateViewport({ scrollX: gesture.startScrollX + delta });
      event.preventDefault();
      return;
    }

    if (gesture.kind === "scrollbar-vertical") {
      const track = getVerticalScrollbarRect(state, metrics);
      const thumb = getVerticalScrollbarThumbRect(state, metrics);
      const travel = Math.max(1, track.height - thumb.height);
      const delta =
        ((point.y - gesture.startPoint.y) / travel) *
        metrics.scrollbarVirtualRangePx;

      core.updateViewport({ scrollY: gesture.startScrollY + delta });
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
        const trackId = getTrackIdByIndex(state, trackIndex);
        const cellOccupied = state.clips.some(
          (clip: PlaylistClip) =>
            clip.trackId === trackId &&
            start >= clip.start &&
            start < clip.start + clip.duration,
        );
        if (!cellOccupied) {
          core.createClip({
            trackIndex,
            start,
            duration: PAINT_DEFAULT_DURATION,
            type: "pattern",
            label: "Clip",
            color: "#7aa6d8",
          });
        }
        gesture.lastTrackIndex = trackIndex;
        gesture.lastSnappedStart = start;
      }
      event.preventDefault();
      return;
    }

    if (gesture.kind === "delete-drag") {
      const hit = hitTestPlaylist(core.getPresentation(), point, metrics);
      if (
        hit.kind === "clip" ||
        hit.kind === "automation-body" ||
        hit.kind === "resize-left" ||
        hit.kind === "resize-right"
      ) {
        core.deleteClip(hit.clip.id);
      }
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
        screenXToTime(state, activeGesture.startPoint.x, metrics),
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
      activeGesture.kind === "automation-point-drag" ||
      activeGesture.kind === "paint-drag" ||
      activeGesture.kind === "delete-drag" ||
      activeGesture.kind === "track-resize" ||
      activeGesture.kind === "track-reorder" ||
      activeGesture.kind === "slip-drag"
    ) {
      core.endGesture();
    }

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
