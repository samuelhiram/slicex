# SliceX — Editor monorepo

## Resumen rápido

SliceX es un monorepo modular para construir un editor financiero con fronteras claras entre dominio, persistencia y render. Este repositorio contiene paquetes reutilizables (`@slicex/*`) y una aplicación Next.js en `apps/web`.

## Rápido inicio (desarrollo)

1. Instala dependencias:

```powershell
pnpm install
```

2. Crea `.env.local` (o ejecuta el helper):

```powershell
pnpm -w run check:env
```

3. Genera Prisma Client (si cambias schema):

```powershell
pnpm -w --filter @slicex/db prisma generate
```

4. Levanta la app en modo desarrollo:

```powershell
pnpm dev
```

## Comandos importantes

- `pnpm -w run typecheck` — TypeScript build.
- `pnpm -w run test:unit` — Ejecuta tests unitarios (Vitest).
- `pnpm -w run test:e2e` — Ejecuta E2E Playwright.
- `pnpm -w run check:arch` — Revisa imports profundos y ownership.
- `pnpm -w run check:env` — Crea/valida `.env.local`.

## Estructura relevante

- `packages/core` — Lógica de dominio y cálculos (sin IO).
- `packages/canvas` — Motor Pixi y adaptadores gráficos.
- `packages/contracts` — DTOs, validaciones y `ErrorEnvelope`.
- `packages/db` — Prisma schema y acceso a base de datos.
- `apps/web` — Next.js (App Router), route handlers y UI.

## Documentación y decisiones (ADRs)

Los ADRs se encuentran en `docs/adr/` y documentan decisiones de arquitectura clave (monorepo, ownership, Prisma, renderer).

## Contribuir

Lee `CONTRIBUTING.md` para el flujo de trabajo de ramas, PRs y comprobaciones locales antes de solicitar revisión.

# SliceX — Monorepo bootstrap

Instalación rápida:

1. Instalar pnpm: `npm i -g pnpm`
2. Instalar dependencias: `pnpm install`
3. Levantar en dev: `pnpm dev`

Principales scripts:

- `pnpm dev` — dev (turbo)
- `pnpm build` — build
- `pnpm test` — tests unitarios
- `pnpm test:e2e` — Playwright
- `pnpm db:generate` — prisma generate (en @slicex/db)

Estructura y boundaries: ver `CONTEXT.md` y `AGENTS.md`.
