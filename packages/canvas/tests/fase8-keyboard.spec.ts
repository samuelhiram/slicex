// F5 (Fase 8) — Arrow keys + End.
//
// Validates that the PlaylistCore helpers nudge clips/playhead atomically
// and that the controller's keydown handler maps the right keys with the
// right modifier scaling.
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  getTrackIndexById,
} from "../src/playlist-core";
import { createPlaylistInteractionController } from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;

function createHost() {
  const listeners = new Map<string, (event: Event) => void>();
  const host = {
    style: { cursor: "" } as Record<string, string>,
    focus() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1200, height: 700 };
    },
    addEventListener(type: string, listener: (event: Event) => void) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    dispatchEvent() {
      return true;
    },
  };
  return { host: host as unknown as HTMLElement, listeners };
}

function keyEvent(
  key: string,
  modifiers: { shift?: boolean; ctrl?: boolean; alt?: boolean } = {},
): KeyboardEvent {
  return {
    key,
    shiftKey: modifiers.shift ?? false,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: false,
    altKey: modifiers.alt ?? false,
    preventDefault() {},
  } as unknown as KeyboardEvent;
}

describe("F5 — PlaylistCore nudge helpers", () => {
  it("nudgeSelection horizontal moves every selected clip by delta", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-bass-1"],
      automationPointIds: [],
    });
    const before = core.getState();
    const drumsStart = before.clips.find((c) => c.id === "clip-drums-1")!.start;
    const bassStart = before.clips.find((c) => c.id === "clip-bass-1")!.start;
    core.nudgeSelection(3, 0);
    const after = core.getState();
    expect(after.clips.find((c) => c.id === "clip-drums-1")!.start).toBe(
      drumsStart + 3,
    );
    expect(after.clips.find((c) => c.id === "clip-bass-1")!.start).toBe(
      bassStart + 3,
    );
  });

  it("nudgeSelection vertical moves clips across tracks (clamped at 0)", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({
      clipIds: ["clip-bass-1"],
      automationPointIds: [],
    });
    const beforeIndex = getTrackIndexById(
      core.getState(),
      core.getState().clips.find((c) => c.id === "clip-bass-1")!.trackId,
    );
    core.nudgeSelection(0, -1);
    const afterIndex = getTrackIndexById(
      core.getState(),
      core.getState().clips.find((c) => c.id === "clip-bass-1")!.trackId,
    );
    expect(afterIndex).toBe(Math.max(0, beforeIndex - 1));
  });

  it("nudgeSelection respects clip groups (siblings move with delta)", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-drums-2"],
      automationPointIds: [],
    });
    core.groupSelection();
    // Now select just one of them.
    core.setSelection({
      clipIds: ["clip-drums-1"],
      automationPointIds: [],
    });
    const before = core.getState();
    const d1 = before.clips.find((c) => c.id === "clip-drums-1")!.start;
    const d2 = before.clips.find((c) => c.id === "clip-drums-2")!.start;
    core.nudgeSelection(5, 0);
    const after = core.getState();
    expect(after.clips.find((c) => c.id === "clip-drums-1")!.start).toBe(d1 + 5);
    // Sibling moved with the same delta because expandSelectionToGroups
    // pulled it into the updates.
    expect(after.clips.find((c) => c.id === "clip-drums-2")!.start).toBe(d2 + 5);
  });

  it("nudgePlayPositionBy clamps negatives at 0", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setPlayPosition(2);
    core.nudgePlayPositionBy(-10);
    expect(core.getState().playPosition.time).toBe(0);
  });

  it("jumpToEnd seeks to the end of the last clip", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const end = core.getContentEndTime();
    core.jumpToEnd();
    expect(core.getState().playPosition.time).toBe(end);
  });
});

describe("F5 — controller keydown mapping", () => {
  function mount() {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    return { core, host, listeners, controller };
  }

  it("ArrowRight with selection nudges clips +1 beat", () => {
    const { core, listeners, controller } = mount();
    core.setSelection({
      clipIds: ["clip-drums-1"],
      automationPointIds: [],
    });
    const start = core.getState().clips.find((c) => c.id === "clip-drums-1")!.start;
    listeners.get("keydown")?.(keyEvent("ArrowRight"));
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.start).toBe(
      start + 1,
    );
    controller.destroy();
  });

  it("Shift+ArrowRight scales the nudge to ×4 step", () => {
    const { core, listeners, controller } = mount();
    core.setSelection({
      clipIds: ["clip-drums-1"],
      automationPointIds: [],
    });
    const start = core.getState().clips.find((c) => c.id === "clip-drums-1")!.start;
    listeners.get("keydown")?.(keyEvent("ArrowRight", { shift: true }));
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.start).toBe(
      start + 4,
    );
    controller.destroy();
  });

  it("Ctrl+ArrowRight nudges by one bar", () => {
    const { core, listeners, controller } = mount();
    core.setSelection({
      clipIds: ["clip-drums-1"],
      automationPointIds: [],
    });
    const start = core.getState().clips.find((c) => c.id === "clip-drums-1")!.start;
    listeners.get("keydown")?.(keyEvent("ArrowRight", { ctrl: true }));
    expect(core.getState().clips.find((c) => c.id === "clip-drums-1")!.start).toBe(
      start + M.beatsPerBar,
    );
    controller.destroy();
  });

  it("ArrowRight without selection moves the playhead", () => {
    const { core, listeners, controller } = mount();
    core.setPlayPosition(5);
    listeners.get("keydown")?.(keyEvent("ArrowRight"));
    expect(core.getState().playPosition.time).toBe(6);
    controller.destroy();
  });

  it("End key jumps the playhead to the content end", () => {
    const { core, listeners, controller } = mount();
    const end = core.getContentEndTime();
    listeners.get("keydown")?.(keyEvent("End"));
    expect(core.getState().playPosition.time).toBe(end);
    controller.destroy();
  });

  it("ArrowDown with no selection is a no-op (does not move the playhead)", () => {
    const { core, listeners, controller } = mount();
    const before = core.getState().playPosition.time;
    listeners.get("keydown")?.(keyEvent("ArrowDown"));
    expect(core.getState().playPosition.time).toBe(before);
    controller.destroy();
  });
});
