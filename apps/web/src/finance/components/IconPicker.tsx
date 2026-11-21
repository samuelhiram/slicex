// The item's icon, chosen beside its name: a square button showing the
// icon (in the item's colour) — or an empty dashed one — that opens a
// popover with a search field, the kind's suggestions and the whole
// catalog by group (icons.ts). Picking closes it and gives the focus back.
//
// Keyboard: the search field takes the focus; ↓ moves into the grid, the
// arrows move by geometry (row / column, across groups), Enter / Space
// pick, Enter in the search picks the first result, Escape closes.
//
// Placed `position: fixed` against the trigger, corrected for a containing
// block (the editor's blurred overlay is one), flipped above when the room
// below is short — no Mantine component (CLAUDE.md: Mantine is form state
// only).
import * as React from "react";
import type { FinancialItemKind } from "@slicex/core";
import { ICON_GROUPS, ICONS, KIND_ICON_SUGGESTIONS, iconDef, searchIcons, type IconDef } from "../icons";
import { KIND_LABELS } from "../labels";
import { useOverlay } from "../../ui/use-overlay";
import { GlyphSvg } from "./ItemIcon";

export interface IconPickerProps {
  /** The icon's name, or undefined for none. */
  value: string | undefined;
  /** The item's kind: its suggestions come first. */
  kind: FinancialItemKind;
  /** The item's colour (the icon is drawn with it, as on the card). */
  color: string;
  onChange: (icon: string | undefined) => void;
  disabled?: boolean;
}

const GAP = 6;
const MARGIN = 8;

export function IconPicker({ value, kind, color, onChange, disabled }: IconPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  const panelId = React.useId();
  const close = React.useCallback(() => setOpen(false), []);
  useOverlay({
    open,
    onClose: close,
    kind: "popover",
    containerRef: panelRef,
    triggerRef,
    initialFocusRef: searchRef,
  });

  // Below the trigger (above when short of room), inside the viewport.
  React.useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const panel = panelRef.current;
      const trigger = triggerRef.current;
      if (!panel || !trigger) return;
      // Where (0, 0) lands: the containing block's offset (a filter /
      // backdrop-filter ancestor makes `fixed` relative to it).
      panel.style.left = "0px";
      panel.style.top = "0px";
      const origin = panel.getBoundingClientRect();
      const anchor = trigger.getBoundingClientRect();
      const width = panel.offsetWidth;
      const height = panel.offsetHeight;
      const roomBelow = window.innerHeight - MARGIN - (anchor.bottom + GAP);
      const roomAbove = anchor.top - GAP - MARGIN;
      const top =
        height > roomBelow && roomAbove > roomBelow
          ? Math.max(MARGIN, anchor.top - GAP - height)
          : anchor.bottom + GAP;
      const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - MARGIN - width));
      panel.style.left = `${Math.round(left - origin.left)}px`;
      panel.style.top = `${Math.round(top - origin.top)}px`;
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);

  const current = iconDef(value);
  const pick = (icon: string | undefined) => {
    onChange(icon);
    setOpen(false);
  };

  const results = query.trim() ? searchIcons(query) : null;
  const suggestions = KIND_ICON_SUGGESTIONS[kind]
    .map((id) => iconDef(id))
    .filter((def): def is IconDef => def !== null);

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-icon-option]"),
    );
    const from = options.indexOf(document.activeElement as HTMLButtonElement);
    if (from < 0) return;
    event.preventDefault();
    const target = neighbour(options, from, event.key);
    if (target === "search") searchRef.current?.focus();
    else options[target]?.focus();
  };

  const option = (def: IconDef, section: string) => (
    <button
      key={`${section}:${def.id}`}
      type="button"
      className="fin-iconpick__option"
      data-icon-option={def.id}
      aria-label={def.label}
      aria-pressed={def.id === value}
      title={def.label}
      onClick={() => pick(def.id)}
    >
      <GlyphSvg glyph={def.glyph} size={18} />
    </button>
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="fin-iconpick__trigger"
        data-empty={current ? undefined : "true"}
        style={{ color: current ? color : undefined }}
        aria-label={current ? `Ícono: ${current.label}. Cambiar` : "Elegir ícono"}
        title={current ? `Ícono: ${current.label}` : "Elegir ícono"}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        disabled={disabled}
        onClick={() => {
          setQuery("");
          setOpen((value) => !value);
        }}
      >
        {current ? (
          <GlyphSvg glyph={current.glyph} size={20} />
        ) : (
          <GlyphSvg glyph={EMPTY_GLYPH} size={18} />
        )}
      </button>
      {open ? (
        <div
          ref={panelRef}
          id={panelId}
          className="fin-iconpick"
          role="dialog"
          aria-label="Elegir ícono"
        >
          <div className="fin-iconpick__head">
            <input
              ref={searchRef}
              type="search"
              className="fin-iconpick__search"
              placeholder="Buscar ícono…"
              aria-label="Buscar ícono"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  // Never submits the editor: picks the first match.
                  event.preventDefault();
                  const first = (results ?? suggestions)[0];
                  if (first) pick(first.id);
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  panelRef.current?.querySelector<HTMLButtonElement>("button[data-icon-option]")?.focus();
                }
              }}
            />
            {current ? (
              <button type="button" className="fin-iconpick__clear" onClick={() => pick(undefined)}>
                Quitar
              </button>
            ) : null}
          </div>
          <div className="fin-iconpick__body" onKeyDown={onGridKeyDown}>
            {results ? (
              results.length > 0 ? (
                <Section title={`${results.length} ${results.length === 1 ? "ícono" : "íconos"}`}>
                  {results.map((def) => option(def, "results"))}
                </Section>
              ) : (
                <p className="fin-iconpick__empty" role="status">
                  Ningún ícono con «{query.trim()}».
                </p>
              )
            ) : (
              <>
                <Section title={`Para ${KIND_LABELS[kind].toLowerCase()}`}>
                  {suggestions.map((def) => option(def, "suggested"))}
                </Section>
                {ICON_GROUPS.map((group) => (
                  <Section key={group.id} title={group.label}>
                    {ICONS.filter((def) => def.group === group.id).map((def) => option(def, group.id))}
                  </Section>
                ))}
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const id = React.useId();
  return (
    <section className="fin-iconpick__section" aria-labelledby={id}>
      <h4 id={id} className="fin-iconpick__title">
        {title}
      </h4>
      <div className="fin-iconpick__grid">{children}</div>
    </section>
  );
}

// "No icon yet": a small face with a plus — pick one.
const EMPTY_GLYPH: readonly string[] = [
  "M20.5 11.5a8.5 8.5 0 1 1-8-8.5",
  "M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2",
  "M9 9.5h.01",
  "M15 9.5h.01",
  "M19 2.5v5",
  "M16.5 5h5",
];

/**
 * The option an arrow key moves to, by geometry: ← → the previous / next one
 * in reading order; ↑ ↓ the nearest one (by x) in the row above / below,
 * across groups; ↑ from the first row goes back to the search field.
 */
function neighbour(options: HTMLButtonElement[], from: number, key: string): number | "search" {
  if (key === "Home") return 0;
  if (key === "End") return options.length - 1;
  if (key === "ArrowRight") return Math.min(options.length - 1, from + 1);
  if (key === "ArrowLeft") return Math.max(0, from - 1);
  const rects = options.map((el) => el.getBoundingClientRect());
  const here = rects[from]!;
  const x = here.left + here.width / 2;
  const down = key === "ArrowDown";
  let rowTop: number | null = null;
  for (const rect of rects) {
    const ahead = down ? rect.top > here.top + 2 : rect.top < here.top - 2;
    if (!ahead) continue;
    if (rowTop === null || (down ? rect.top < rowTop : rect.top > rowTop)) rowTop = rect.top;
  }
  if (rowTop === null) return down ? from : "search";
  let best = from;
  let bestDistance = Infinity;
  rects.forEach((rect, index) => {
    if (Math.abs(rect.top - rowTop!) > 2) return;
    const distance = Math.abs(rect.left + rect.width / 2 - x);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}
