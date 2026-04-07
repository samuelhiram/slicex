"use client";

import type { StoreAdapter } from "@slicex/canvas";
import { storeAdapter as defaultStoreAdapter } from "../lib/storeAdapter";
import {
  formatBalanceValue,
  resolveSnapshotBalance,
} from "../lib/editorFormatters";
import { useStoreSnapshot } from "../lib/useStoreSnapshot";

type BalanceSummaryProps = {
  store?: StoreAdapter;
};

export function BalanceSummary({ store = defaultStoreAdapter }: BalanceSummaryProps) {
  const snapshot = useStoreSnapshot(store);
  const balance = resolveSnapshotBalance(snapshot);
  const balanceTone = balance < 0 ? "negative" : "positive";

  return (
    <div
      role="status"
      data-tone={balanceTone}
      className="balance-summary"
    >
      <div className="balance-summary__copy">
        <span className="balance-summary__label">Balance: </span>
        <strong className="balance-summary__value" data-testid="balance-summary-value">
          {formatBalanceValue(balance)}
        </strong>
      </div>
      <span aria-hidden="true" className="balance-summary__accent" />
    </div>
  );
}