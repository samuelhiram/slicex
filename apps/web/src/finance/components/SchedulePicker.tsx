// THE way to say how often something happens, everywhere a schedule is
// asked (the item editor's "Cuándo" block, the onboarding's pay):
//
//   [Una vez] [Cada semana] [Cada quincena] [Cada mes] [Cada año] [Personalizado…]
//                                      Personalizado → Cada [N] [días | meses]
//
// The common schedules are one click (like a calendar app's "Repetir");
// anything else is "cada N días / meses". The model side is schedule-ui.ts
// (frequencyParts / withFrequencyParts / SCHEDULE_PRESETS).
//
// Keyboard: a radio group — Tab lands on the chosen option, the arrows
// move AND choose (wrapping), Home / End jump to the ends.
import * as React from "react";
import {
  presetOf,
  SCHEDULE_PRESETS,
  type FrequencyUnit,
} from "../schedule-ui";
import { useEditableText } from "./form-kit";

// "Cada N": a number field the person can clear while typing (the rule only
// takes whole numbers >= 1; leaving it empty restores the rule's).
function EveryInput({
  value,
  unit,
  onChange,
}: {
  value: number;
  unit: "days" | "months";
  onChange: (every: number) => void;
}) {
  const { text, setText, emit } = useEditableText(value, String);
  return (
    <input
      type="number"
      inputMode="numeric"
      min={1}
      step={1}
      className="fin-repeat__every"
      aria-label={unit === "days" ? "Cada cuántos días" : "Cada cuántos meses"}
      value={text}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const n = Math.floor(Number(raw));
        if (raw.trim() !== "" && Number.isFinite(n) && n >= 1 && emit(n)) onChange(n);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

export function SchedulePicker({
  labelledBy,
  unit,
  every,
  allowOnce = true,
  onChange,
}: {
  /** id of the element that names the group ("Se repite"). */
  labelledBy: string;
  unit: FrequencyUnit;
  every: number;
  /** "Una vez" offered (false for a pay, which always repeats). */
  allowOnce?: boolean;
  onChange: (unit: FrequencyUnit, every: number) => void;
}) {
  const presets = allowOnce ? SCHEDULE_PRESETS : SCHEDULE_PRESETS.filter((p) => p.unit !== "once");
  const matched = presetOf({ unit, every });
  // "Personalizado" stays open once chosen, even if the numbers happen to
  // match a preset (typing 1 → "Cada mes" must not collapse the fields).
  const [customOpen, setCustomOpen] = React.useState(matched === null);
  const custom = customOpen || matched === null;
  const counted: "days" | "months" = unit === "days" ? "days" : "months";

  // Every option of the group, in order: the presets, then "Personalizado…".
  const options = [
    ...presets.map((preset) => ({
      id: preset.id,
      label: preset.label,
      checked: !custom && matched?.id === preset.id,
      choose: () => {
        setCustomOpen(false);
        onChange(preset.unit, preset.every);
      },
    })),
    {
      id: "custom",
      label: "Personalizado…",
      checked: custom,
      choose: () => {
        setCustomOpen(true);
        // From a schedule that isn't "cada N" (una vez, quincena): start
        // at "cada 2 meses", the first thing no preset says.
        if (unit !== "days" && unit !== "months") onChange("months", 2);
      },
    },
  ];
  const checkedIndex = Math.max(
    0,
    options.findIndex((option) => option.checked),
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const from = buttons.indexOf(event.target as HTMLButtonElement);
    if (from < 0) return;
    const last = buttons.length - 1;
    let to: number;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowDown":
        to = from === last ? 0 : from + 1;
        break;
      case "ArrowLeft":
      case "ArrowUp":
        to = from === 0 ? last : from - 1;
        break;
      case "Home":
        to = 0;
        break;
      case "End":
        to = last;
        break;
      default:
        return;
    }
    event.preventDefault();
    options[to]!.choose();
    buttons[to]!.focus();
  };

  return (
    <div className="fin-repeat">
      <div
        className="fin-repeat__presets"
        role="radiogroup"
        aria-labelledby={labelledBy}
        onKeyDown={onKeyDown}
      >
        {options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.checked}
            tabIndex={index === checkedIndex ? 0 : -1}
            className="fin-repeat__preset"
            data-checked={option.checked ? "true" : undefined}
            onClick={option.choose}
          >
            {option.label}
          </button>
        ))}
      </div>
      {custom ? (
        <div className="fin-repeat__custom">
          <span className="fin-repeat__word">Cada</span>
          <EveryInput value={every} unit={counted} onChange={(n) => onChange(counted, n)} />
          <select
            className="fin-repeat__unit"
            aria-label="Unidad"
            value={counted}
            onChange={(event) => onChange(event.target.value as FrequencyUnit, every)}
          >
            <option value="days">{every === 1 ? "día" : "días"}</option>
            <option value="months">{every === 1 ? "mes" : "meses"}</option>
          </select>
        </div>
      ) : null}
    </div>
  );
}
