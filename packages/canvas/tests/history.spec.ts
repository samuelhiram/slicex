import { describe, expect, it } from "vitest";
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  replacePresent,
  undoHistory,
} from "../src/playlist-core/history";

describe("history primitives", () => {
  it("starts empty with only present", () => {
    const h = createHistory(1);
    expect(h.past).toEqual([]);
    expect(h.present).toBe(1);
    expect(h.future).toEqual([]);
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });

  it("pushes present to past on push", () => {
    const h0 = createHistory(1);
    const h1 = pushHistory(h0, 2);
    expect(h1.past).toEqual([1]);
    expect(h1.present).toBe(2);
    expect(h1.future).toEqual([]);
  });

  it("clears future when pushing after undo", () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    h = undoHistory(h);
    expect(h.future).toEqual([3]);
    h = pushHistory(h, 4);
    expect(h.past).toEqual([1, 2]);
    expect(h.present).toBe(4);
    expect(h.future).toEqual([]);
  });

  it("undo and redo are inverses", () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    h = undoHistory(h);
    expect(h.present).toBe(2);
    h = redoHistory(h);
    expect(h.present).toBe(3);
  });

  it("undo no-ops on empty past", () => {
    const h = createHistory(1);
    const h2 = undoHistory(h);
    expect(h2).toBe(h);
  });

  it("redo no-ops on empty future", () => {
    const h = createHistory(1);
    const h2 = redoHistory(h);
    expect(h2).toBe(h);
  });

  it("replacePresent does not push to past", () => {
    let h = createHistory(1);
    h = pushHistory(h, 2);
    h = replacePresent(h, 3);
    expect(h.past).toEqual([1]);
    expect(h.present).toBe(3);
  });

  it("pushHistory de-duplicates same value", () => {
    const h = createHistory(1);
    const h2 = pushHistory(h, 1);
    expect(h2).toBe(h);
  });

  it("respects maxDepth by dropping oldest", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 5; i += 1) {
      h = pushHistory(h, i, { maxDepth: 3 });
    }
    expect(h.past).toEqual([2, 3, 4]);
    expect(h.present).toBe(5);
  });
});
