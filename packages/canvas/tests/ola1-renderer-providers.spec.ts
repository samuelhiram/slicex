// Ola 1 — host visual providers in the renderer.
//
//   getClipContent     events / level drawn inside the clip body at absolute
//                      beats; repaint only on reference / start / zoom change
//   getDragAnnotation  pill under the tooltip; repaint only on new reference
//   getTrackMeta       header subtitle + meter for visible real rows
//   getOverviewData    overview lane (see ola1-overview-lane.spec.ts)
//
// With none of them (and default metrics) the renderer draws exactly what it
// drew before: no provider is queried, no extra Text appears.
//
// Pixi's Application needs a GPU context, so it is replaced by a minimal
// fake; Container / Graphics / Text are the real classes.
import { Container, Graphics, Text } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PlaylistClipContent,
  PlaylistClipPresentation,
  PlaylistDragAnnotation,
  PlaylistMetrics,
  PlaylistOverviewData,
  PlaylistState,
  PlaylistTrackMeta,
} from "../src/playlist-core";

interface FakeApplication {
  stage: Container;
  renders: number;
}

const fake = vi.hoisted(() => ({ apps: [] as FakeApplication[] }));

vi.mock("pixi.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pixi.js")>();
  class Application {
    stage = new actual.Container();
    renderer = { resize() {} };
    canvas = { style: {} as Record<string, string> };
    renders = 0;
    constructor() {
      fake.apps.push(this);
    }
    init(): Promise<void> {
      return Promise.resolve();
    }
    render(): void {
      this.renders += 1;
    }
    destroy(): void {}
  }
  return { ...actual, Application };
});

const {
  createDemoPlaylistState,
  createPlaylistCore,
  createPlaylistPresentation,
  DEFAULT_PLAYLIST_METRICS,
} = await import("../src/playlist-core");
const { createPlaylistRenderer } = await import("../src/playlist-renderer-pixi");
const { createClipNodeRegistry } = await import(
  "../src/playlist-renderer-pixi/clip-node-registry"
);
const { createDragAnnotationLayer } = await import(
  "../src/playlist-renderer-pixi/layers/drag-annotation"
);
const { createTrackMetaSource, drawTrackRows } = await import(
  "../src/playlist-renderer-pixi/layers/track-rows"
);

const M = DEFAULT_PLAYLIST_METRICS;
const PALETTE = {
  text: 0xffffff,
  textMuted: 0x999999,
  selected: 0x00ff00,
  hover: 0x0000ff,
  rowLine: 0x333333,
  panel: 0x111111,
  panelStrong: 0x222222,
  automationLine: 0xff00ff,
};

let frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
function flushFrames(): number {
  const pending = frames;
  frames = new Map();
  for (const callback of pending.values()) callback(0);
  return pending.size;
}
function flushToIdle(): void {
  for (let i = 0; i < 10 && frames.size > 0; i += 1) flushFrames();
}
async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
function createContainer(): HTMLElement {
  return {
    getBoundingClientRect: () => ({ width: 1200, height: 700 }),
    appendChild() {},
  } as unknown as HTMLElement;
}

function sizedDemoState(): PlaylistState {
  const state = createDemoPlaylistState();
  return { ...state, viewport: { ...state.viewport, width: 1200, height: 700 } };
}

function visibleTexts(node: Container): string[] {
  const out: string[] = [];
  const walk = (c: Container) => {
    if (!c.visible) return;
    for (const child of c.children) {
      if (child instanceof Text) {
        if (child.visible) out.push(child.text);
      } else {
        walk(child as Container);
      }
    }
  };
  walk(node);
  return out;
}

beforeEach(() => {
  fake.apps.length = 0;
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextFrameId++;
    frames.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// Wraps each node's body Graphics.clear so a test can count body redraws.
function countBodyRedraws(parent: Container): Map<Container, number> {
  const counts = new Map<Container, number>();
  for (const child of parent.children) {
    const node = child as Container;
    const body = node.children[0] as Graphics;
    const original = body.clear.bind(body);
    counts.set(node, 0);
    body.clear = () => {
      counts.set(node, (counts.get(node) ?? 0) + 1);
      return original();
    };
  }
  return counts;
}

function nodeOf(parent: Container, views: PlaylistClipPresentation[], id: string): Container {
  return parent.children[views.findIndex((v) => v.clip.id === id)] as Container;
}

describe("renderer — no new providers, default metrics: nothing new is drawn or queried", () => {
  it("renders the same texts and never queries providers that need a lane or tooltip", async () => {
    const core = createPlaylistCore(sizedDemoState());
    const plain = createPlaylistRenderer(createContainer(), core);
    await settle();
    flushToIdle();
    const plainTexts = visibleTexts(fake.apps[0]!.stage).sort();

    const core2 = createPlaylistCore(sizedDemoState());
    let overviewCalls = 0;
    let annotationCalls = 0;
    const withProviders = createPlaylistRenderer(createContainer(), core2, {
      getOverviewData: () => {
        overviewCalls += 1;
        return null;
      },
      getDragAnnotation: () => {
        annotationCalls += 1;
        return { text: "never", tone: "neutral" };
      },
    });
    await settle();
    flushToIdle();
    core2.setHover({ kind: "clip", clipId: "clip-bass-1" });
    flushFrames();
    // Lane height 0 → the overview provider is never called; no tooltip →
    // the annotation provider is never called.
    expect(overviewCalls).toBe(0);
    expect(annotationCalls).toBe(0);
    expect(visibleTexts(fake.apps[1]!.stage).sort()).toEqual(plainTexts);
    plain.destroy();
    withProviders.destroy();
  });
});

describe("renderer — overview lane wiring", () => {
  it("draws the lane from getOverviewData once per frame (O(1) provider)", async () => {
    const LANE_M: PlaylistMetrics = { ...M, overviewLaneHeight: 90 };
    const core = createPlaylistCore(sizedDemoState(), { metrics: LANE_M });
    const data: PlaylistOverviewData = {
      title: "Money",
      primary: { initial: 100, beats: [5, 10], values: [-50, 300] },
      thresholds: [{ value: 0, tone: "danger", label: "zero" }],
      annotations: [{ beat: 5, value: -50, label: "dip", tone: "danger" }],
    };
    let calls = 0;
    const renderer = createPlaylistRenderer(createContainer(), core, {
      getOverviewData: () => {
        calls += 1;
        return data;
      },
    });
    await settle();
    flushToIdle();
    const stage = fake.apps[0]!.stage;
    expect(visibleTexts(stage)).toEqual(expect.arrayContaining(["Money", "zero", "dip"]));
    const before = calls;
    core.setHover({ kind: "clip", clipId: "clip-bass-1" });
    flushFrames();
    expect(calls).toBe(before + 1);
    renderer.destroy();
  });
});

describe("renderer — clip content provider", () => {
  const views = () => createPlaylistCore(sizedDemoState()).getPresentation().visibleClipViews;

  it("events: only events inside the clip window are drawn; content wins over the sparkline", () => {
    // clip-bass-1: start 4, duration 18 → window [4, 22].
    const content: PlaylistClipContent = {
      kind: "events",
      beats: [0, 4, 10, 15, 22, 30],
      values: [1, 0.5, -0.8, 1, -1, 1],
    };
    const sparkCalls: string[] = [];
    const registry = createClipNodeRegistry(PALETTE, {
      getClipContent: (id) => (id === "clip-bass-1" ? content : null),
      getClipSparkline: (id) => {
        sparkCalls.push(id);
        return null;
      },
    });
    const parent = new Container();
    const list = views();
    registry.syncFrame(parent, list);
    const body = nodeOf(parent, list, "clip-bass-1").children[0] as Graphics;
    // body fill + title band + 4 in-window events (4, 10, 15, 22).
    expect(body.context.instructions.length).toBe(2 + 4);
    expect(sparkCalls).not.toContain("clip-bass-1");
    expect(sparkCalls.length).toBe(
      list.filter((v) => v.clip.type === "pattern" && v.clip.id !== "clip-bass-1").length,
    );
    registry.destroy();
  });

  it("level: one filled area + one top line", () => {
    const content: PlaylistClipContent = {
      kind: "level",
      series: { initial: 1000, beats: [8, 12, 40], values: [700, 300, 0] },
      max: 1000,
    };
    const registry = createClipNodeRegistry(PALETTE, {
      getClipContent: (id) => (id === "clip-bass-1" ? content : null),
    });
    const parent = new Container();
    const list = views();
    registry.syncFrame(parent, list);
    const body = nodeOf(parent, list, "clip-bass-1").children[0] as Graphics;
    const actions = body.context.instructions.map((i) => i.action);
    expect(actions).toEqual(["fill", "fill", "fill", "stroke"]);
    registry.destroy();
  });

  it("redraws a body only when the content reference, clip start or zoom changes", () => {
    const core = createPlaylistCore(sizedDemoState());
    let content: PlaylistClipContent = { kind: "events", beats: [6, 9], values: [1, -1] };
    const stable = new Map<string, PlaylistClipContent>();
    const registry = createClipNodeRegistry(PALETTE, {
      getClipContent: (id) => {
        if (id === "clip-bass-1") return content;
        let other = stable.get(id);
        if (!other) {
          other = { kind: "events", beats: [], values: [] };
          stable.set(id, other);
        }
        return other;
      },
    });
    const parent = new Container();
    const first = core.getPresentation().visibleClipViews;
    registry.syncFrame(parent, first);
    const redraws = countBodyRedraws(parent);
    const bassNode = nodeOf(parent, first, "clip-bass-1");
    const total = () => [...redraws.values()].reduce((a, b) => a + b, 0);

    // 100 frames of hover / playhead / selection with the same references.
    for (let i = 0; i < 100; i += 1) {
      if (i % 2) core.setPlayPosition(i);
      else core.setHover({ kind: "clip", clipId: "clip-chords-1" });
      registry.syncFrame(parent, core.getPresentation().visibleClipViews);
    }
    // The hovered clip's outline changes its hash once (hover on) — content
    // never forces a repaint by itself.
    const hoverRedraws = total();
    expect(hoverRedraws).toBeLessThanOrEqual(1);
    expect(redraws.get(bassNode)).toBe(0);

    content = { kind: "events", beats: [6, 9, 12], values: [1, -1, 1] };
    registry.syncFrame(parent, core.getPresentation().visibleClipViews);
    expect(redraws.get(bassNode)).toBe(1);
    expect(total()).toBe(hoverRedraws + 1);

    // Same reference, clip moved: events sit at absolute beats → re-layout.
    core.moveClips([{ id: "clip-bass-1", start: 5, trackIndex: 1 }]);
    registry.syncFrame(parent, core.getPresentation().visibleClipViews);
    expect(redraws.get(bassNode)).toBe(2);
    registry.syncFrame(parent, core.getPresentation().visibleClipViews);
    expect(redraws.get(bassNode)).toBe(2);
    registry.destroy();
  });
});

describe("renderer — drag annotation pill", () => {
  function makeLayer() {
    const parts = {
      container: new Container(),
      background: new Graphics(),
      textLayer: new Container(),
    };
    parts.container.addChild(parts.background, parts.textLayer);
    return { parts, layer: createDragAnnotationLayer(parts) };
  }

  it("follows the tooltip by transform and repaints only on a new reference", () => {
    const { parts, layer } = makeLayer();
    const core = createPlaylistCore(sizedDemoState());
    const annotation: PlaylistDragAnnotation = { text: "Min +$2,208", tone: "positive" };
    layer.sync(core.getPresentation(), annotation);
    expect(parts.container.visible).toBe(false); // no tooltip yet
    expect(layer.stats.repaints).toBe(0);

    for (let i = 0; i < 50; i += 1) {
      core.setTooltip({ kind: "time", text: `t${i}`, anchor: { x: 300 + i, y: 200 } });
      layer.sync(core.getPresentation(), annotation);
    }
    expect(parts.container.visible).toBe(true);
    expect(layer.stats.repaints).toBe(1);
    expect(parts.container.x).toBe(300 + 49 + 12);
    expect(parts.container.y).toBeGreaterThan(200 - 22);
    expect(visibleTexts(parts.container)).toEqual(["Min +$2,208"]);

    layer.sync(core.getPresentation(), { text: "Min −$90", tone: "negative" });
    expect(layer.stats.repaints).toBe(2);
    expect(visibleTexts(parts.container)).toEqual(["Min −$90"]);

    core.clearTooltip();
    layer.sync(core.getPresentation(), annotation);
    expect(parts.container.visible).toBe(false);
    layer.dispose();
  });

  it("is wired through the renderer callback", async () => {
    const core = createPlaylistCore(sizedDemoState());
    const annotation: PlaylistDragAnnotation = { text: "sales del rojo", tone: "positive" };
    let calls = 0;
    const renderer = createPlaylistRenderer(createContainer(), core, {
      getDragAnnotation: () => {
        calls += 1;
        return annotation;
      },
    });
    await settle();
    flushToIdle();
    expect(calls).toBe(0);
    core.setTooltip({ kind: "time", text: "12 NOV", anchor: { x: 400, y: 300 } });
    flushFrames();
    expect(calls).toBe(1);
    expect(visibleTexts(fake.apps[0]!.stage)).toContain("sales del rojo");
    core.clearTooltip();
    flushFrames();
    expect(visibleTexts(fake.apps[0]!.stage)).not.toContain("sales del rojo");
    renderer.destroy();
  });
});

describe("renderer — track meta in the header", () => {
  it("queries only visible real rows and caches the derived subtitle per meta object", () => {
    // Scrolled so overscan rows exist above and virtual rows below.
    const state = sizedDemoState();
    const scrolled: PlaylistState = { ...state, viewport: { ...state.viewport, scrollY: 300 } };
    const pres = createPlaylistPresentation(scrolled, M);
    const queried: string[] = [];
    const metaById = new Map<string, PlaylistTrackMeta>();
    for (const track of state.tracks) {
      metaById.set(track.id, {
        subtitle: `${track.label} · a very long yearly impact subtitle`,
        meter: track.id === "track-5" ? -0.5 : 0.75,
      });
    }
    const source = createTrackMetaSource((id) => {
      queried.push(id);
      return metaById.get(id) ?? null;
    });
    const graphics = new Graphics();
    const layer = new Container();
    drawTrackRows(graphics, layer, pres, source);
    const visibleReal = pres.trackRows.filter(
      (row) =>
        !row.isVirtual &&
        row.rowRect.y + row.rowRect.height > M.rulerHeight &&
        row.rowRect.y < 700,
    );
    expect(pres.trackRows.length).toBeGreaterThan(visibleReal.length);
    expect(queried.sort()).toEqual(visibleReal.map((r) => r.track.id).sort());
    const shown = visibleTexts(layer);
    const subtitle = shown.find((t) => t.startsWith("Vox ·"));
    expect(subtitle).toBeDefined();
    expect(subtitle!.endsWith("…")).toBe(true);

    // Same meta object next frame → same cached display string.
    const entry = source.cache.get("track-5")!;
    const display = entry.subtitle;
    drawTrackRows(graphics, layer, pres, source);
    expect(source.cache.get("track-5")).toBe(entry);
    expect(entry.subtitle).toBe(display);
  });

  it("is wired through the renderer callback", async () => {
    const core = createPlaylistCore(sizedDemoState());
    const meta: PlaylistTrackMeta = { subtitle: "−$24k / año", meter: -0.4 };
    const renderer = createPlaylistRenderer(createContainer(), core, {
      getTrackMeta: (id) => (id === "track-2" ? meta : null),
    });
    await settle();
    flushToIdle();
    expect(visibleTexts(fake.apps[0]!.stage)).toContain("−$24k / año");
    renderer.destroy();
  });
});
