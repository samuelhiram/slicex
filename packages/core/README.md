# @slicex/core

Core domain types and deterministic business logic for SliceX.

This package contains pure TypeScript logic (no IO) and should be the single
source of truth for domain models and financial calculations.

Usage:

```ts
import { calculateBalanceAt } from "@slicex/core";
```

## Financial engine (`src/finance/`)

Pure, deterministic projection of cash and debt. No IO, no DOM, no clock:
every date is passed in as an ISO `YYYY-MM-DD` string and all date maths runs
on UTC day numbers (DST-proof). Money is rounded to cents after every step.

```ts
import {
  createDemoFinancialDocument,
  debtByAccountAt,
  projectFinancialDocument,
  snapshotAt,
  findLiquidityWarnings,
  rankDebtsByAvalanche,
} from "@slicex/core";

const doc = createDemoFinancialDocument("2026-11-07");
const projection = projectFinancialDocument(doc); // expand → accounts → project
snapshotAt(projection, "2026-12-01"); // { cash, debt } at the END of that day
findLiquidityWarnings(projection, doc.minimumCashReserve); // end-of-day episodes
// Debts owed at a date (per account), ranked highest annual rate first:
const balances = debtByAccountAt(projection, "2026-12-01");
rankDebtsByAvalanche(doc, balances); // without `balances`: opening balances
```

Pipeline: `expandRecurrence` (arithmetic skip to the first occurrence, never
walks from a far anchor) → `expandFinancialEvents` (items → dated events,
same-day order income < interest < purchase < debt opening < expense < loan <
MSI < card payment) → `buildProjectionAccounts` → `projectFinancialTimeline` (one pass,
points only for non-zero effects). Queries (`snapshotAt`, `nextPayment`) are
binary searches over the projection points; `debtByAccountAt` binary-searches
per-account series built once per projection (WeakMap), so it is
O(accounts · log points) per call. Model and semantics are documented in
[`src/finance/types.ts`](src/finance/types.ts).

Modelling notes:

- `projection.accounts` lists the debt accounts the projection ran with,
  including the ones created on the fly for purchases on an unknown card; each
  point that touches an account carries `accountId` and `accountDebtAfter`.
- Loans without `balance` owe every scheduled payment up to `endDate` (counted
  arithmetically, not capped at the horizon).
- Card interest uses the average daily balance between cuts.
- MSI: the last installment absorbs the cent remainder; a plan with nothing
  paid that starts after the document start opens its debt on its start date
  (`"debt-opening"` event, no cash).
