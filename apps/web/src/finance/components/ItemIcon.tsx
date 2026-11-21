// An item's icon in the DOM: the catalog's glyph (icons.ts) as an inline
// SVG, stroked with `currentColor` — the same geometry the canvas draws in
// the card's pill. Unknown / absent names render nothing.
import * as React from "react";
import { iconDef } from "../icons";

export interface ItemIconProps {
  /** The icon's name (FinancialItem.icon). */
  id: string | undefined | null;
  /** Px (square). Default 16. */
  size?: number;
  className?: string;
}

export function ItemIcon({ id, size = 16, className }: ItemIconProps) {
  const def = iconDef(id);
  if (!def) return null;
  return <GlyphSvg glyph={def.glyph} size={size} className={className} />;
}

/** A glyph (24-unit path data) as an SVG: decorative, the caller names it. */
export function GlyphSvg({
  glyph,
  size = 16,
  className,
}: {
  glyph: readonly string[];
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={className ? `fin-glyph ${className}` : "fin-glyph"}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {glyph.map((d, index) => (
        <path key={index} d={d} />
      ))}
    </svg>
  );
}
