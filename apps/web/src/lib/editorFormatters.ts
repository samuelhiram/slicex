import { calculateBalanceAt } from "@slicex/core";
import type { CanvasStoreSnapshot } from "@slicex/canvas";

const balanceFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const playheadFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

function normalizeDate(value: string | Date | null | undefined): Date | null {
  if (value == null) {
    return null;
  }

  const date = value instanceof Date ? new Date(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatBalanceValue(balance: number): string {
  return balanceFormatter.format(balance);
}

export function formatPlayheadLabel(
  playheadAt: CanvasStoreSnapshot["playheadAt"],
): string {
  const date = normalizeDate(playheadAt);

  if (!date) {
    return "No playhead";
  }

  return playheadFormatter.format(date);
}

export function resolveSnapshotBalance(
  snapshot: CanvasStoreSnapshot,
): number {
  if (!snapshot.document || snapshot.playheadAt == null) {
    return 0;
  }

  const playheadDate = normalizeDate(snapshot.playheadAt);

  if (!playheadDate) {
    return 0;
  }

  return calculateBalanceAt(snapshot.document, playheadDate.toISOString());
}