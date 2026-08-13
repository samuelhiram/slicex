# SliceX — Editor monorepo

SliceX es un monorepo modular para construir un gestor financiero tipo **Excel-DAW**: timeline
infinito con tracks y objetos financieros estirables. La app es una **SPA Vite + React 19** con un
**Worker Hono** desplegado como un solo Cloudflare Worker, en `apps/web`.

**Estado hoy:** la superficie visible es un **playlist tipo FL Studio** renderizado con Pixi desde
`@slicex/canvas`, corriendo con datos demo en memoria. La capa financiera
(`@slicex/core`, `@slicex/contracts`, `@slicex/db`) existe como scaffolding y todavía **no** está
cableada a la UI.

- Comportamiento de producto → [docs/product-spec.md](docs/product-spec.md)
- Snapshot técnico del repo → [docs/project-canon.md](docs/project-canon.md)
- Ownership y reglas de capa → [AGENTS.md](AGENTS.md)
- Índice de toda la documentación → [docs/README.md](docs/README.md)

## Rápido inicio (desarrollo)

```powershell
pnpm install
pnpm -w run check:env    # crea/valida .env.local
pnpm dev:web             # → http://localhost:4321
```

`pnpm dev:web` levanta la SPA y el Worker juntos en el runtime local de Cloudflare. `pnpm dev`
corre el `turbo dev` de todos los paquetes — sólo hace falta si tocas varios a la vez.

Si cambias el schema Prisma:

```powershell
pnpm -w --filter @slicex/db prisma generate
```

## Comandos importantes

| Comando | Qué hace |
|---|---|
| `pnpm dev:web` | Dev server (Vite + Worker CF) en el puerto 4321 |
| `pnpm -w run build:web` | Build SPA + Worker → `apps/web/dist/` |
| `pnpm -w run preview:web` | Preview local del build |
| `pnpm -w run deploy:web` | `wrangler deploy` (config en la raíz) |
| `pnpm -w run typecheck` | tsc raíz + cliente + worker |
| `pnpm -w run test:unit` | Vitest (`-- --run` para no entrar en watch) |
| `pnpm -w run test:e2e` | Playwright |
| `pnpm -w run check:arch` | Deep imports + mirrors `.js` + anti-patrones de performance |
| `pnpm -w run check:env` | Crea/valida `.env.local` |
| `pnpm -w run check:fast` | `check:arch` + `check:env` (gate pre-commit) |

> El dev server usa `strictPort: false`: si el 4321 está ocupado, Vite se pasa al 4322 en silencio
> mientras Playwright sigue apuntando fijo al 4321. Revisa el puerto real en el log si algo no cuadra.

## Estructura relevante

- `apps/web` — SPA Vite + React (`src/`) + Worker Hono (`worker/`), deploy a Cloudflare Workers.
- `packages/canvas` — motor del playlist: `playlist-core`, `playlist-interaction`, `playlist-renderer-pixi`.
- `packages/core` — lógica de dominio y cálculos financieros (sin IO).
- `packages/contracts` — DTOs, validaciones Zod y `ErrorEnvelope`.
- `packages/db` — Prisma schema y acceso a base de datos.
- `packages/config`, `packages/testing` — config compartida y helpers de test.
- `wrangler.jsonc` — **en la raíz**: config del Worker, assets y binding Hyperdrive.

## Reglas duras

- **Performance canon** ([docs/performance-canon.md](docs/performance-canon.md)) es obligatorio para
  cualquier código en `playlist-*` o el shell React. Un budget que falla es un bug, no una tolerancia
  que ajustar.
- **Sin deep imports** entre paquetes: sólo `@slicex/<pkg>`.
- **Sin mirrors `.js`** junto a `.ts`/`.tsx`.
- **Prisma sólo en `@slicex/db`**; `@slicex/core` no hace IO.
- **Branch base: `master`.**

## Documentación y decisiones (ADRs)

Los ADRs están en [docs/adr/](docs/adr/) — ver [docs/adr/README.md](docs/adr/README.md) para el
índice y el estado de cada uno (hay dos series históricas con numeración solapada).

## Contribuir

Lee [CONTRIBUTING.md](CONTRIBUTING.md) para el flujo de ramas, PRs y comprobaciones locales antes de
pedir revisión.
