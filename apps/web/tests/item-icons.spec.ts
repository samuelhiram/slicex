// @vitest-environment jsdom
// Item icons: the in-house catalog (icons.ts), the data model (the item's
// `icon` name, validated by shape), the plan's storage, the bridge's
// provider for the canvas, and the editor's picker.
import { afterEach, describe, expect, it } from "vitest";
import * as React from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { GraphicsPath } from "pixi.js";
import { createDemoFinancialDocument, type FinancialDocument, type FinancialItem } from "@slicex/core";
import { createPlaylistCore } from "@slicex/canvas";
import { FinancialItemSchemaStrict, ItemIconSchema } from "@slicex/contracts";
import {
  ICON_GROUPS,
  ICONS,
  KIND_ICON_SUGGESTIONS,
  iconDef,
  iconGlyph,
  searchIcons,
} from "../src/finance/icons";
import { FinancialBridge } from "../src/finance/financial-bridge";
import { FINANCE_PLAYLIST_METRICS, createFinancialPlaylistState } from "../src/finance/mapping";
import { parsePlan, type SavedPlan } from "../src/finance/persistence";
import { switchKind } from "../src/finance/components/FinancialEditorModal";
import { IconPicker } from "../src/finance/components/IconPicker";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("the icon catalog", () => {
  it("has unique, storable names, a label and a group for every icon", () => {
    const ids = ICONS.map((def) => def.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ICONS.length).toBeGreaterThanOrEqual(40);
    for (const def of ICONS) {
      expect(ItemIconSchema.safeParse(def.id).success).toBe(true);
      expect(def.label.trim()).not.toBe("");
      expect(ICON_GROUPS.some((group) => group.id === def.group)).toBe(true);
      expect(def.glyph.length).toBeGreaterThan(0);
    }
    for (const group of ICON_GROUPS) {
      expect(ICONS.some((def) => def.group === group.id)).toBe(true);
    }
  });

  it("every glyph is path data the canvas can build (24-unit grid)", () => {
    for (const def of ICONS) {
      for (const d of def.glyph) {
        expect(d).toMatch(/^M/);
        expect(() => new GraphicsPath(d)).not.toThrow();
        const bounds = new GraphicsPath(d).bounds;
        expect(bounds.minX).toBeGreaterThanOrEqual(0);
        expect(bounds.minY).toBeGreaterThanOrEqual(0);
        expect(bounds.maxX).toBeLessThanOrEqual(24);
        expect(bounds.maxY).toBeLessThanOrEqual(24);
      }
    }
  });

  it("every kind's suggestions are in the catalog", () => {
    for (const ids of Object.values(KIND_ICON_SUGGESTIONS)) {
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) expect(iconDef(id)).not.toBeNull();
    }
  });

  it("iconGlyph: the SAME array every call (the canvas compares references); null for none / unknown", () => {
    expect(iconGlyph("house")).toBe(iconGlyph("house"));
    expect(iconGlyph("house")).not.toBeNull();
    expect(iconGlyph(undefined)).toBeNull();
    expect(iconGlyph("")).toBeNull();
    expect(iconGlyph("no-such-icon")).toBeNull();
  });

  it("search ignores accents and case, and needs every word", () => {
    expect(searchIcons("super").map((def) => def.id)).toContain("shopping-cart");
    expect(searchIcons("CAFÉ").map((def) => def.id)).toContain("coffee");
    expect(searchIcons("luz").map((def) => def.id)).toEqual(["zap"]);
    expect(searchIcons("tarjeta credito").map((def) => def.id)).toContain("credit-card");
    expect(searchIcons("zzzz")).toEqual([]);
    expect(searchIcons("  ").length).toBe(ICONS.length);
  });
});

const ITEM: FinancialItem = {
  id: "renta",
  kind: "expense",
  name: "Renta",
  amount: 8000,
  icon: "house",
  recurrence: { frequency: "monthly", startDate: "2026-12-01" },
};

describe("the data model", () => {
  it("an item keeps its icon name; a malformed name is rejected", () => {
    const ok = FinancialItemSchemaStrict.safeParse(ITEM);
    expect(ok.success).toBe(true);
    expect((ok.data as FinancialItem).icon).toBe("house");
    expect(ItemIconSchema.safeParse("gamepad-2").success).toBe(true);
    for (const bad of ["House", "a b", "-x", "x-", "x--y", "", "a".repeat(41)]) {
      expect(ItemIconSchema.safeParse(bad).success).toBe(false);
    }
    // A name the catalog does not know (a newer app's) still loads.
    expect(FinancialItemSchemaStrict.safeParse({ ...ITEM, icon: "rocket-ship" }).success).toBe(true);
  });

  it("the saved plan keeps icons; a malformed one is dropped, never the item", () => {
    const doc = createDemoFinancialDocument("2026-11-19");
    const items = [...doc.items, ITEM, { ...ITEM, id: "roto", name: "Roto", icon: "No Válido" } as FinancialItem];
    const plan: SavedPlan = {
      v: 1,
      activeId: "main",
      compareId: null,
      branches: [{ id: "main", name: "Plan", forkDate: null, doc: { ...doc, items } }],
      ledger: [],
    };
    const parsed = parsePlan(JSON.stringify(plan))!;
    const saved = parsed.branches[0]!.doc.items;
    expect(saved.find((item) => item.id === "renta")!.icon).toBe("house");
    const broken = saved.find((item) => item.id === "roto");
    expect(broken).toBeDefined();
    expect(broken!.icon).toBeUndefined();
    // The demo plan ships with icons.
    expect(saved.find((item) => item.id === "fin-sueldo")!.icon).toBe("briefcase");
  });

  it("a kind switch in the editor keeps the icon", () => {
    const doc: FinancialDocument = {
      id: "d",
      name: "d",
      startDate: "2026-11-19",
      initialCash: 0,
      minimumCashReserve: 0,
      horizonMonths: 12,
      items: [ITEM],
    };
    expect(switchKind(ITEM, "income", doc).icon).toBe("house");
    const { icon: _icon, ...plain } = ITEM;
    expect(switchKind(plain as FinancialItem, "income", doc).icon).toBeUndefined();
  });
});

describe("the bridge's icon provider", () => {
  const doc: FinancialDocument = {
    id: "t",
    name: "t",
    startDate: "2026-11-07",
    initialCash: 5000,
    minimumCashReserve: 1000,
    horizonMonths: 12,
    items: [
      { ...ITEM },
      {
        id: "bono",
        kind: "income",
        name: "Bono",
        amount: 4000,
        recurrence: { frequency: "once", startDate: "2026-12-09", endDate: "2026-12-09" },
      },
    ],
  };
  const setup = () => {
    const core = createPlaylistCore(createFinancialPlaylistState(doc), {
      metrics: FINANCE_PLAYLIST_METRICS,
      stretchEnabled: false,
    });
    return new FinancialBridge(core, doc);
  };

  it("gives the catalog's glyph (the same reference), or null", () => {
    const bridge = setup();
    expect(bridge.getClipIcon("renta")).toBe(iconGlyph("house"));
    expect(bridge.getClipIcon("renta")).toBe(bridge.getClipIcon("renta"));
    expect(bridge.getClipIcon("bono")).toBeNull();
    expect(bridge.getClipIcon("nope")).toBeNull();
  });

  it("follows an edit, and a one-date tag grows by the icon's room", () => {
    const bridge = setup();
    const plain = bridge.clipMinWidth("bono", 70, 20);
    const bono = bridge.getItem("bono")!;
    expect(bridge.replaceItem({ ...bono, icon: "gift" })).toBe(true);
    expect(bridge.getClipIcon("bono")).toBe(iconGlyph("gift"));
    // A tall (70 px) card: the 21 px icon + its 6 px gap.
    expect(bridge.clipMinWidth("bono", 70, 20)).toBe(plain + 27);
  });
});

describe("the picker", () => {
  let root: Root | null = null;
  let container: HTMLElement | null = null;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = null;
    container = null;
  });

  function mount(value: string | undefined, picked: (string | undefined)[]) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root!.render(
        React.createElement(IconPicker, {
          value,
          kind: "expense",
          color: "#e5484d",
          onChange: (icon: string | undefined) => picked.push(icon),
        }),
      ),
    );
    return container.querySelector<HTMLButtonElement>(".fin-iconpick__trigger")!;
  }

  const typeInto = (input: HTMLInputElement, text: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("names its state; opens a dialog with the kind's suggestions first and the search focused", () => {
    const trigger = mount(undefined, []);
    expect(trigger.getAttribute("aria-label")).toBe("Elegir ícono");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    act(() => trigger.click());
    const dialog = container!.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-label")).toBe("Elegir ícono");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(dialog.querySelector(".fin-iconpick__search"));
    const firstSection = dialog.querySelector(".fin-iconpick__section")!;
    expect(firstSection.querySelector("h4")!.textContent).toBe("Para gasto");
    const first = firstSection.querySelectorAll("button[data-icon-option]");
    expect(Array.from(first).map((el) => el.getAttribute("data-icon-option"))).toEqual([
      ...KIND_ICON_SUGGESTIONS.expense,
    ]);
    // No "Quitar" without an icon.
    expect(dialog.querySelector(".fin-iconpick__clear")).toBeNull();
  });

  it("a click picks and closes; Enter in the search picks the first match", () => {
    const picked: (string | undefined)[] = [];
    const trigger = mount(undefined, picked);
    act(() => trigger.click());
    act(() =>
      container!.querySelector<HTMLButtonElement>('button[data-icon-option="utensils"]')!.click(),
    );
    expect(picked).toEqual(["utensils"]);
    expect(container!.querySelector('[role="dialog"]')).toBeNull();

    act(() => trigger.click());
    const search = container!.querySelector<HTMLInputElement>(".fin-iconpick__search")!;
    typeInto(search, "cafe");
    expect(container!.querySelectorAll("button[data-icon-option]").length).toBe(1);
    act(() => {
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(picked).toEqual(["utensils", "coffee"]);

    act(() => trigger.click());
    typeInto(container!.querySelector<HTMLInputElement>(".fin-iconpick__search")!, "zzzz");
    expect(container!.querySelector('[role="status"]')!.textContent).toContain("zzzz");
  });

  it("with an icon: says which, marks it, and 'Quitar' clears it", () => {
    const picked: (string | undefined)[] = [];
    const trigger = mount("house", picked);
    expect(trigger.getAttribute("aria-label")).toBe("Ícono: Casa. Cambiar");
    expect(trigger.style.color).not.toBe("");
    act(() => trigger.click());
    const pressed = container!.querySelectorAll('button[aria-pressed="true"]');
    expect(pressed.length).toBeGreaterThan(0);
    for (const el of Array.from(pressed)) expect(el.getAttribute("data-icon-option")).toBe("house");
    act(() => container!.querySelector<HTMLButtonElement>(".fin-iconpick__clear")!.click());
    expect(picked).toEqual([undefined]);
  });
});
