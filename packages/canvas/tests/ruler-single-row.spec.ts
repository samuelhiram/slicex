// metrics.rulerSingleRow: the axis' groups ("dic 2026") share the tick row —
// a soft chip, sticky at the left edge, after the "now" pill when they
// would touch it, pushed out by the next group — and a tick label that
// would touch a chip gives way (a day number never reads as its date).
import { Container, Graphics, Text } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  createDemoPlaylistState,
  createPlaylistPresentation,
  DEFAULT_PLAYLIST_METRICS,
  type PlaylistMetrics,
  type PlaylistTimeAxis,
} from "../src/playlist-core";
import { drawRulerChrome, rulerTickLabelY } from "../src/playlist-renderer-pixi/layers/ruler";
import { clearTextLayer } from "../src/playlist-renderer-pixi/text-pool";

const M: PlaylistMetrics = { ...DEFAULT_PLAYLIST_METRICS, rulerHeight: 34, rulerSingleRow: true };
const PX = 28;

// One centred label per beat ("d1"…), beat 0 the "now" pill; two groups.
const axis: PlaylistTimeAxis = {
  ticks(fromBeat, toBeat) {
    const out = [];
    for (let beat = Math.max(0, Math.floor(fromBeat)); beat <= Math.ceil(toBeat); beat += 1) {
      out.push({ beat, major: false, label: beat === 0 ? "Hoy" : `d${beat}`, centered: true, emphasis: beat === 0 });
    }
    return out;
  },
  bands: () => [
    { kind: "group" as const, start: 0, end: 10, label: "nov 2026" },
    { kind: "group" as const, start: 10, end: 400, label: "dic 2026" },
  ],
  formatTime: (beat) => `day ${beat}`,
};

function draw(scrollBeats: number, metrics: PlaylistMetrics = M) {
  const base = createDemoPlaylistState();
  const state = {
    ...base,
    viewport: { ...base.viewport, width: 1200, height: 700, pxPerBeat: PX, scrollX: scrollBeats * PX },
  };
  const presentation = createPlaylistPresentation(state, metrics, axis);
  const graphics = new Graphics();
  const layer = new Container();
  clearTextLayer(layer);
  drawRulerChrome(graphics, layer, presentation);
  const texts = layer.children.filter((c): c is Text => c instanceof Text && c.visible);
  const at = (label: string) => texts.find((t) => t.text === label);
  return { presentation, texts: texts.map((t) => t.text), at };
}

describe("one-row ruler", () => {
  it("the month chip shares the row with the days, after the 'Hoy' pill", () => {
    const { texts, at, presentation } = draw(0);
    const y = rulerTickLabelY(presentation);
    // Centred in the 34 px ruler.
    expect(y).toBe(Math.round((34 - 12 - 3) / 2));
    const hoy = at("Hoy")!;
    const nov = at("nov 2026")!;
    expect(nov).toBeDefined();
    expect(Math.abs(nov.y - (y - 1))).toBeLessThanOrEqual(1);
    expect(nov.x).toBeGreaterThan(hoy.x);
    // The days under the chip give way; later ones are drawn.
    expect(texts).not.toContain("d1");
    expect(texts).not.toContain("d2");
    expect(texts).toContain("d6");
    expect(texts).toContain("dic 2026");
    // Every day drawn before the next month's chip ends ≥ 8 px before it
    // (its chip starts 6 px left of its text).
    const chipLeft = at("dic 2026")!.x - 6;
    for (const label of texts.filter((text) => /^d\d+$/.test(text))) {
      const text = at(label)!;
      const right = text.x + label.length * 7.2 / 2;
      if (right < chipLeft) expect(chipLeft - right).toBeGreaterThanOrEqual(8);
    }
  });

  it("sticks to the left edge while its month is on screen", () => {
    const { at, presentation } = draw(20);
    const left = presentation.metrics.trackHeaderWidth;
    const dic = at("dic 2026")!;
    expect(dic.x).toBeGreaterThanOrEqual(left);
    expect(dic.x).toBeLessThan(left + 16);
  });

  it("without rulerSingleRow the groups keep their upper tier", () => {
    const { at } = draw(0, { ...M, rulerHeight: 52, rulerSingleRow: false });
    expect(at("dic 2026")!.y).toBe(6);
  });
});
