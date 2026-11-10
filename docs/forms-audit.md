# Auditoría de formularios (2026-11-09)

Estado de los formularios de `apps/web` antes de unificar la arquitectura (Mantine Form + Zod).
Fuente: lectura del código en `feat/financial-engine-mvp`.

## 1. Inventario

| Componente | Qué captura | Estado | Validación | Líneas |
|---|---|---|---|---|
| `finance/components/FinancialEditorModal.tsx` | Ítem financiero (6 tipos, unión discriminada por `kind`): nombre, montos, tasa, tarjeta, "Cuándo" (empieza, se repite, termina) | `useState` de un `draft` completo, controlado | `validateFinancialDraft` a mano, **un solo error** (el primero) en una línea `role="alert"` | 1385 |
| `finance/components/Onboarding.tsx` | Caja, pago (cada cuánto, cuánto, próximo pago), colchón, gastos fijos (filas) | 9 `useState` sueltos, controlado | Ifs en `submit`, un solo error | 363 |
| `finance/components/RecDialog.tsx` | Conciliación: monto real por movimiento + caja real | `useState`, controlado | `parseNumberInput` en línea | 187 |
| `finance/components/StatementDialog.tsx` | Estado de cuenta pegado (textarea) | `useState` | `parseStatement` (preview de filas) | 152 |
| `finance/components/FinancialUi.tsx` (`InlineNumberInput`) | Liquidez hoy / Reserva mínima en el encabezado | texto local + commit en blur/Enter | `parseNumberInput` | 186 |
| `finance/components/CommandBar.tsx` | Barra "/" (lenguaje natural) | `useState` | `command.ts` (parser) | 205 |
| `finance/components/SchedulePicker.tsx` | "Se repite" (presets + cada N) | controlado por props | entero ≥ 1 | 137 |
| `components/PlaylistInspector.tsx` | Inspector del canvas (números, color) | controlado | ninguna | 243 |
| `NavControls.tsx`, `PlaylistShell.tsx` | Selects de rango y "Ajustar a" | controlado | n/a (no son formularios) | — |

## 2. Hallazgos

### Duplicación
- **El patrón "texto local + valor emitido" está copiado 4 veces** (`NumberField`, `DateField`, `EveryInput`, `InlineNumberInput`): estado `text` + `useRef` del último valor emitido + `useEffect` de resincronización. Es exactamente lo que resuelve un input no controlado.
- **Fechas en dos sistemas**: el editor usa `DateField` (parseo es-MX, vista previa, ↑/↓); el onboarding vuelve a parsear "¿Cuándo es tu próximo pago?" con su propio input y su propia vista previa.
- **Montos en tres sitios** con reglas distintas (editor `NumberField`, onboarding inputs sueltos, `RecDialog`), todos sobre `parseNumberInput` pero con mensajes y estados de error diferentes.

### Validación y tipos
- **Dos modelos que ya divergen**: `@slicex/contracts` define con Zod un `FinancialObjectSchema` / `RecurrenceRuleSchema` (`DAILY | WEEKLY | MONTHLY | YEARLY`, `count`, `until`) que **no corresponde** al modelo real de `@slicex/core` (`FinancialItem`, 6 tipos, `once | daily | weekly | biweekly | semimonthly | monthly`, `interval`, `anchorDate`). Nada los mantiene alineados.
- **La validación del cliente no es un esquema**: `validateFinancialDraft` es una cadena de `if` que devuelve el **primer** error como texto. No hay errores por campo, ni tipos inferidos, ni reutilización en persistencia.
- **Mensajes desalineados con la UI**: los errores dicen "Fecha: inválida." y "Fecha final: …" mientras las etiquetas ya dicen *Empieza* / *Termina*.
- **Persistencia validada a medias**: `persistence.ts` (`parsePlan`) comprueba la forma del documento con guardas manuales (`isDocument`) pero **no valida cada ítem**: un `localStorage` corrupto o editado a mano puede meter ítems con montos/fechas inválidos directo a la proyección.
- El Worker sí usa Zod (`routes/timelines.ts`, `ParamsSchema.safeParse`) — patrón correcto, pero aislado.

### Estado y rendimiento
- Todo es **controlado**: cada tecla re-renderiza el editor completo (≈1400 líneas de árbol, más el resumen de "Cuándo" que expande la recurrencia). Hoy es imperceptible (formularios chicos), pero escala mal y mezcla "estado de UI" con "estado del documento".
- `switchKind`, `normalizeForSave`, `withFrequencyParts`… son lógica de dominio correcta pero vive dentro del archivo del modal.

### Accesibilidad
- Un único `role="alert"` para todo el formulario: el error **no está asociado** al campo (`aria-describedby`), y solo las fechas marcan `aria-invalid`.
- Los presets de "Se repite" son `role="radio"` sin navegación con flechas (roving tabindex).
- Bien: etiquetas visibles en todos los campos, foco atrapado en modales, `Escape`/devolución de foco, objetivos ≥ 24 px.

### Seguridad
- Sin envío a servidor desde formularios (la persistencia es `localStorage`; el API de timelines está dormido). React escapa todo el texto; no hay `dangerouslySetInnerHTML`.
- Riesgo real: **datos sin validar de `localStorage`** (ver arriba) y, cuando se conecte el servidor, **ningún esquema compartido** cliente/servidor para `FinancialItem`.

### Canon del repo
- `docs/frontend-canon.md`: *"keep the editor shell CSS-first unless there is a strong reason to adopt a component library"*. El sistema visual (Soft UI, tokens claro/oscuro en `globals.css`, espejados en la paleta del canvas) es propio. Adoptar **componentes** de Mantine choca con esta regla; adoptar **Mantine Form** (sin UI) y **Zod** no.

## 3. Arquitectura objetivo (propuesta)

1. **Un esquema por modelo, en `@slicex/contracts`**: `FinancialItemSchema` (unión discriminada por `kind`) + `FinancialRecurrenceSchema`, con una prueba de tipos que garantice `z.infer<…>` ≡ `FinancialItem` de `@slicex/core`. Lo usan: el editor, el onboarding, `parsePlan` (persistencia) y, más adelante, el Worker. Se retira el `FinancialObjectSchema` divergente (o se marca como del modelo dormido).
2. **Estado con Mantine Form en modo `uncontrolled`** + `zodResolver`: errores por campo, `form.key()` en vez de re-render por tecla, `form.watch` solo donde la UI deriva valores (resumen de "Cuándo", vista previa de pagos).
3. **Un juego mínimo de campos reutilizables** (no un framework): `MoneyField`, `DateField`, `SchedulePicker`, `CardSelect`, `FieldError`, conectados con `form.getInputProps(path)` y con el error ligado por `aria-describedby`.
4. **Lógica de dominio fuera de los componentes**: `switchKind`, `normalizeForSave`, presets de horario → módulo puro (`finance/item-form.ts`), probado aparte.
5. **Migración por orden de valor**: editor → onboarding → conciliación → estado de cuenta → entradas del encabezado.

La decisión abierta es la **capa visual**: componentes de Mantine (reestilizar todos los diálogos con su sistema y actualizar el canon) o mantener los componentes propios con Mantine Form + Zod por debajo.

## 4. Implementado (2026-11-09) — "Mantine Form + Zod, UI propia"

Decisión: **Mantine Form** (estado / validación / envío, sin componentes visuales) + **Zod**; los
controles siguen siendo los propios (Soft UI). `@mantine/form` fijado en 9.7.3 (≥ 2 semanas de
publicado), con `schemaResolver` nativo (Standard Schema; Zod 3.25 lo implementa).

- **Esquemas compartidos** — `packages/contracts/src/finance.ts`: `ISODateSchema`,
  `MoneySchema`, `FinancialRecurrenceSchema` (incluye `interval`, fin ≥ inicio),
  `FinancialItemSchema` (unión discriminada por `kind`), `FinancialItemSchemaStrict` (reglas
  cruzadas: pagados ≤ meses) y `FinancialDocumentSchema`. Mensajes en español, por campo.
- **Sin deriva modelo ↔ esquema** — `apps/web/src/finance/item-schema.ts` afirma en compilación
  que `z.infer<FinancialItemSchema>` ≡ `FinancialItem` de `@slicex/core`.
- **Editor** (`FinancialEditorModal`): estado en `useForm` (**controlado**, a propósito: el
  resumen de "Cuándo", la vista previa de pagos y los presets se derivan de cada tecla);
  validación = esquema compartido + reglas de UX (`itemFormSchema`: nombre, tarjeta existente).
  **Error bajo cada campo**, con `aria-invalid` + `aria-describedby`; la línea `role="alert"`
  resume el primero ("Monto: no puede ser negativo."). Al guardar, `cleanItem` deja solo las
  claves del tipo (las de un cambio de tipo se descartan).
- **Onboarding**: `useForm` **no controlado** (`form.key` + `getInputProps`), esquema Zod del
  texto tal como se escribe (montos y fechas es-MX), errores por campo, `form.watch` solo para
  las dos vistas previas que siguen a la escritura.
- **Persistencia** (`persistence.ts`): el plan de `localStorage` se valida con el esquema
  compartido; un ítem inválido se descarta solo (el resto del plan sobrevive), un documento
  inválido se descarta entero. Antes entraban sin validar a la proyección.
- Tests: `packages/contracts/tests/finance.spec.ts`, persistencia en `finance-plan.spec.ts`,
  errores por campo y onboarding en `finance-components.spec.ts`.

## 5. Completado (2026-11-10)

- **Piezas compartidas, conectadas** (`finance/components/form-kit.tsx`): `FieldErrorsContext` /
  `useFieldError` / `FieldError`, `useEditableText` (el patrón "texto local + valor emitido", antes
  copiado), `amountTextSchema` (monto *tal como se escribe* → `MoneySchema` u otro esquema de
  número compartido), `bindField` (input nativo ↔ Mantine Form con su error ligado) y `firstError`
  (la línea `role="alert"`). `parseNumberInput` vive en `finance/format.ts`, junto a `parseDateInput`.
- **Un solo `DateField`** (`finance/components/DateField.tsx`, texto es-MX + calendario de
  `@mantine/dates`): el editor ("Empieza", "Termina el…") y el onboarding ("¿Cuándo es tu próximo
  pago?", `prefer="on-or-after"`, `min` = hoy) usan el mismo. El editor ya no tiene copias propias.
  `SlicexMantineProvider` (`mantine.tsx`) envuelve el shell con el tema de la app.
- **Rec** (`RecDialog`): Mantine Form controlado; "Otro monto" valida con `MoneySchema` y el saldo
  real con el `initialCash` del documento (puede ser negativo). Antes un monto vacío o inválido se
  tomaba en silencio como "Pasó"; ahora es un error en su fila y bloquea Guardar.
- **Estado de cuenta** (`StatementDialog`): Mantine Form controlado; un texto sin movimientos es
  error del textarea (`aria-invalid` + `aria-describedby`), validado al escribir con un solo parseo
  compartido entre la vista previa y el esquema.
- **Encabezado** (`InlineNumberInput`): valida con el esquema compartido del documento
  (`initialCash` admite sobregiro, `minimumCashReserve` no); el inválido se marca mientras se
  escribe y se revierte al confirmar, como un campo numérico de herramienta de diseño.
- **Bugs corregidos**:
  - el editor llamaba hooks después de su `return null` (ítem borrado con el editor abierto →
    "Rendered fewer hooks than expected");
  - el calendario se veía roto (días amontonados, controles gigantes): faltaba
    `@mantine/core/styles/default-css-variables.css` en `main.tsx` — el provider solo inyecta lo que
    difiere de esas variables (`--mantine-scale`, espaciados…) y sin ellas todo `calc()` es inválido;
  - Escape con el foco en el botón ▦ cerraba el diálogo entero en vez de solo el calendario;
  - texto no reconocido mostraba dos mensajes bajo la fecha ("No reconocida…" + "Fecha inválida");
    ahora solo la vista previa (el resumen y `aria-invalid` siguen).
  Tests de regresión en `finance-components.spec.ts` (los visuales, verificados en el navegador).
- Tests: calendario, regresión de hooks, fecha del onboarding, Rec, estado de cuenta y montos del
  encabezado en `finance-components.spec.ts`. `vitest.setup.ts` simula `matchMedia` (jsdom no lo
  trae y el provider de Mantine lo lee).

### Pendiente
- `FinancialObjectSchema` / `RecurrenceRuleSchema` de `contracts` describen el modelo dormido del
  API y no el real: retirarlos cuando se conecte el servidor con `FinancialItemSchema`.
- Presets de "Se repite" sin navegación con flechas (roving tabindex).
