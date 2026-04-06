# Scripts

This folder contains helper scripts used by the repo for local checks.

- `check-imports.mjs`: scans workspace source files to detect deep imports of `@slicex/<pkg>/...`. Run with:

```powershell
node scripts/check-imports.mjs
```

- `sync-env.mjs`: validates or creates `.env.local` from `.env.example` (ensures `NEXT_PUBLIC_APP_URL` exists). Run with:

```powershell
node scripts/sync-env.mjs
```

Helpers para tareas comunes.

Usage:

- `pnpm db:generate` — genera prisma client (desde root script delega a package)
