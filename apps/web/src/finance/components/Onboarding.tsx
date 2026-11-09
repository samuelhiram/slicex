// "Tu año en 60 segundos": the first visit shows an example year with a
// banner; "Empezar" asks three things (cash today, how you get paid, the
// cushion you want to keep) plus optional fixed expenses, and builds YOUR
// year — with the Mexican year's suggestions (aguinaldo, Buen Fin…) if
// wanted. No foreign demo left behind.
import * as React from "react";
import {
  addDays,
  daysInMonth,
  suggestMexicanYear,
  type FinancialDocument,
  type FinancialItem,
  type ISODate,
  type RecurrenceFrequency,
} from "@slicex/core";
import { formatDateWeekday, parseDateInput } from "../format";
import { parseNumberInput } from "./FinancialUi";

export function WelcomeBanner({
  onStart,
  onDismiss,
}: {
  onStart: () => void;
  onDismiss: () => void;
}) {
  return (
    <section className="fin-banner" aria-label="Bienvenida">
      <div className="fin-banner__text">
        <strong>Este es un año de ejemplo.</strong> ¿Armamos el tuyo? Toma 60 segundos.
      </div>
      <button type="button" className="fin-button fin-button--primary" onClick={onStart}>
        Empezar
      </button>
      <button
        type="button"
        className="fin-icon-button"
        aria-label="Seguir viendo el ejemplo"
        title="Seguir viendo el ejemplo"
        onClick={onDismiss}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M5 5l10 10M15 5 5 15" />
        </svg>
      </button>
    </section>
  );
}

const PAY_OPTIONS: ReadonlyArray<{ value: RecurrenceFrequency; label: string }> = [
  { value: "semimonthly", label: "Quincenal (el 15 y fin de mes)" },
  { value: "monthly", label: "Mensual" },
  { value: "biweekly", label: "Cada 14 días" },
  { value: "weekly", label: "Semanal" },
];

interface FixedRow {
  name: string;
  amount: string;
  day: string;
}

const EMPTY_ROWS: FixedRow[] = [
  { name: "Renta", amount: "", day: "1" },
  { name: "", amount: "", day: "" },
  { name: "", amount: "", day: "" },
];

/** Next date ≥ today whose day-of-month is `day` (clamped to the month). */
export function nextDayOfMonth(today: ISODate, day: number): ISODate {
  let year = Number(today.slice(0, 4));
  let month = Number(today.slice(5, 7));
  for (let i = 0; i < 2; i += 1) {
    const clamped = Math.min(Math.max(1, Math.round(day)), daysInMonth(year, month));
    const date = `${year}-${String(month).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
    if (date >= today) return date;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return today;
}

export interface OnboardingAnswers {
  cash: number;
  frequency: RecurrenceFrequency;
  pay: number;
  nextPay: ISODate;
  reserve: number;
  fixed: Array<{ name: string; amount: number; day: number }>;
  withSuggestions: boolean;
}

/** The plan built from the answers (pure; exported for tests). */
export function buildYear(today: ISODate, answers: OnboardingAnswers): FinancialDocument {
  const items: FinancialItem[] = [];
  if (answers.pay > 0) {
    items.push({
      id: "mi-sueldo",
      kind: "income",
      name: "Sueldo",
      amount: answers.pay,
      recurrence:
        answers.frequency === "semimonthly"
          ? { frequency: "semimonthly", startDate: today }
          : {
              frequency: answers.frequency,
              startDate: today,
              anchorDate: answers.nextPay,
            },
    });
  }
  answers.fixed.forEach((row, index) => {
    if (!row.name.trim() || !(row.amount > 0)) return;
    const first = nextDayOfMonth(today, row.day || 1);
    items.push({
      id: `mi-fijo-${index + 1}`,
      kind: "expense",
      name: row.name.trim(),
      amount: row.amount,
      recurrence: { frequency: "monthly", startDate: first },
    });
  });
  const doc: FinancialDocument = {
    id: "mi-ano",
    name: "Mi año",
    startDate: today,
    initialCash: answers.cash,
    minimumCashReserve: Math.max(0, answers.reserve),
    horizonMonths: 12,
    items,
  };
  if (answers.withSuggestions) {
    for (const suggestion of suggestMexicanYear(doc)) items.push(suggestion.item);
  }
  return doc;
}

export function OnboardingDialog({
  today,
  onCreate,
  onClose,
}: {
  today: ISODate;
  onCreate: (doc: FinancialDocument) => void;
  onClose: () => void;
}) {
  const [cash, setCash] = React.useState("");
  const [frequency, setFrequency] = React.useState<RecurrenceFrequency>("semimonthly");
  const [pay, setPay] = React.useState("");
  const [nextPay, setNextPay] = React.useState("");
  const [reserve, setReserve] = React.useState("");
  const [rows, setRows] = React.useState<FixedRow[]>(EMPTY_ROWS);
  const [withSuggestions, setWithSuggestions] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const firstRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    firstRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parsedNextPay = nextPay.trim() ? parseDateInput(nextPay, today) : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const cashValue = parseNumberInput(cash);
    const payValue = parseNumberInput(pay);
    if (cashValue === null || !Number.isFinite(cashValue)) {
      setError("Escribe cuánto dinero tienes hoy (puede ser 0).");
      return;
    }
    if (payValue === null || !Number.isFinite(payValue) || payValue < 0) {
      setError("Escribe cuánto te pagan cada vez.");
      return;
    }
    const reserveValue = reserve.trim() ? parseNumberInput(reserve) : payValue;
    const fixed = rows
      .map((row) => ({
        name: row.name,
        amount: parseNumberInput(row.amount) ?? 0,
        day: Number(row.day) || 1,
      }))
      .filter((row) => row.name.trim() && Number.isFinite(row.amount) && row.amount > 0);
    onCreate(
      buildYear(today, {
        cash: cashValue,
        frequency,
        pay: payValue,
        nextPay: parsedNextPay ?? addDays(today, frequency === "weekly" ? 7 : 14),
        reserve: reserveValue !== null && Number.isFinite(reserveValue) ? reserveValue : payValue,
        fixed,
        withSuggestions,
      }),
    );
  };

  return (
    <div className="playlist-shell__modal-overlay" role="presentation">
      <form
        className="playlist-shell__modal fin-onboarding"
        role="dialog"
        aria-modal="true"
        aria-label="Tu año en 60 segundos"
        onSubmit={submit}
      >
        <header className="playlist-shell__modal-header">
          <strong className="fin-editor__title">Tu año en 60 segundos</strong>
          <button type="button" className="playlist-shell__modal-close" aria-label="Cerrar" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="playlist-shell__modal-body fin-editor__body">
          <div className="fin-editor__grid">
            <label className="fin-editor__field fin-editor__field--wide">
              <span className="fin-editor__label">¿Cuánto dinero tienes hoy?</span>
              <input
                ref={firstRef}
                type="text"
                inputMode="decimal"
                placeholder="$12,000"
                value={cash}
                onChange={(event) => setCash(event.target.value)}
              />
            </label>
            <label className="fin-editor__field">
              <span className="fin-editor__label">¿Cómo te pagan?</span>
              <select
                value={frequency}
                onChange={(event) => setFrequency(event.target.value as RecurrenceFrequency)}
              >
                {PAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fin-editor__field">
              <span className="fin-editor__label">¿Cuánto cada vez?</span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="$9,000"
                value={pay}
                onChange={(event) => setPay(event.target.value)}
              />
            </label>
            {frequency !== "semimonthly" ? (
              <label className="fin-editor__field fin-editor__field--wide">
                <span className="fin-editor__label">¿Cuándo es tu próximo pago?</span>
                <input
                  type="text"
                  placeholder="dd/mm/aaaa"
                  value={nextPay}
                  aria-invalid={nextPay.trim() !== "" && parsedNextPay === null}
                  onChange={(event) => setNextPay(event.target.value)}
                />
                <span className="fin-date__preview" data-state={parsedNextPay ? "ok" : undefined}>
                  {parsedNextPay ? formatDateWeekday(parsedNextPay) : ""}
                </span>
              </label>
            ) : null}
            <label className="fin-editor__field fin-editor__field--wide">
              <span className="fin-editor__label">
                ¿Cuánto quieres tener siempre de colchón?{" "}
                <em className="fin-editor__optional">(si lo dejas vacío: un pago)</em>
              </span>
              <input
                type="text"
                inputMode="decimal"
                placeholder={pay ? pay : "$5,000"}
                value={reserve}
                onChange={(event) => setReserve(event.target.value)}
              />
            </label>
          </div>

          <p className="fin-onboarding__label">
            Gastos fijos <em className="fin-editor__optional">(opcional)</em>
          </p>
          <div className="fin-onboarding__rows">
            {rows.map((row, index) => (
              <div key={index} className="fin-onboarding__row">
                <input
                  type="text"
                  aria-label={`Gasto fijo ${index + 1}`}
                  placeholder={index === 0 ? "Renta" : index === 1 ? "Internet" : "Colegiatura"}
                  value={row.name}
                  onChange={(event) =>
                    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, name: event.target.value } : r)))
                  }
                />
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={`Monto del gasto ${index + 1}`}
                  placeholder="$0"
                  value={row.amount}
                  onChange={(event) =>
                    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, amount: event.target.value } : r)))
                  }
                />
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={`Día del mes del gasto ${index + 1}`}
                  placeholder="día"
                  value={row.day}
                  onChange={(event) =>
                    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, day: event.target.value } : r)))
                  }
                />
              </div>
            ))}
          </div>

          <label className="fin-editor__check fin-onboarding__check">
            <input
              type="checkbox"
              checked={withSuggestions}
              onChange={(event) => setWithSuggestions(event.target.checked)}
            />
            Agregar el año mexicano: aguinaldo, Buen Fin, predial, regreso a clases
          </label>

          <p className="fin-editor__error" role="alert">
            {error ?? ""}
          </p>
          <div className="fin-editor__actions">
            <span className="fin-editor__actions-spacer" />
            <button type="button" className="fin-editor__button" onClick={onClose}>
              Seguir con el ejemplo
            </button>
            <button type="submit" className="fin-editor__button fin-editor__button--primary">
              Crear mi año
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
