// The records panel, right of the timeline (about a quarter of the screen):
// every money record in one place, open by default on "Gastos del mes".
// The header's records button (F) folds / unfolds it; folded, it is not
// mounted.
//
// - "Lo que pasó": the movements recorded by hand ("Registrar") plus what
//   the plan assumed happened since each visit (Rec's ledger), grouped by
//   day, newest first. Nothing is ever lost to the timeline moving on: a
//   one-time expense of months ago is here, with its time, concept and
//   notes. Filters: text (concept, category, notes, amount), kind, period,
//   card; the category chips carry their totals (click again: all).
// - "En tu plan": the plan's objects by kind (Ingresos, Gastos, Préstamos,
//   Tarjetas, MSI) with quick adjustments in place — the amount (Enter
//   saves, one undo step), counts or not, show it on the timeline, open the
//   editor.
//
// Not a dialog: it sits BESIDE the stage (the canvas follows its width via
// the renderer's ResizeObserver) and stays while a form opens on top
// (inert then, like the stage). Read-only views of the bridge and the
// futures: React follows their revisions (useSyncExternalStore) and every
// list is derived once per change (useMemo). The history list (memo) only
// renders again when the journal, the filters or the card names change —
// never on a plan edit that does not touch them.
import * as React from "react";
import { MoneySchema } from "@slicex/contracts";
import {
  filterMovements,
  summarizeMovements,
  totalsByCategory,
  UNCATEGORIZED,
  usedCategories,
  type FinancialItem,
  type ISODate,
  type Movement,
  type MovementKind,
} from "@slicex/core";
import type { FinancialBridgeApi } from "../bridge-api";
import type { Futures } from "../futures";
import { formatDateShort, formatMoneyWhole, formatSignedMoneyWhole } from "../format";
import { frequencyShort, KIND_COLORS, KIND_LABELS } from "../labels";
import {
  dayLabel,
  groupByDay,
  historyRows,
  nextDates,
  PERIOD_OPTIONS,
  periodRange,
  viewRange,
  withPeriod,
  PLAN_TABS,
  planAmountOf,
  planCards,
  planTabFor,
  recordsTitle,
  withPlanAmount,
  type DayGroup,
  type HistoryRow,
  type PeriodPreset,
  type PlanTab,
  type SearchView,
} from "../movements-ui";
import { scheduleSummary } from "../schedule-ui";
import { useAnnounce } from "../../ui/announcer";
import { Select } from "../../ui/select";
import { InlineNumberInput } from "./FinancialUi";
import { RecordsDateBar } from "./RecordsDateBar";

/** The panel's id: the header button controls it (aria-controls). */
export const RECORDS_PANEL_ID = "fin-records";

export interface MovementsPanelProps {
  bridge: FinancialBridgeApi;
  futures: Futures;
  today: ISODate;
  view: SearchView;
  onViewChange: (view: SearchView) => void;
  /** Fold the panel (its × / the header button). */
  onFold: () => void;
  /** "Registrar" from an empty list (the capture opens on top). */
  onRecord: (kind: MovementKind) => void;
  /** Edit a recorded movement. */
  onEditMovement: (movement: Movement) => void;
  /** Open the plan's editor on an item. */
  onEditItem: (itemId: string) => void;
  /** Show the item on the timeline (selected, scrolled into view). */
  onRevealItem: (itemId: string) => void;
  /** A form is open on top: nothing here takes the focus or the keys. */
  inert?: boolean;
  /** The search box (F focuses it). */
  queryRef?: React.Ref<HTMLInputElement>;
}

const SOURCE_LABELS: Readonly<Record<HistoryRow["source"], string>> = {
  registered: "",
  plan: "Del plan",
  adjustment: "Ajuste",
};

const AMOUNT_LABELS: Readonly<Record<PlanTab, string>> = {
  income: "Monto",
  expense: "Monto",
  loan: "Pago",
  card: "Saldo o cargo",
  msi: "Total",
};

const PLAN_NOUNS: Readonly<Record<PlanTab, [one: string, many: string]>> = {
  income: ["ingreso", "ingresos"],
  expense: ["gasto", "gastos"],
  loan: ["préstamo", "préstamos"],
  card: ["tarjeta o cargo", "tarjetas y cargos"],
  msi: ["compra a meses", "compras a meses"],
};

const SECTIONS = ["history", "plan"] as const;
type Section = (typeof SECTIONS)[number];

/** "Cada mes, día 1" / "Una vez, 15 nov" / "Saldo · corte 5 · paga 15" / "6 meses (2 pagados)". */
function cadenceOf(item: FinancialItem, cardName: (id: string) => string | undefined): string {
  switch (item.kind) {
    case "credit-card":
      return `Saldo · corte ${item.cutDay} · paga ${item.dueDay}${item.paymentMode === "statement" ? " · totalero" : ""}`;
    case "installment-plan":
      return `${item.installmentsTotal} meses (${item.installmentsPaid} pagados)`;
    case "card-purchase": {
      const card = cardName(item.cardId);
      const where = card ? ` en ${card}` : "";
      return item.recurrence.frequency === "once"
        ? `Cargo único${where}, ${formatDateShort(item.recurrence.startDate)}`
        : `${scheduleSummary(item.recurrence)}${where}`;
    }
    default:
      return item.recurrence.frequency === "once"
        ? `Una vez, ${formatDateShort(item.recurrence.startDate)}`
        : scheduleSummary(item.recurrence) || frequencyShort(item.recurrence);
  }
}

/** "Hasta 1 jun" / "Sin fin" / "" (a one-time item: nothing to say). */
function endOf(item: FinancialItem): string {
  if (item.recurrence.frequency === "once" && item.kind !== "credit-card" && item.kind !== "installment-plan") {
    return "";
  }
  return item.recurrence.endDate ? `Hasta ${formatDateShort(item.recurrence.endDate)}` : "Sin fin";
}

function plural(count: number, [one, many]: readonly [string, string]): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The header's "Registrar gasto" while the panel is folded (open, the
 * panel has its own): the capture in one click, with what this month's
 * expenses add up to — the panel's default figure stays in sight.
 */
export function RecordMonthButton({
  futures,
  today,
  onRecord,
}: {
  futures: Futures;
  today: ISODate;
  onRecord: () => void;
}) {
  const version = React.useSyncExternalStore(futures.subscribe, futures.getVersion);
  const spent = React.useMemo(() => {
    const rows = historyRows(futures.getMovements(), futures.getLedger());
    return summarizeMovements(filterMovements(rows, { kind: "expense", ...periodRange("month", today) })).expenses;
    // The journal and the ledger only change with the futures' version.
  }, [futures, version, today]);
  return (
    <button
      type="button"
      className="fin-button fin-record"
      onClick={onRecord}
      title={`Registrar un gasto que ya pasó (G) · este mes llevas ${formatMoneyWhole(spent)}`}
      aria-keyshortcuts="G"
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M4 2.5h8v11l-2-1.2-2 1.2-2-1.2-2 1.2z" />
        <path d="M6 6h4M6 8.5h4" />
      </svg>
      <span className="fin-record__words">Registrar gasto</span>
      <span className="fin-record__month">
        <span className="fin-sr-only">, </span>este mes {formatMoneyWhole(spent)}
      </span>
    </button>
  );
}

export function MovementsPanel(props: MovementsPanelProps) {
  const { bridge, futures, today, view, onViewChange, onFold, onRecord, inert, queryRef } = props;
  const revision = React.useSyncExternalStore(bridge.subscribe, bridge.getRevision);
  const futuresVersion = React.useSyncExternalStore(futures.subscribe, futures.getVersion);
  const announce = useAnnounce();
  // Stable row handlers (the memoized lists don't render again when the
  // shell passes new arrows).
  const handlersRef = React.useRef(props);
  handlersRef.current = props;
  const editMovement = React.useCallback((movement: Movement) => handlersRef.current.onEditMovement(movement), []);

  const set = (patch: Partial<SearchView>) => onViewChange({ ...view, ...patch });
  const section: Section = view.tab === "history" ? "history" : "plan";
  const title = recordsTitle(view, today);
  // "Elegir fechas…" just chosen: the range calendar opens at once (once).
  const [rangeJustChosen, setRangeJustChosen] = React.useState(false);
  React.useEffect(() => {
    if (rangeJustChosen) setRangeJustChosen(false);
  }, [rangeJustChosen]);
  const choosePeriod = (period: PeriodPreset) => {
    if (period !== "range") {
      onViewChange(withPeriod(view, period));
      return;
    }
    // The range starts as what was on screen (this month so far by default).
    const current = viewRange(view, today);
    const to = current.to !== undefined && current.to < today ? current.to : today;
    const from = current.from !== undefined && current.from <= to ? current.from : `${today.slice(0, 7)}-01`;
    setRangeJustChosen(true);
    onViewChange(withPeriod(view, "range", from <= to ? from : to, to));
  };
  const doc = bridge.getDocument();
  const cards = React.useMemo(() => planCards(doc), [doc]);
  // Card names as one primitive: the history list follows renames, not every edit.
  const cardKey = cards.map((card) => `${card.id}\u0000${card.name}`).join("\u0001");
  const cardNames = React.useMemo(
    () => new Map(cards.map((card) => [card.id, card.name] as const)),
    // `cardKey` is what `cards` contributes.
    [cardKey],
  );

  // --- Lo que pasó
  const rows = React.useMemo(
    () => historyRows(futures.getMovements(), futures.getLedger()),
    // The journal and the ledger only change with the futures' version.
    [futures, futuresVersion],
  );
  const hasCategories = React.useMemo(() => usedCategories(rows).length > 0, [rows]);
  // Everything but the category: the chips keep showing every category
  // (with its total) while one is chosen.
  const base = React.useMemo(
    () =>
      filterMovements(rows, {
        query: view.query,
        kind: view.kind,
        ...viewRange(view, today),
        ...(view.paidWith ? { paidWith: view.paidWith } : {}),
      }),
    [rows, view.query, view.kind, view.period, view.from, view.to, view.paidWith, today],
  );
  const filtered = React.useMemo(
    () => (view.category ? filterMovements(base, { category: view.category }) : base),
    [base, view.category],
  );
  const totals = React.useMemo(() => summarizeMovements(filtered), [filtered]);
  const chipKind: MovementKind = view.kind === "income" ? "income" : "expense";
  const chips = React.useMemo(
    () => totalsByCategory(base.filter((row) => row.kind === chipKind)).slice(0, 8),
    [base, chipKind],
  );
  const groups = React.useMemo(() => groupByDay(filtered), [filtered]);

  // --- En tu plan
  const projection = bridge.getProjection();
  const upcoming = React.useMemo(() => nextDates(projection, today), [projection, today]);
  const planTab = view.tab === "history" ? null : PLAN_TABS.find((tab) => tab.id === view.tab)!;
  const planItems = React.useMemo(() => {
    if (!planTab) return [];
    const words = view.query
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    return doc.items.filter((item) => {
      if (!planTab.kinds.includes(item.kind)) return false;
      if (words.length === 0) return true;
      const name = item.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      return words.every((word) => name.includes(word));
    });
    // `revision` covers every document change.
  }, [doc, planTab, view.query, revision]);

  const toggleIncluded = (item: FinancialItem) => {
    if (bridge.isItemLocked(item.id)) {
      announce({ message: `${item.name} está en una línea bloqueada.` });
      return;
    }
    bridge.core.toggleClipMute(item.id);
    const excluded = bridge.getItem(item.id)?.enabled === false;
    announce({
      message: excluded ? `${item.name} ya no cuenta en tus cifras.` : `${item.name} vuelve a contar en tus cifras.`,
      undo: () => bridge.core.undo(),
    });
  };

  const commitAmount = (item: FinancialItem, amount: number) => {
    const current = bridge.getItem(item.id);
    if (!current) return;
    if (!bridge.replaceItem(withPlanAmount(current, amount))) {
      announce({ message: `${item.name} está en una línea bloqueada: no se cambió.` });
      return;
    }
    announce({
      message: `${item.name}: ${formatMoneyWhole(planAmountOf(current) ?? 0)} → ${formatMoneyWhole(amount)}`,
      undo: () => bridge.core.undo(),
    });
  };

  const titleId = React.useId();
  const listId = React.useId();
  const sectionRefs = React.useRef(new Map<Section, HTMLButtonElement>());
  const sectionTabId = (value: Section) => `${listId}-tab-${value}`;
  const goToSection = (value: Section) => {
    if (value === section) return;
    set(value === "history" ? { tab: "history" } : { tab: planTabFor(view.kind) });
  };
  const onSectionKeyDown = (event: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next: Section =
      event.key === "Home" ? "history" : event.key === "End" ? "plan" : section === "history" ? "plan" : "history";
    goToSection(next);
    sectionRefs.current.get(next)?.focus();
  };

  // The figure under the title: what the list adds up to.
  let figure: string | null = null;
  let caption = "";
  if (section === "history") {
    const count = totals.count === 0 ? "Sin movimientos" : plural(totals.count, ["movimiento", "movimientos"]);
    if (view.kind === "expense") {
      figure = formatMoneyWhole(totals.expenses);
      caption = count;
    } else if (view.kind === "income") {
      figure = formatMoneyWhole(totals.income);
      caption = count;
    } else {
      figure = formatSignedMoneyWhole(totals.net);
      caption = [count, `gastos ${formatMoneyWhole(totals.expenses)}`, `ingresos ${formatMoneyWhole(totals.income)}`].join(
        " · ",
      );
    }
    if (view.category) caption += ` en ${view.category}`;
  } else if (planTab) {
    const excluded = planItems.filter((item) => item.enabled === false).length;
    caption = plural(planItems.length, PLAN_NOUNS[planTab.id]) + (excluded > 0 ? ` · ${excluded} no cuenta${excluded === 1 ? "" : "n"}` : "");
  }
  const narrowed = view.query !== "" || view.category !== "" || view.paidWith !== "";

  return (
    <aside id={RECORDS_PANEL_ID} className="fin-records" aria-labelledby={titleId} inert={inert}>
      <header className="fin-records__header">
        <div className="fin-records__heading">
          <h2 id={titleId} className="fin-records__title">
            {title}
          </h2>
          {figure !== null ? (
            <p className="fin-records__figure" data-tone={view.kind === "all" && totals.net < 0 ? "negative" : undefined}>
              {figure}
            </p>
          ) : null}
          <p className="fin-records__caption" role="status" aria-live="polite">
            {caption}
          </p>
        </div>
        {/* The panel's one primary action: what just happened, in seconds. */}
        <button
          type="button"
          className="fin-button fin-button--primary fin-records__record"
          onClick={() => onRecord(chipKind)}
          title="Registrar un gasto o ingreso que ya pasó (G)"
          aria-keyshortcuts="G"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 3v10M3 8h10" />
          </svg>
          Registrar
        </button>
        <button
          type="button"
          className="fin-icon-button fin-records__fold"
          onClick={onFold}
          aria-label="Ocultar movimientos"
          title="Ocultar el panel (F lo vuelve a abrir)"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <rect x="3" y="4" width="14" height="12" rx="2" />
            <path d="M12 4v12M7 8.5 8.5 10 7 11.5" />
          </svg>
        </button>
      </header>

      <div className="fin-records__controls">
        <div className="playlist-shell__segmented fin-records__sections" role="tablist" aria-label="Qué ver" onKeyDown={onSectionKeyDown}>
          {SECTIONS.map((value) => (
            <button
              key={value}
              ref={(el) => {
                if (el) sectionRefs.current.set(value, el);
                else sectionRefs.current.delete(value);
              }}
              id={sectionTabId(value)}
              type="button"
              role="tab"
              className="playlist-shell__tool fin-records__section"
              aria-selected={section === value}
              aria-controls={listId}
              tabIndex={section === value ? 0 : -1}
              data-active={section === value}
              onClick={() => goToSection(value)}
            >
              {value === "history" ? "Lo que pasó" : "En tu plan"}
            </button>
          ))}
        </div>

        <input
          ref={queryRef}
          type="search"
          className="fin-records__query"
          value={view.query}
          onChange={(event) => set({ query: event.currentTarget.value })}
          placeholder={section === "history" ? "Buscar concepto, nota o monto…" : "Buscar por nombre…"}
          aria-label={section === "history" ? "Buscar por concepto, categoría, nota o monto" : "Buscar por nombre"}
        />

        {section === "history" ? (
          <div className="fin-records__filter-row">
            <div className="playlist-shell__segmented" role="group" aria-label="Tipo">
              {(["expense", "income", "all"] as const).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="playlist-shell__tool"
                  aria-pressed={view.kind === kind}
                  data-active={view.kind === kind}
                  onClick={() => set({ kind, category: "" })}
                >
                  {kind === "all" ? "Todo" : kind === "expense" ? "Gastos" : "Ingresos"}
                </button>
              ))}
            </div>
            <Select
              size="sm"
              className="fin-records__select"
              aria-label="Periodo"
              value={view.period === "today" ? "day" : view.period}
              onValueChange={(next) => choosePeriod(next as PeriodPreset)}
              options={PERIOD_OPTIONS}
            />
            {cards.length > 0 ? (
              <Select
                size="sm"
                className="fin-records__select"
                aria-label="Pagado con"
                value={view.paidWith}
                onValueChange={(next) => set({ paidWith: next })}
                options={[
                  { value: "", label: "Cualquier pago" },
                  { value: "cash", label: "Efectivo o débito" },
                  ...cards.map((card) => ({ value: card.id, label: card.name })),
                ]}
              />
            ) : null}
          </div>
        ) : null}
        {section === "history" ? (
          <RecordsDateBar
            view={view}
            today={today}
            onChange={(period, from, to) => onViewChange(withPeriod(view, period, from, to))}
            openRangeOnMount={rangeJustChosen}
          />
        ) : (
          <div className="fin-records__kinds" role="group" aria-label="Qué objetos">
            {PLAN_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className="fin-records__kind"
                aria-pressed={view.tab === tab.id}
                data-active={view.tab === tab.id}
                onClick={() => set({ tab: tab.id })}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {section === "history" && hasCategories && (chips.length > 1 || view.category) ? (
          <div className="fin-records__chips" role="group" aria-label={chipKind === "income" ? "Ingresos por categoría" : "Gastos por categoría"}>
            {chips.map((group) => {
              const active = view.category !== "" && view.category === group.category;
              return (
                <button
                  key={group.category}
                  type="button"
                  className="fin-records__chip"
                  aria-pressed={active}
                  data-active={active}
                  disabled={group.category === UNCATEGORIZED}
                  onClick={() => set({ category: active ? "" : group.category })}
                >
                  <span>{group.category}</span>
                  <strong>{formatMoneyWhole(group.total)}</strong>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>

      <div
        id={listId}
        role="tabpanel"
        aria-labelledby={sectionTabId(section)}
        className="fin-records__list"
        tabIndex={-1}
      >
        {section === "history" ? (
          filtered.length === 0 ? (
            <div className="fin-records__empty">
              {narrowed && rows.length > 0 ? (
                <p>Nada coincide con esos filtros.</p>
              ) : (
                // Empty: what this list is for.
                <>
                  <p className="fin-records__empty-title">Gastos e ingresos no planeados</p>
                  <p>
                    Aquí ingresas gastos no previstos o cosas del día a día que afectan a tu cartera
                    directamente.
                  </p>
                  {rows.length === 0 ? (
                    <p className="fin-records__empty-hint">Con “Registrar” (tecla G) lo anotas en segundos.</p>
                  ) : null}
                </>
              )}
              {rows.length > 0 && !narrowed && view.period !== "all" ? (
                <button type="button" className="fin-button" onClick={() => onViewChange(withPeriod(view, "all"))}>
                  Ver todas las fechas
                </button>
              ) : null}
            </div>
          ) : (
            <HistoryList groups={groups} today={today} cardNames={cardNames} onEdit={editMovement} />
          )
        ) : planItems.length === 0 || !planTab ? (
          <div className="fin-records__empty">
            <p>
              {view.query
                ? "Nada coincide con ese nombre."
                : `No hay ${planTab ? PLAN_NOUNS[planTab.id][1] : "objetos"} en tu plan.`}
            </p>
          </div>
        ) : (
          <ul className="fin-records__items">
            {planItems.map((item) => {
              const amount = planAmountOf(item);
              const included = item.enabled !== false;
              const next = upcoming.get(item.id);
              const end = endOf(item);
              const label = AMOUNT_LABELS[planTab.id];
              return (
                <li key={item.id} className="fin-records__item" data-included={included}>
                  <div className="fin-records__line">
                    <span className="fin-records__name">
                      <span className="fin-table__swatch" style={{ background: KIND_COLORS[item.kind] }} aria-hidden="true" />
                      <span className="fin-records__concept" title={item.name}>
                        {item.name}
                      </span>
                      {planTab.id === "card" ? (
                        <span className="fin-records__pill fin-records__pill--quiet">{KIND_LABELS[item.kind]}</span>
                      ) : null}
                    </span>
                    <span className="fin-records__amount">
                      {amount !== null ? (
                        <InlineNumberInput
                          value={amount}
                          format={formatMoneyWhole}
                          schema={MoneySchema}
                          ariaLabel={`${label} de ${item.name}`}
                          className="fin-records__inline"
                          onCommit={(value) => commitAmount(item, value)}
                        />
                      ) : item.kind === "installment-plan" ? (
                        formatMoneyWhole(item.originalAmount)
                      ) : null}
                    </span>
                  </div>
                  <p className="fin-records__meta">{cadenceOf(item, (id) => cardNames.get(id))}</p>
                  <div className="fin-records__foot">
                    <p className="fin-records__meta">
                      {[next ? `Próximo ${formatDateShort(next)}` : "Sin fechas por venir", end].filter(Boolean).join(" · ")}
                    </p>
                    <label className="fin-records__toggle" title="Si cuenta en tus cifras y en la gráfica">
                      <input
                        type="checkbox"
                        checked={included}
                        onChange={() => toggleIncluded(item)}
                        aria-label={`${item.name} cuenta en tus cifras`}
                      />
                      <span aria-hidden="true">Cuenta</span>
                    </label>
                    <button
                      type="button"
                      className="fin-records__action"
                      onClick={() => handlersRef.current.onRevealItem(item.id)}
                      aria-label={`Ver ${item.name} en la línea de tiempo`}
                    >
                      Ver
                    </button>
                    <button
                      type="button"
                      className="fin-records__action"
                      onClick={() => handlersRef.current.onEditItem(item.id)}
                      aria-label={`Editar ${item.name}`}
                    >
                      Editar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}

/**
 * "Lo que pasó", one block per day (Hoy, Ayer, lun 16 nov…) with the day's
 * net; a recorded row is a button that opens it to edit. Memo: its inputs
 * only change with the journal, the filters and the card names.
 */
const HistoryList = React.memo(function HistoryList({
  groups,
  today,
  cardNames,
  onEdit,
}: {
  groups: readonly DayGroup<HistoryRow>[];
  today: ISODate;
  cardNames: ReadonlyMap<string, string>;
  onEdit: (movement: Movement) => void;
}) {
  return (
    <ol className="fin-records__days">
      {groups.map((group) => (
        <li key={group.date} className="fin-records__day">
          <h3 className="fin-records__day-head">
            <span>{dayLabel(group.date, today)}</span>
            <span className="fin-records__day-net">{formatSignedMoneyWhole(group.net)}</span>
          </h3>
          <ul className="fin-records__rows">
            {group.rows.map((row) => {
              const signed = row.kind === "income" ? row.amount : -row.amount;
              const badge = SOURCE_LABELS[row.source];
              const card = row.cardId ? (cardNames.get(row.cardId) ?? "Tarjeta borrada") : "";
              const meta = [row.time ?? "", card].filter(Boolean);
              const content = (
                <>
                  <span className="fin-records__line">
                    <span className="fin-records__concept">{row.concept}</span>
                    <span className="fin-records__amount" data-tone={signed >= 0 ? "positive" : "negative"}>
                      {formatSignedMoneyWhole(signed)}
                    </span>
                  </span>
                  {meta.length > 0 || (row.category && row.category !== row.concept) || badge ? (
                    <span className="fin-records__meta">
                      {meta.length > 0 ? <span>{meta.join(" · ")}</span> : null}
                      {row.category && row.category !== row.concept ? (
                        <span className="fin-records__pill">{row.category}</span>
                      ) : null}
                      {badge ? <span className="fin-records__pill fin-records__pill--quiet">{badge}</span> : null}
                    </span>
                  ) : null}
                  {row.notes ? <span className="fin-records__notes">{row.notes}</span> : null}
                </>
              );
              return (
                <li key={row.key} className="fin-records__row" data-source={row.source}>
                  {row.movement ? (
                    <button type="button" className="fin-records__row-main" onClick={() => onEdit(row.movement!)}>
                      <span className="fin-sr-only">Editar: </span>
                      {content}
                    </button>
                  ) : (
                    <div className="fin-records__row-main">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
});
