// "Escribir sobre el timeline": press "/" and type "renta 8000 el 1". The
// sentence is understood as you type, the money lane previews the effect
// live (the plan is untouched) and Enter does what the sentence asks. Empty,
// the bar shows a fixed line of examples and offers the Mexican year
// (aguinaldo, Buen Fin, predial…) as ghost suggestions: Tab adds the
// highlighted one. While typing, Tab completes the word.
//
// UX-05: not every sentence is a new item (command.ts interpretCommand):
//   - "tengo 11400 en el banco" → today's cash: "Liquidez hoy $A → $B";
//     Enter sets it (undoable);
//   - "pagué la tarjeta nu 3000" → the card's balance goes down (and today's
//     cash, unless you say it is already out of it);
//   - a one-off dated before today → never added silently: "Ya pasó…" with
//     [Descontarlo de mi liquidez] (Enter) / [Anotarlo igual];
//   - a guessed kind ("Supuse: tipo") → Enter adds nothing; the person picks
//     [Gasto] [Ingreso] [Es mi saldo de hoy].
// Every option previews on hover / focus; every commit is announced with
// "Deshacer" (UX-26). UX-27: one open / close contract (useOverlay): Escape
// closes, the focus goes back to whoever opened the bar. UX-45: the reason
// a sentence does nothing is said in the person's terms.
import * as React from "react";
import { useFitInViewport } from "../../ui/fit-in-viewport";
import {
  suggestMexicanYear,
  type FinancialDocument,
  type FinancialItem,
  type YearSuggestion,
} from "@slicex/core";
import type { FinancialBridgeApi, FinancialPreview, PreviewEffect } from "../bridge-api";
import {
  cardNeverPaidOff,
  completeCommand,
  explainNoAmount,
  interpretCommand,
  type CommandIntent,
  type ParsedCommand,
} from "../command";
import { formatDateShort, formatMoneyWhole } from "../format";
import { KIND_COLORS } from "../labels";
import { useAnnounce } from "../../ui/announcer";
import { useOverlay } from "../../ui/use-overlay";
import { inOneUndoStep } from "../undo-step";
import { describePreviewEffect, useLivePreviewEffect } from "./EffectLine";
import { useFinancialRevision } from "./FinancialUi";

export interface CommandBarProps {
  bridge: FinancialBridgeApi;
  today: string;
  onClose: () => void;
  /** Where the focus goes on close when the element that opened the bar is gone. */
  fallbackFocus?: () => HTMLElement | null;
}

function suggestionAmount(item: FinancialItem): string {
  if ("amount" in item) {
    return `${item.kind === "income" ? "+" : "−"}${formatMoneyWhole(item.amount)}`;
  }
  return "";
}

/** One thing Enter (or a click) can do with the sentence. */
export interface CommandOption {
  id: string;
  label: string;
  /** What-if on the lane while this option is the one in view. */
  preview: FinancialPreview;
  /** Applies it; returns the announcement (or null when nothing changed). */
  apply: (bridge: FinancialBridgeApi, effect: PreviewEffect | null) => string | null;
  /** Closes the bar after applying (default true). */
  closes?: boolean;
}

export interface CommandPlan {
  /** Shown above the options ("Gasto · Renta · $8,000 · cada mes, día 1…"). */
  summary: string | null;
  /** A notice that needs attention ("Ya pasó…", "Supuse: tipo"). */
  warning: string | null;
  /** Fields that were defaulted (shown as a quiet hint). */
  assumed: string[];
  options: CommandOption[];
  /** Index of the option Enter applies; -1 = a choice is required. */
  defaultIndex: number;
}

function withCash(doc: FinancialDocument, cash: number): FinancialDocument {
  return { ...doc, initialCash: cash };
}

function withItem(doc: FinancialDocument, item: FinancialItem): FinancialDocument {
  return { ...doc, items: doc.items.map((other) => (other.id === item.id ? item : other)) };
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function cashChange(before: number, after: number): string {
  return `Liquidez hoy ${formatMoneyWhole(before)} → ${formatMoneyWhole(after)}`;
}

function addOption(id: string, label: string, parsed: ParsedCommand, item: FinancialItem): CommandOption {
  return {
    id,
    label,
    preview: { kind: "add", item },
    apply: (bridge, effect) => {
      bridge.setPreview(null);
      bridge.addItem({ ...item, id: "" } as FinancialItem);
      const what = parsed.summary;
      return effect ? `Agregado: ${what}. ${describePreviewEffect(effect)}` : `Agregado: ${what}`;
    },
  };
}

function cashOption(id: string, label: string, doc: FinancialDocument, cash: number, why: string): CommandOption {
  const before = doc.initialCash;
  const after = roundCents(cash);
  return {
    id,
    label,
    preview: { kind: "document", doc: withCash(doc, after) },
    apply: (bridge) => {
      if (Math.abs(after - bridge.getDocument().initialCash) < 0.005) return null;
      bridge.setPreview(null);
      bridge.setInitialCash(after);
      return `${why}. ${cashChange(before, after)}`;
    },
  };
}

/**
 * What the bar offers for an intent (pure; exported for tests). `doc` is the
 * current plan.
 */
export function planCommand(intent: CommandIntent, doc: FinancialDocument): CommandPlan {
  if (intent.type === "balance") {
    return {
      summary: `Tu saldo de hoy: ${formatMoneyWhole(intent.amount)} · ${cashChange(doc.initialCash, intent.amount)}`,
      warning: null,
      assumed: [],
      options: [cashOption("balance", "Fijar mi liquidez de hoy", doc, intent.amount, "Liquidez de hoy actualizada")],
      defaultIndex: 0,
    };
  }

  if (intent.type === "card-payment") {
    const card = doc.items.find((item) => item.id === intent.cardId);
    if (!card || card.kind !== "credit-card") {
      return { summary: null, warning: "No encontré esa tarjeta en tu plan.", assumed: [], options: [], defaultIndex: -1 };
    }
    const nextBalance = roundCents(Math.max(0, card.balance - intent.amount));
    const nextCash = roundCents(doc.initialCash - intent.amount);
    const paid = { ...card, balance: nextBalance };
    const balanceText = `saldo de ${card.name} ${formatMoneyWhole(card.balance)} → ${formatMoneyWhole(nextBalance)}`;
    const both: CommandOption = {
      id: "card-both",
      label: "Bajar saldo y liquidez",
      preview: { kind: "document", doc: withItem(withCash(doc, nextCash), paid) },
      apply: (bridge) => {
        bridge.setPreview(null);
        inOneUndoStep(bridge.core, () => {
          bridge.setInitialCash(nextCash);
          const current = bridge.getItem(card.id);
          if (current && current.kind === "credit-card") bridge.replaceItem({ ...current, balance: nextBalance });
        });
        return `Abono a ${card.name}: ${balanceText} · ${cashChange(doc.initialCash, nextCash)}`;
      },
    };
    const onlyBalance: CommandOption = {
      id: "card-balance",
      label: "Solo el saldo (ya no está en mi liquidez)",
      preview: { kind: "document", doc: withItem(doc, paid) },
      apply: (bridge) => {
        bridge.setPreview(null);
        const current = bridge.getItem(card.id);
        if (!current || current.kind !== "credit-card") return null;
        bridge.replaceItem({ ...current, balance: nextBalance });
        return `Abono a ${card.name}: ${balanceText}`;
      },
    };
    return {
      summary: `Abono a ${card.name} ${formatMoneyWhole(intent.amount)}${
        intent.date === doc.startDate ? " hoy" : ` el ${formatDateShort(intent.date)}`
      } · ${balanceText}`,
      warning: null,
      assumed: [],
      options: [both, onlyBalance],
      defaultIndex: 0,
    };
  }

  const { parsed, past, needsKind } = intent;
  const item = parsed.item;
  const amount = "amount" in item ? item.amount : 0;
  const assumed = parsed.assumed.filter((field) => field !== "tipo");

  // UX-01 (the editor's rule): a card with a balance and $0 a month is never
  // paid off — not added without a payment or an explicit choice.
  if (item.kind === "credit-card" && cardNeverPaidOff(item)) {
    const totalero: FinancialItem = { ...item, paymentMode: "statement" };
    return {
      summary: parsed.summary,
      warning:
        "Con $0 al mes esta tarjeta no se liquida. Escribe cuánto pagas (“… pago 2000 al mes”) o elige:",
      assumed,
      options: [
        addOption("card-statement", "Pago el total cada mes (totalero)", { ...parsed, summary: `${parsed.summary} · totalero` }, totalero),
        addOption("card-unpaid", "Agregarla sin pago (no se liquida)", parsed, item),
      ],
      defaultIndex: -1,
    };
  }

  if (needsKind && (item.kind === "expense" || item.kind === "income")) {
    const asIncome: FinancialItem = { ...item, kind: "income" };
    const asExpense: FinancialItem = { ...item, kind: "expense" };
    const options: CommandOption[] = past
      ? [
          cashOption("past-expense", "Gasto: restarlo de mi liquidez", doc, doc.initialCash - amount, "Descontado de tu liquidez"),
          cashOption("past-income", "Ingreso: sumarlo a mi liquidez", doc, doc.initialCash + amount, "Sumado a tu liquidez"),
          cashOption("kind-balance", "Es mi saldo de hoy", doc, amount, "Liquidez de hoy actualizada"),
        ]
      : [
          addOption("kind-expense", "Gasto", { ...parsed, summary: parsed.summary }, asExpense),
          addOption("kind-income", "Ingreso", { ...parsed, summary: parsed.summary.replace(/^Gasto/, "Ingreso") }, asIncome),
          cashOption("kind-balance", "Es mi saldo de hoy", doc, amount, "Liquidez de hoy actualizada"),
        ];
    return {
      summary: `${formatMoneyWhole(amount)}${past ? ` el ${formatDateShort(item.recurrence.startDate)}` : ""} · ¿qué es?`,
      warning: "No sé si es un gasto, un ingreso o tu saldo: elige uno (o escríbelo: “gasto …”, “ingreso …”).",
      assumed,
      options,
      defaultIndex: -1,
    };
  }

  if (past) {
    const when = formatDateShort(item.recurrence.startDate);
    let first: CommandOption;
    if (item.kind === "card-purchase") {
      const card = doc.items.find((other) => other.id === item.cardId);
      if (card && card.kind === "credit-card") {
        const next = roundCents(card.balance + item.amount);
        first = {
          id: "past-card",
          label: `Sumarlo al saldo de ${card.name}`,
          preview: { kind: "document", doc: withItem(doc, { ...card, balance: next }) },
          apply: (bridge) => {
            bridge.setPreview(null);
            const current = bridge.getItem(card.id);
            if (!current || current.kind !== "credit-card") return null;
            bridge.replaceItem({ ...current, balance: roundCents(current.balance + item.amount) });
            return `Sumado al saldo de ${card.name}: ${formatMoneyWhole(card.balance)} → ${formatMoneyWhole(next)}`;
          },
        };
      } else {
        first = addOption("past-record", "Anotarlo igual", parsed, item);
      }
    } else {
      const sign = item.kind === "income" ? 1 : -1;
      first = cashOption(
        "past-discount",
        sign > 0 ? "Sumarlo a mi liquidez" : "Descontarlo de mi liquidez",
        doc,
        doc.initialCash + sign * amount,
        sign > 0 ? "Sumado a tu liquidez" : "Descontado de tu liquidez",
      );
    }
    const options = first.id === "past-record" ? [first] : [first, addOption("past-record", "Anotarlo igual", parsed, item)];
    return {
      summary: parsed.summary,
      warning: `Ya pasó (${when}): tu liquidez de hoy ya debería incluirlo.`,
      assumed,
      options,
      defaultIndex: 0,
    };
  }

  return {
    summary: parsed.summary,
    warning: null,
    assumed,
    options: [addOption("add", "Agregar", parsed, item)],
    defaultIndex: 0,
  };
}

function suggestionOption(suggestion: YearSuggestion): CommandOption {
  return {
    id: `suggestion:${suggestion.id}`,
    label: suggestion.title,
    preview: { kind: "add", item: suggestion.item },
    apply: (bridge, effect) => {
      bridge.setPreview(null);
      bridge.addItem({ ...suggestion.item, id: "" } as FinancialItem);
      const what = `${suggestion.title} ${suggestionAmount(suggestion.item)} el ${formatDateShort(suggestion.item.recurrence.startDate)}`;
      return effect ? `Agregado: ${what}. ${describePreviewEffect(effect)}` : `Agregado: ${what}`;
    },
    closes: false,
  };
}

const EXAMPLES = "renta 8000 el 1 · sueldo 9000 quincenal · tengo 11400 en el banco · pagué la tarjeta 3000";

export function CommandBar({ bridge, today, onClose, fallbackFocus }: CommandBarProps) {
  const revision = useFinancialRevision(bridge);
  const announce = useAnnounce();
  const [text, setText] = React.useState("");
  const [selected, setSelected] = React.useState(0);
  // The option under the pointer / with the focus (its preview wins).
  const [inView, setInView] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const optionsRef = React.useRef<HTMLDivElement | null>(null);
  // Always fully on screen (phones: the bar is wider than the window).
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  useFitInViewport(rootRef, true);
  useOverlay({
    open: true,
    onClose,
    kind: "popover",
    containerRef: rootRef,
    initialFocusRef: inputRef,
    fallbackFocus,
  });

  const doc = React.useMemo(() => bridge.getDocument(), [bridge, revision]);
  const intent = React.useMemo(
    () => (text.trim() ? interpretCommand(text, { today, doc }) : null),
    [text, today, doc],
  );
  const plan = React.useMemo(() => (intent ? planCommand(intent, doc) : null), [intent, doc]);
  const suggestions = React.useMemo<YearSuggestion[]>(
    () => (text.trim() ? [] : suggestMexicanYear(doc)),
    [text, doc],
  );
  const completion = React.useMemo(
    () => (text && !text.endsWith(" ") ? completeCommand(text) : null),
    [text],
  );
  const highlighted = suggestions[Math.min(selected, suggestions.length - 1)] ?? null;
  const highlightedOption = React.useMemo(
    () => (highlighted ? suggestionOption(highlighted) : null),
    [highlighted],
  );

  const options = plan?.options ?? [];
  const defaultOption = plan && plan.defaultIndex >= 0 ? (options[plan.defaultIndex] ?? null) : null;
  const shownOption =
    options.find((option) => option.id === inView) ?? defaultOption ?? (text.trim() ? null : highlightedOption);

  // Live what-if on the money lane (cleared on close) and its effect: at
  // once, on every keystroke (the sentence is short and parsed as you type).
  const preview = shownOption?.preview ?? null;
  const effect = useLivePreviewEffect(bridge, preview, { delayMs: 0 });

  const commit = (option: CommandOption) => {
    const message = option.apply(bridge, effect);
    if (message) announce({ message, undo: () => bridge.core.undo() });
    if (option.closes === false) {
      setSelected(0);
      setInView(null);
      return;
    }
    onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Tab" && !event.shiftKey) {
      if (completion) {
        event.preventDefault();
        setText(text + completion);
        return;
      }
      if (!text.trim() && highlightedOption) {
        event.preventDefault();
        commit(highlightedOption);
      }
      // Otherwise Tab moves on (to the options).
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
      if (defaultOption) {
        commit(defaultOption);
      } else if (plan && options.length > 0) {
        // A choice is required: take the person to it.
        optionsRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
      } else if (!text.trim() && highlightedOption) {
        commit(highlightedOption);
      }
    }
  };

  const ghost = !text && highlighted
    ? `${highlighted.title} ${suggestionAmount(highlighted.item)} el ${formatDateShort(highlighted.item.recurrence.startDate)}`
    : null;
  const parsedKind =
    intent?.type === "item" && !intent.needsKind ? intent.parsed.item.kind : null;
  const keyHint = defaultOption ? "Enter" : ghost ? "Tab" : "Esc";
  const examplesId = React.useId();

  return (
    <div
      ref={rootRef}
      className="fin-command"
      role="dialog"
      aria-label="Escribir un movimiento"
    >
      <div className="fin-command__field">
        <span className="fin-command__slash" aria-hidden="true">/</span>
        <div className="fin-command__input-wrap">
          <input
            ref={inputRef}
            className="fin-command__input"
            value={text}
            placeholder={ghost ? "" : "Escribe qué y cuánto"}
            aria-label="Movimiento"
            aria-describedby={!text ? examplesId : undefined}
            spellCheck={false}
            autoComplete="off"
            onChange={(event) => {
              setText(event.target.value);
              setSelected(0);
              setInView(null);
            }}
            onKeyDown={onKeyDown}
          />
          <span className="fin-command__ghost" aria-hidden="true">
            <span className="fin-command__ghost-typed">{text}</span>
            {completion ?? ""}
            {ghost ?? ""}
          </span>
        </div>
        <kbd className="fin-command__key">{keyHint}</kbd>
      </div>

      {!text ? (
        <p id={examplesId} className="fin-command__examples">
          <span className="fin-command__examples-label">Ejemplos:</span> {EXAMPLES}
        </p>
      ) : null}

      {plan ? (
        <div className="fin-command__result">
          <span
            className="fin-command__dot"
            style={{ background: parsedKind ? KIND_COLORS[parsedKind] : "var(--muted)" }}
            aria-hidden="true"
          />
          <div className="fin-command__summary">
            {plan.summary ? <span className="fin-command__what">{plan.summary}</span> : null}
            {plan.warning ? (
              <span className="fin-command__warning" role="note">
                {plan.warning}
              </span>
            ) : null}
            {plan.assumed.length > 0 ? (
              <span className="fin-command__assumed">Supuse: {plan.assumed.join(", ")}</span>
            ) : null}
          </div>
        </div>
      ) : text.trim() ? (
        <p className="fin-command__empty">{explainNoAmount(text)}</p>
      ) : null}

      {effect && preview ? (
        <p className="fin-command__effect" data-tone={effect.tone}>
          {effect.text}
        </p>
      ) : null}

      {options.length > 0 ? (
        <div
          ref={optionsRef}
          className="fin-command__options"
          role="group"
          aria-label={plan?.defaultIndex === -1 ? "Elige qué es" : "Qué hacer"}
          onMouseLeave={() => setInView(null)}
        >
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              className={
                index === plan?.defaultIndex
                  ? "fin-command__option fin-command__option--primary"
                  : "fin-command__option"
              }
              onMouseEnter={() => setInView(option.id)}
              onFocus={() => setInView(option.id)}
              onBlur={() => setInView((current) => (current === option.id ? null : current))}
              onClick={() => commit(option)}
            >
              {option.label}
              {index === plan?.defaultIndex ? (
                <kbd className="fin-command__key" aria-hidden="true">Enter</kbd>
              ) : null}
            </button>
          ))}
        </div>
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
                  commit(suggestionOption(suggestion));
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

