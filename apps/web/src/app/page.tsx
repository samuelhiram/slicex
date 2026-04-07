"use client";
import { BalanceSummary } from "../components/BalanceSummary";
import { CanvasShell } from "../components/CanvasShell";
import { formatPlayheadLabel } from "../lib/editorFormatters";
import { storeAdapter } from "../lib/storeAdapter";
import { useStoreSnapshot } from "../lib/useStoreSnapshot";

const trackPalette = [
  "#0f766e",
  "#2563eb",
  "#7c3aed",
  "#d97706",
  "#0891b2",
  "#4f46e5",
];

const amountFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
});

function formatAmount(amount: number): string {
  const formatted = amountFormatter.format(Math.abs(amount));

  if (amount > 0) {
    return `+${formatted}`;
  }

  if (amount < 0) {
    return `-${formatted}`;
  }

  return formatted;
}

function formatItemDate(value: string | Date | null | undefined): string {
  if (value == null) {
    return "No date";
  }

  const parsedDate = value instanceof Date ? new Date(value) : new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return "No date";
  }

  return dateFormatter.format(parsedDate);
}

export default function Page() {
  const snapshot = useStoreSnapshot(storeAdapter);
  const document = snapshot.document;
  const items = document?.items ?? [];
  const playheadLabel = formatPlayheadLabel(snapshot.playheadAt);

  return (
    <main className="editor-page">
      <header className="editor-topbar">
        <div className="editor-brand">
          <span className="editor-brand__eyebrow">Timeline workspace</span>
          <div className="editor-brand__title">SliceX</div>
        </div>
        <div className="editor-metrics">
          <BalanceSummary store={storeAdapter} />
          <div className="editor-metric">
            <span className="editor-metric__label">Playhead: </span>
            <strong className="editor-metric__value">{playheadLabel}</strong>
          </div>
        </div>
      </header>
      <section className="editor-body">
        <aside className="editor-sidebar">
          <div className="editor-panel">
            <div className="editor-panel__label">Active timeline</div>
            <h1 className="editor-panel__title">
              {document?.title ?? "Untitled timeline"}
            </h1>
            <p className="editor-panel__body">
              {items.length > 0
                ? `${items.length} entries are projected into the canvas.`
                : "No timeline items are loaded yet."}
            </p>
          </div>

          <ul className="editor-track-list" aria-label="Timeline items">
            {items.length > 0 ? (
              items.map((item, index) => {
                const trackColor = trackPalette[index % trackPalette.length];
                const tone =
                  item.amount < 0 ? "negative" : item.amount > 0 ? "positive" : "neutral";

                return (
                  <li
                    key={item.id}
                    className="editor-track"
                    data-tone={tone}
                  >
                    <span
                      aria-hidden="true"
                      className="editor-track__swatch"
                      style={{ backgroundColor: trackColor }}
                    />
                    <div className="editor-track__meta">
                      <span className="editor-track__name">{item.name}</span>
                      <span className="editor-track__detail">
                        {formatItemDate(item.date)}
                      </span>
                    </div>
                    <strong className="editor-track__amount">
                      {formatAmount(item.amount)}
                    </strong>
                  </li>
                );
              })
            ) : (
              <li className="editor-track editor-track--empty">
                <strong>No timeline entries yet.</strong>
                Add an item to see it projected onto the canvas.
              </li>
            )}
          </ul>
        </aside>

        <div className="editor-canvas-shell" id="editor-root">
          <CanvasShell />
        </div>
      </section>
    </main>
  );
}
