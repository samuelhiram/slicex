// Plans to open the app on for testing, through the URL (main.tsx):
//   ?reset          the example year (a first visit; "Reiniciar con el ejemplo…")
//   ?reset=memoria  "Plan con memoria": set 22 days ago, it remembers the six
//                   weeks before (the balance memory, FinancialDocument.history)
// Both replace the saved plan and every future.
import { createRememberedPlanDocument, type ISODate } from "@slicex/core";
import { MAIN_BRANCH_ID } from "./futures";
import type { SavedPlan } from "./persistence";

/** The saved plan `?reset=<name>` opens on, built for `today`; null for an unknown name. */
export function testPlan(name: string, today: ISODate): SavedPlan | null {
  if (name !== "memoria") return null;
  return {
    v: 1,
    activeId: MAIN_BRANCH_ID,
    compareId: null,
    branches: [{ id: MAIN_BRANCH_ID, name: "Plan principal", forkDate: null, doc: createRememberedPlanDocument(today) }],
    ledger: [],
  };
}
