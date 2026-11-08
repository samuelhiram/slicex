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
  accountActivity,
  annualItemImpact,
  createDemoFinancialDocument,
  debtByAccountAt,
  estimateDebtPayoffs,
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
// When each debt is gone (30-year window by default), what it costs:
estimateDebtPayoffs(doc).get("fin-nu"); // { payoffDate: "2028-08-26", totalInterest, totalPaid, finalDebt }
// Interest / payments / charges of one account between two dates (inclusive):
accountActivity(projection, "fin-nu", "2026-11-07", "2026-12-07");
annualItemImpact(projection).get("fin-sueldo"); // signed cash per item over the projection
```

Pipeline: `expandRecurrence` (arithmetic skip to the first occurrence, never
walks from a far anchor) → `expandFinancialEvents` (items → dated events,
same-day order income < interest < purchase < debt opening < expense < loan <
MSI < card payment) → `buildProjectionAccounts` → `projectFinancialTimeline` (one pass,
points only for non-zero effects). Queries (`snapshotAt`, `nextPayment`) are
binary searches over the projection points; `debtByAccountAt` binary-searches
per-account series built once per projection (WeakMap), so it is
O(accounts · log points) per call; `accountActivity` reads prefix sums of the
same series (O(log points), optional `out` object to avoid allocating) and
`annualItemImpact` is cached per projection (same map on every call). Model and semantics are documented in
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
- Payoffs (`estimateDebtPayoffs`): each debt account is simulated alone (its
  cuts, purchases, MSI opening and planned payments; cash is irrelevant) with
  the projection's exact arithmetic, over lazy day-number schedules that stop
  at the payoff (demo document, 360 months: ≈ 0.1 ms). The payoff is the
  payment that clears the account for good: no purchase / debt opening left
  after it, except open-ended recurring charges that every later payment
  clears. The interest of the last stretch (posted by the projection at the
  next cut) is counted in `totalInterest` / `totalPaid`. `payoffDate` is
  `null` when the debt is still there at the cap — a card whose payment never
  covers its interest compounds every month, so its 30-year totals are
  astronomically large: show "no se liquida" rather than the number, or pass
  a shorter `maxMonths`.
