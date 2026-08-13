# @slicex/config

Configuración compartida del monorepo. **No tiene `src/` ni exporta código** — sólo aloja bases de
config que otros paquetes extienden:

- `tsconfig.json` — base de TypeScript para los paquetes.
- `vitest.config.ts` — base de Vitest.

Si buscas dónde se define un check o un gate, no es aquí: viven en [`scripts/`](../../scripts/) y se
ejecutan desde los scripts del `package.json` de la raíz.
