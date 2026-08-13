# Scripts

Helpers de checks locales y CI. Todos corren con Node directo o vía los scripts del root.

## Gates de arquitectura — `pnpm -w run check:arch`

Los tres corren en cadena; cualquiera que falle corta el gate.

- **`check-imports.mjs`** — bloquea deep imports entre paquetes (`@slicex/<pkg>/src/...`). Sólo se
  permite la API pública `@slicex/<pkg>`.
- **`check-js-siblings.mjs`** — bloquea mirrors `.js`/`.jsx` junto a fuentes `.ts`/`.tsx` en `src/`
  y en tests. Contexto histórico en [../docs/js-dedup-report.md](../docs/js-dedup-report.md).
- **`check-perf-patterns.mjs`** — lint estático de anti-patrones del
  [performance canon](../docs/performance-canon.md) sobre `playlist-core`, `playlist-interaction`,
  `playlist-renderer-pixi` y el shell React.

```powershell
pnpm -w run check:arch
node scripts/check-imports.mjs   # o individualmente
```

## Entorno — `pnpm -w run check:env`

- **`sync-env.mjs`** — valida o crea `.env.local`. La única variable requerida es **`VITE_APP_URL`**
  (default `http://localhost:4321`). Lee `.env.example` si existe; hoy **no existe** en el repo, así
  que en la práctica escribe los defaults.

Nota: ningún código de la app lee `VITE_APP_URL` hoy — sólo la valida este gate. La conexión a
Postgres entra por el binding Hyperdrive de `wrangler.jsonc`, no por env.

## E2E

- **`e2e-static-server.js`** — expuesto como `pnpm -w run test:e2e:static`.
  ⚠️ **Roto hoy, no usar.** Quedó de la era Next.js y referencia dos rutas que ya no existen:
  sirve `apps/web/public/index.html` (el index real vive en `apps/web/index.html`; `public/` sólo
  tiene `robots.txt`) y lanza Playwright con `--config=playwright.local.config.ts`, archivo que no
  está en el repo. Además default `PORT=3000`, anterior al move a 4321.
  El camino vivo para e2e es `pnpm -w run test:e2e`, que usa `playwright.config.ts` y levanta el dev
  server por su cuenta. Pendiente decidir si este script se arregla o se borra.

## Otros comandos del root

- `pnpm db:generate` — `prisma generate` dentro de `@slicex/db`.
- `pnpm db:migrate` — `prisma migrate dev` dentro de `@slicex/db`.
