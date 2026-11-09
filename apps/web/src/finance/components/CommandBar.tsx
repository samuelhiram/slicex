// "Escribir sobre el timeline": press "/" and type "renta 8000 el 1". The
// sentence is understood as you type, the money lane previews the effect
// live (the plan is untouched) and Enter adds it. Empty, the bar offers
// the Mexican year (aguinaldo, Buen Fin, predial…) as ghost suggestions:
// Tab adds the highlighted one. While typing, Tab completes the word.
import * as React from "react";
import { useFitInViewport } from "../../ui/fit-in-viewport";
import { suggestMexicanYear, type FinancialItem, type YearSuggestion } from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import { completeCommand, parseCommand } from "../command";
import { formatDateShort, formatMoneyWhole } from "../format";
import { KIND_COLORS } from "../labels";
import { useFinancialRevision } from "./FinancialUi";

export interface CommandBarProps {
  bridge: FinancialBridgeApi;
  today: string;
  onClose: () => void;
}

function suggestionAmount(item: FinancialItem): string {
  if ("amount" in item) {
    return `${item.kind === "income" ? "+" : "−"}${formatMoneyWhole(item.amount)}`;
  }
  return "";
}

export function CommandBar({ bridge, today, onClose }: CommandBarProps) {
  const revision = useFinancialRevision(bridge);
  const [text, setText] = React.useState("");
  const [selected, setSelected] = React.useState(0);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  // Always fully on screen (phones: the bar is wider than the window).
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  useFitInViewport(rootRef, true);

  const parsed = React.useMemo(
    () => (text.trim() ? parseCommand(text, { today, doc: bridge.getDocument() }) : null),
    [text, today, bridge, revision],
  );
  const suggestions = React.useMemo<YearSuggestion[]>(
    () => (text.trim() ? [] : suggestMexicanYear(bridge.getDocument())),
    [text, bridge, revision],
  );
  const completion = React.useMemo(
    () => (text && !text.endsWith(" ") ? completeCommand(text) : null),
    [text],
  );
  const highlighted = suggestions[Math.min(selected, suggestions.length - 1)] ?? null;
  const previewItem: FinancialItem | null = parsed?.item ?? highlighted?.item ?? null;

  // Live what-if on the money lane (cleared on close) and its effect.
  const [effect, setEffect] = React.useState<ReturnType<FinancialBridgeApi["getPreviewEffect"]>>(null);
  React.useEffect(() => {
    bridge.setPreview(previewItem ? { kind: "add", item: previewItem } : null);
    setEffect(previewItem ? bridge.getPreviewEffect() : null);
  }, [bridge, previewItem, revision]);
  React.useEffect(() => () => bridge.setPreview(null), [bridge]);
  React.useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const add = (item: FinancialItem) => {
    bridge.setPreview(null);
    bridge.addItem({ ...item, id: "" } as FinancialItem);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      if (completion) {
        setText(text + completion);
        return;
      }
      if (!text.trim() && highlighted) {
        add(highlighted.item);
        setSelected(0);
      }
      return;
    }
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setSelected((index) => (index + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setSelected((index) => (index - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (parsed) {
        add(parsed.item);
        onClose();
      } else if (!text.trim() && highlighted) {
        add(highlighted.item);
        setSelected(0);
      }
    }
  };

  const ghost = !text && highlighted
    ? `${highlighted.title} ${suggestionAmount(highlighted.item)} el ${formatDateShort(highlighted.item.recurrence.startDate)}`
    : null;

  return (
    <div ref={rootRef} className="fin-command" role="dialog" aria-label="Escribir un movimiento">
      <div className="fin-command__field">
        <span className="fin-command__slash" aria-hidden="true">/</span>
        <div className="fin-command__input-wrap">
          <input
            ref={inputRef}
            className="fin-command__input"
            value={text}
            placeholder={ghost ? "" : "renta 8000 el 1 · sueldo 9000 quincenal · uber 150 hoy"}
            aria-label="Movimiento"
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setText(event.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
          />
          <span className="fin-command__ghost" aria-hidden="true">
            <span className="fin-command__ghost-typed">{text}</span>
            {completion ?? ""}
            {ghost ?? ""}
          </span>
        </div>
        <kbd className="fin-command__key">{parsed ? "Enter" : ghost ? "Tab" : "Esc"}</kbd>
      </div>

      {parsed ? (
        <div className="fin-command__result">
          <span
            className="fin-command__dot"
            style={{ background: KIND_COLORS[parsed.item.kind] }}
            aria-hidden="true"
          />
          <div className="fin-command__summary">
            <span className="fin-command__what">{parsed.summary}</span>
            {parsed.assumed.length > 0 ? (
              <span className="fin-command__assumed">Supuse: {parsed.assumed.join(", ")}</span>
            ) : null}
          </div>
        </div>
      ) : text.trim() ? (
        <p className="fin-command__empty">Escribe un monto: “gasolina 600 cada semana”.</p>
      ) : null}

      {effect && previewItem ? (
        <p className="fin-command__effect" data-tone={effect.tone}>
          {effect.text}
        </p>
      ) : null}

      {suggestions.length > 0 ? (
        <div className="fin-command__suggestions">
          <p className="fin-command__label">Tu año en México</p>
          <ul role="listbox" aria-label="Sugerencias del año">
            {suggestions.map((suggestion, index) => (
              <li
                key={suggestion.id}
                role="option"
                aria-selected={index === selected}
                className="fin-command__suggestion"
                data-selected={index === selected}
                onMouseEnter={() => setSelected(index)}
                onMouseDown={(event) => {
                  event.preventDefault();
                  add(suggestion.item);
                }}
              >
                <span
                  className="fin-command__dot"
                  style={{ background: KIND_COLORS[suggestion.item.kind] }}
                  aria-hidden="true"
                />
                <span className="fin-command__suggestion-text">
                  <span className="fin-command__suggestion-title">
                    {suggestion.title}{" "}
                    <span className="fin-command__suggestion-amount">
                      {suggestionAmount(suggestion.item)} ·{" "}
                      {formatDateShort(suggestion.item.recurrence.startDate)}
                    </span>
                  </span>
                  <span className="fin-command__suggestion-why">{suggestion.why}</span>
                </span>
                {index === selected ? <kbd className="fin-command__key">Tab</kbd> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
