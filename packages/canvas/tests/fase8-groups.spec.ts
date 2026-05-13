// F6 (Fase 8) — Group / ungroup clips.
//
// Validates:
//   - Ctrl+G groups the current selection; Ctrl+Shift+G ungroups.
//   - Paste regenerates groupIds (pasted group is a sibling of the source
//     group, not a copy that drags the original).
//   - Delete keeps the surviving members of a group together.
//   - Select tool drag expands to the whole group at pointerdown so the
//     drop-ghost in F3 shows every sibling.
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
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

describe("F6 — group/ungroup hotkeys", () => {
  it("Ctrl+G groups the selection; Ctrl+Shift+G ungroups", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-bass-1"],
      automationPointIds: [],
    });
    listeners.get("keydown")?.(keyEvent("g", { ctrl: true }));
    const grouped = core.getState();
    const a = grouped.clips.find((c) => c.id === "clip-drums-1")!.groupId;
    const b = grouped.clips.find((c) => c.id === "clip-bass-1")!.groupId;
    expect(a).toBeDefined();
    expect(a).toBe(b);
    listeners.get("keydown")?.(keyEvent("g", { ctrl: true, shift: true }));
    const ungrouped = core.getState();
    expect(ungrouped.clips.find((c) => c.id === "clip-drums-1")!.groupId).toBeUndefined();
    expect(ungrouped.clips.find((c) => c.id === "clip-bass-1")!.groupId).toBeUndefined();
    controller.destroy();
  });
});

describe("F6 — paste regenerates groupIds", () => {
  it("a pasted grouped pair gets a fresh groupId distinct from the source", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-drums-2"],
      automationPointIds: [],
    });
    const sourceGroup = core.groupSelection();
    expect(sourceGroup).not.toBeNull();
    core.copyToClipboard();
    const pasted = core.pasteClipboard({ atTime: 100, atTrackIndex: 0 });
    expect(pasted.length).toBe(2);
    const s = core.getState();
    const p1 = s.clips.find((c) => c.id === pasted[0])!;
    const p2 = s.clips.find((c) => c.id === pasted[1])!;
    expect(p1.groupId).toBeDefined();
    expect(p1.groupId).toBe(p2.groupId);
    // Distinct from the source group.
    expect(p1.groupId).not.toBe(sourceGroup);
  });
});

describe("F6 — surviving group members keep their groupId", () => {
  it("delete one of three grouped clips; the other two stay grouped", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-drums-2", "clip-bass-1"],
      automationPointIds: [],
    });
    core.groupSelection();
    core.deleteClip("clip-drums-1");
    const s = core.getState();
    const a = s.clips.find((c) => c.id === "clip-drums-2")!;
    const b = s.clips.find((c) => c.id === "clip-bass-1")!;
    expect(a.groupId).toBeDefined();
    expect(a.groupId).toBe(b.groupId);
  });
});

describe("F6 — undo of group clears the groupIds", () => {
  it("after Ctrl+G undo, no clip carries the new groupId", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-drums-2"],
      automationPointIds: [],
    });
    const before = core.getState();
    core.groupSelection();
    core.undo();
    const after = core.getState();
    expect(after.clips.find((c) => c.id === "clip-drums-1")!.groupId).toBe(
      before.clips.find((c) => c.id === "clip-drums-1")!.groupId,
    );
    expect(after.clips.find((c) => c.id === "clip-drums-2")!.groupId).toBe(
      before.clips.find((c) => c.id === "clip-drums-2")!.groupId,
    );
  });
});

describe("F6 — select-tool drag expansion", () => {
  it("dragging one grouped clip drags every sibling", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    core.setSelection({
      clipIds: ["clip-drums-1", "clip-drums-2"],
      automationPointIds: [],
    });
    core.groupSelection();
    core.setSelection({ clipIds: [], automationPointIds: [] });
    const view = core.getPresentation().clipViewsById.get("clip-drums-1")!;
    const cx = view.bodyRect.x + view.bodyRect.width / 2;
    const cy = view.bodyRect.y + view.bodyRect.height / 2;
    const px = core.getState().viewport.pxPerBeat;
    const startD1 = core.getState().clips.find((c) => c.id === "clip-drums-1")!.start;
    const startD2 = core.getState().clips.find((c) => c.id === "clip-drums-2")!.start;
    const pointerEvent = (clientX: number) =>
      ({
        pointerId: 1,
        button: 0,
        clientX,
        clientY: cy,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        detail: 1,
        preventDefault() {},
      }) as unknown as PointerEvent;
    listeners.get("pointerdown")?.(pointerEvent(cx));
    // Drag right by 4 beats.
    listeners.get("pointermove")?.(pointerEvent(cx + 4 * px));
    listeners.get("pointerup")?.(pointerEvent(cx + 4 * px));
    const after = core.getState();
    expect(after.clips.find((c) => c.id === "clip-drums-1")!.start).toBeCloseTo(
      startD1 + 4,
      1,
    );
    expect(after.clips.find((c) => c.id === "clip-drums-2")!.start).toBeCloseTo(
      startD2 + 4,
      1,
    );
    controller.destroy();
    void M;
  });
});
