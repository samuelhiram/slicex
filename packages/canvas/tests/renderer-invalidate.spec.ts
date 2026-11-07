// canvas-renderer-no-invalidate-for-providers.
//
// The renderer only painted on core notifies, so a host whose provider data
// changed without any PlaylistState change (an amount edited in a modal →
// new getClipDetail string) kept showing the stale figure until some
// unrelated dispatch. PlaylistRenderer.invalidate() requests a repaint
// through the same rAF-coalesced path as core notifies (canon §3.10/§3.11).
//
// Pixi's Application needs a GPU context, so it is replaced by a minimal
// fake; every other Pixi class (Container / Graphics / Text) is the real one,
// which is what the layers and the clip node registry draw into.
import { Container, Text } from "pixi.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface FakeApplication {
  stage: Container;
  renders: number;
}

// Shared with the hoisted vi.mock factory below.
const fake = vi.hoisted(() => ({
  apps: [] as FakeApplication[],
  holdInit: false,
  releaseInit: null as (() => void) | null,
}));

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
      if (!fake.holdInit) return Promise.resolve();
      return new Promise((resolve) => {
        fake.releaseInit = resolve;
      });
    }
    render(): void {
      this.renders += 1;
    }
    destroy(): void {}
  }
  return { ...actual, Application };
});

const { createDemoPlaylistState, createPlaylistCore } = await import(
  "../src/playlist-core"
);
const { createPlaylistRenderer } = await import(
  "../src/playlist-renderer-pixi"
);

// Manual rAF queue: frames run only when the test flushes them.
let frames = new Map<number, FrameRequestCallback>();
let nextFrameId = 1;
function flushFrames(): number {
  const pending = frames;
  frames = new Map();
  for (const callback of pending.values()) callback(0);
  return pending.size;
}

// Mount schedules a render plus a follow-up resize frame; drain to idle.
function flushToIdle(): void {
  for (let i = 0; i < 10 && frames.size > 0; i += 1) flushFrames();
  expect(frames.size).toBe(0);
}

function createContainer(): HTMLElement {
  return {
    getBoundingClientRect: () => ({ width: 1200, height: 700 }),
    appendChild() {},
  } as unknown as HTMLElement;
}

async function settle(): Promise<void> {
  // Let the init().then() continuation run.
  await Promise.resolve();
  await Promise.resolve();
}

function sizedCore() {
  const state = createDemoPlaylistState();
  return createPlaylistCore({
    ...state,
    viewport: { ...state.viewport, width: 1200, height: 700 },
  });
}

function visibleTexts(node: Container): string[] {
  const out: string[] = [];
  const walk = (c: Container) => {
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
  fake.holdInit = false;
  fake.releaseInit = null;
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

describe("PlaylistRenderer.invalidate", () => {
  it("repaints a provider-only change (detail text) without any core notify", async () => {
    const core = sizedCore();
    let notifies = 0;
    core.subscribe(() => {
      notifies += 1;
    });
    let amount = "−$2,000 única";
    const renderer = createPlaylistRenderer(createContainer(), core, {
      getClipDetail: (id) => (id === "clip-drums-1" ? amount : null),
    });
    await settle();
    flushToIdle();
    const app = fake.apps[0]!;
    const rendersAfterMount = app.renders;
    expect(rendersAfterMount).toBeGreaterThan(0);
    const scene = app.stage;
    expect(visibleTexts(scene)).toContain("−$2,000 única");

    // The host edits the amount: provider data changes, PlaylistState doesn't.
    amount = "−$3,500 única";
    expect(flushFrames()).toBe(0); // nothing scheduled on its own
    renderer.invalidate();
    expect(flushFrames()).toBe(1);
    expect(app.renders).toBe(rendersAfterMount + 1);
    expect(visibleTexts(scene)).toContain("−$3,500 única");
    expect(visibleTexts(scene)).not.toContain("−$2,000 única");
    expect(notifies).toBe(0);
    renderer.destroy();
  });

  it("coalesces with core notifies and repeated calls into one frame", async () => {
    const core = sizedCore();
    const renderer = createPlaylistRenderer(createContainer(), core);
    await settle();
    flushToIdle();
    const app = fake.apps[0]!;
    const before = app.renders;

    renderer.invalidate();
    renderer.invalidate();
    core.setPlayPosition(3);
    core.setHover({ kind: "clip", clipId: "clip-drums-1" });
    renderer.invalidate();
    expect(frames.size).toBe(1);
    flushFrames();
    expect(app.renders).toBe(before + 1);

    // Idle afterwards: no self-sustaining tick (canon §3.11).
    expect(flushFrames()).toBe(0);
    renderer.destroy();
  });

  it("an invalidate before the Pixi app is ready does not wedge later frames", async () => {
    fake.holdInit = true;
    const core = sizedCore();
    const renderer = createPlaylistRenderer(createContainer(), core);
    renderer.invalidate();
    // The frame runs while init() is still pending: renderNow bails out.
    expect(flushFrames()).toBe(1);
    fake.releaseInit!();
    await settle();
    flushToIdle();
    const app = fake.apps[0]!;
    const mounted = app.renders;
    expect(mounted).toBeGreaterThan(0);
    // Later requests still schedule (and paint) frames.
    renderer.invalidate();
    expect(flushFrames()).toBe(1);
    core.setPlayPosition(5);
    expect(flushFrames()).toBe(1);
    expect(app.renders).toBe(mounted + 2);
    renderer.destroy();
  });

  it("is a no-op after destroy", async () => {
    const core = sizedCore();
    const renderer = createPlaylistRenderer(createContainer(), core);
    await settle();
    flushToIdle();
    renderer.destroy();
    renderer.invalidate();
    expect(frames.size).toBe(0);
  });
});
