# ADR 0003 — Prisma client and migrations

Date: 2026-04-05

## Context

We require a single source of truth for DB access with easy migrations during development.

## Decision

Place Prisma schema and migrate scripts in `@slicex/db`. Export a PrismaClient singleton from `packages/db/src/client.ts` to avoid multiple clients in dev.

## Consequences

- All DB queries centralised in `@slicex/db`.
- Local migration and `prisma generate` helpers available via package scripts.
