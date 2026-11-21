// @vitest-environment jsdom
// "Ordenar por tipo" (2026-11-20): one click puts every item on an event
// line of its own, grouped by kind — incomes, then expenses, then the
// debts — whatever the rows held before, filling the FIRST lines with
// nothing empty in between. One undo step.
import { afterEach, describe, expect, it, vi } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createDemoFinancialDocument, type FinancialDocument } from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { FinancialBridge } from "../src/finance/financial-bridge";
import {
  arrangementByKind,
  createFinancialPlaylistState,
  FINANCE_PLAYLIST_METRICS,
  type FinancialTrackLayout,
} from "../src/finance/mapping";
import { KIND_ORDER } from "../src/finance/labels";
import { TimelineCell } from "../src/finance/components/TimelineCell";
import { AnnouncerProvider } from "../src/ui/announcer";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const START = "2026-11-07";

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = "";
});

/** The plan with EVERY item piled on one line (the screenshot: "Sueldo… +19"). */
function piled(doc: FinancialDocument = createDemoFinancialDocument(START), extra: Partial<FinancialTrackLayout> = {}) {
  const layout: FinancialTrackLayout = {
    tracks: [{ id: "one", label: "", color: "#888888", height: 64 }],
    placement: Object.fromEntries(doc.items.map((item) => [item.id, "one"])),
    ...extra,
  };
  const core = createPlaylistCore(createFinancialPlaylistState(doc, layout), {
    metrics: FINANCE_PLAYLIST_METRICS,
    stretchEnabled: false,
  });
  return { doc, core, bridge: new FinancialBridge(core, doc) };
}

const kindRank = (kind: string) => KIND_ORDER.indexOf(kind as (typeof KIND_ORDER)[number]);

describe("arrangementByKind: by kind, each on its own line, from the first line", () => {
  it("every item gets a line of its own, incomes → expenses → debts, in the plan's order", () => {
    const { doc, core } = piled();
    const plan = arrangementByKind(doc, core.getState())!;
    expect(plan).not.toBeNull();
    // One line per item, in kind order, and within a kind the plan's order.
    expect(plan.tracks).toHaveLength(doc.items.length);
    const byLine = plan.tracks.map((track) => doc.items.find((item) => plan.placement[item.id] === track.id)!);
    const ranks = byLine.map((item) => kindRank(item.kind));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(byLine[0]!.kind).toBe("income");
    expect(byLine.at(-1)!.kind).toBe(KIND_ORDER.filter((kind) => doc.items.some((item) => item.kind === kind)).at(-1));
    const incomes = doc.items.filter((item) => item.kind === "income").map((item) => item.id);
    expect(byLine.slice(0, incomes.length).map((item) => item.id)).toEqual(incomes);
    // The line's height comes along.
    expect(plan.tracks.every((track) => track.height === 64)).toBe(true);
  });

  it("keeps each line's state (excluded, locked) and a name the person gave a one-item line", () => {
    const doc = createDemoFinancialDocument(START);
    const [first, second, ...rest] = doc.items;
    const layout: FinancialTrackLayout = {
      tracks: [
        { id: "mine", label: "Mi sueldo", color: "#888888", muted: true },
        { id: "rest", label: "Todo lo demás", color: "#888888", locked: true },
        { id: "named-empty", label: "Para después", color: "#888888" },
        { id: "plain-empty", label: "", color: "#888888" },
      ],
      placement: Object.fromEntries([
        [first!.id, "mine"],
        ...[second!, ...rest].map((item) => [item.id, "rest"]),
      ]),
    };
    const core = createPlaylistCore(createFinancialPlaylistState(doc, layout), {
      metrics: FINANCE_PLAYLIST_METRICS,
      stretchEnabled: false,
    });
    const plan = arrangementByKind(doc, core.getState())!;
    const lineOf = (id: string) => plan.tracks.find((track) => track.id === plan.placement[id])!;
    // Alone on its named line: the name and the exclusion come along.
    expect(lineOf(first!.id)).toMatchObject({ label: "Mi sueldo", muted: true });
    // A shared named line: its name stays with nobody; its lock with all.
    expect(lineOf(second!.id).label).toBe("");
    expect(lineOf(second!.id).locked).toBe(true);
    // The named empty line goes after the items; the plain one goes.
    expect(plan.tracks.at(-1)!.label).toBe("Para después");
    expect(plan.tracks).toHaveLength(doc.items.length + 1);
  });

  it("null once arranged (plain empty lines below don't count)", () => {
    const { doc, core } = piled();
    const plan = arrangementByKind(doc, core.getState())!;
    core.arrangeTracks(plan.tracks, plan.placement);
    expect(arrangementByKind(doc, core.getState())).toBeNull();
  });
});

describe("the bridge: one undo step, the plan itself untouched", () => {
  it("arranges, keeps every date and amount, and Ctrl+Z puts the pile back", () => {
    const { core, bridge } = piled();
    const before = bridge.getDocument().items;
    const pile = core.getState();
    expect(bridge.isArrangedByKind()).toBe(false);
    expect(bridge.arrangeByKind()).toBe(true);
    const state = core.getState();
    // Every item on its own line, the first lines, one lane each.
    const lines = new Set(state.clips.map((clip) => clip.trackId));
    expect(lines.size).toBe(state.clips.length);
    expect(state.tracks.slice(0, state.clips.length).every((track) => lines.has(track.id))).toBe(true);
    expect(state.clips.every((clip) => (clip.lane ?? 0) === 0)).toBe(true);
    // Only the rows moved.
    expect(bridge.getDocument().items).toEqual(before);
    expect(bridge.isArrangedByKind()).toBe(true);
    expect(bridge.arrangeByKind()).toBe(false);
    // One step back: the pile.
    core.undo();
    expect(core.getState().tracks.map((track) => track.id)).toEqual(pile.tracks.map((track) => track.id));
    expect(new Set(core.getState().clips.map((clip) => clip.trackId))).toEqual(new Set(["one"]));
    bridge.destroy();
  });
});

describe("the button in 'Plano de eventos'", () => {
  function mount(bridge: FinancialBridge, core: ReturnType<typeof piled>["core"]) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        React.createElement(
          AnnouncerProvider,
          null,
          React.createElement(TimelineCell, { core, bridge, normalHeight: 84, defaultPxPerBeat: 28 / 7 }),
        ),
      ),
    );
    return document.querySelector<HTMLButtonElement>('button[aria-label="Ordenar por tipo"]')!;
  }

  it("arranges, scrolls to the first line, offers 'Deshacer'; then it rests (disabled)", () => {
    const { core, bridge } = piled();
    core.setViewportSize(1200, 700);
    core.updateViewport({ scrollY: 120 });
    const button = mount(bridge, core);
    expect(button.disabled).toBe(false);
    const spy = vi.spyOn(bridge, "arrangeByKind");
    act(() => button.click());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(core.getState().viewport.scrollY).toBe(0);
    expect(document.body.textContent).toContain("Ordenado por tipo");
    expect(button.disabled).toBe(true);
    // "Deshacer" brings the pile back — and the button wakes up.
    const undo = [...document.querySelectorAll("button")].find((el) => el.textContent === "Deshacer")!;
    act(() => undo.click());
    expect(new Set(core.getState().clips.map((clip) => clip.trackId))).toEqual(new Set(["one"]));
    expect(button.disabled).toBe(false);
    bridge.destroy();
  });
});
