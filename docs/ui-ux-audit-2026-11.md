> **Auditoría 2026-11-10.** Generada por una auditoría multi-agente (16 áreas, 178 hallazgos verificados con probes). Estado al commit `e91939e`; ver la sección final de los arreglos aplicados en el commit que acompaña este archivo.

# Auditoría UI/UX de SliceX: frentes blandos

**Fecha:** 2026-11-10 · **Branch:** `feat/financial-engine-mvp` · **Alcance:** 16 áreas, 178 hallazgos verificados, agrupados en 83 entradas según su causa raíz.
**Prioridad:** estabilidad, luego escalabilidad, luego fricción UX, luego pulido.

---

## Resumen ejecutivo

- **Salud general.** La base técnica es buena: las fechas son enteros, hay un solo esquema Zod, el core del playlist es idempotente y rápido, y el ciclo de vida de Pixi está bien cuidado. Lo frágil está donde se cruzan documento, vista, futuros y persistencia. Hay **8 causas raíz críticas, todas reproducidas con probes**. Casi todas producen cifras falsas o pérdida silenciosa **después de recargar**, y por eso los 1103 tests no las detectan.
- **Riesgo 1: gestos normales corrompen el plan guardado.**
  - El solo o el silencio de una línea se persiste como `enabled:false` en cada objeto.
  - Achicar un recurrente a menos de un día deja `endDate < startDate` y el objeto desaparece al recargar. Pasó en 21 de 25 sesiones de fuzz.
  - La barra "/" crea ítems que el esquema rechaza.
  - El Inspector renombra el objeto que se selecciona después.
  - El patrón común: se escribe al documento sin pasar por el esquema, y `parseDocument` descarta lo inválido en silencio.
- **Riesgo 2: la persistencia no avisa de nada.**
  - Dos pestañas se pisan entre sí (gana la última que escribe).
  - `savePlan` devuelve `true` aunque no haya storage, y nadie revisa cuando devuelve `false`.
  - El ledger de Rec crece sin límite y nadie lo lee.
  - El debounce de 600 ms no se vacía al cerrar la pestaña.
  - `?reset` borra todo sin respaldo.
  - El plan entero vive en una sola clave de localStorage.
- **Riesgo 3: los futuros no comparten la realidad.** Rec solo corrige el futuro activo: `replaceParkedDocs` no tiene llamadores. Por eso el fantasma de comparación, Q y el cambio de futuro muestran una caja que el usuario ya corrigió. Además, el portapapeles y el archivo de cortes se cruzan entre escenarios e inventan montos.
- **Riesgo 4: el motor muestra cifras falsas en casos comunes.**
  - En una tarjeta totalera, el Rec diario adelanta pagos unos 20 de cada 30 días.
  - Un préstamo con saldo sigue cobrando caja después del "Libre en…".
  - La estrategia avalancha recomienda abonar dinero que el plan necesita días después.
  - Teclear la fecha de inicio cambia el número de pagos.
- **Riesgo 5: historial y gestos frágiles.**
  - Deshacer restaura el viewport, la herramienta y el portapapeles viejos, y vuelve a pintar overlays.
  - Pinch, pointercancel, long-press y Ctrl+Z a mitad de un arrastre dejan gestos abiertos, o confirman lo que debían cancelar. No existe `cancelGesture`.
- **Escala.** Con 12 meses, el único horizonte posible hoy, un paso de arrastre cuesta 2–6 ms. Lo que pesa:
  - Memoria: cada gesto retiene una proyección completa, unos 75–165 MB por futuro.
  - Renders puntuales: ValleyCard tarda 40–210 ms en frío; RecDialog, 180–340 ms por tecla tras un año sin abrir la app; los clips silenciados, 15–210 ms por frame de zoom.
  - Si se abre el horizonte a 10–30 años, el arrastre pasa a 34–117 ms por movimiento, y **ningún budget cubre el bridge**.
- **Móvil, el siguiente target, no está listo.** `100vh` oculta los últimos 56–80 px. Un dedo no desplaza el plan. La barra "/" no se puede cerrar sin teclado físico. A 360 px el panel Análisis tapa todo y su botón de cerrar queda fuera de pantalla.
- **Los gates no protegen producción.** El hook de pre-commit no está instalado, Workers Builds despliega sin esperar al CI, y la única e2e nunca pasa por "editar y recargar".
- **Lo sólido:** la aritmética de fechas y dinero, el contrato de esquema único, los hot paths del core (10k clips a menos de 1.5 ms por movimiento), el ciclo de vida de Pixi, las suscripciones React selectivas y el sistema de tokens y tema. No conviene tocarlos.

---

## Mapa de frentes blandos (ordenado por riesgo)

| # | Frente | Peor severidad | P0 | P1 | P2 | P3 |
|---|---|---|---|---|---|---|
| 1 | Integridad del plan guardado | crítica | 5 | 1 | – | – |
| 2 | Persistencia sin red | crítica | 2 | 4 | 1 | – |
| 3 | Futuros y Rec: una sola realidad | crítica | 2 | – | 2 | – |
| 4 | Motor financiero y captura: cifras incorrectas | crítica | 6 | – | 7 | – |
| 5 | Historial y ciclo de vida del gesto | alta | 3 | – | 1 | – |
| 6 | Memoria y costo por interacción a escala | alta | – | 15 | – | – |
| 7 | Móvil y táctil | alta | 2 | – | 6 | – |
| 8 | Red de seguridad y ciclo de vida del canvas | media | – | 4 | – | – |
| 9 | Confianza al editar (deshacer, atajos, modos) | alta | – | – | 6 | – |
| 10 | Accesibilidad | alta | – | – | 6 | – |
| 11 | Deuda estructural y gates | media | – | 2 | – | – |
| 12 | Lenguaje y pulido visual | media | – | – | – | 8 |

---

## P0: Estabilidad (arreglar ya)

### Frente 1 · Integridad del plan guardado

**P0-1 · El solo y el silencio de una línea de evento se guardan como `enabled:false` en cada objeto**
crítica · confirmado · M · `bridge-1`, `gap-fuzz-cruzado-1`
Ubicación: [financial-bridge.ts:1119](apps/web/src/finance/financial-bridge.ts#L1119), [mapping.ts:348](apps/web/src/finance/mapping.ts#L348), [mapping.ts:486](apps/web/src/finance/mapping.ts#L486)
- **Escenario:** en el demo, "Solo esta línea de evento", esperar al autosave y recargar. El solo ya no está, pero 6 de 7 clips quedan silenciados uno por uno y la caja final pasa de 95,708 a 228,000. Si se silencia una línea, se recarga y se quita el silencio, el objeto sigue deshabilitado.
- **Arreglo:** persistir solo `clip.muted`. La exclusión por línea (mute o solo) se aplica como filtro al proyectar, sobre un documento derivado que nunca se guarda. Agregar un test de ida y vuelta: solo → `toSaved` → `parsePlan` → `bootstrapPlan` → comparar `finalCash`. Los planes que ya se guardaron con este daño no se pueden distinguir de los sanos: conviene avisar al usuario.

**P0-2 · Achicar o rebanar un recurrente a menos de un día lo borra al recargar**
crítica · confirmado · S (clamp) / M (reparación + fuzz) · `guardrails-1`
Ubicación: [mapping.ts:259](apps/web/src/finance/mapping.ts#L259), [persistence.ts:52](apps/web/src/finance/persistence.ts#L52)
- **Escenario:** al arrastrar el borde derecho del Sueldo hasta su inicio, queda con `duration 0.25`, lo que da `endDate = startDate − 1`. El autosave lo guarda y `parseDocument` lo descarta al recargar, sin aviso. En el fuzz, 21 de 25 sesiones de 60 gestos produjeron al menos un objeto así.
- **Arreglo:** en `deriveRecurrence`, `endExclusive = Math.max(endExclusive, startBeat + 1)`. En `parseDocument`, reparar (`endDate = startDate`) en vez de descartar, y contar los descartes. Agregar un test de propiedad: secuencia de gestos → `toSaved` → `parsePlan` debe conservar todos los ids.

**P0-3 · La barra "/" agrega objetos que el esquema rechaza, y desaparecen al recargar**
crítica · confirmado · S · `command-1`
Ubicación: [CommandBar.tsx:63](apps/web/src/finance/components/CommandBar.tsx#L63), [command.ts:1294](apps/web/src/finance/command.ts#L1294), [command.ts:1275](apps/web/src/finance/command.ts#L1275)
- **Escenario:** sin tarjetas en el plan (el estado normal al salir del onboarding), "uber 150 con tarjeta" crea una compra con `cardId ""`. "renta 8000 mensual hasta ayer" crea `endDate < startDate`. Los dos muestran "Sin efecto en tu caja" y se pierden al recargar: en el probe, 4 objetos quedaron en 1.
- **Arreglo:**
  - Validar en `add` con `itemFormSchema(cards)` y mostrar `firstFieldError` en la barra.
  - En el parser, no clasificar como compra con tarjeta si el plan no tiene tarjetas, y rechazar un "hasta" anterior al inicio.
  - Meter `FinancialItemSchemaStrict` en el fuzz de `finance-command.spec.ts`, que hoy fija `cardId ""` como resultado esperado.

**P0-4 · El Inspector renombra el siguiente objeto que se selecciona y expone campos DAW que mueven los días de pago**
crítica · confirmado · S · `shell-1`, `shell-7`, `uxflows-8`, `gap-render-react-escala-7`, `-8`
Ubicación: [PlaylistInspector.tsx:114](apps/web/src/components/PlaylistInspector.tsx#L114), [PlaylistInspector.tsx:135](apps/web/src/components/PlaylistInspector.tsx#L135), [PlaylistInspector.tsx:176](apps/web/src/components/PlaylistInspector.tsx#L176), [PlaylistInspector.tsx:188](apps/web/src/components/PlaylistInspector.tsx#L188)
- **Escenario, renombrado:** con el Inspector abierto, clic en "Sueldo" y luego en "Gasto". "Gasto" pasa a llamarse "Sueldo" en el canvas, en el documento y en localStorage. Falta un `key`, y el efecto del debounce escribe el nombre viejo sobre el objeto nuevo.
- **Escenario, campos DAW:**
  - "Content offset (beats)" y "Stretch ratio" mueven todos los días de pago (en el probe, del 11-13 al 11-24), aunque `stretchEnabled` está en `false`.
  - Cada tecla deja una entrada de undo.
  - Arrastrar el selector de color unos 3 s llena el historial de 200 entradas.
  - Todo el panel está en inglés.
- **Arreglo:** quitar el Inspector del shell financiero. Si se conserva: `key={focusedClip.id}`, escribir solo tras una edición del usuario, y campos financieros que pasen por `bridge.replaceItem`. En el core, `setClipStretchRatio` debe ser no-op cuando `stretchEnabled === false`.

**P0-5 · Ids de línea de evento duplicados después de insertar una línea y recargar**
alta · confirmado · S · `corestate-4`
Ubicación: [state-track-helpers.ts:39](packages/canvas/src/playlist-core/state-track-helpers.ts#L39), [geometry.ts:411](packages/canvas/src/playlist-core/geometry.ts#L411)
- **Escenario:**
  1. Se materializan filas lejanas.
  2. "Insertar línea abajo" acuña `track-10` en la posición 1.
  3. Al recargar, se recortan las filas vacías.
  4. Al soltar algo en la fila 9 aparece otro `track-10`.
  - Resultado: el objeto de la fila 1 se dibuja en la 9 y, al guardar, los dos colapsan en una sola fila.
- **Arreglo:** un único acuñador de ids que revise todos los existentes (contador monotónico o `row-<n>`). `createVirtualTrack` debe saltar ids ya presentes, y hay que validar la unicidad al cargar.

### Frente 2 · Persistencia sin red

**P0-6 · Con dos pestañas abiertas, la última que autoguarda borra lo hecho en la otra**
crítica (dos verificadores la dejaron en alta) · confirmado · M · `shell-2`, `persist-3`, `uxflows-3`
Ubicación: [PlaylistShell.tsx:934](apps/web/src/components/PlaylistShell.tsx#L934), [persistence.ts:110](apps/web/src/finance/persistence.ts#L110)
- **Escenario:** la pestaña A está abierta desde ayer. En B se capturan 20 movimientos y se crea un futuro. Al mover algo en A, a los 600 ms A escribe encima su plan viejo completo. "Reiniciar" en una pestaña también se deshace con el siguiente autosave de la otra. No hay listener de `storage`, ni BroadcastChannel, ni locks.
- **Arreglo:** guardar `{rev, writerId}` en SavedPlan. Escuchar `storage` y pasar la pestaña obsoleta a solo lectura, con el aviso "Tu plan cambió en otra pestaña · Recargar". Comparar `rev` antes de cada escritura.

**P0-7 · El guardado falla en silencio y el ledger de Rec crece sin límite hacia la cuota**
alta · confirmado · M · `shell-8`, `persist-6`, `persist-7`, `engine-6`, `uxflows-2`, `guardrails-2`, `gap-fuzz-cruzado-8`
Ubicación: [persistence.ts:112](apps/web/src/finance/persistence.ts#L112), [bootstrap.ts:66](apps/web/src/finance/bootstrap.ts#L66), [futures.ts:204](apps/web/src/finance/futures.ts#L204), [PlaylistShell.tsx:934](apps/web/src/components/PlaylistShell.tsx#L934)
- **Escenario:**
  - Si el storage está bloqueado, `storage()` devuelve `null` y `savePlan` devuelve `true` sin haber escrito nada.
  - Con la cuota llena devuelve `false`, y los dos llamadores ignoran el valor.
  - El ledger agrega todos los eventos pasados en cada visita. Nadie lo lee (`getLedger` no tiene consumidores) y se serializa entero en cada autosave.
  - Tamaños medidos: 300 objetos × 15 futuros ≈ 1.0–1.2 M caracteres, más 0.6–2.5 M de ledger por año (según el probe). Con una cuota de 2.5–5 M caracteres (según el navegador), se llena en 1 a 3 años en el perfil intensivo.
  - Desde ese momento, cada edición se pierde al recargar.
- **Arreglo:**
  - `savePlan` devuelve `false` cuando no hay storage.
  - Estado `saveStatus` con un banner persistente: "No se pudo guardar · Descargar respaldo".
  - Exportar e importar el plan en JSON.
  - Pedir `navigator.storage.persist()`.
  - Del ledger, guardar solo las entradas distintas de `planned` (o un resumen mensual), en una clave aparte o en IndexedDB.

### Frente 3 · Futuros y Rec: una sola realidad

**P0-8 · Rec corrige solo el futuro activo; si se cambia de futuro antes de "Revisar", corrige el equivocado**
crítica · confirmado · M · `bridge-2`, `persist-1`, `engine-4`, `uxflows-1`, `gap-fuzz-cruzado-3`
Ubicación: [bootstrap.ts:52](apps/web/src/finance/bootstrap.ts#L52), [bootstrap.ts:87](apps/web/src/finance/bootstrap.ts#L87), [futures.ts:226](apps/web/src/finance/futures.ts#L226), [PlaylistShell.tsx:1154](apps/web/src/components/PlaylistShell.tsx#L1154)
- **Escenario, solo el activo:** después de 20 días, el usuario escribe "Saldo real hoy = 1,234". El futuro activo queda en 1,234, pero el estacionado, el fantasma de comparación y Q siguen con la caja supuesta (260,085 en un probe; 55,800 y 80,030 en otros). Cada rama se rueda con su propio pasado hipotético.
- **Escenario, futuro equivocado:** con el banner visible, el usuario cambia a "Rama B" y aplica "el pago de Nu no pasó". La Nu de B sube 3,000 y la del plan principal no cambia.
- **Arreglo:** RecState con `branchId` y el original de cada rama. Aplicar los mismos deltas (caja, saldos, MSI) a cada documento estacionado con `replaceParkedDocs`; la alternativa es rodar solo la rama activa y rebasar las demás por sus diferencias desde `forkDate`. Test: 2 ramas + Rec con `cashOverride` dan la misma caja inicial.

**P0-9 · Cortar, copiar y pegar entre futuros inventa monto y tipo**
alta · confirmado · M · `bridge-3`, `gap-fuzz-cruzado-5`, `gap-fuzz-cruzado-4`
Ubicación: [financial-bridge.ts:811](apps/web/src/finance/financial-bridge.ts#L811), [financial-bridge.ts:1341](apps/web/src/finance/financial-bridge.ts#L1341), [financial-bridge.ts:1394](apps/web/src/finance/financial-bridge.ts#L1394), [futures.ts:151](apps/web/src/finance/futures.ts#L151)
- **Escenario:**
  - Cortar "Bono +$20,000", visitar un futuro sin sesión, volver y pegar: queda "Bono" con +$300, clonado de su vecino "Regalo". En una fila vacía sería un gasto genérico de $500.
  - A la inversa, `importSession` no limpia `archiveBySource`, y un pegado en B toma el monto 99,999 de un objeto borrado en A.
  - Copiar en A y pegar en B pega el portapapeles viejo de B.
- **Arreglo:** el archivo de cortes y el portapapeles deben viajar con la sesión, no con el bridge. Limpiar `archiveBySource` en `importSession`. Si no se puede resolver la fuente de un clip pegado, no fabricar el objeto: avisar.

### Frente 4 · Motor financiero: cifras incorrectas

**P0-10 · Tarjeta totalera con Rec diario: adelanta el pago de compras hechas después del corte y luego guarda caja y saldo erróneos**
crítica · confirmado · M · `engine-1`
Ubicación: [rollforward.ts:477](packages/core/src/finance/rollforward.ts#L477), [projection.ts:208](packages/core/src/finance/projection.ts#L208)
- **Escenario:** corte el día 10, pago el 30, compras de $1,000 el 5 nov y $500 el 15 nov. Si se abre la app el 20 nov, el pago del 30 nov pasa a ser $1,500. Si se abre el 1 dic, se registra caja 8,500 y tarjeta en 0, cuando lo real es 9,000 y 500. Afecta unos 20 de cada 30 días a todo totalero con compras posteriores al corte.
- **Arreglo:** agregar `statementBalance?` a CreditCardItem (el estado ya cortado). La proyección y el payoff lo usan como `statement` inicial, y rollForward lo calcula. Exponerlo en contracts y en el editor.

**P0-11 · Un préstamo con saldo sigue cobrando caja después de liquidarse**
crítica · confirmado · M · `engine-2`
Ubicación: [projection.ts:254](packages/core/src/finance/projection.ts#L254)
- **Escenario:** saldo 10,000, pago 1,500, sin fecha de fin. La línea dice "Libre en may 2027", pero la proyección cobra 6 pagos más (−9,000) y el último pago completo aunque solo se debían 1,000. "Al horizonte" queda 9,500 por debajo. Después de un Rec, el préstamo en 0 vuelve a extenderse hasta el horizonte.
- **Arreglo:** `cashDelta = -applied`, como ya se hace en tarjetas, y no emitir el punto si `applied = 0`. En rollForward, eliminar los préstamos con saldo 0. Actualizar `finance-projection.spec.ts:228`, que hoy fija el comportamiento contrario.

**P0-12 · Marcar en Rec que el pago de un préstamo sin saldo "no pasó" perdona esa deuda**
alta · confirmado · S · `engine-3`
Ubicación: [bootstrap.ts:112](apps/web/src/finance/bootstrap.ts#L112)
- **Escenario:** préstamo de ventana, pago del 5 nov marcado como "no pasó". La caja sube 1,000, pero la deuda queda en 11,000 en vez de 12,000. El préstamo por defecto no tiene saldo, así que este es el caso común.
- **Arreglo:** comparar `debtByAccountAt` de las dos proyecciones en vez de los campos `balance`, y fijar `balance` en el ítem actual.

**P0-13 · La estrategia avalancha recomienda abonar dinero que el plan necesita días después**
alta · confirmado · M · `panels-1`, `engine-10`
Ubicación: [DebtStrategyPanel.tsx:39](apps/web/src/finance/components/DebtStrategyPanel.tsx#L39), [strategy.ts:139](packages/core/src/finance/strategy.ts#L139)
- **Escenario:** en el demo, con el playhead el 15 nov, el panel dice "Disponible para extra $3,000" y muestra +$3,000 en verde. La misma proyección baja a −$1,292 el 27 nov. Seguir el consejo deja la caja en −$4,292, mientras ValleyCard avisa del valle.
- **Arreglo:** el disponible es el mínimo de caja entre `date` y el siguiente ingreso (o +31 días), menos la reserva; cuesta O(log n + k) sobre `projection.points`. Si cae bajo la reserva, mostrar "$0: tu caja baja de la reserva el 27 nov".

**P0-14 · Teclear la fecha de inicio cambia en silencio el número de pagos y pierde "último día del mes"**
alta · confirmado · S · `forms-1`
Ubicación: [FinancialEditorModal.tsx:641](apps/web/src/finance/components/FinancialEditorModal.tsx#L641), [DateField.tsx:145](apps/web/src/finance/components/DateField.tsx#L145)
- **Escenario:** un mensual de 12 pagos. Teclear "15/11/2030" lo deja en 1 pago; volver a teclear la misma fecha lo deja en 10. Con el calendario se conservan los 12. La causa: `DateField` emite `""` en cada tecla parcial y `paymentCount(prev)` lee 0.
- **Arreglo:** que `DateField` solo emita fechas reconocidas (error local; `""` solo en blur). Que el editor guarde en un ref el último `recurrence` válido. Agregar un test que teclee carácter por carácter.

**P0-15 · Barra "/": con un solo monto, el préstamo toma el capital como pago mensual, y frases de tiempo se tragan en el nombre**
alta · confirmado · M · `command-2`, `command-4`
Ubicación: [command.ts:1191](apps/web/src/finance/command.ts#L1191), [command.ts:1200](apps/web/src/finance/command.ts#L1200)
- **Escenario:**
  - "préstamo 50000 a 12 meses" da un pago de 50,000 × 12, es decir 600,000.
  - "hipoteca 2 millones a 20 años" da 2 M × 240.
  - "café 45 diario" da un gasto único llamado "Café diario".
  - "uber 150 el lunes pasado" queda en el lunes próximo.
  - El resumen se ve verosímil y `assumed` no marca nada.
- **Arreglo:** con un monto y un plazo, tratar el monto como saldo y derivar el pago, mostrando "pago $X/mes · saldo $Y". Agregar vocabulario para diario, rangos "de X a Y", "pasado" y "primero". Si queda una palabra de tiempo en el nombre, marcarla como no entendida.

### Frente 5 · Historial y ciclo de vida del gesto

**P0-16 · El historial guarda todo el estado de UI: deshacer restaura viewport, herramienta, portapapeles y cabezal, y vuelve a pintar overlays y menús**
alta · confirmado · M (parche de transitorios: S) · `corestate-1`, `corestate-2`
Ubicación: [state.ts:442](packages/canvas/src/playlist-core/state.ts#L442), [state.ts:290](packages/canvas/src/playlist-core/state.ts#L290), [history.ts:45](packages/canvas/src/playlist-core/history.ts#L45)
- **Escenario:**
  - Editar, redimensionar o rotar, hacer scroll, cambiar a Cortar, copiar otro objeto y pulsar Ctrl+Z. El estado vuelve a 1200×700, scroll 0, herramienta select y portapapeles null. El canvas conserva el ancho viejo hasta el siguiente resize.
  - Arrastrar un día y deshacer deja pintados el fantasma, la línea de snap y la pastilla de fecha.
  - Borrar desde el menú y pulsar Ctrl+Z reabre el menú.
  - Lo mismo pasa al volver a un futuro estacionado.
- **Arreglo:** el historial guarda solo el documento (tracks, clips, markers y quizá la selección). En undo, redo y `loadSession`, conservar los campos de sesión del presente y limpiar `hover`, `dragPreview`, `snapHint`, `tooltip`, `contextMenu` y `marquee`.

**P0-17 · No existe `cancelGesture`: pinch, pointercancel, long-press, Ctrl+Z a mitad de un arrastre y cambiar de futuro dejan gestos abiertos o confirman lo que debían cancelar**
alta · confirmado (pointerup perdido: plausible) · M · `interaction-1` (alta), `interaction-2` (plausible), `interaction-3`/`corestate-5`, `interaction-9`, `interaction-10`, `gap-fuzz-cruzado-6` (medias)
Ubicación: [touch.ts:302](packages/canvas/src/playlist-interaction/touch.ts#L302), [controller.ts:1806](packages/canvas/src/playlist-interaction/controller.ts#L1806), [controller.ts:2281](packages/canvas/src/playlist-interaction/controller.ts#L2281), [controller.ts:1986](packages/canvas/src/playlist-interaction/controller.ts#L1986), [futures.ts:121](apps/web/src/finance/futures.ts#L121)
- **Escenario:**
  - Un dedo sobre "Renta" y un segundo dedo para pellizcar: el gesto nunca se cierra. Los overlays quedan pegados, ninguna edición posterior crea entrada de undo y el bridge sigue "en gesto", sin reanclar deudas.
  - pointercancel ejecuta el corte o abre el editor.
  - El long-press abre el menú, pero el arrastre sigue moviendo el objeto debajo.
  - Ctrl+Z con el botón pulsado deshace otra edición y después mete una entrada por cada pointermove (past pasa de 3 a 122 y el redo se pierde).
  - Bifurcar o cambiar de futuro con un gesto abierto mezcla el arrastre con la entrada anterior.
- **Arreglo:**
  - `core.cancelGesture()`: restaura `getGestureBase()` y cierra el gesto sin agregar entrada.
  - Un único `finishGesture('commit'|'cancel')`, llamado desde pointerup, pointercancel, `lostpointercapture`, blur, Esc, el inicio del pinch, el long-press y Ctrl+Z.
  - Tratar `buttons === 0` como pointerup.
  - `fork` y `switchTo` cierran o rechazan los gestos abiertos.

**P0-18 · Con el zoom alejado, agarrar un evento único por el centro lo recorta a 0.25 días y cambia su fecha**
alta · confirmado · S · `interaction-6`
Ubicación: [hit-test.ts:273](packages/canvas/src/playlist-interaction/hit-test.ts#L273)
- **Escenario:** en la vista Año (~2.7 px por día, eventos de unos 19 px) o con más zoom fuera, el asa izquierda de 8 px gana al cuerpo. El pago queda con 0.25 días de duración, casi invisible, y su fecha se mueve +7 días. Esto también alimenta P0-2.
- **Arreglo:** asas de `max(2, width/4)`, o desactivarlas si `width < 3 × asa`. Sin resize izquierdo en eventos únicos.

### Frente 7 · Superficies atascadas en móvil

**P0-19 · `min-height: 100vh` deja fuera de pantalla los últimos 56–80 px en Chrome Android y Safari iOS**
alta · confirmado (no probado en dispositivo) · S · `styles-1`
Ubicación: [globals.css:283](apps/web/src/styles/globals.css#L283)
- **Escenario:** el banner de bienvenida, el toggle del inspector, la barra de scroll horizontal y el único aviso de error del renderer quedan bajo la barra del navegador, y la página no se puede desplazar para verlos.
- **Arreglo:** `height: 100dvh` sin `min-height`, o `height: 100%`. Probarlo con la barra de URL dinámica activa.

**P0-20 · La barra "/" no se puede cerrar en táctil ni con un clic fuera**
alta · confirmado · S · `command-5`, `gap-modos-transitorios-2`
Ubicación: [CommandBar.tsx:69](apps/web/src/finance/components/CommandBar.tsx#L69), [PlaylistShell.tsx:1072](apps/web/src/components/PlaylistShell.tsx#L1072), [PlaylistShell.tsx:1216](apps/web/src/components/PlaylistShell.tsx#L1216)
- **Escenario:**
  - En el teléfono, "Nuevo → Escribir…": el teclado virtual no tiene Esc. La única salida es agregar un objeto, y con el campo vacío Enter agrega la sugerencia resaltada.
  - En escritorio, un clic en el canvas le quita el foco al input, y desde ahí Esc y "/" dejan de funcionar.
  - Mientras la barra sigue abierta, ValleyCard está oculta y el carril sigue mostrando el escenario hipotético.
- **Arreglo:** un botón × de 44 px, `useDismiss` para cerrar con un toque fuera, Escape global cuando `commandOpen`, que "Escribir…" alterne, y que "/" vuelva a enfocar el input.

---

## P1: Escalabilidad y riesgos estructurales

### Frente 6 · Memoria que crece con el uso

**P1-1 · Cada arrastre retiene una proyección completa mientras su estado siga en el historial**
alta · confirmado · S · `bridge-4`, `engine-5`, `gap-fuzz-cruzado-2`, `gap-modos-transitorios-1`
Ubicación: [financial-bridge.ts:297](apps/web/src/finance/financial-bridge.ts#L297), [financial-bridge.ts:1720](apps/web/src/finance/financial-bridge.ts#L1720)
- **Medido con el horizonte real de 12 meses:** 0.37–0.56 MB por gesto. 200 gestos suben el heap entre +99 y +165 MB, contra +8 MB sin pedir el carril o con el WeakMap anulado.
- **Techo:** 200 entradas por futuro, multiplicado por cada futuro con sesión: 0.5–1 GB en sesiones largas con 5–10 futuros. En Android la pestaña muere y se pierde lo que estaba en el debounce.
- **Arreglo:** una caché de una sola ranura `{snapshot, projection}` para la base del gesto abierto, llenada con la proyección saliente y vaciada al cerrar el gesto y en `resetTransient`. Agregar el budget "N gestos ⇒ heap acotado".

**P1-2 · `normalizeState` realoja todos los clips en cada edición y clona portapapeles, selección y overlays en cada dispatch**
media · confirmado · S · `corestate-3`, `corestate-8`
Ubicación: [state-utils.ts:308](packages/canvas/src/playlist-core/state-utils.ts#L308), [state-utils.ts:215](packages/canvas/src/playlist-core/state-utils.ts#L215)
- **Medido:**
  - 300 clips × 200 ediciones = 60,300 objetos clip distintos: +5.8 MB por futuro, +14 MB con el portapapeles lleno.
  - Un dispatch de scroll con 2,000 clips copiados pasa de 1.8 µs a 98 µs.
  - El guard `dragPreview ===` nunca se cumple, así que en cada hover durante un arrastre corre `provisionalLanes` O(N).
  - El menú contextual abierto se re-renderiza en cada tick.
- **Arreglo:** devolver el mismo objeto clip si ya está normalizado, y compartir por referencia clipboard, markers, selection, dragPreview y contextMenu.

**P1-3 · El registry del renderer nunca libera los nodos de clips borrados**
media · confirmado · M · `renderer-2`
Ubicación: [clip-node-registry.ts:951](packages/canvas/src/playlist-renderer-pixi/clip-node-registry.ts#L951)
- **Medido:** 50 rondas de crear y borrar 10 clips dejan 500 nodos para 10 vivos. Crece con cada id distinto (slice, pegar, estados de cuenta). Un clip silenciado y largo retiene MB.
- **Arreglo:** desalojar el nodo cuando su id ya no esté en `state.clips` (revisar solo si cambió la referencia), hacer `clear()` de los bodies ocultos, y mandar sus Text a una free-list. Reutilizar un Set por frame en vez de crear uno nuevo.

### Frente 6 · Costo por interacción

**P1-4 · ValleyCard calcula los valles (explicación + hasta 9 proyecciones) dentro del render**
alta · confirmado · M · `gap-render-react-escala-2`
Ubicación: [ValleyCard.tsx:29](apps/web/src/finance/components/ValleyCard.tsx#L29)
- **Medido:** el primer hover sobre un valle tarda 40–210 ms en frío. Con el playhead dentro de un valle, cada commit (incluido cada paso de arrastre) suma 22–42 ms. Aplicar un Rec suma 36–168 ms.
- **Arreglo:** mostrar primero la explicación y calcular `fixes` diferido (idle o `useDeferredValue`) con "Buscando arreglos…". No recalcular con un gesto abierto. Reutilizar `this.projection` como base.

**P1-5 · RecDialog pinta y valida toda la tabla en cada tecla**
alta · confirmado · M · `gap-render-react-escala-1`, `persist-9`, `forms-12`, `styles-5`
Ubicación: [RecDialog.tsx:86](apps/web/src/finance/components/RecDialog.tsx#L86), [RecDialog.tsx:154](apps/web/src/finance/components/RecDialog.tsx#L154), [globals.css:2981](apps/web/src/styles/globals.css#L2981)
- **Medido con 300 objetos (React dev):**
  - 90 días fuera: 794–857 filas, 53–64 ms por select o tecla.
  - 1 año fuera: 2,786–5,236 filas, abrir tarda 0.65–1.4 s, 180–340 ms por tecla y 160 ms por blur.
  - "Saldo real hoy" y "Aplicar" quedan al final de unos 17,000 px de tabla.
- **Arreglo:** agrupar por objeto (conteo y total, expandible) con acciones en lote. Poner "Saldo real hoy" arriba y el pie sticky. Filas memoizadas en modo `uncontrolled`, o virtualizadas. Validar al enviar.

**P1-6 · El rayado de los clips silenciados emite un trazo por línea a lo ancho de todo el clip**
alta · confirmado · S · `renderer-1`
Ubicación: [clip-node-registry.ts:460](packages/canvas/src/playlist-renderer-pixi/clip-node-registry.ts#L460)
- **Medido:** con Solo activo (todo lo demás silenciado), cada frame de zoom cuesta 15–160 ms contra 0.8 ms normal. Un préstamo de 20 años silenciado cuesta unos 210 ms por redibujo con zoom máximo. También se redibuja en hover y selección.
- **Arreglo:** un solo path con un único stroke, limitado a la ventana visible; mejor aún, una textura de rayas (TilingSprite o FillPattern). Agregar el budget "clip silenciado largo < 2 ms".

**P1-7 · El hover del carril vive en la raíz del shell: cada día recorrido re-renderiza todo, incluida la tabla de deudas sin límite**
media · confirmado · S · `shell-9`, `panels-5`, `gap-render-react-escala-4`, `-6`
Ubicación: [PlaylistShell.tsx:788](apps/web/src/components/PlaylistShell.tsx#L788), [PlaylistShell.tsx:875](apps/web/src/components/PlaylistShell.tsx#L875), [DebtStrategyPanel.tsx:80](apps/web/src/finance/components/DebtStrategyPanel.tsx#L80)
- **Medido (jsdom, React dev):** 60 cambios de día dan 60 commits del árbol completo, de 4–8 ms cada uno. Con el riel Análisis abierto, la tabla de deudas (79–171 filas, sin límite) suma 3.4–22.6 ms por commit, y abrir el riel cuesta 89–136 ms. Hay 0 `React.memo` en `apps/web/src`, contra la regla 7 del canon de performance.
- **Arreglo:** mover `hoverDay` a un store externo que solo lea ValleyCard (`useSyncExternalStore`). Memoizar SummaryBar, SidePanel y Toolbar con `tools` y callbacks estables. En la tabla, top-N de deudas con "Ver todas" y `DebtRow` memoizado.

**P1-8 · Rec y estado de cuenta hacen un commit, una proyección y una entrada de undo por fila (no hay API de lote)**
media · confirmado · M · `bridge-9`, `forms-4`, `gap-render-react-escala-3`
Ubicación: [bootstrap.ts:107](apps/web/src/finance/bootstrap.ts#L107), [StatementDialog.tsx:98](apps/web/src/finance/components/StatementDialog.tsx#L98)
- **Medido:** 65 correcciones de deuda generan 23–37 commits y otras tantas entradas de undo, con la UI congelada 0.27–1.2 s. Un replace + 30 add tardan 245 ms.
- **Consecuencias:** un Ctrl+Z deshace una sola fila. Con la línea bloqueada, `replaceItem` devuelve `false` (nadie lo revisa) y el estado de cuenta queda aplicado a medias.
- **Arreglo:** `bridge.batch(fn)` con un solo `apply`, un solo `recompute` y una sola entrada de undo. Revisar los retornos y abortar el lote si alguna escritura se veta.

**P1-9 · El arranque rueda y valida todos los futuros antes del primer pintado**
media · confirmado · M · `persist-13`, `gap-render-react-escala-5`
Ubicación: [bootstrap.ts:52](apps/web/src/finance/bootstrap.ts#L52), [persistence.ts:48](apps/web/src/finance/persistence.ts#L48)
- **Medido con 15 futuros × 300 objetos:** `parsePlan` 31–62 ms y `bootstrapPlan` 99–409 ms (en un probe, el montaje completo tardó ~1 s). Crece lineal con los futuros, y no hay skeleton mientras `bridge` es null.
- **Arreglo:** rodar solo el futuro activo y el resto en `switchTo`, `docOf`, `peekTarget` o en idle. Mover el `savePlan` inicial a idle. Mostrar un skeleton de la barra.

**P1-10 · La vista previa de "/" reproyecta todo en cada tecla, aunque solo cambie el nombre**
media · confirmado · S · `command-10`
Ubicación: [CommandBar.tsx:54](apps/web/src/finance/components/CommandBar.tsx#L54)
- **Medido:** el parser cuesta 0.1 ms; la tecla completa, 26 ms de mediana con 300 objetos a 30 años. A 12 meses es bajo: el costo está en la proyección.
- **Arreglo:** una clave de preview sin `name` ni `id`, más `useDeferredValue` o un debounce de unos 120 ms.

**P1-11 · Pixi mantiene un rAF perpetuo en reposo (Ticker.system del SchedulerSystem)**
media · confirmado · S · `renderer-8`
Ubicación: [renderer-impl.ts:531](packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts#L531)
- **Medido:** 121 rAF en 120 frames sin ninguna actividad. Contradice el canon §3.11, y el lint `pixi-idle-ticker` no lo detecta.
- **Arreglo:** después de `init`, quitar `scheduler._update` de `Ticker.system` y correr `renderer.gc.run()` a mano. Agregar una aserción en un test.

**P1-12 · Pintar construye un set de celdas de todo el documento en cada clic**
media · confirmado · M · `interaction-11`
Ubicación: [brush.ts:54](packages/canvas/src/playlist-interaction/brush.ts#L54)
- **Medido:** 0.23–1.3 s con 100–300 objetos a 10 años, y 2.2–4 s a 30 años. Hoy solo se llega con el atajo oculto B (ver P2-2).
- **Arreglo:** sembrar solo las filas y el rango que toca el trazo, con búsqueda por intervalos.

**P1-13 · El body completo del clip se redibuja en hover, selección y cada frame de zoom**
media · plausible · M · `renderer-4`
Ubicación: [clip-node-registry.ts:899](packages/canvas/src/playlist-renderer-pixi/clip-node-registry.ts#L899)
- **Medido a tamaños alcanzables:** 0.85 ms por hover y 4.5–6 ms por frame de zoom con 20 clips en escritorio. El riesgo está en Android (3–5× más lento) y en horizontes largos.
- **Arreglo:** separar el hash del body (contenido) del hash del overlay (hover, selección, highlight). Dibujar solo la ventana visible. Usar 2 fills en vez de N.

**P1-14 · `SET_TRACK_HEIGHT` y `SET_SELECTION` no son idempotentes, y hay helpers O(U×N)**
baja · confirmado · S · `corestate-7`, `corestate-9`
Ubicación: [reducer.ts:1025](packages/canvas/src/playlist-core/reducer.ts#L1025), [state.ts:547](packages/canvas/src/playlist-core/state.ts#L547)
- **Medido:** con 2,000 objetos, duplicar o pegar tarda 66–77 ms. Con 300 es barato.
- **Arreglo:** devolver el mismo state si nada cambió. Usar un Map id→clip por llamada y un Set de ids en `makeClipId`.

### Frente 6 · Precipicio por horizonte (latente)

**P1-15 · Cada paso de arrastre reproyecta todo y reconstruye todos los providers, y ningún budget lo vigila**
media latente (`interaction-4` quedó en alta, pero se midió a horizontes inalcanzables) · confirmado · L · `bridge-5`, `interaction-4`, `engine-7` (plausible), `guardrails-8`
Ubicación: [financial-bridge.ts:1608](apps/web/src/finance/financial-bridge.ts#L1608), [Onboarding.tsx:137](apps/web/src/finance/components/Onboarding.tsx#L137), [perf-budget.spec.ts](packages/canvas/tests/perf-budget.spec.ts)
- **Medido con 300 objetos, por pointermove (Node, sin render):** 2–6 ms a 12 meses, 12–46 ms a 120 meses, 34–117 ms a 360 meses. `valleyAt` cuesta 100–250 ms y deshacer 32–71 ms. Hoy el horizonte está fijo en 12 meses y no hay jank. El primer cambio que lo abra (P2-10) dejará el arrastre en 2–15 fps sin que falle ningún gate.
- **Arreglo, antes de abrir el horizonte:**
  - Budgets del bridge en `apps/web/tests`: arrastre, replace y undo < 16 ms con 300 objetos en el horizonte máximo.
  - Proyección incremental desde el primer día afectado (checkpoints mensuales).
  - Coalescer `recompute` por rAF mientras haya un gesto abierto.
  - Calcular los valles fuera del gesto.

### Frente 2 · Persistencia sin red: riesgos medios

**P1-16 · El autosave no se vacía al salir, y el cleanup cancela el guardado pendiente**
media · confirmado · S · `shell-3`, `bridge-8`, `persist-4`, `guardrails-3`
Ubicación: [PlaylistShell.tsx:930](apps/web/src/components/PlaylistShell.tsx#L930), [PlaylistShell.tsx:1012](apps/web/src/components/PlaylistShell.tsx#L1012)
- **Escenario:** guardar un monto y cerrar o recargar antes de 600 ms, o que un crash de render haga que el ErrorBoundary desmonte el shell: la última edición se pierde (medido en jsdom). En Android, que el SO congele la pestaña dentro de esa ventana es un caso borde, no la norma.
- **Arreglo:** `flushSave()` en `pagehide`, en `visibilitychange→hidden` y en el cleanup, en lugar de `clearTimeout`.

**P1-17 · Sin migración ni respaldo: lo que no valida se borra en silencio y el autosave lo vuelve permanente**
media · confirmado · M · `persist-2`
Ubicación: [persistence.ts:52](apps/web/src/finance/persistence.ts#L52), [persistence.ts:63](apps/web/src/finance/persistence.ts#L63)
- **Escenario:** un rollback de deploy (Workers Builds despliega cada push) con un kind nuevo, una regla más estricta o `v !== 1` hace que la build descarte objetos, ramas o el plan entero (y caiga al demo). El primer gesto sobrescribe lo guardado. Este mismo mecanismo es el que vuelve permanentes P0-2 y P0-3.
- **Arreglo:**
  - `migrate[v]` antes de validar.
  - Antes de cualquier descarte, copiar el JSON crudo a `slicex.plan.v1.backup-<fecha>` y avisar ("3 objetos no se pudieron leer").
  - Si `parsePlan` falla con datos presentes, mostrar una pantalla de recuperación en vez del demo.

**P1-18 · `?reset` borra el plan y todos los futuros sin confirmar ni respaldar**
media · confirmado · S · `persist-12`
Ubicación: [main.tsx:22](apps/web/src/main.tsx#L22)
- **Escenario:** un enlace compartido, o el autocompletado del navegador con `/?reset`, borra todo de forma irreversible.
- **Arreglo:** que el botón "Reiniciar" ponga un token de un solo uso en sessionStorage y `?reset` lo exija. Respaldar antes de borrar y ofrecer "Deshacer reinicio".

**P1-19 · "Hoy" se congela al montar el shell**
media · confirmado · S · `shell-10`, `persist-11`, `engine-11`, `uxflows-12`
Ubicación: [PlaylistShell.tsx:787](apps/web/src/components/PlaylistShell.tsx#L787)
- **Escenario:** con la PWA o la pestaña abierta de un día para otro, "/ gasté 300 hoy" se fecha ayer. "Liquidez hoy" y "Próximo pago" son de ayer, el estado de cuenta clasifica los cargos de hoy como futuros, y Rec no aparece hasta recargar.
- **Arreglo:** recalcular en `visibilitychange` y con un timer a medianoche. Si cambió el día: flush, rollForward y banner de Rec. Para eso, `today` tiene que salir de las deps del efecto de build (ver P1-25).

### Frente 8 · Red de seguridad y ciclo de vida del canvas

**P1-20 · Fallos de arranque o de render sin manejo: pantalla vacía, un solo boundary en inglés y ninguna salida que conserve los datos**
media · confirmado (build sin catch: plausible) · M · `shell-4`, `guardrails-7`, `shell-5`, `guardrails-5`
Ubicación: [PlaylistShell.tsx:834](apps/web/src/components/PlaylistShell.tsx#L834), [ErrorBoundary.tsx:17](apps/web/src/components/ErrorBoundary.tsx#L17), [ErrorBoundary.tsx:24](apps/web/src/components/ErrorBoundary.tsx#L24)
- **Escenario:**
  - Si `build()` lanza (corre dentro de `font.ready.then`, sin catch), el escenario queda vacío y sin texto.
  - Si lanza entre `setCore` y la línea 937, los paneles aparecen pero el autosave nunca se suscribe.
  - Un throw en cualquier panel tumba también el canvas y muestra "SliceX hit a fatal error · Try again". Eso recarga el mismo plan (posible bucle) y pierde el undo de todos los futuros.
  - La única salida conocida, `?reset`, borra todo.
  - No se encontró un disparador concreto hoy.
- **Arreglo:**
  - try/catch y `.catch` en build, con `setError`.
  - Boundaries por zona (barra, riel, ValleyCard, diálogos) con fallback local en español.
  - Boundary raíz que haga flush y ofrezca "Descargar mi plan (.json)" (leyendo el storage crudo) y "Empezar de nuevo" con respaldo.

**P1-21 · Sentry no recibe los crashes que atrapa el ErrorBoundary ni los fallos del renderer**
media · confirmado · S · `shell-6`, `guardrails-4`
Ubicación: [ErrorBoundary.tsx:13](apps/web/src/components/ErrorBoundary.tsx#L13), [main.tsx:35](apps/web/src/main.tsx#L35), [sentry.ts:12](apps/web/src/lib/sentry.ts#L12)
- **Escenario:** React 19 no pasa los errores atrapados a `window.onerror`, y `createRoot` se llama sin `onCaughtError`. `VITE_SENTRY_DSN` no está documentada y no hay sourcemaps. Los crashes más graves no los ve nadie.
- **Arreglo:** `onCaughtError`, `onUncaughtError` y `onRecoverableError` con `Sentry.reactErrorHandler()`. `captureException` en el `onError` del renderer. Documentar el DSN de build, `build.sourcemap: 'hidden'`, y un `beforeSend` que quite montos y nombres.

**P1-22 · Si se pierde el contexto WebGL, el canvas queda en blanco hasta la siguiente interacción**
media · confirmado (disparador en Android: plausible) · S · `renderer-3`, `shell-12`
Ubicación: [renderer-impl.ts:553](packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts#L553), [PlaylistShell.tsx:896](apps/web/src/components/PlaylistShell.tsx#L896)
- **Escenario:** Pixi 8.17 solo emite `contextChange` al restaurar el contexto, y el renderer pinta solo bajo demanda. En táctil, sin hover, el plan "desaparece" hasta que se toca algo, y ese toque puede mover un objeto invisible. Si `app.init` falla, sale un mensaje crudo en inglés sin reintento.
- **Arreglo:** en `webglcontextrestored`, `invalidateCachedLayers()` + `requestRender()`. Overlay "Restaurando vista…". Mensaje en español con "Reintentar".

**P1-23 · Un suscriptor que lanza deja mudos al renderer y al autosave**
media · confirmado (`renderNow`: plausible, baja) · M · `gap-fuzz-cruzado-7`, `renderer-10`
Ubicación: [state.ts:1491](packages/canvas/src/playlist-core/state.ts#L1491), [renderer-impl.ts:455](packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts#L455)
- **Escenario:** duplicar un gasto del 28/12/9999 crea la fecha `10000-01-04`. Desde ahí, cada edición lanza dentro del bridge, que es el primer suscriptor, y `notify` (sin try/catch) deja sin notificar al renderer y al autosave. El canvas y las cifras divergen y nada se guarda. Además, un provider que lance dentro de `renderNow` congela el canvas sin aviso.
- **Arreglo:** limitar las fechas en `dateOf` y `moveClips` al máximo del esquema. Aislar cada listener de `notify` (try/catch y relanzar en un microtask). try/catch en `renderNow` que llame `onError` una sola vez.

### Frente 1 · Integridad: riesgo medio

**P1-24 · Los nombres que el usuario pone a una línea se borran en cada carga si coinciden con un objeto**
media · confirmado · S · `bridge-7`
Ubicación: [mapping.ts:305](apps/web/src/finance/mapping.ts#L305)
- **Escenario:** renombrar a "Renta" la fila que contiene el objeto "Renta" y recargar: vuelve a "Línea de evento". Es una migración sin versión que corre en cada carga.
- **Arreglo:** `layoutVersion` en el layout, y saltar `appGivenRowLabel` en layouts ya migrados (o un flag `named` en las filas renombradas).

### Frente 11 · Deuda estructural y gates

**P1-25 · Módulos monolíticos donde nacen los bugs de arriba**
media · confirmado (editor: plausible) · L · `shell-14`, `bridge-10`, `interaction-13`, `command-12`, `forms-8`, `styles-10`
- [PlaylistShell.tsx](apps/web/src/components/PlaylistShell.tsx#L1039) (1,341 líneas):
  - **Problema:** `editorOpen` es un OR manual, así que un diálogo nuevo que no se agregue deja vivos Ctrl+Z, "/" y Q detrás de él. El efecto de build tiene 230 líneas con cleanup manual. `Futures` nace con deps `[today, metrics]`, de modo que arreglar P1-19 o P2-15 de la forma obvia borra todo el undo.
  - **Arreglo:** un `useFinancialSession()` de identidad estable y un `ModalStack` donde cada diálogo se registre solo.
- [financial-bridge.ts](apps/web/src/finance/financial-bridge.ts#L254) (1,771 líneas, 36 campos, 8 cachés con 5 tipos de llave, 11 escrituras a `this.doc`):
  - **Problema:** de aquí salen P0-9, P1-1 y la totalera de P2-9.
  - **Arreglo:** separar SessionState (exportable con la sesión), PlaylistSync, ProjectionViews (una sola llave) y GestureState, con un `commitDoc` único.
- [controller.ts](packages/canvas/src/playlist-interaction/controller.ts#L1211) (2,316 líneas, 20 kinds repartidos en 4 listas, 7 `beginGesture`):
  - **Problema:** es el origen de P0-17.
  - **Arreglo:** un registro de handlers de gesto `{begin, move, commit, cancel}`.
- [command.ts](apps/web/src/finance/command.ts#L748) (1,475 líneas):
  - **Problema:** la pre-pasada `detectKind` diverge de las pasadas que consumen tokens, `catch { return null }` esconde excepciones, y el fuzz no valida el esquema.
  - **Arreglo:** un solo reconocedor con registro de frases, y una tabla de frases MX en los tests.
- [FinancialEditorModal.tsx](apps/web/src/finance/components/FinancialEditorModal.tsx#L1175) (1,239 líneas):
  - **Problema:** los switches terminan en `default`, así que un kind nuevo compila sin campos. Las reglas de "Cuándo" son closures del componente, y ahí vive P0-14.
  - **Arreglo:** `assertNever` en los switches, y las reglas en un `item-form.ts` puro con tests de tabla.
- [globals.css](apps/web/src/styles/globals.css#L3250) (3,563 líneas, 52 selectores redeclarados, 14 bloques @media dispersos, código muerto):
  - **Arreglo:** `@layer`, CSS por componente y stylelint en `check:arch`.

**P1-26 · Los gates no protegen producción**
media · confirmado · S–M · `guardrails-9`, `guardrails-6`, `guardrails-10`
Ubicación: [package.json:28](package.json#L28), [ci.yml](.github/workflows/ci.yml), [reload-stress.pw.ts:42](apps/web/tests/reload-stress.pw.ts#L42), [check-imports.mjs:17](scripts/check-imports.mjs#L17)
- **Escenario:**
  - `pre:commit` es un script de npm, no un hook instalado.
  - Workers Builds despliega cada push a master sin esperar al CI. Además, en el CI, `setup-node` con `cache: pnpm` corre antes de `corepack enable`, así que probablemente falla.
  - La única e2e recarga sin editar (nunca pasa por autosave → loadPlan), y su aserción de "Cargando" no prueba nada.
  - `finance-shell.spec` mockea el bridge.
  - `check-imports` no impide que `@slicex/core` importe React o Pixi.
  - P0-2 pasó todos los gates.
- **Arreglo:**
  - Un hook real (simple-git-hooks o husky con `prepare`).
  - Build command de Workers: check:arch + typecheck + vitest + build.
  - e2e "editar monto → recargar → sigue ahí" y "plan de hace 14 días con 3 futuros monta sin errores".
  - Test unitario del shell con el bridge real y fake timers.
  - Reglas por paquete en `check-imports`.

---

## P2: Fricción UX y accesibilidad

### Frente 9 · Confianza al editar

**P2-1 · No hay deshacer visible ni confirmación después de acciones destructivas o de Enter en "/"**
alta · confirmado · S–M · `uxflows-5`, `command-13`
Ubicación: [PlaylistShell.tsx:1076](apps/web/src/components/PlaylistShell.tsx#L1076), [PlaylistShell.tsx:359](apps/web/src/components/PlaylistShell.tsx#L359), [CommandBar.tsx:99](apps/web/src/finance/components/CommandBar.tsx#L99)
- **Escenario:** en táctil, elegir "Vaciar línea de evento" por error borra sueldo, renta y gastos fijos sin confirmación ni forma de deshacer, y el autosave lo persiste. En "/", después de "netflix 219 mensual el 5" + Enter, el clip cae en una línea nueva fuera de la vista y el usuario lo vuelve a escribir.
- **Arreglo:** botones Deshacer y Rehacer en la toolbar. Toasts como "Eliminado · Deshacer" o "Agregado: Netflix $219 cada mes · Deshacer". Confirmar "Vaciar" cuando la línea tenga más de un objeto. Revelar el clip nuevo.

**P2-2 · Atajos DAW vivos: Retroceso alterna el imán, B pinta gastos de $500, y siguen R, L, Insert y los marcadores**
media · confirmado · S · `interaction-12`, `interaction-5`, `uxflows-10`
Ubicación: [controller.ts:2060](packages/canvas/src/playlist-interaction/controller.ts#L2060), [paint.ts:47](packages/canvas/src/playlist-interaction/tools/paint.ts#L47), [controller.ts:98](packages/canvas/src/playlist-interaction/controller.ts#L98)
- **Escenario:**
  - En Mac, ⌫ sobre un gasto no lo borra: el ajuste pasa a "Libre" y los arrastres siguientes caen en fracciones de día.
  - "b" + clic crea un "Gasto" de $500 sin pasar por el editor, contra la decisión documentada en `PlaylistShell.tsx:879`.
  - "r" hace pulsar una banda de grabación que no tiene nada que ver con Rec.
- **Arreglo:** Backspace igual a Delete. Que el host declare las herramientas y atajos permitidos (finanzas apaga paint, slip, transporte y marcadores). Que Pintar respete `onCreateRequest`.

**P2-3 · Cerrar un menú del encabezado haciendo clic en el canvas ejecuta la herramienta activa**
media · confirmado · S · `panels-4`
Ubicación: [use-dismiss.ts:46](apps/web/src/ui/use-dismiss.ts#L46)
- **Escenario:** con Borrar activo, abrir "Futuros" y hacer clic sobre un objeto para cerrar el menú lo borra.
- **Arreglo:** que `useDismiss` consuma la pulsación de cierre en la fase de captura cuando cae sobre el host del canvas.

**P2-4 · La tarjeta del valle tapa el inspector, su descarte no dura y no hay escala de z-index**
media · confirmado · S · `panels-6`, `styles-3`
Ubicación: [ValleyCard.tsx:38](apps/web/src/finance/components/ValleyCard.tsx#L38), [globals.css:2346](apps/web/src/styles/globals.css#L2346)
- **Escenario:** la tarjeta (z 8) cubre 278 px del inspector abierto (z 6), incluido su botón de cerrar. Al descartarla, vuelve con la siguiente edición o al recargar, porque la clave es `startDate:eventId`. Hay 10 valores literales de z-index y ninguna variable.
- **Arreglo:** descartar por episodio y recordarlo por plan. Cerrar con Escape. Una escala `--z-*` en `:root`. Desplazar el valle cuando haya un riel abierto.

**P2-5 · La tarjeta totalera se estira sin feedback, regresa al soltar y deja un undo fantasma**
media · confirmado · S · `bridge-6`
Ubicación: [financial-bridge.ts:1160](apps/web/src/finance/financial-bridge.ts#L1160)
- **Arreglo:** `canExtend = false` en tarjetas de tipo statement, o mostrar la nota sin depender del baseline. No crear la entrada de undo.

**P2-6 · Horizonte fijo de 12 meses, sin control ni aviso**
media · confirmado · M · `uxflows-7`
Ubicación: [Onboarding.tsx:137](apps/web/src/finance/components/Onboarding.tsx#L137), [financial-bridge.ts:829](apps/web/src/finance/financial-bridge.ts#L829)
- **Escenario:** un clip arrastrado al mes 14 se ve en el canvas pero no cuenta en la caja ni en las alertas. De un crédito de 48 meses, la caja solo se proyecta 12.
- **Arreglo:** marcar en el canvas "Hasta aquí calculamos" y avisar al soltar un objeto fuera. Ofrecer otros horizontes solo después de resolver P1-15.

### Frente 3 · Futuros y Rec: fricción

**P2-7 · Los modos transitorios (Q/A, "/", base fijada) muestran cifras que no coinciden entre sí**
media · confirmado · M · `gap-modos-transitorios-3`, `-4`, `-5`
Ubicación: [PlaylistShell.tsx:1061](apps/web/src/components/PlaylistShell.tsx#L1061), [PlayheadReadout.tsx:22](apps/web/src/finance/components/PlayheadReadout.tsx#L22), [FinancialSidePanel.tsx:24](apps/web/src/finance/components/FinancialSidePanel.tsx#L24)
- **Escenario:**
  - Con Q pulsada, el punto del carril vale $45,708 (futuro B), pero la lectura de su propia celda y el tooltip dicen $7,708 (futuro A). ValleyCard sigue explicando A, y su "Aplicar" modifica A.
  - La pastilla de Q se calcula una vez y se congela: tras deshacer muestra −$1,292 cuando el valor real es −$12,292.
  - La "Base fijada" sobrevive al cambio de futuro y a "Crear mi año".
- **Arreglo:** que el bridge exponga el modo de vista efectivo, y que lectura, tooltip y valle lo sigan o se marquen como "vista previa". Pastilla derivada de la revisión. "Aplicar" deshabilitado durante una preview. La base fijada guarda id y nombre de su futuro.

**P2-8 · Onboarding: se pierde en cuanto se toca el ejemplo, y "Crear mi año" deja vivos los futuros del demo**
media · confirmado · S–M · `panels-3`, `panels-2`, `uxflows-13`, `gap-fuzz-cruzado-9`
Ubicación: [PlaylistShell.tsx:863](apps/web/src/components/PlaylistShell.tsx#L863), [PlaylistShell.tsx:1147](apps/web/src/components/PlaylistShell.tsx#L1147)
- **Escenario:** arrastrar un pago del ejemplo y cerrar: al día siguiente no hay bienvenida, sino un Rec sobre datos ficticios. Si se bifurcó el ejemplo antes de "Crear mi año", el año real queda como "Rama desde …" y el demo queda como fantasma de comparación, persistido.
- **Arreglo:** marcar `origin: "example"`; mientras siga siéndolo, mantener el banner y no ofrecer Rec. `Futures.reset(doc)` en createYear, y soltar la base fijada. Una entrada permanente "Armar mi año…".

### Frente 2 · Persistencia: fricción

**P2-9 · Rec: "Después" pierde la revisión para siempre si se recarga**
media · confirmado · M · `persist-5`, `uxflows-4`
Ubicación: [PlaylistShell.tsx:961](apps/web/src/components/PlaylistShell.tsx#L961)
- **Escenario:** el plan rodado se guarda al arrancar, pero RecState solo vive en React. Después de "Después" y una recarga, no hay banner ni forma de reabrir Rec. "Liquidez hoy" y los saldos se pueden corregir a mano, pero se pierde el flujo guiado y el registro en el ledger.
- **Arreglo:** persistir `pendingRec` (fecha y originales por rama) hasta que se aplique o se descarte, y una entrada "Revisar lo que pasó" en el menú.

### Frente 4 · Captura que mete datos equivocados

**P2-10 · Montos ambiguos aceptados en silencio: "2,50" se guarda como 250, "1.500" como 1.5 y "0x10" como 16**
media · confirmado · S · `forms-3`, `engine-12`
Ubicación: [format.ts:143](apps/web/src/finance/format.ts#L143)
- **Arreglo:** un parser estricto para es-MX: rechazar exponentes y hexadecimales, máximo 2 decimales, un tope de ~1e12, y tratar la ambigüedad como error ("¿Quisiste decir 2.50?"). Mostrar junto al campo el valor interpretado.

**P2-11 · Estado de cuenta: "PAGO" invierte cargos y pegar dos veces duplica movimientos**
media · confirmado · M · `persist-8`, `persist-10`, `forms-2`
Ubicación: [statement.ts:269](apps/web/src/finance/statement.ts#L269), [StatementDialog.tsx:92](apps/web/src/finance/components/StatementDialog.tsx#L92)
- **Escenario:** "PAGO DE SERVICIOS CFE 850.00", "DOMICILIACION PAGO TELCEL 499.00" y "UBER TRIP - 89.00" se leen como abonos: error de 5,276 en la deuda del ejemplo. `newBalance = balance + net` no tiene fecha de corte, así que duplica lo que el saldo ya incluía o lo que se pegó antes.
- **Arreglo:** "pago" indica abono solo en patrones de pago a la tarjeta. El "-" es negativo solo si va pegado al número. Una casilla por fila con la marca "ya importada" (hash fecha + monto + descripción, más `statementImportedThrough`). La opción "Mi saldo ya incluye estos cargos".

**P2-12 · Barra "/": lecturas erróneas de severidad media**
media · confirmado · S–M · `command-3`, `-6`, `-7`, `-8`, `-9`
Ubicación: [command.ts:606](apps/web/src/finance/command.ts#L606), [command.ts:1233](apps/web/src/finance/command.ts#L1233), [command.ts:100](apps/web/src/finance/command.ts#L100), [command.ts:762](apps/web/src/finance/command.ts#L762), [command.ts:761](apps/web/src/finance/command.ts#L761)
- **Escenario:**
  - "N pagos" con un periodo mayor a un mes se trunca: trimestral de 12 pagos da 5, anual de 10 da 1.
  - "por 6 meses" sin frecuencia da un gasto único.
  - "veinticinco mil" da $1,000; "renta 8 000" da $8.
  - "tarjeta nu 5000" duplica la tarjeta Nu, y en "límite 50000 saldo 12000" se toma el límite como saldo.
  - "pagué con la nu 800 cena" da un gasto en efectivo.
- **Arreglo:** ventana calculada con el periodo real; inferir mensual cuando hay duración; números en palabras completos o "no entendí el monto"; consultar `cards` antes de crear una tarjeta; "pagué con X" = compra con X; mostrar el número de pagos en el resumen.

**P2-13 · Editor: Escape o un clic en el fondo descartan sin preguntar, "Después de N pagos" no se puede vaciar y cambiar el tipo de una tarjeta deja huérfanas sus compras**
media · confirmado · S–M · `forms-5`, `forms-6`, `forms-7`
Ubicación: [FinancialEditorModal.tsx:584](apps/web/src/finance/components/FinancialEditorModal.tsx#L584), [FinancialEditorModal.tsx:995](apps/web/src/finance/components/FinancialEditorModal.tsx#L995), [FinancialEditorModal.tsx:714](apps/web/src/finance/components/FinancialEditorModal.tsx#L714)
- **Escenario:**
  - En móvil, tocar los 24 px de fondo pierde una tarjeta recién llenada. En Rec pasa lo mismo con Escape.
  - Al borrar "12" el campo queda en "1", y teclear "24" da 124 pagos.
  - Pasar "BBVA" a préstamo deja 8 compras y 3 MSI contra una cuenta fantasma a tasa 0.
- **Arreglo:** confirmación ligera si hay cambios (`isDirty`). El patrón `useEditableText` con tope y `countRecurrence` O(1). Antes de cambiar el tipo o borrar, contar los dependientes y ofrecer moverlos.

**P2-14 · El onboarding descarta filas sin nombre e inventa la fecha de pago; mover una multiselección contra el día 0 la aplasta**
media · confirmado · S · `panels-9`, `corestate-6`
Ubicación: [Onboarding.tsx:245](apps/web/src/finance/components/Onboarding.tsx#L245), [state.ts:1085](packages/canvas/src/playlist-core/state.ts#L1085)
- **Escenario:** un 600 en la fila cuyo placeholder dice "Internet" desaparece (la caja sale $7,200 al año más alta). Con la fecha vacía, un sueldo mensual queda en hoy+14. Con Sueldo (día 0) y Renta (día 10) seleccionados, pulsar ← cinco veces deja la Renta en el día 5.
- **Arreglo:** un refine "si hay monto, ponle nombre" o usar el placeholder como nombre; fecha obligatoria o mostrar la supuesta. Acotar el delta del conjunto (`max(delta, -minStart)`) en nudge, grupos y arrastre.

**P2-15 · El goal-seek bimestral propone pagar todo hoy; el préstamo por defecto tiene 13 pagos**
media/baja · confirmado · S · `engine-8`, `engine-9`
Ubicación: [goalseek.ts:195](packages/core/src/finance/goalseek.ts#L195), [items.ts:128](packages/core/src/finance/items.ts#L128)
- **Arreglo:** calcular las ocurrencias por aritmética, sin suponer una ventana de 31 días. Fin del préstamo con `addDays(addMonths(date, 12), -1)`, o 12 pagos explícitos.

### Frente 5 · Gesto: fricción

**P2-16 · La selección por recuadro está anclada a la pantalla: al auto-desplazarse suelta lo que ya había seleccionado**
media · confirmado · M · `interaction-7`
Ubicación: [controller.ts:1381](packages/canvas/src/playlist-interaction/controller.ts#L1381)
- **Arreglo:** guardar el ancla en coordenadas de contenido y proyectarla en cada paso.

### Frente 7 · Móvil y táctil

**P2-17 · Un dedo no desplaza el plan (selecciona, mueve o redimensiona) y dos dedos solo hacen zoom horizontal**
alta · confirmado · L · `interaction-8`
Ubicación: [controller.ts:755](packages/canvas/src/playlist-interaction/controller.ts#L755), [touch.ts:143](packages/canvas/src/playlist-interaction/touch.ts#L143)
- **Arreglo:** en táctil, un dedo en vacío hace pan 2D con inercia (el recuadro pasa a long-press o a la herramienta explícita). Dos dedos hacen pan y zoom. Mover objetos solo tras un hold breve. Márgenes de toque de 24–44 px en las asas.

**P2-18 · Paneles de ancho fijo a 360 px: Análisis tapa todo y su botón de cerrar queda fuera de pantalla**
alta · confirmado · M · `styles-2`, `panels-10`
Ubicación: [globals.css:1445](apps/web/src/styles/globals.css#L1445), [globals.css:2342](apps/web/src/styles/globals.css#L2342), [globals.css:3206](apps/web/src/styles/globals.css#L3206)
- **Medido:**
  - El stage mide 344 px.
  - `.fin-side` mide 372 px: del botón de cerrar se ven 14 de 32 px, y no hay Escape.
  - `.fin-valley` empieza en x = −38.
  - El `min-width` de `.fin-navhelp` le gana al `maxWidth` de fit-in-viewport.
- **Arreglo:** `width: min(…, 100%)` y `min-width: min(N, calc(100vw - 16px))`. Bajo 720 px, hojas inferiores, una a la vez. Escape cierra el riel.

**P2-19 · La geometría del canvas se fija al montar y solo según la altura: quedan 124 px de timeline en 360 px**
media · confirmado · L · `shell-11`
Ubicación: [shell-metrics.ts:33](apps/web/src/finance/shell-metrics.ts#L33), [PlaylistShell.tsx:728](apps/web/src/components/PlaylistShell.tsx#L728)
- **Escenario:** la cabecera de líneas ocupa 216 px y la barra de scroll 20 px. Rotar no recalcula nada, y cambiar las métricas hoy reconstruiría core, bridge y futuros, borrando el undo.
- **Arreglo:** `core.setMetrics` en caliente, `metrics` fuera de las deps del build, y una densidad por ancho (cabecera de 64–96 px).

**P2-20 · Sin reglas táctiles: affordances que solo aparecen con hover, objetivos de 26–32 px, contador oculto bajo 960 px, y MetricHelp invisible con un toque**
media · confirmado · S–M · `styles-8`, `panels-7`
Ubicación: [globals.css:1090](apps/web/src/styles/globals.css#L1090), [globals.css:504](apps/web/src/styles/globals.css#L504), [MetricHelp.tsx:72](apps/web/src/finance/components/MetricHelp.tsx#L72)
- **Arreglo:** un bloque `@media (pointer: coarse)` con objetivos de 44 px, subrayado visible, etiquetas de herramienta y contador visible. Un token `--target-min`. MetricHelp alterna con un toque y se cierra con useDismiss.

**P2-21 · Menús y barra "/" recortados contra el stage, tooltip y pastilla del gesto sin límites, y diálogos sin layout móvil**
media · confirmado (diálogos: plausible) · S–M · `styles-4`, `renderer-7`, `forms-11`
Ubicación: [fit-in-viewport.ts:65](apps/web/src/ui/fit-in-viewport.ts#L65), [tooltip.ts:65](packages/canvas/src/playlist-renderer-pixi/layers/tooltip.ts#L65), [globals.css:1764](apps/web/src/styles/globals.css#L1764)
- **Escenario:**
  - En 375×667, la barra "/" (~430 px) se sube y queda cortado el propio input.
  - El tooltip con la fecha y "Caja" se corta en el borde derecho, que es justo donde lleva el autoscroll.
  - El editor usa 2 columnas de 136 px, Rec es una tabla de 4 columnas, y calendario y teclado aparecen a la vez.
- **Arreglo:** fit contra el ancestro con overflow, o portal a body. Clamp y flip del tooltip. Bajo 600 px, hojas a pantalla completa con el editor en una columna y Rec como tarjetas. Con `pointer: coarse`, abrir el calendario solo desde su botón.

**P2-22 · Diálogos nativos (`prompt`/`confirm`) para renombrar líneas y futuros, borrar y reiniciar**
baja · confirmado · M · `panels-11`, `shell-13` (parcial)
Ubicación: [FuturesMenu.tsx:173](apps/web/src/finance/components/FuturesMenu.tsx#L173), [PlaylistShell.tsx:320](apps/web/src/components/PlaylistShell.tsx#L320)
- **Arreglo:** edición en línea y un popover de confirmación propio, con toast "Deshacer".

### Frente 10 · Accesibilidad

**P2-23 · Los objetos financieros solo existen en el canvas: con teclado o lector de pantalla no se pueden leer ni editar**
alta · confirmado · L · `uxflows-6`
Ubicación: [PlaylistShell.tsx:1197](apps/web/src/components/PlaylistShell.tsx#L1197)
- **Arreglo:** una vista "Lista" en DOM, virtualizada, que abra el mismo editor. Tab, flechas y Enter para recorrer y editar objetos en el canvas, con aria-live que anuncie el objeto enfocado.

**P2-24 · El canvas no muestra ningún indicador de foco**
media · confirmado · S · `styles-7`
Ubicación: [globals.css:303](apps/web/src/styles/globals.css#L303)
- **Arreglo:** `outline: 2px solid var(--accent); outline-offset: -2px` en `:focus-visible`.

**P2-25 · Barra "/" sin semántica de combobox ni región viva, y Tab con el campo vacío agrega sugerencias al plan**
media · confirmado · S · `command-11`, `uxflows-11`, `gap-modos-transitorios-6`
Ubicación: [CommandBar.tsx:118](apps/web/src/finance/components/CommandBar.tsx#L118), [CommandBar.tsx:75](apps/web/src/finance/components/CommandBar.tsx#L75)
- **Escenario:** pulsar Tab para salir agrega "Aguinaldo", luego "Buen Fin", luego "Predial". El lector de pantalla no anuncia el resumen ni la línea "Supuse".
- **Arreglo:** el patrón combobox de ARIA 1.2 y `role="status"` en resumen, supuestos y efecto. Aceptar sugerencias solo con Enter o clic, y dejar que Tab mueva el foco.

**P2-26 · El menú contextual no funciona con teclado y "Comparar" de Futuros es inalcanzable con teclado**
media · confirmado · M · `shell-13`, `panels-8`
Ubicación: [PlaylistShell.tsx:594](apps/web/src/components/PlaylistShell.tsx#L594), [FuturesMenu.tsx:140](apps/web/src/finance/components/FuturesMenu.tsx#L140)
- **Arreglo:** abrir el menú con ContextMenu o Shift+F10; `menuitem`, flechas, Home y End, y devolver el foco al cerrar. "Comparar" como `menuitemcheckbox`. Mover `useMenuButton` a `src/ui/` y reutilizarlo.

**P2-27 · El foco se pierde al cerrar StatementDialog y Rec, Rec roba el foco en re-renders, y los errores se anuncian en cada tecla**
media · confirmado · S · `forms-10`, `forms-9`
Ubicación: [PlaylistShell.tsx:1332](apps/web/src/components/PlaylistShell.tsx#L1332), [RecDialog.tsx:97](apps/web/src/finance/components/RecDialog.tsx#L97), [FinancialEditorModal.tsx:1017](apps/web/src/finance/components/FinancialEditorModal.tsx#L1017)
- **Arreglo:** reutilizar `useRestoreFocus` y guardar `onClose` en un ref. Mostrar errores tras blur o tras el primer intento de Guardar, con `role="alert"` solo al guardar. Sacar `<FieldError>` del `<label>`.

**P2-28 · Contraste AA incumplido en chips de acento, texto fantasma y bordes de campos**
media · confirmado · S · `styles-6`
Ubicación: [globals.css:483](apps/web/src/styles/globals.css#L483), [globals.css:2754](apps/web/src/styles/globals.css#L2754), [globals.css:2019](apps/web/src/styles/globals.css#L2019)
- **Medido:**
  - Acento sobre acento suave: 4.01 en claro y 4.39 en oscuro.
  - Texto fantasma: 3.49.
  - Borde de los campos: 1.37 y 1.46, cuando se piden 3:1.
  - Agarrador en oscuro: 2.92.
- **Arreglo:** un token `--accent-text`, un `--control-border` igual a `--subtle`, el fantasma sin opacidad, y `textInverse: 0x0e0e10` en el tema oscuro. Un test que calcule los ratios desde los tokens.

---

## P3: Pulido UI

### Frente 12 · Lenguaje y sistema visual

**P3-1 · Términos prohibidos e inglés en textos visibles**
media · confirmado · S · `panels-12`, `uxflows-9`, `gap-modos-transitorios-9`
Ubicación: [FinancialEditorModal.tsx:817](apps/web/src/finance/components/FinancialEditorModal.tsx#L817), [ScenarioPanel.tsx:149](apps/web/src/finance/components/ScenarioPanel.tsx#L149), [ErrorBoundary.tsx:24](apps/web/src/components/ErrorBoundary.tsx#L24), [PlaylistShell.tsx:446](apps/web/src/components/PlaylistShell.tsx#L446)
- **Ejemplos:** "Pista bloqueada", "Mutea o edita clips … what-if", "Cash final", "playhead", "Application error / Try again", "Renderer failed." y los marcadores "Bucle" y "Compás". La misma cifra aparece como "Al horizonte", "Cash final", "Caja" y "Liquidez proyectada".
- **Arreglo:** un glosario único y un lint de literales prohibidos (clip, pista, track, playhead, cash) en `check:arch`.

**P3-2 · Los tokens CSS y la paleta del canvas ya divergen, y no hay test de sincronía**
media · confirmado · M · `styles-9`
Ubicación: [globals.css:63](apps/web/src/styles/globals.css#L63), [palette.ts:89](packages/canvas/src/playlist-renderer-pixi/palette.ts#L89)
- **Detalle:** 6 desajustes (text, muted, line, on-accent, surface en oscuro y theme-color). `KIND_COLORS` tiene un solo valor para los dos temas: #f76b15 queda a 2.97:1 sobre el canvas claro.
- **Arreglo:** una sola fuente de tokens en TS que genere la paleta y las custom properties. Mientras tanto, un test de correspondencias.

**P3-3 · El canvas se ve borroso al cambiar el devicePixelRatio (zoom del navegador u otro monitor)**
media · confirmado · S · `renderer-5`
Ubicación: [renderer-impl.ts:483](packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts#L483)
- **Arreglo:** `renderer.resize(w, h, devicePixelRatio)` y un listener de `matchMedia(resolution)`.

**P3-4 · `compactMoney` muestra "$1000k", "$10.0k" y "-$0", no tiene tramo de miles de millones y usa guion ASCII**
baja · confirmado · S · `gap-modos-transitorios-7` · [visuals.ts:43](apps/web/src/finance/visuals.ts#L43)
- **Arreglo:** redondear antes de elegir tramo, o usar `Intl.NumberFormat` con notación compacta, y U+2212 para el signo.

**P3-5 · El Δ del panel Escenario pinta "$0" de rojo**
baja · confirmado · S · `gap-modos-transitorios-8` · [ScenarioPanel.tsx:24](apps/web/src/finance/components/ScenarioPanel.tsx#L24)
- **Arreglo:** calcular el tono sobre el valor redondeado.

**P3-6 · El fantasma de autocompletado de "/" no sigue el scroll del input**
baja · confirmado · S · `command-14` · [globals.css:2754](apps/web/src/styles/globals.css#L2754)
- **Arreglo:** sincronizar `scrollLeft`, u ocultar el fantasma cuando hay desborde.

**P3-7 · Un frame vacío en cada resize**
baja · plausible · S · `renderer-9` · [renderer-impl.ts:483](packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts#L483)
- **Arreglo:** pintar de forma síncrona en el callback del ResizeObserver.

**P3-8 · `docs/frontend-canon.md` prescribe full-bleed, lo contrario del Soft UI vigente**
baja · confirmado · S · `styles-11` · [frontend-canon.md:7](docs/frontend-canon.md#L7)
- **Arreglo:** reescribirlo, o reducirlo a un puntero a project-canon §2 con banner `> **Histórico**`.

---

## Quick wins (esfuerzo S, severidad ≥ media)

1. **Inspector:** quitarlo del shell financiero, o ponerle `key` y escribir solo tras una edición del usuario. Cierra el bug crítico P0-4.
2. **`deriveRecurrence`:** `endExclusive ≥ startBeat + 1`. Detiene la pérdida de objetos de P0-2.
3. **Barra "/":** validar `CommandBar.add` con `itemFormSchema` y meter el esquema en el fuzz (P0-3).
4. **Autosave:** `flushSave()` en `pagehide`, en `visibilitychange` y en el cleanup (P1-16).
5. **Memoria:** caché de una ranura en lugar de `snapshotProjections`; libera 90–165 MB por futuro (P1-1).
6. **Líneas de evento:** un acuñador único de ids (P0-5).
7. **Fecha de inicio:** que `DateField` no emita `""` en teclas parciales (P0-14).
8. **Rec de préstamos sin saldo:** comparar con `debtByAccountAt` (P0-12).
9. **Barra "/" cerrable:** botón ×, `useDismiss` y Escape global (P0-20).
10. **Viewport móvil:** `height: 100dvh` sin `min-height: 100vh` (P0-19).

Siguiente tanda, también S:
- Rayado de silenciados en un solo path (P1-6).
- Asas escaladas al ancho del clip (P0-18).
- Limpiar los transitorios en undo (P0-16, parche).
- Sentry `onCaughtError` (P1-21).
- `hoverDay` fuera de la raíz (P1-7).
- Backspace = borrar (P2-2).

---

## Orden de ataque sugerido

1. **Red de seguridad antes de tocar nada.** Así, lo que rompan los pasos siguientes se ve y se puede recuperar.
   - `flushSave` y `savePlan` honesto con banner de error.
   - Respaldo crudo antes de cualquier descarte o `?reset`, y exportar a JSON.
   - try/catch en build; ErrorBoundary en español con "Descargar mi plan", más boundaries por zona.
   - Sentry `onCaughtError`.
   - Instalar el hook real y meter typecheck y vitest en el build de Workers.
2. **Versionar el plan guardado.** Es prerequisito de todos los cambios de forma de datos: `statementBalance` (P0-10), separar la exclusión de `enabled` (P0-1), `pendingRec` (P2-9) y compactar el ledger (P0-7).
   - Pipeline `migrate[v]`.
   - `{rev, writerId}` + listener `storage` para varias pestañas (P0-6).
   - `layoutVersion` (P1-24).
3. **Cerrar las fugas de integridad.**
   - Quick wins 1–3 y 6–8.
   - Exclusión por línea como filtro de vista, apoyada en la migración del paso 2.
   - Ledger compacto.
   - e2e "editar → recargar → sigue ahí".
   - Test de propiedad de ida y vuelta de gestos.
4. **Una sola realidad entre futuros y una sola forma de cerrar un gesto.** Hacerlo junto con la partición del bridge y del controller (P1-25), no antes.
   - `bridge.batch` (una entrada de undo).
   - RecState por rama + `replaceParkedDocs`.
   - Archivo de cortes y portapapeles por sesión; `Futures.reset` en createYear.
   - En el canvas: `core.cancelGesture` con un `finishGesture` único, y un historial que guarde solo el documento (P0-16, P0-17).
5. **Motor.** Tope de caja en préstamos, `statementBalance`, disponible de la avalancha calculado sobre una ventana, goal-seek por aritmética, y una tabla de frases MX en el fuzz del parser.
6. **Escala y móvil.**
   - `snapshotProjections`, ValleyCard diferido, RecDialog agrupado, `hoverDay` en un store.
   - Budgets del bridge en perf-budget.
   - Después, layout móvil (hojas, pan táctil, `pointer: coarse`) y la vista Lista accesible.
   - Abrir el horizonte solo cuando haya proyección incremental y los budgets estén en verde.

---

## Lo que está sólido (no tocar)

- **Fechas y dinero.** Fechas como enteros de día (algoritmo de Hinnant) y strings ISO, sin `Date` local. `roundMoney` nunca da -0 ni NaN. Los MSI suman exacto. 300 Rec diarios terminan a centavos de la proyección directa.
- **Esquema único.** Un solo esquema Zod (`@slicex/contracts`) con el guard `Exact<DTO, FinancialItem>`. `parsePlan` nunca lanza: hay que conservarlo, pero con respaldo y aviso.
- **Hot paths del core.** Las acciones de alta frecuencia (§4) son idempotentes. Con 10k clips: hover 0.82 ms, recuadro 1.41 ms y mover 350 clips 0.14 ms por movimiento. Lanes en O(n log n).
- **Ciclo de vida de Pixi.** Build diferido para StrictMode, `disposeApp` idempotente, render coalescido por rAF con el id limpiado antes de pintar, y EventSystem desconectado.
- **Undo alineado con el documento.** Los snapshots en WeakMap mantienen undo/redo y documento sincronizados. En 1,500 pasos de fuzz no quedó ningún clip sin objeto ni objeto sin clip, y en 50 recargas el layout no se movió.
- **Suscripciones React.** `usePlayheadDay` reduce el playhead a días enteros, `useSyncExternalStore` lee por revisión y `notifyVisual` no sube la revisión. El editor cuesta 2–4 ms por tecla con 300 objetos; la reproducción, 0.01 ms por frame de mediana.
- **Consultas del core.** `snapshotAt`, `debtByAccountAt` y `nextPayment` son O(log n) con índices en WeakMap. Los formatters Intl se crean una vez por módulo.
- **Tema y flotantes.** Sin parpadeo de tema, 0 `!important`, CSS tokenizado, y el oscuro pasa AA en texto. Una regla única para flotantes (`useDismiss`, `useFitInViewport`, portal), y menús ARIA correctos en la barra de resumen.
- **Parser "/".** Puro y total: 0.1 ms por frase y 1,500 frases de fuzz sin excepciones. Su vista previa expone la interpretación, y el editor no crea nada hasta "Guardar".
- **Fixture de Playwright.** Es estricta: hace fallar cualquier test ante console.error, pageerror o respuestas 5xx.

---

## Método y cobertura

- **16 áreas auditadas:**
  - Shell React y ciclo de vida.
  - FinancialBridge.
  - Persistencia, futuros y estado.
  - Formularios y diálogos.
  - Barra "/".
  - Paneles y chrome.
  - CSS, tokens y temas.
  - Interacción del canvas.
  - Renderer Pixi.
  - Estado del playlist.
  - Motor financiero.
  - Flujos UX de extremo a extremo.
  - Redes de seguridad.
  - Tres pasadas de huecos: fuzz cruzado de invariantes, modos transitorios y costo de render React.
- **Conteos:** 180 hallazgos brutos, 2 refutados, 178 conservados (168 confirmados, 10 plausibles, 0 disputados, 0 sin verificar), agrupados aquí en 83 entradas por causa raíz. Los verificadores bajaron severidades donde el disparador no se alcanza hoy (por ejemplo, horizontes largos tratados como latentes) y corrigieron escenarios exagerados (Android congelando timers, Zoom ausente de la toolbar, Insert cortando "todo").
- **Probes que midieron algo:**
  - Fuzz de 1,500 pasos mezclados con 50 recargas (invariantes core ↔ bridge ↔ futuros ↔ persistencia).
  - Fuzz de 25 sesiones × 60 gestos: 21 de 25 produjeron objetos inválidos.
  - Heap con `--expose-gc` (proyecciones retenidas, copias de clips por entrada de historial).
  - Costo por pointermove con 12, 120 y 360 meses.
  - Render React en jsdom con Profiler (RecDialog, ValleyCard, hover, DebtStrategyPanel, arranque con 15 futuros).
  - Graphics real + `buildContextBatches` (rayado, zoom, hover).
  - SchedulerSystem real de Pixi (rAF en reposo).
  - Parser con frases reales de español MX.
  - Ratios WCAG calculados desde los tokens.
  - Tamaño del plan y del ledger por año de uso.
- **Puntos ciegos:**
  - Nada se probó en un dispositivo real: Android, iOS, la cuota real de Safari, la pérdida de contexto WebGL, `100vh` y el parpadeo de resize se dedujeron del código.
  - Los tiempos de React vienen de jsdom con build de desarrollo: están inflados frente a producción, aunque el costo O(filas) es estructural.
  - Pixi no monta en jsdom, así que no se midió el frame completo del shell.
  - No se vieron el dashboard de Workers Builds ni los runs de CI: el DSN de Sentry y el estado real del CI siguen sin confirmar.
  - El Worker/API y la persistencia en servidor, hoy dormidos, no se auditaron.
  - No hubo pruebas con un lector de pantalla real.
  - Las cifras a 10–30 años son latentes, porque la UI fija el horizonte en 12 meses.
  - Los planes que ya se guardaron con el daño de P0-1 no se pueden reparar automáticamente sin una heurística.