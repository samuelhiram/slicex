# SliceX — canon básico del proyecto

> Estado sintetizado del repo inspeccionado en `master`. **Última verificación: 2026-08-13**
> (rutas, comandos y suite de tests comprobados contra el código, no sólo leídos).
> Este archivo sirve como referencia canónica corta para entender qué es SliceX hoy, cómo está organizado y qué partes del repo describen el estado real.
> **Para el comportamiento del producto** (modelo de timeline, objetos financieros, mecánicas de tarjeta/MSI, etc.) ver [product-spec.md](product-spec.md) — ese es el documento primigenio del producto, no este.

## 1. Qué es SliceX hoy

SliceX es un monorepo con `pnpm` + workspaces + `turbo` para una app web (SPA Vite + React + Hono Worker desplegada en Cloudflare Workers) y paquetes compartidos. En el estado actual del código, la superficie principal visible no es un editor financiero genérico sino un **Playlist tipo FL Studio** montado en `apps/web` y renderizado con Pixi desde `@slicex/canvas`.

## 2. Estado real actual

### Lo que sí está implementado en el código

- `apps/web/src/App.tsx` monta directamente `PlaylistShell` (no hay router; la entrada es
  `index.html` → `src/main.tsx` → `<App />`).
- `PlaylistShell` crea un **documento financiero demo** (`createDemoFinancialDocument(hoy)` de
  `@slicex/core`), lo proyecta a estado de playlist (`apps/web/src/finance/mapping.ts`), inicializa
  core + interacción + renderer y el `FinancialBridge`, y monta `PlaylistInspector`, los paneles
  financieros (`apps/web/src/finance/components/`) y `ErrorBoundary`.
- `@slicex/canvas` exporta tres capas claras:
  - `playlist-core`
  - `playlist-interaction`
  - `playlist-renderer-pixi`
- El playlist actual soporta, a nivel de código:
  - tracks y clips de tipo `audio`, `pattern` y `automation`
  - play position marker / playhead + transporte con `Space`
  - drag de clips, resize izquierdo y derecho, stretch mode (Shift+M)
  - marquee selection, grupos, clipboard (copy/paste) e historial undo/redo
  - edición de automation points
  - zoom horizontal con wheel + ctrl/meta, pan con mouse medio
  - scrollbars horizontal y vertical
  - context menu en track headers y en clips
  - tracks virtuales al navegar hacia abajo y timeline virtual/infinito a la derecha
  - markers de timeline (labels, loop bounds, recording fences)
  - toolbar completa de 8 herramientas — `select`, `draw`, `paint`, `delete`, `mute`, `slip`,
    `slice`, `zoom` — con hotkeys `E/P/B/D/T/S/C/Z`, todas implementadas en
    `playlist-interaction/tools/`
  - overlays de drag: ghost preview, snap indicator y tooltip B.B.T
  - gestos touch: pinch zoom, long-press e inercia

### Motor financiero (MVP, en memoria)

- **Tiempo:** 1 beat = 1 día; beat 0 = `FinancialDocument.startDate` ("hoy"). Ruler de calendario
  vía la opción genérica `PlaylistCoreOptions.timeAxis` (`apps/web/src/finance/time-axis.ts`).
- **`@slicex/core/finance`** (puro): fechas ISO, recurrencias (`once`/`weekly`/`biweekly`/
  `semimonthly`/`monthly`), expansión de eventos, proyección (cash + deuda por cuenta; interés de
  tarjeta estimado por saldo diario promedio), alertas de liquidez, avalancha, comparación de
  escenarios, documento demo.
- **`FinancialBridge`** (`apps/web/src/finance/financial-bridge.ts`): `item.id === clip.id`. La
  geometría del clip es la verdad de las fechas (estirar borde derecho = `endDate`, recortar el
  izquierdo no mueve los días de pago, slice parte la recurrencia); lo no temporal (montos,
  tarjetas) vive en el documento. **Candado de fechas por objeto** (2026-11-18): un botón de
  solo ícono al inicio de la tercera fila de la tarjeta, antes de la etiqueta de fechas (cosa
  aparte), pegajoso como el texto (en una tarjeta baja, por carriles apilados, la fila va AL
  LADO del bloque nombre + monto, centrada; nunca desaparece mientras se ve el texto)
  (`PlaylistClip.timeLocked`; el
  renderer lo dibuja con `clipTimeLock` y lo expone con `getClipLockRect`, que el controller usa
  como `clipTimeLock.rectOf` para que el clic caiga donde se ve). Cerrado: arrastrar solo cambia
  de línea, sin estirar, sin agarrador central ni Slip, y ←/→ mueven el día. Abierto: se mueve
  de día y se estira como siempre. Por defecto (`datesLockedByDefault` en `mapping.ts`): cerrado
  si tiene inicio y fin (`endDate`) o es MSI; abierto si es de una sola fecha, indefinido, o una
  deuda que termina al liquidarse (tarjeta, préstamo con saldo: su borde derecho es la búsqueda
  de objetivo). `FinancialItem.lockDates` guarda la elección solo cuando difiere del default; un
  objeto abierto que estiras hasta tener fin sigue abierto. Un clic es un paso de deshacer y se
  anuncia. El formulario siempre cambia las fechas. Clips de menos de 88 px no lo muestran. Ya no
  se usa `clipMoveAxis: "rows"` (sigue en el motor). Las
  barras de cobros / pagos, los cortes de tarjeta, el playhead, el escalón de la curva y la línea
  flotante del cursor (`layers/hover-time.ts`) caen todos en el **inicio** del día
  (`EVENT_DAY_OFFSET = 0`); la pastilla con la fecha y el sombreado del día van sobre la celda.
  Las etiquetas del carril de caja ("Mín …", valles) viven en la franja de arriba con una línea
  punteada hasta su punto. Undo/redo del playlist es la única pila: cada
  estado del historial tiene su snapshot de items, y cada guardado del editor es una entrada
  (`core.touch()` cuando el clip no cambia). Clips no cortables (`noSlice`): eventos únicos,
  tarjetas, MSI, préstamos con saldo.
- **UI React:** barra de resumen (liquidez, reserva, deuda, próximo pago, mínimo proyectado,
  alertas, altas), readout del playhead, editor (doble clic; alta diferida: el item se crea al
  Guardar), panel "Análisis" (escenario base vs actual, estrategia avalancha a la fecha del
  playhead).
- **Olas 2–4 (2026-11-08)** — "la línea responde", "futuros", "vivir en tu realidad":
  - *Deudas que terminan donde las liquidas:* tarjetas y préstamos con saldo sin fecha final
    (`isPayoffPinned`) tienen el borde derecho derivado del pago total (`estimateDebtPayoffs`;
    una tarjeta se alarga hasta su último MSI). Arrastrar ese borde es **búsqueda de objetivo**
    (`solveDebtPayment` en `@slicex/core/finance/goalseek.ts`): calcula el pago que te libera en
    esa fecha; al soltar, el clip cae en el día real de liquidación. Préstamos por ventana
    conservan su total y lo reparten.
  - *Monto con la mano:* el borde superior de un clip es un "nivel" genérico del canvas
    (`PlaylistInteractionOptions.onClipLevelDrag`); el bridge lo mapea al monto (`levelDrag`).
    Un arrastre = una entrada de undo; la píldora muestra el efecto.
  - *Valles que se explican y se arreglan:* `explainValley` / `suggestValleyFixes`
    (`valley.ts`); la tarjeta `ValleyCard` aparece al pasar sobre un valle de la franja
    (`onOverviewHover`) o con el playhead dentro de uno, ilumina los pagos que lo cavan
    (`getClipHighlight`) y aplica arreglos de un clic.
  - *Futuros (ramas):* `Futures` (`apps/web/src/finance/futures.ts`) guarda cada versión como
    documento + sesión del playlist (`core.saveSession/loadSession`: cada futuro con su undo).
    "Bifurcar aquí", comparar (fantasma bajo la curva), cambiar con transición animada,
    mantener **Q** para asomarse al otro futuro, mantener **A** sobre un clip para ver el año sin él.
  - *La tarjeta como compás:* `CreditCardItem.paymentMode: "statement"` (totalero: paga el
    estado de cuenta completo, nunca intereses); cortes dibujados como marcas en el clip
    (`PlaylistClipContent.marks`); al cruzar el corte una compra muestra cuándo se paga.
  - *Escribir sobre el timeline:* "/" abre `CommandBar` (`command.ts`: "renta 8000 el 1"),
    vista previa en vivo en la franja, Enter crea; vacío ofrece el año mexicano
    (`suggestMexicanYear`: aguinaldo, Buen Fin, predial…) aceptable con Tab.
  - *Rec y persistencia:* el plan (todos los futuros + bitácora) se guarda en `localStorage`
    (`persistence.ts`). Al volver otro día, `rollForward` lo pone al día suponiendo que todo pasó
    como se planeó; `RecDialog` corrige ("no pasó", "otro monto", saldo real). Pegar un estado de
    cuenta sobre una tarjeta (`statement.ts`) actualiza su saldo o agrega compras futuras.
  - *Tu año en 60 segundos:* primera visita = ejemplo + banner; el onboarding arma el año del
    usuario con tres preguntas. La persistencia en servidor (`@slicex/db`) sigue dormida.
  - *Lo que pasó (registro de movimientos reales, 2026-11-18):* **plan ≠ realidad**. El plan
    (items) es lo que va a pasar; un `Movement` (`@slicex/core/finance/movements.ts`) es lo que
    ya pasó: gasto o ingreso con monto, fecha, hora, concepto, categoría, notas y tarjeta
    opcional. Cada movimiento es independiente (nunca se empareja con un item del plan aunque se
    llame igual) y su efecto se asienta en el "hoy" del plan: `initialCash`, o el `balance` de
    la tarjeta si se pagó con ella. **Un solo registro para todos los futuros**
    (`Futures.commitMovement`, guardado en `slicex.plan.v1` → `movements`).
    **La realidad no es un paso del deshacer del plan:** `bridge.applyReality` no toca el
    playlist; cada snapshot del historial lleva un sello con la realidad acumulada cuando se tomó
    y, al restaurarlo (undo/redo, cambiar de futuro), se le suma la realidad registrada después.
    Ctrl+Z de un cambio del plan nunca "des-gasta" dinero; deshacer un movimiento es asentar el
    efecto contrario ("Deshacer" del aviso, o "Borrar"). UI: "Registrar" (tecla **G**,
    `MovementCaptureDialog`: monto → rápidos Mandado/Gasolina/Gustito… ordenados por uso →
    Enter; con fecha futura se vuelve un item único del plan) y el **panel de movimientos**
    (`MovementsPanel`, 2026-11-18): columna a la derecha del timeline (~¼ de pantalla,
    `clamp(320px, 25vw, 560px)`) que empuja el canvas (el ResizeObserver del renderer lo sigue;
    se pliega sin animar el ancho). Abierto por defecto en **"Gastos del mes"**: el título dice
    lo que se ve ("Ingresos de hoy", "Todo lo que pasó", "Préstamos de tu plan"), con la cifra
    total debajo. El botón del header (antes "Buscar") lo pliega y despliega; **F** lo abre y
    enfoca su búsqueda. Plegado o abierto lo recuerda el navegador (`localStorage`
    `slicex.records-panel.v1`; sin elección: abierto desde 900 px, plegado debajo, donde cubre
    el stage en vez de empujarlo); la vista (sección y filtros) la recuerda la pestaña
    (`sessionStorage` `slicex.records-view.v1`). "Lo que pasó" = registro + bitácora de Rec
    agrupados por día (Hoy, Ayer, lun 16 nov…, con el neto del día), filtros por texto, tipo,
    periodo y forma de pago, y chips por categoría con su total (siguen visibles con una
    elegida; otro clic la quita); una fila registrada abre su edición. Periodo
    (`RecordsDateBar.tsx`): **"Día a día"** = ‹ día › con el día como botón de calendario y
    "Hoy" (nunca pasa de hoy; `SearchView.from` = el día, ausente = hoy) y **"Elegir
    fechas…"** = rango en el calendario de `@mantine/dates` (`type="range"`, dos clics) con ‹ ›
    que lo recorren completo; el título lo dice ("Gastos de ayer", "Gastos del 1 al 15 nov").
    Vacío, explica la sección: "Gastos e ingresos no planeados…". "En tu plan" =
    ingresos, gastos, préstamos, tarjetas y MSI (entra al mismo tipo que se veía) con ajuste
    rápido del monto, cuenta/no cuenta, ver en el timeline y editar. No es diálogo: queda
    detrás (inerte) de los formularios que abre. **"Registrar" vive en el panel** (su acción
    primaria); con el panel oculto, el header muestra "Registrar gasto · este mes $X"
    (`RecordMonthButton`). El "/" registra lo que ya pasó ("gasté 500 en tacos ayer")
    en el mismo registro. Pendiente: dibujar el pasado en el canvas (hoy el scroll X se topa en
    el día 0).
- **Lenguaje visual (2026-11-07):** UI calmada y de alto contraste, tema **claro y oscuro**
  (toggle en el header; primera visita sigue al sistema; elección en `localStorage`
  `slicex.theme`, `apps/web/src/theme.ts`). Tokens CSS en `globals.css`
  (`:root[data-theme=…]`) espejados en la paleta del canvas
  (`packages/canvas/src/playlist-renderer-pixi/palette.ts`, `LIGHT_PALETTE`/`DARK_PALETTE`);
  se cambian juntos. Fuente Inter (woff2 locales en `apps/web/src/assets/fonts/inter/`, OFL);
  el shell espera a la fuente antes de crear el renderer (Pixi rasteriza cada `Text` una vez).
  Regla de dos niveles (mes / días, píldora "Hoy", fines de semana sombreados) vía
  `PlaylistTimeAxis.bands()` + ticks `centered`/`emphasis`/`dim`; clips como tarjetas tintadas
  con barra de acento; headers con íconos (ojo / enfoque / candado) en vez de "M S L".
- **Estándar Soft UI (regla de implementación, 2026-11-08).** Toda UI nueva lo cumple:
  - **Cartas sobre página gris:** `--page-bg` gris suave; el contenido vive en tarjetas
    flotantes (`--radius-card`, `--shadow-card`, separadas `--gap-card`). Nada de franjas a
    todo lo ancho separadas por líneas finas. El header es UNA tarjeta (métricas + herramientas
    + acciones): **un renglón de 56 px desde 1200 px** (laptops incluidas: dos renglones
    dejaban ~2/3 del ancho vacío y le quitaban ~45 px al canvas), dos en tablet (métricas
    arriba; herramientas a la izquierda y acciones a la derecha abajo), tres en teléfono. En
    el renglón único ceden espacio por orden, sin perder nombre accesible: bajo 1800 la fecha
    de cada métrica pasa junto al valor ("−$1,292 27 nov") y "Ajustar a" queda como imán;
    bajo 1700 se oculta el beneficiario del próximo pago; bajo 1600 el wordmark y las palabras
    del chip de alertas (ícono + número); bajo 1440 el nombre del futuro si es el único (plan
    principal). Si aun así no caben, las métricas se desplazan de lado con desvanecido.
    **Cada cifra se explica sola** (`apps/web/src/finance/components/MetricHelp.tsx`): etiqueta
    con subrayado punteado; al pasar el cursor (350 ms) o al enfocarla aparece una tarjeta con
    qué es, qué dicen los números de la persona ahora (con tono ok/bajo/negativo) y qué hace el
    clic. Letra: etiquetas 11 px, valores 14 px (15 px desde 1800).
  - **Densidad del canvas según el alto de la ventana** (`apps/web/src/finance/shell-metrics.ts`,
    se decide una vez al montar porque las métricas del core son fijas): ≥860 px "cómoda"
    (carril de caja 112 px, filas 72 px); 720–859 "compacta" (96 / 60); <720 "ajustada"
    (88 / 60). 60 px es el mínimo que conserva nombre + subtítulo + medidor del header de
    track. "Análisis" vive en la fila del título "Caja" para que la celda del carril quepa en
    88 px. Las capas DOM se alinean con `--pl-ruler-h` / `--pl-lane-h` / `--pl-header-w`.
  - **Controles secundarios = rellenos suaves** (`--surface-2`) sin contorno; una sola acción
    primaria rellena (`--ink`) por superficie. Radios `--radius-s/m/l` = 8/12/18 px.
  - **Header v3 (2026-11-18): tres grupos, no once controles.** (1) *Estado del plan*: el
    veredicto ("Te alcanza todo el año · Lo más bajo …"), **una sola cifra en la barra**
    (Liquidez hoy, editable) y "Más cifras" justo después con todo lo demás —reserva mínima
    incluida, a cualquier ancho (`BAR_METRICS` en `FinancialSummaryBar.tsx`); el chip de alertas
    solo se ve cuando hay alertas (el mismo botón, UX-26). (2) *Herramientas*, centradas: solo
    íconos al estilo Figma (nombre y tecla en el tooltip y en el nombre accesible) y el imán como
    un ícono más (su modo en el tooltip y en la lista). (3) *Acciones*: "Registrar gasto" (solo
    con el panel de movimientos oculto), el botón del panel, el
    futuro (solo ícono en el plan principal) y "+ Nuevo". Reglas al final de `globals.css`
    ("Header v3"); prevalecen sobre las de abajo que hablan de etiquetas de herramientas y de
    cifras que se acomodan por ancho.
  - **Formularios — estándar v2 (2026-11-18)** (bloque final de `globals.css`): etiqueta arriba
    en color de texto (13 px/600) y ayuda en gris 12 px; campos con superficie propia
    (`--field-bg`, `--field-border`, `--field-shadow`), 36 px y esquinas de 8 px, con el anillo
    de foco de UX-63; opciones ("Se repite", rápidos de "Registrar") como fichas con borde (la
    elegida en `--accent`); radios dibujados con los tokens; botones de diálogo rectangulares
    (8 px), con una sola primaria `--ink`; encabezado y pie separados por una línea. El
    **editor de objetos es un panel lateral** (`.fin-sheet`): el formulario a la izquierda y la
    **"Vista previa"** a la derecha (resumen en palabras, próximos pagos y efecto en tu caja,
    en vivo), con encabezado y botones fijos y una sola columna bajo 900 px. Los demás
    diálogos (Registrar, Rec, estado de cuenta, onboarding) siguen centrados con el mismo
    estilo de campo. **Sin pickers nativos**: todo selector es `Select`
    (`apps/web/src/ui/select.tsx`, Radix Select con los tokens; ver
    [forms-audit.md](forms-audit.md) §5), la hora es un `Select` de horarios, los checkbox y
    radios se dibujan con los tokens y los números no muestran flechas del sistema. Un préstamo termina en una **fecha** (por defecto) o **después de N
    pagos**; nunca "Nunca". Sus **intereses**: «Sin intereses» por defecto; «Con intereses»
    pide la tasa anual (informativa: el pago ya los incluye; sirve para «Calcular pago» y la
    avalancha). El inicio de lo que se repite se llama **«Próximo pago / cobro / cargo»** y una
    fecha sin año ("15 dic") se toma a futuro. Un **gasto recurrente puede ser «Sin día fijo
    (presupuesto)»** (`FinancialRecurrence.flexibleDay`, p. ej. $1,500 de salidas cada semana):
    no se pide fecha; el periodo arranca hoy y el monto se descuenta al **inicio** de cada
    semana / quincena / mes (lectura prudente para la caja). El motor lo expande como cualquier
    recurrencia; `deriveRecurrence` lo conserva al estirar el objeto. Solo gastos (en un ingreso
    sería optimista).
  - **Un formulario abierto sobrevive a recargar** (`apps/web/src/finance/form-draft.ts`): el
    editor de objetos (nuevo o editando, con "Termina" e "Intereses") y "Registrar" guardan lo
    que llevas escrito en `sessionStorage` (`slicex.form-draft.v1`) mientras están
    abiertos y se reabren igual tras recargar la pestaña; cerrarlos (Guardar, Cancelar, ×,
    Escape) lo olvida. Lo restaurado sigue contando como "cambios sin guardar". Por pestaña:
    otra pestaña o una visita nueva no revive un borrador viejo. Las pruebas que montan el
    shell limpian también `sessionStorage`.
  - **Controles donde y cuando actúan:** los íconos de cada track (ojo / enfoque / candado /
    asa) solo en la fila con hover o selección, o cuando su estado está activo; sin contadores
    permanentes (solo un chip con selección múltiple); un banner a la vez; la lectura del
    playhead (fecha · caja · deuda) vive en la celda vacía bajo "Caja", no en una barra.
  - **Todo alcanzable a cualquier ancho:** lo flotante (menús, popovers, menú contextual, barra
    "/") pasa por `apps/web/src/ui/fit-in-viewport.ts` (se recorre / se limita / hace scroll
    dentro de la ventana); las barras se desplazan de lado en vez de encimarse. Auditado en
    1920 / 1366 / 1024 / 768 / 390 px (ningún control fuera de pantalla, tapado, sin nombre
    accesible ni menor a 24 px); el renglón único y la densidad, en 1920×1000, 1536×738,
    1366×768, 1280×680, 1200×700 y 1024×700 (2026-11-09).
  - **Cierre de lo flotante, una sola regla** (`apps/web/src/ui/use-dismiss.ts`): un menú se
    cierra con un clic FUERA (de su botón y de su popover), un scroll FUERA, un resize o Escape;
    nunca con un clic o la rueda DENTRO (texto, bordes, separadores, items deshabilitados). Nada
    de handlers "clic fuera" escritos a mano por componente.
  - **La rueda mueve todo lo que se desplaza:** las tiras laterales con scrollbar oculto (cifras
    del encabezado, barra de herramientas) usan `apps/web/src/ui/wheel-scroll-x.ts` (rueda
    vertical → lateral). **El clic derecho es el silenciador** (2026-11-18, `rightButton:
    "mute"`): sin menú sobre el timeline; sostenido, el cursor es el de Excluir y cada objeto
    cambia (cuenta ⇄ excluido) cada vez que el puntero ENTRA en él — pasar de nuevo sin soltar
    lo regresa; un paso de deshacer y un aviso ("Excluidos de tus cifras…", "Vuelve a contar…").
    El encabezado de una línea conserva su menú; el del objeto sigue en Shift+F10 / tecla Menú.
    La línea entre filas y los botones del track no se tragan el botón derecho (`trackChrome:
    false` en el hit-test).
  - **Un objeto de una sola fecha mide lo que su nombre y su monto** a cualquier zoom
    (`PlaylistLayoutOptions.clipMinWidthPx` ← `FinancialBridge.clipMinWidth`, con la misma
    estimación de texto del renderer, `clipTextWidthPx`): crece el rect dibujado (hit-test y
    renderer), no su fecha. Muy alejado, dos etiquetas cercanas de la misma línea pueden
    encimarse (los carriles se calculan en días). La etiqueta entera lleva el color de su tipo,
    como sus hermanos (sin la "extensión de un día" tenue de UX-41; su día es su borde izquierdo).
  - **Cada tarjeta dice sus fechas, en una tercera fila** (`describePeriod` → `getClipPeriod`
    del renderer): "9 dic 2026", "1 dic 2026 – 1 sep 2027", "13 nov 2026 – Indefinido"; una deuda
    o MSI hasta su liquidación estimada. Bajo el nombre y el monto van DOS cosas distintas: el
    candado, un botón de solo ícono (translúcido; un cuadro suave bajo el puntero; lo único que
    reacciona), y 6 px después la etiqueta de fechas, información: ícono de calendario, relleno
    opaco del color de la tarjeta un tono más claro (más oscuro en tema claro), sin borde,
    esquinas suaves, el gris de la línea del monto — parte de la tarjeta, tapa las marcas de
    pago. En una tarjeta sin alto para la tercera fila (carriles apilados) la fila va al lado del
    bloque nombre + monto, centrada. Recortada con "…" si no cabe; la etiqueta de una sola fecha
    crece para mostrarla (`clipCardWidthPx`, misma geometría que el dibujo).
  - **En el canvas la rueda es vertical** (2026-11-09; `mouseWheel: "rows"` del controller):
    sube y baja entre líneas de evento como cualquier documento; Shift + rueda, la rueda
    inclinable o la rueda sobre la regla / el carril de Caja mueven el tiempo; Ctrl + rueda o
    pellizco hacen zoom; el trackpad desplaza libre en 2-D. El motor conserva `"time"` (paridad
    FL) como valor por defecto.
- **Tracks infinitos y permanentes (como FL)**: el shell usa `virtualTracks` por defecto
  (filas "Track N" vacías siempre debajo). Las filas no se borran solas: el acomodo
  (`FinancialTrackLayout` en `apps/web/src/finance/mapping.ts`: filas, incluso vacías, y
  item → fila) se guarda por futuro en `slicex.plan.v1` y `createFinancialPlaylistState(doc, layout)`
  lo restaura; las filas vacías auto-nombradas al final no se guardan (son idénticas a las
  infinitas). Menús contextuales en español: "Nuevo … aquí" crea en esa fila y fecha
  (`bridge.addItem(item, { trackIndex })`); el menú de la línea no tiene "borrar".
- **Nombre en producto: "línea de evento" (ES) / "slot" (EN)**, nunca "track" ni "fila" en
  textos visibles (2026-11-09). El motor sigue diciendo `track` en código (renombrarlo es un
  cambio aparte). **Título derivado en vivo, nunca persistido (2026-11-11, UX-44; sustituye a
  "nueve veces 'Línea de evento'"):** una línea que la persona no nombró se titula por lo que
  contiene, calculado en cada revisión y nunca guardado en su etiqueta: su objeto principal
  (mayor impacto en caja) y "+N" por los demás ("Sueldo", "Pago Tarjeta Plata +1";
  `derivedRowTitle` en `apps/web/src/finance/labels.ts`, vía `PlaylistTrackMeta.title`). Así el
  título nunca miente cuando se apila otra cosa (el motivo por el que antes no se bautizaban
  líneas con un ítem: ese nombre quedaba escrito). Una línea vacía sigue llamándose "Línea de
  evento". "Renombrar…" pone un nombre propio que gana siempre; vacío (o el automático) lo
  devuelve al título derivado. En el modelo, automático = etiqueta vacía o el "Track N" del
  motor (`isAutoRowLabel`); el renderer muestra las vacías con `formatTrackLabel`. Al cargar un
  plan guardado, las etiquetas que puso la app se vuelven automáticas (`appGivenRowLabel` en
  `mapping.ts`). La cabecera ya no lleva el medidor de 3 px sin rótulo (se leía como un fader);
  el subtítulo dice el peso de la línea en palabras.
- **Carriles apilados dentro de una línea** (`packages/canvas/src/playlist-core/lanes.ts`, port
  del schedule de postalhub-dashboard `ShiftPlanner/shiftCalendarLayout.ts`): clips que se pisan
  en el tiempo nunca se tapan; cada uno tiene `clip.lane` y la línea `track.lanes`, y mide
  `lanes × alto de carril` (`track.height` es el alto de UN carril; el redimensionado lo
  reparte). Reglas: lo soltado se queda en el carril donde se soltó; lo demás conserva su
  carril y, si le cae encima, pasa al carril que el soltado dejó (intercambio) o al libre más
  cercano; lo nuevo va al primer carril libre; los carriles vacíos se eliminan. Mientras dura
  un gesto los carriles son provisionales (nada se reacomoda, ninguna línea pierde carriles) y
  la línea bajo el arrastre abre un **carril libre punteado** para apilar a la misma fecha; al
  soltar se asientan dentro de la misma entrada de undo. Los carriles no se persisten: al
  recargar vuelve el reparto automático. Los eventos únicos de un tipo comparten UNA línea
  en vez de abrir una segunda; las líneas guardadas así se respetan.
- **Una sola forma de decir "cuándo"** (2026-11-09): cuándo pasa, se paga, entra dinero o
  termina un evento se elige igual en todas partes, con el patrón de un calendario ("Repetir").
  En el editor es el bloque **"Cuándo"** (todas las clases):
  - *Se repite* = `SchedulePicker` (`apps/web/src/finance/components/SchedulePicker.tsx`):
    botones de un clic [Una vez] [Cada semana] [Cada quincena] [Cada mes] [Cada año] y
    [Personalizado…] que abre "Cada [N] [días | meses]" (no se cierra solo si N coincide con
    un preset);
  - *Empieza* (o *Fecha* si no se repite): su día es el día de pago ("Siempre el último día del
    mes" cuando cae en fin de mes); los días de corte / pago de una tarjeta van en el bloque;
  - *Termina* ◉ Nunca ○ El [fecha] ○ Después de [N] pagos — sin campos deshabilitados:
    escribir la fecha elige "El"; las dos formas guardan una fecha de fin (ajustada al último
    pago);
  - un **resumen en palabras** ("Cobras $1,000 cada 6 meses, el día 15, desde el …, hasta el
    …: 5 pagos.") con las próximas fechas (`cadenceText` / `upcomingPayments`).
  El onboarding ("¿Cada cuánto te pagan?") usa el mismo `SchedulePicker` y la barra "/"
  entiende lo mismo ("cada 3 meses", "cada 10 días", bimestral / trimestral / semestral /
  anual). Modelo: `interval` en `FinancialRecurrence` (`daily` / `monthly`; core
  `recurrence.ts` / `schedule.ts`, fase desde el ancla); regla ↔ controles en `schedule-ui.ts`
  (`frequencyParts` / `withFrequencyParts` / `SCHEDULE_PRESETS`): cada 7 / 14 días se guardan
  como semanal / catorcenal.
- **El lápiz no crea por su cuenta**: con `onCreateRequest` (opción del controller) el doble
  clic o el arrastre en vacío solo pintan un fantasma punteado y abren el editor con un
  borrador en esa fecha y línea (tipo: el del ítem seleccionado, si no el de la línea, si no
  gasto); nada se agrega hasta "Guardar". Antes el doble clic dejaba un "Gasto" de $500 sin
  nombre.
- **Agarrador de longitud**: el clip seleccionado muestra una barra vertical en el centro de
  la pantalla, dentro del clip (`getClipExtendHandle` en `playlist-core/presentation.ts`,
  compartido por renderer y hit-test). Arrastrarla mueve el final derecho (izquierda acorta,
  derecha alarga) aunque esté fuera de pantalla; un gesto = una entrada de undo. El host
  lo veta por clip (`clipExtend`; finanzas: no en eventos de un solo día).

### Lo que no está conectado todavía como flujo final de producto

- El documento financiero vive **solo en memoria**: no se persiste (Prisma / `/api/timelines` siguen
  sin cablear a la UI).
- `createDemoPlaylistState()` (demo musical) sigue existiendo en `@slicex/canvas` para sus tests,
  pero la app ya no la monta.

## 3. Arquitectura vigente del repo

### App

- `apps/web`
  - SPA Vite + React 19 (cliente) + Hono Worker (API) corriendo como **un solo Cloudflare Worker** vía `@cloudflare/vite-plugin`.
  - Entrada cliente: `index.html` → `src/main.tsx` → `<App />` → `<PlaylistShell />`.
  - Entrada Worker: `worker/index.ts` (Hono + Sentry CF) → rutas en `worker/routes/`.
  - Static Assets binding sirve la SPA con `not_found_handling: "single-page-application"` y `run_worker_first: ["/api/*"]` deriva el API al Worker.
  - Monta el playlist full-screen.

### Paquetes

- `@slicex/core`
  - Dominio y lógica pura.
  - En la documentación raíz aparece como capa de negocio principal.
- `@slicex/canvas`
  - Motor del playlist actual.
  - Contiene modelo, geometría, interacción y renderer Pixi.
- `@slicex/contracts`
  - DTOs, validaciones y contratos compartidos.
- `@slicex/db`
  - Prisma schema y cliente de base de datos.
  - Modela `User`, `Tenant`, `TenantMembership`, `Timeline`, `TimelineRevision` y `AuditLog`.

## 4. Superficie principal para entender el proyecto

### Entrada web (cliente)

- `apps/web/index.html`
- `apps/web/src/main.tsx`
- `apps/web/src/App.tsx`
- `apps/web/src/components/PlaylistShell.tsx`
- `apps/web/src/styles/globals.css`

### Entrada web (Worker / API)

- `apps/web/worker/index.ts`
- `apps/web/worker/routes/health.ts`
- `apps/web/worker/routes/timelines.ts`
- `wrangler.jsonc` — **en la raíz del repo**, no en `apps/web/`. `vite.config.ts` lo referencia como
  `../../wrangler.jsonc` y `wrangler deploy` se corre desde la raíz.
- `apps/web/vite.config.ts` — dev server en puerto **4321**, `strictPort: false`.

### Playlist core

- `packages/canvas/src/index.ts`
- `packages/canvas/src/playlist-core/index.ts`
- `packages/canvas/src/playlist-core/types.ts`
- `packages/canvas/src/playlist-core/geometry.ts`
- `packages/canvas/src/playlist-core/state.ts`
- `packages/canvas/src/playlist-core/presentation.ts`
- `packages/canvas/src/playlist-core/demo.ts`

### Interacción

- `packages/canvas/src/playlist-interaction/controller.ts`
- `packages/canvas/src/playlist-interaction/hit-test.ts`

### Renderer

- `packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts`

### Infraestructura / governance

- `package.json`
- `apps/web/package.json`
- `packages/canvas/package.json`
- `packages/core/package.json`
- `packages/contracts/package.json`
- `packages/db/package.json`
- `packages/db/prisma/schema.prisma`
- `vitest.config.ts`
- `.github/workflows/ci.yml`
- `scripts/check-imports.mjs`
- `scripts/check-js-siblings.mjs`

## 5. Cómo está modelado el playlist

### Estado

El estado del playlist vive en `PlaylistState` (`playlist-core/types.ts`) y contiene:

- `tracks`, `clips`
- `viewport`, `snap`
- `selection`, `marquee`, `hover`, `contextMenu`
- `playPosition`, `transport`
- `tool`, `clipboard`, `stretchMode`
- `markers`
- `dragPreview`, `snapHint`, `tooltip` — overlays efímeros de gesto, se limpian en el release

### Reglas importantes del modelo

- El playhead vive como `playPosition.time`.
- La posición en pantalla se deriva desde tiempo + viewport.
- El viewport guarda `scrollX`, `scrollY`, `pxPerBeat`, `width`, `height`.
- El renderer consume una presentación derivada; no guarda la verdad del modelo.
- La capa `presentation.ts` prepara vistas calculadas para tracks, clips, ruler, scrollbars, context menu, marquee y play position.

## 6. Interacción implementada

La interacción del playlist está centralizada en `playlist-interaction/controller.ts`.

### Gestos soportados en el código

Los 17 `kind` de `playlist-interaction/gesture-types.ts`:

- `pan`, `marquee`
- `clip-drag`, `clip-resize`, `clip-create-drag`
- `automation-point-drag`
- `play-position-drag`
- `scrollbar-horizontal`, `scrollbar-vertical`
- `slip-drag`, `slice-drag`
- `paint-drag`, `delete-drag`, `mute-drag`
- `track-resize`, `track-reorder`
- `marker-drag`

### Acciones por contexto

- click en ruler mueve play position
- arrastrar play position lo reposiciona
- right click en track header abre context menu
- right click en automation body agrega automation point
- right click en automation point lo elimina
- `Delete` / `Backspace` elimina selección
- `Space` alterna reproducción del playhead

## 7. Renderer actual

El renderer actual está en `playlist-renderer-pixi/renderer-impl.ts` y usa:

- `Application`
- `Container`
- `Graphics`
- `Text`

La composición está separada en capas de dibujo:

- fondo/scene
- timeline con `mask`
- chrome del ruler y track headers
- foreground para scrollbars y context menu

Colores: la paleta viva `COLORS` (`palette.ts`) se muta en sitio con `applyPlaylistTheme`;
`renderer.setTheme("light" | "dark")` la cambia e invalida una sola vez todas las capas
cacheadas (grid, máscara, nodos de clip, overview lane, píldora de arrastre). Nunca por frame.

Esto confirma que el proyecto actual sí está orientado a un playlist canvas interactivo, no a un layout React estático.

## 8. Persistencia y backend

`@slicex/db` ya define una base de persistencia multi-tenant con revisiones de timeline:

- `Timeline`
- `TimelineRevision.documentJson`
- `headRevisionId`
- `AuditLog`

Eso indica que la intención arquitectónica de persistir documentos/versiones sigue viva, aunque la UI principal del playlist inspeccionada en esta pasada todavía corre con demo data.

## 9. Comandos y gates relevantes

### Desarrollo

- `pnpm dev`
- `pnpm dev:web`

### Calidad

- `pnpm -w run typecheck`
- `pnpm -w run test:unit`
- `pnpm -w run test:e2e`
- `pnpm -w run check:arch`
- `pnpm -w run check:env`
- `pnpm -w run check:fast`

### Reglas automáticas existentes

- `scripts/check-imports.mjs`
  - bloquea deep imports entre paquetes `@slicex/*`
- `scripts/check-js-siblings.mjs`
  - bloquea mirrors `.js/.jsx` junto a `.ts/.tsx`

## 10. Documentos del repo y cómo leerlos

Índice completo con estado por documento: [docs/README.md](README.md).

### Documentos útiles y vigentes

- `docs/product-spec.md`
  - **fuente de verdad del producto** (modelo, mecánicas financieras, MSI)
- `docs/performance-canon.md`
  - **regla dura** para todo código en `playlist-*` y el shell React
- `docs/fl-playlist-parity-spec.md`
  - contrato de paridad con FL Studio, gesto por gesto
- `docs/playlist-manual-test.md`
  - guion de prueba manual del playlist
- `README.md`
  - quickstart y mapa general del monorepo
- `AGENTS.md`
  - ownership, workflow y reglas de colaboración
- `CONTRIBUTING.md`
  - pre-PR checklist y convenciones
- `docs/frontend-canon.md`
  - canon visual/layout del frontend
- `CONTEXT.md`
  - resumen operativo **+ historial acumulado**; la mitad de abajo es archivo de la era Next.js

### Cómo deben interpretarse

- `README.md` y `AGENTS.md` siguen siendo útiles como marco.
- `CONTEXT.md` **no debe leerse como una foto exacta única del estado actual**; contiene historial acumulado de fases, bloques y cambios previos.
- Este archivo (`docs/project-canon.md`) debe ser la referencia corta para responder: **qué es el repo hoy y dónde tocar primero**.

## 11. Inconsistencias reales encontradas

Estas inconsistencias existen en el repo y conviene conocerlas (revisadas 2026-08-13):

1. **Narrativa mixta del producto** — *vigente, es intencional.*
   - La documentación de producto describe un gestor financiero; el código visible monta un playlist
     estilo FL Studio. No es contradicción: el playlist es el motor de interacción que después
     hospedará los objetos financieros. Ver `product-spec.md`.

2. **`CONTEXT.md` mezcla historia y estado** — *acotado.*
   - El historial quedó agrupado bajo "Historial acumulado (archivo)" con banner explícito. La
     cabecera sí describe el estado real.

3. **Rama objetivo `main` vs `master`** — *resuelto.*
   - `CONTRIBUTING.md` ya apunta a `master`, igual que CI y `AGENTS.md`. `master` es además la
     **única branch** del repo desde 2026-08-13.

4. **`docs/adr/` tiene numeración solapada** — *documentado, sin resolver.*
   - Conviven dos series de ADR con los mismos números (0001–0004). Ver [adr/README.md](adr/README.md).

5. **`scripts/e2e-static-server.js` está roto** — *sin resolver.*
   - Apunta a `apps/web/public/index.html` y a `playwright.local.config.ts`; ninguno existe. El
     script `test:e2e:static` no corre. El camino vivo es `test:e2e`.

6. **CI declara pasos que no se han verificado verdes en esta pasada.**
   - `.github/workflows/ci.yml` corre `corepack enable` *después* de `actions/setup-node` con
     `cache: 'pnpm'`, orden que suele fallar en runners limpios. Sin `gh` CLI local no se pudo
     confirmar el estado real de las corridas.

## 12. Qué tomar como verdad canónica mínima

Para trabajo operativo diario, la verdad mínima debe ser esta:

- La app visible actual es el playlist en `apps/web`.
- El motor principal actual está en `packages/canvas/src/playlist-*`.
- `@slicex/db` y los modelos Prisma representan la base de persistencia/versionado.
- `AGENTS.md` define reglas de ownership.
- `docs/frontend-canon.md` define el baseline visual.
- `docs/project-canon.md` define el snapshot corto y canónico del repo.

## 13. Punto de entrada recomendado por tipo de tarea

### Si el cambio es visual o de interacción del playlist

Entrar por:

- `apps/web/src/components/PlaylistShell.tsx`
- `packages/canvas/src/playlist-core/*`
- `packages/canvas/src/playlist-interaction/*`
- `packages/canvas/src/playlist-renderer-pixi/renderer-impl.ts`

### Si el cambio es de persistencia

Entrar por:

- `packages/db/prisma/schema.prisma`
- `@slicex/contracts`
- handlers/rutas de `apps/web`

### Si el cambio es de reglas o arquitectura

Entrar por:

- `AGENTS.md`
- `README.md`
- `CONTRIBUTING.md`
- `scripts/check-imports.mjs`
- `scripts/check-js-siblings.mjs`

## 14. Criterio de mantenimiento de este archivo

Actualizar `docs/project-canon.md` cuando cambie al menos una de estas cosas:

- entrada principal del producto
- paquete/capa principal del motor
- modelo principal del dominio visible
- reglas de ownership
- comandos de validación
- branch/canon de CI
- documento que deba considerarse fuente de verdad

## 15. Alcance de esta auditoría

Este canon fue sintetizado mediante inspección directa del repositorio y sus documentos principales.

Revisión 2026-08-13, verificado ejecutando:

- `pnpm -w run check:arch` — verde (imports, mirrors `.js`, anti-patrones de performance)
- `pnpm -w run typecheck` — verde (raíz + cliente + worker)
- `pnpm exec vitest run` — **314 tests en 30 archivos**, verdes
- `pnpm dev:web` — arranca y sirve `/` y `/api/health` con 200 en el puerto 4321

**No** implica confirmación de que CI esté verde hoy (ver inconsistencia 6).
**No** implica validación de la ruta de deploy a Cloudflare en esta pasada.
