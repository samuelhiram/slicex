import {
  automationPointFromScreen,
  clamp,
  getClipRect,
  getTrackIndexById,
  normalizeRect,
  rectsIntersect,
  screenXToTime,
  screenYToTrackIndex,
  snapTime,
} from "../playlist-core";
import type {
  PlaylistClip,
  PlaylistCore,
  PlaylistMetrics,
  PlaylistPoint,
} from "../playlist-core";
import { hitTestPlaylist, type PlaylistHit } from "./hit-test";

export interface PlaylistInteractionController {
  destroy: () => void;
}

type PlaylistInteractionHost = HTMLElement & {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
};

interface ClipDragOriginal {
  id: string;
  start: number;
  trackIndex: number;
}

type ActiveGesture =
  | {
      kind: "pan";
      pointerId: number;
      startPoint: PlaylistPoint;
      startScrollX: number;
      startScrollY: number;
    }
  | {
      kind: "marquee";
      pointerId: number;
      startPoint: PlaylistPoint;
    }
  | {
      kind: "clip-drag";
      pointerId: number;
      primaryClipId: string;
      startPointerTime: number;
      startTrackIndex: number;
      originals: ClipDragOriginal[];
    }
  | {
      kind: "clip-resize";
      pointerId: number;
      clipId: string;
      edge: "left" | "right";
    }
  | {
      kind: "automation-point-drag";
      pointerId: number;
      clipId: string;
      pointId: string;
      originalTime: number;
      originalValue: number;
    };

function resolvePoint(host: HTMLElement, event: MouseEvent | PointerEvent | WheelEvent): PlaylistPoint {
  const rect = host.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function setCursor(host: HTMLElement, hit: PlaylistHit | null, active: ActiveGesture | null): void {
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

  if (!hit) {
    host.style.cursor = "default";
    return;
  }

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
}

function getSelectedDragClips(core: PlaylistCore, clip: PlaylistClip): PlaylistClip[] {
  const state = core.getState();
  const selected = new Set(state.selection.clipIds);

  if (!selected.has(clip.id)) {
    return [clip];
  }

  return state.clips.filter((candidate) => selected.has(candidate.id));
}

function selectClipsInMarquee(core: PlaylistCore, metrics: PlaylistMetrics): void {
  const state = core.getState();
  const marquee = state.marquee;

  if (!marquee) {
    return;
  }

  const rect = normalizeRect({
    x: marquee.start.x,
    y: marquee.start.y,
    width: marquee.current.x - marquee.start.x,
    height: marquee.current.y - marquee.start.y,
  });
  const clipIds = state.clips
    .filter((clip) => rectsIntersect(rect, getClipRect(state, clip, metrics)))
    .map((clip) => clip.id);

  core.setSelection({ clipIds, automationPointIds: [] });
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

  core.setHover(null);
}

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
    const hit = hitTestPlaylist(state, point, metrics);

    if (event.button === 1) {
      activeGesture = {
        kind: "pan",
        pointerId: event.pointerId,
        startPoint: point,
        startScrollX: state.viewport.scrollX,
        startScrollY: state.viewport.scrollY,
      };
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture);
      event.preventDefault();
      return;
    }

    if (event.button === 2) {
      if (hit.kind === "automation-point") {
        core.removeAutomationPoint(hit.clip.id, hit.pointId);
        event.preventDefault();
        return;
      }

      if (hit.kind === "automation-body") {
        const next = automationPointFromScreen(state, hit.clip, point, metrics);
        core.addAutomationPoint(hit.clip.id, snapTime(next.time, state, event.altKey), next.value);
        event.preventDefault();
        return;
      }

      return;
    }

    if (event.button !== 0) {
      return;
    }

    if (hit.kind === "automation-point") {
      const automationPoint = hit.clip.points.find(
        (candidate) => candidate.id === hit.pointId,
      );

      if (!automationPoint) {
        return;
      }

      core.setSelection({
        clipIds: [hit.clip.id],
        automationPointIds: [hit.pointId],
      });
      activeGesture = {
        kind: "automation-point-drag",
        pointerId: event.pointerId,
        clipId: hit.clip.id,
        pointId: hit.pointId,
        originalTime: automationPoint.time,
        originalValue: automationPoint.value,
      };
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture);
      event.preventDefault();
      return;
    }

    if (hit.kind === "resize-left" || hit.kind === "resize-right") {
      core.setSelection({ clipIds: [hit.clip.id], automationPointIds: [] });
      activeGesture = {
        kind: "clip-resize",
        pointerId: event.pointerId,
        clipId: hit.clip.id,
        edge: hit.kind === "resize-left" ? "left" : "right",
      };
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture);
      event.preventDefault();
      return;
    }

    if (hit.kind === "clip" || hit.kind === "automation-body") {
      const selectedClips = getSelectedDragClips(core, hit.clip);

      if (!state.selection.clipIds.includes(hit.clip.id)) {
        core.setSelection({ clipIds: [hit.clip.id], automationPointIds: [] });
      }

      activeGesture = {
        kind: "clip-drag",
        pointerId: event.pointerId,
        primaryClipId: hit.clip.id,
        startPointerTime: screenXToTime(state, point.x, metrics),
        startTrackIndex: getTrackIndexById(state, hit.clip.trackId),
        originals: selectedClips.map((clip) => ({
          id: clip.id,
          start: clip.start,
          trackIndex: getTrackIndexById(state, clip.trackId),
        })),
      };
      host.setPointerCapture?.(event.pointerId);
      setCursor(host, hit, activeGesture);
      event.preventDefault();
      return;
    }

    activeGesture = {
      kind: "marquee",
      pointerId: event.pointerId,
      startPoint: point,
    };
    core.setSelection({ clipIds: [], automationPointIds: [] });
    core.setMarquee({ start: point, current: point });
    host.setPointerCapture?.(event.pointerId);
    setCursor(host, hit, activeGesture);
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent): void => {
    const state = core.getState();
    const point = resolvePoint(host, event);

    if (!activeGesture) {
      const hit = hitTestPlaylist(state, point, metrics);
      setHoverFromHit(core, hit);
      setCursor(host, hit, null);
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
      selectClipsInMarquee(core, metrics);
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
            Math.max(0, state.tracks.length - 1),
          ),
        })),
      );
      event.preventDefault();
      return;
    }

    if (gesture.kind === "clip-resize") {
      const time = snapTime(screenXToTime(state, point.x, metrics), state, event.altKey);
      core.resizeClip(gesture.clipId, gesture.edge, time);
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
        event.ctrlKey ? gesture.originalTime : snapTime(next.time, state, event.altKey),
        event.shiftKey ? gesture.originalValue : next.value,
      );
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

    activeGesture = null;
    host.releasePointerCapture?.(event.pointerId);
    setCursor(host, hitTestPlaylist(core.getState(), resolvePoint(host, event), metrics), null);
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
    if (event.key === "Delete" || event.key === "Backspace") {
      core.removeSelected();
      event.preventDefault();
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
