# SliceX

> Modular monorepo for an Excel-DAW style financial manager — an infinite timeline of stretchable financial objects.

SliceX is a monorepo for building a financial manager shaped like a DAW: an infinite timeline with
tracks and stretchable financial objects (income, expenses, debts), and clonable timelines for
simulating scenarios. The app is a **Vite + React 19 SPA** with a **Hono Worker**, deployed as a
single Cloudflare Worker from `apps/web`.

**Current state:** the visible surface is an **FL Studio-style playlist** rendered with Pixi from
`@slicex/canvas`, running on in-memory demo data. The financial layer (`@slicex/core`,
`@slicex/contracts`, `@slicex/db`) exists as scaffolding and is **not yet wired to the UI**.

| Document | What it covers |
|---|---|
| [docs/product-spec.md](docs/product-spec.md) | Product behavior — source of truth |
| [docs/project-canon.md](docs/project-canon.md) | Technical snapshot of the repo |
| [AGENTS.md](AGENTS.md) | Ownership and layer rules |
| [docs/README.md](docs/README.md) | Index of all documentation |

## Quick start

```powershell
pnpm install
pnpm -w run check:env    # creates and validates .env.local
pnpm dev:web             # → http://localhost:4321
```

`pnpm dev:web` runs the SPA and the Worker together in the local Cloudflare runtime. `pnpm dev` runs
`turbo dev` across every package — only needed when working on several at once.

After changing the Prisma schema:

```powershell
pnpm -w --filter @slicex/db prisma generate
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev:web` | Dev server (Vite + CF Worker) on port 4321 |
| `pnpm -w run build:web` | Build SPA + Worker → `apps/web/dist/` |
| `pnpm -w run preview:web` | Preview the build locally |
| `pnpm -w run deploy:web` | `wrangler deploy` (config lives at the repo root) |
| `pnpm -w run typecheck` | `tsc` for root, client and worker |
| `pnpm -w run test:unit` | Vitest (add `-- --run` to avoid watch mode) |
| `pnpm -w run test:e2e` | Playwright |
| `pnpm -w run check:arch` | Deep imports + `.js` mirrors + performance anti-patterns |
| `pnpm -w run check:env` | Create and validate `.env.local` |
| `pnpm -w run check:fast` | `check:arch` + `check:env` (pre-commit gate) |

> The dev server uses `strictPort: false`. If 4321 is taken, Vite silently moves to 4322 while
> Playwright keeps pointing at 4321. Check the actual port in the log when something does not line up.

## Structure

```
apps/web             Vite + React SPA (src/) and Hono Worker (worker/), deployed to CF Workers
packages/canvas      Playlist engine: playlist-core, playlist-interaction, playlist-renderer-pixi
packages/core        Domain logic and financial calculations — no IO
packages/contracts   DTOs, Zod validation and ErrorEnvelope
packages/db          Prisma schema and database access
packages/config      Shared configuration
packages/testing     Test helpers
wrangler.jsonc       At the ROOT: Worker config, assets and Hyperdrive binding
```

## Hard rules

These are enforced, not aspirational. `check:arch` fails the build when they are broken.

- **Performance canon** ([docs/performance-canon.md](docs/performance-canon.md)) is mandatory for any
  code in `playlist-*` or the React shell. **A failing budget is a bug, not a tolerance to widen.**
- **No deep imports** between packages — only `@slicex/<pkg>`, never `@slicex/<pkg>/src/...`.
- **No `.js` mirrors** sitting next to `.ts` / `.tsx` files.
- **Prisma only in `@slicex/db`.** `@slicex/core` performs no IO.
- **Base branch is `master`.**

The reason the engine/logic split is enforced rather than merely preferred: the target is web →
Android → iOS, so `@slicex/core` has to be portable without React or Pixi.

## Architecture decisions

ADRs live in [docs/adr/](docs/adr/) — see [docs/adr/README.md](docs/adr/README.md) for the index and
the status of each one. Note that two historical series overlap in numbering.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for branch flow, PR expectations and the local checks to run
before requesting review.
