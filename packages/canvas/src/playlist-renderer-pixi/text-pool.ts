// Text-instance pool keyed per Container.
//
// Canon §3.1 + §3.8: the renderer must not allocate DisplayObjects per
// frame. The pool resets a per-Container cursor at the start of each
// render, so subsequent addText calls reuse the previous frame's Text
// objects (cheap mutation of .text/.x/.y) instead of `new Text(...)`.
// Children stay parented so the next frame grabs them in O(1).
//
// disposeTextLayer wipes the layer at unmount only.
//
// The `new Text(...)` call here lives in the only place where it's allowed
// (besides renderer-impl.ts + clip-node-registry.ts): check-perf-patterns
// whitelists this file explicitly. See scripts/check-perf-patterns.mjs.
import { Container, Text } from "pixi.js";
import { COLORS } from "./palette";

const TEXT_POOL_CURSOR = new WeakMap<Container, number>();

export interface TextStyleOptions {
  size?: number;
  color?: number;
  weight?: string;
}

function applyTextStyle(label: Text, text: string, opts: TextStyleOptions): void {
  if (label.text !== text) {
    label.text = text;
  }
  const color = opts.color ?? COLORS.text;
  const size = opts.size ?? 12;
  const weight = (opts.weight ?? "500") as any;
  const style = label.style;
  if (style.fill !== color) style.fill = color;
  if (style.fontSize !== size) style.fontSize = size;
  if (style.fontWeight !== weight) style.fontWeight = weight;
}

export function addText(
  layer: Container,
  text: string,
  x: number,
  y: number,
  options: TextStyleOptions = {},
): void {
  const cursor = TEXT_POOL_CURSOR.get(layer) ?? 0;
  let label = layer.children[cursor] as Text | undefined;
  if (label instanceof Text) {
    applyTextStyle(label, text, options);
    label.visible = true;
  } else {
    label = new Text({
      text,
      style: {
        fill: options.color ?? COLORS.text,
        fontFamily: "Segoe UI, Arial, sans-serif",
        fontSize: options.size ?? 12,
        fontWeight: (options.weight ?? "500") as any,
        letterSpacing: 0,
      },
    });
    label.eventMode = "none";
    layer.addChild(label);
  }
  label.x = Math.round(x);
  label.y = Math.round(y);
  TEXT_POOL_CURSOR.set(layer, cursor + 1);
}

// Reset the layer's pool cursor and hide any Text instances that the new
// frame won't claim. Children stay parented so the next frame can grab
// them in O(1).
export function clearTextLayer(layer: Container): void {
  TEXT_POOL_CURSOR.set(layer, 0);
  for (const child of layer.children) {
    child.visible = false;
  }
}

// Final tear-down at unmount. Drops all children and forgets the cursor.
export function disposeTextLayer(layer: Container): void {
  TEXT_POOL_CURSOR.delete(layer);
  layer.removeChildren();
}
