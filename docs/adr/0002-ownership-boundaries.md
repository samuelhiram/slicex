# ADR 0002 — Ownership & package boundaries

Date: 2026-04-05

## Context

To avoid architectural debt and unclear responsibilities, packages must have explicit ownership and limited surface area.

## Decision

- `@slicex/core`: domain logic and types (no IO).
- `@slicex/canvas`: rendering, Pixi integration (no network IO).
- `@slicex/contracts`: DTOs and validation.
- `@slicex/db`: Prisma schema + client.
- `apps/*`: runtime, HTTP, and adapters.

## Enforcement

`scripts/check-imports.mjs` detects deep imports and enforces the rule. CI runs this check on PRs.
