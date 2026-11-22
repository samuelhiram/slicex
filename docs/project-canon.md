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
- `PlaylistShell` abre el plan guardado o, en la primera visita y con "Reiniciar con el
  ejemplo…" (Mi plan ▾ o `?reset`), **el año de ejemplo** (`createExampleYearDocument(hoy)` de
  `@slicex/core`, 2026-11-20: "Mi año" — sueldo de despacho, freelance, cuarto rentado, renta,
  súper, servicios, crédito del auto, dos tarjetas con MSI, seguro y viaje, todos con ícono; caja
  positiva todo el año con valles bajo la reserva para arreglar). `createDemoFinancialDocument`
  sigue como fixture estable del motor y de las pruebas (las de interacción del shell lo fijan
  con un `vi.mock` parcial de `createExampleYearDocument`). Lo proyecta a estado de playlist (`apps/web/src/finance/mapping.ts`), inicializa
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
  tarjetas) vive en el documento. **Candado de fechas por objeto** (2026-11-18): un botón
  metido en la **esquina inferior izquierda** de la tarjeta (pestaña sólida al ras de los
  bordes, con el radio de la tarjeta en su esquina), antes de la
  etiqueta de fechas (cosa aparte), pegajoso como el texto (en una tarjeta baja, por carriles apilados, la fila va AL
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
  se usa `clipMoveAxis: "rows"` (sigue en el motor). Las **barras de cobros / pagos** ocupan
  todo el alto de la tarjeta (el mismo margen que la franja de color), todas iguales sin
  importar el monto (un ritmo parejo; entrada o salida se lee del color), líneas finas de
  1.5 px, casi opacas; el nombre
  y el monto llevan un contorno fino del color de la tarjeta para que se lean sobre ellas. Las
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
  - *Cada pago es una celda (2026-11-21):* un **clic rápido** sobre un objeto (presionar y
    soltar en ≤ 400 ms sin moverse ni modificadores; `PlaylistInteractionOptions.onClipTap`,
    `CLIP_TAP_MAX_MS`) abre `OccurrenceCard` en el pago bajo el puntero: la celda entre su marca
    y la siguiente (`occurrence.ts` `findOccurrence`, `bridge.occurrenceAt`). Presionar y
    arrastrar sigue moviéndolo; el doble clic sigue abriendo el formulario (cierra la tarjeta).
    Dos alcances, **sin crear otro objeto** (`@slicex/core/finance/rules.ts`):
    **"Solo este pago"** = `FinancialItem.occurrenceEdits` (`{ date, amount }`; 0 = no pasa: la
    celda queda como marca punteada) y **"Este y los siguientes"** = `ruleChanges`
    (`{ from, amount?, frequency?, interval? }`: monto y/o cada cuánto desde ese pago; en el
    primer pago cambia la regla base). Cambiar la frecuencia fuerza "y los siguientes" y
    reinicia el ritmo en ese pago; solo monto conserva los días. El alcance es el **estado** de
    ese pago y **va y viene** (2026-11-22): donde empieza un cambio la tarjeta abre en "Este y los
    siguientes"; pasarlo a "Solo este pago" lo acota a ese pago y los siguientes vuelven a la regla
    anterior (`withoutRuleChangeAt`; la tarjeta lo dice antes de aplicar), y "Volver a $…" lo quita.
    En el primer pago no hay regla anterior: el cambio es la regla misma. El motor expande por tramos
    (`ruleSegments`) en eventos, liquidación (`payoff.ts`) y búsqueda de objetivo; un préstamo
    por ventana debe lo de su regla **base** (pagar distinto cambia cuándo terminas, no cuánto
    debes). Mover el objeto mueve sus cambios (`shiftItemRules`); recortar un borde no. La
    etiqueta dice la regla vigente en el playhead y el próximo cambio ("−$550 /semana → −$300
    (23 dic)"). Vista previa en la franja mientras escribes; Aplicar = un paso de deshacer con
    "Deshacer". Tarjetas totaleras y MSI: solo lectura (botón al formulario). Se guardan en
    `slicex.plan.v1` (esquemas en `@slicex/contracts`).
  - *Cada línea dice su monto (2026-11-21):* toda celda de un objeto recurrente lleva escrito el
    pago que aplicó la proyección ("+$11,000", "−$550", "$0" si no pasa; préstamos, tarjetas y
    MSI incluidos) arriba de la barra, a la derecha de su marca, solo donde cabe; si el inicio
    de la celda quedó fuera, el texto se pega al borde visible. Resaltados (negrita, color del
    objeto) los pagos que difieren de su regla: un ajuste de solo ese pago y el primero de un
    cambio. Ese color no es el de la marca, que se pierde sobre su propio tinte: es el mismo tono
    más claro en oscuro y más profundo en claro, hasta leerse sobre la tarjeta aun con el brillo
    del hover (`legibleInk` + `inkContrast` en `palette.ts`, 2026-11-22). Su celda lleva además
    un **contorno punteado** en ese color, separado de las marcas de los lados (un `Graphics` por
    nodo, `label: "clip-cell-boxes"`, dibujado solo alrededor de lo visible y redibujado al
    cambiar el zoom, la tarjeta o el tema, no al desplazar). Genérico en el motor: `PlaylistClipContent.cells` (`beats`, `labels`, `strong`);
    el registro de nodos recicla un `Text` por celda visible (`label: "clip-cell"`), recorta a
    `[stickyLeft, visibleRight]` y no hace nada en un cuadro donde no se movió nada. El host
    las arma en `buildCells` (`visuals.ts`, textos en caché por monto). En "En tu plan" cada
    fila muestra (y edita en línea) el monto vigente hoy, "Próximo 9 dic: −$700" y una línea
    de acento con los cambios ("Desde 23 dic: −$300 /semana · 9 dic: −$700",
    `ruleEditsSummary`); el formulario los lista en "Cambios en tus pagos" (`PaymentChanges`,
    "Quitar" en cada uno) y la vista previa los menciona.
  - *La celda bajo el puntero se ilumina (2026-11-21):* con Seleccionar / Dibujar, sobre el
    cuerpo de un objeto, la celda que abriría un clic se tiñe del color del objeto, su marca
    se engrosa y su monto se escribe a fuerza plena (`syncFrame(…, hoverClipId, hoverTime)`,
    `cellIndexAt`; un `Graphics` por nodo, creado la primera vez, redibujado solo cuando cambia
    la celda). Los montos llevan un halo del color de la tarjeta: la línea de saldo de una
    deuda nunca los tacha. La tarjeta flotante (hover) nombra ese pago ("Pago del 18 ene:
    −$1,200 · clic para cambiarlo"; `getClipInfo(clipId, beat)`) y se coloca bajo la fila del
    objeto, o sobre ella si no cabe (`PlaylistTooltip.avoidTop/avoidBottom`), sin tapar las
    celdas que lees. Si la vista se mueve bajo el puntero quieto (rueda, deslizamiento,
    teclado), el hover y el día se recalculan y la tarjeta se cierra. Teclado: el menú del
    objeto (tecla Menú / Shift+F10) ofrece "Cambiar el pago del 25 nov…", y en la tarjeta ‹ ›
    (Alt+← / Alt+→) recorren los pagos. El doble clic abre el objeto aunque el segundo clic
    caiga en el agarrador que trajo el primero.
  - *Pulido de usabilidad (2026-11-21):* el "Deshacer" de un aviso desaparece en cuanto el
    historial se mueve más allá de su cambio (Ctrl+Z, otra edición), porque desharía otra cosa
    (`AnnouncerProvider history`, `PlaylistCore.historyToken()`); el mensaje queda. Bajo
    1670 px, donde se oculta el calendario de la lectura del día, el rótulo dice la fecha
    ("CAJA · 23 ENE", en acento si sigue al puntero). El aviso de herramienta / primera
    selección vive en la pila de banners (una fila arriba, a la derecha): nunca se enciman; se
    calla mientras la tarjeta de un pago está abierta. En ventanas ≤ 639 px de ancho la
    columna de nombres mide 132 px (`NARROW_HEADER_WIDTH`, al montar). La tarjeta de pago
    rechaza texto que no es monto (antes cerraba sin avisar). En "En tu plan": "Cada lunes ·
    Sin fin" juntos y "Próximo 23 nov: −$1,200" sin partir fecha y monto.
  - *Auditoría de simetría y desbordes (2026-11-22):* reglas tipográficas globales al inicio
    de `globals.css`: texto corrido con `text-wrap-style: pretty` y títulos / etiquetas /
    estados vacíos / banners con `balance` (solo la propiedad larga: un `nowrap` sigue
    ganando). Encabezado:
    - La lectura del día tiene ancho fijo: el día del rótulo reserva el de "· 31 MAR" y las
      cifras 8ch. Mover el puntero ya no empuja Liquidez, "Más cifras" ni las herramientas.
    - Las cifras comparten línea base con Liquidez hoy (24 px).
    - La lectura no lleva borde propio.
    - El botón de movimientos va relleno como sus vecinos.
    - En ≤ 720 px el encabezado es una cuadrícula de tres filas, alineada a ambos bordes:
      marca · alertas · Más · Nuevo / Liquidez · cuatro paneles / herramientas.

    Superficies:
    - Menús hasta 640 px de alto: "Escribir…" ya no sale cortado.
    - Alertas en columnas (subgrid), con los montos alineados aunque la fecha lleve año.
    - Tabla de avalancha en cinco columnas, con la tasa bajo el nombre: ningún nombre
      cortado.
    - "En tu plan" muestra cifra (lo que mueve en el horizonte, `planTotal`), así que
      cambiar de sección no mueve nada.
    - Arreglos del valle: el título va junto a "Aplicar" y el detalle a todo lo ancho; el
      interés va en pesos enteros.
    - Banners angostos (consulta de contenedor): el texto va arriba junto a la × y los
      botones en una fila a la derecha.
    - La tarjeta de pago pone la fecha bajo el nombre, a todo lo ancho; el nombre largo pasa
      a dos líneas, nunca "…".
    - Los rápidos del registro van en columnas iguales.
    - Las opciones de "Se repite" llenan sus filas.
    - El renglón de deudas de la bienvenida se acomoda por tipo de control, ya no por
      posición: los `<select>` ocultos corrían los anchos.
    - Vista previa del editor: sin "−—" cuando aún no hay monto, el MSI termina en su último
      pago y la caja vacía dice qué falta.
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
    lo que se ve ("Ingresos de hoy", "Todo lo que pasó", "Préstamos de tu plan") en la barra de
    título de los paneles (con "Registrar" y la X), y la cifra total encabeza los controles. El botón del header (antes "Buscar") lo pliega y despliega; **F** lo abre y
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
  **Regla de un renglón** (2026-11-20, `metrics.rulerSingleRow`, 34 px en vez de 52): el mes
  con su año ("dic 2026") va en el mismo renglón que los días, como etiqueta suave (negrita
  sobre un relleno tenue, para que un día anterior nunca se lea como su fecha), pegada al
  borde izquierdo mientras su mes está a la vista y después de la píldora "Hoy"; los días que
  la tocarían ceden. Muy lejos, "nov 2026" por mes cuando cabe; si no, el año como etiqueta
  ("2027") y los meses "feb", "mar". El motor conserva los dos niveles sin esa opción.
  Antes: regla de dos niveles (mes / días, píldora "Hoy", fines de semana sombreados) vía
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
    (carril de caja 80 px, filas 84 px: tarjeta de 70 px, nombre y monto arriba, la fila del
    candado + fechas anclada abajo, ~13 px de aire entre ellas); 720–859 "compacta" (72 / 60); <720 "ajustada"
    (64 / 60) — el carril solo lleva el título "Caja"; la lectura del día vive en el header. 60 px es el mínimo que conserva nombre + subtítulo + medidor del header de
    track. "Análisis" vive en la fila del título "Caja" para que la celda del carril quepa en
    88 px. Las capas DOM se alinean con `--pl-ruler-h` / `--pl-lane-h` / `--pl-header-w`.
  - **Ajustes del gráfico de balance** (2026-11-20, `ChartSettings.tsx` +
    `apps/web/src/finance/chart-settings.ts`). Una **tuerca** de 26 px integrada en la esquina
    superior izquierda del gráfico (`.fin-chart-gear`, en el stage) abre un modal "Ajustes del
    gráfico", anclado bajo ella y sobre un velo tenue sin desenfoque, para ver cada cambio en
    vivo. Tiene un interruptor por extra: **Mínimos** (pines y píldoras de los puntos bajos),
    **Deuda** (su línea en su escala), **Reserva** (línea, etiqueta y tono de aviso bajo ella),
    **Plan alterno** (el fantasma del futuro comparado) y **Escala** (guías redondas y
    etiquetas de la derecha). **Todo empieza apagado**: el gráfico es la curva de caja y su línea
    de $0; debajo de $0 sigue en rojo. Cada elemento, la caja incluida, elige su color:
    "Automático" (el del tema, tokens `--chart-*` ↔ `palette.ts`) o uno de 7 tonos que se leen
    en ambos temas, sin rojo. Preferencia del navegador (`localStorage` `slicex.chart.v1`), no
    del plan. El puente recibe `setOverviewView(view)` (`OverviewView` en `visuals.ts`; por
    defecto todo encendido, para pruebas y otros hosts); el shell se lo pasa desde el primer
    cuadro y en cada cambio. El canvas acepta `PlaylistOverviewData.colors` (nunca para
    "danger"), `scaleLabels: false` y `corner` (una caja libre de etiquetas donde está la
    tuerca: los nombres de umbral y las píldoras se corren a su derecha). Elegir "Comparar" en
    Futuros enciende "Plan alterno". El fantasma del gesto y el de "Ver mi año sin esto" no
    dependen de él.
  - **Sin barra encima de la regla** (2026-11-20). Hubo un renglón de 40 px sobre la regla
    (`.fin-timebar`) con **"Asomarte a «Plan principal»"** (`FuturesPeekChip`) y la franja azul
    **"Estás en «Otra versión» (hipótesis) · Volver al plan principal"** (`FutureStrip`, UX-19);
    se quitó entera, con los dos componentes y sus estilos. El escenario vuelve a ir pegado al
    header. Asomarte al otro futuro es **mantener Q**; en qué versión estás lo dice el botón de
    Futuros (su nombre), y volver al plan principal se hace desde su menú ("Plan principal").
  - **Paneles laterales: un solo aspecto, el de "Comparar y pagar deudas"** (2026-11-19). Todo
    panel al costado del timeline (ese rail, el de movimientos, el inspector) es una columna
    acoplada al stage, sin hueco, sin tarjeta propia y sin sombra, en `--raised`, con una línea
    `--line` entre ella y el stage, y una barra de título de 52 px: título de 15 px/600 en color
    de texto, sus acciones y su cierre (X de 32 px) a la derecha, línea abajo. El stage y sus
    paneles forman UNA tarjeta: `.playlist-shell__workspace` lleva el radio y la sombra (con
    `overflow: hidden`) y el stage pierde los suyos, así las esquinas exteriores coinciden con
    el header y no hay muescas en las uniones. (Chromium headless, sin GPU, puede capturar el
    canvas con huecos transparentes bajo el inspector abierto en esta disposición; un navegador
    real lo dibuja completo — verificado con ventana, 2026-11-19.)
  - **Controles secundarios = rellenos suaves** (`--surface-2`) sin contorno; una sola acción
    primaria rellena (`--ink`) por superficie. Radios `--radius-s/m/l` = 8/12/18 px.
  - **Header: un solo tamaño** (bloque final de `globals.css`): todo control del header mide
    40 px de alto con esquina de 12 px (los botones de solo ícono, cuadros de 40); las dos
    "cifras" (la lectura del día y Liquidez hoy) comparten tipo: etiqueta chica en mayúsculas
    y valor de 17 px en negrita.
  - **Header v3 (2026-11-18): tres grupos, no once controles.** (1) *Estado del plan*: el
    chip de alertas (solo con alertas; las palabras del veredicto "Te alcanza … · Lo más bajo …"
    ya no se muestran — los valles están en el carril de caja, una rama en la franja de abajo,
    una simulación en el chip de exclusiones), la **lectura del día**
    (`PlayheadReadout` `.fin-readout--header`: CAJA y DEUDA en grande con la leyenda de las
    líneas del carril; la fecha como mini calendario desde 1670 px; a menos de 1110 px solo la
    caja), **una sola cifra en la barra**
    (Liquidez hoy, editable) y "Más cifras" justo después con todo lo demás —reserva mínima
    incluida, a cualquier ancho (`BAR_METRICS` en `FinancialSummaryBar.tsx`); el chip de alertas
    solo se ve cuando hay alertas (el mismo botón, UX-26). (2) *Herramientas*, centradas: solo
    íconos al estilo Figma (nombre y tecla en el tooltip y en el nombre accesible) y el imán como
    un ícono más (su modo en el tooltip y en la lista). (3) *Acciones*: "Registrar gasto" (solo
    con el panel de movimientos oculto), **"Pagar deudas"** (`FinancialSidePanel`
    `placement="header"`; su rail "Comparar y pagar deudas" se abre al costado del stage), el
    botón del panel, el
    futuro (solo ícono, cuadro de 40 px, mientras el plan principal es el único futuro; con más
    futuros se ensancha: ícono, nombre del futuro activo recortado con "…" y cuántos hay en una
    píldora — bajo 1430 px el nombre cede y quedan ícono y número, nunca apretados en el cuadro)
    y "+ Nuevo". Reglas al final de `globals.css`
    ("Header v3"); prevalecen sobre las de abajo que hablan de etiquetas de herramientas y de
    cifras que se acomodan por ancho.
  - **Formularios — estándar v2 (2026-11-18)** (bloque final de `globals.css`): etiqueta arriba
    en color de texto (13 px/600) y ayuda en gris 12 px; campos con superficie propia
    (`--field-bg`, `--field-border`, `--field-shadow`), 36 px y esquinas de 8 px, con el anillo
    de foco de UX-63; opciones ("Se repite", rápidos de "Registrar") como fichas con borde (la
    elegida en `--accent`); radios dibujados con los tokens; botones de diálogo rectangulares
    (8 px), con una sola primaria `--ink`; encabezado y pie separados por una línea. El
    **editor de objetos es un panel lateral** (`.fin-sheet`, del ancho del formulario). Arriba,
    de borde a borde, un **pedazo de timeline** con el objeto como lo dibuja el canvas
    (`ShapePreview`: tarjeta del color del tipo con nombre, monto y fechas, una marca por
    pago, meses y "Hoy"; solo visual, en vivo; en móvil se queda fija al hacer scroll).
    Debajo, el formulario (scroll propio), sin filas a medias: un campo que va solo en su fila
    lleva su ayuda o la lectura de la fecha al lado, y "Se repite" cabe en un renglón. Justo
    después, la **"Vista previa"** (resumen en palabras, próximos pagos y efecto en tu caja,
    en vivo), cuya franja baja hasta los botones; bajo 900 px de ancho o 620 px de alto todo
    va en un solo scroll. Su fondo
    desenfoca y oscurece el canvas **salvo el objeto que se edita** (`EditorSpotlight`): una
    ventana nítida a su alrededor, recortada con `clip-path` (`path(evenodd, …)`) en el velo
    `.fin-spotlight__scrim`, con un anillo `--accent`; la ventana se corta en el timeline
    visible y bajo el borde de la hoja, y sigue al canvas (notifies del core, un medido por
    cuadro). Al crear, o con el objeto fuera de pantalla, todo el fondo se desenfoca. Los demás
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
    permanentes (solo un chip con selección múltiple); un banner a la vez. La lectura del día
    (fecha · caja · deuda del día marcado, o del día bajo el cursor) vive en el **header**,
    justo después del chip de alertas (ver Header v3); la celda del carril de caja solo lleva su
    título. Ya no hay navegador de tiempo en el canvas (`NavControls` sin montar: "‹ Hoy ›",
    rango, − / + y "?"; el zoom sigue con la rueda / pellizco / teclas; "Cómo moverte" queda
    solo en el aviso de navegación de la primera vez).
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
  - **Control de la esquina** (`ZoomPad`, arriba de los nombres de las líneas): un rectángulo
    gris; al presionarlo y arrastrar se oculta el cursor (pointer lock) y ↕ cambia el alto de
    TODAS las líneas (arriba más altas), ↔ el zoom (izquierda menos, derecha más; el día del
    borde izquierdo se queda). Flechas en pasos. Un arrastre = un paso de deshacer.
    `PlaylistCore.setAllTrackHeights` (acción por lote `SET_ALL_TRACK_HEIGHTS`) pone las filas
    materializadas y `state.rowHeight` — el alto de las demás, que el core aplica a
    `metrics.trackHeight` (su copia propia) y re-aplica al deshacer / cargar; viaja en el layout
    guardado (`FinancialTrackLayout.rowHeight`). A su derecha, **↺ Restaurar**: todas las líneas
    a su alto normal (el de la densidad) y el zoom de inicio; apagado si ya están así. Debajo,
    la celda del carril de caja (`TimelineCell`; **sin título visible** desde 2026-11-20 — el grupo se
    llama "Plano de eventos" solo para lectores de pantalla; el canvas ya no
    dibuja "Caja") y lleva botones de solo ícono del timeline: el de filas (tres filas iguales y
    una flecha de alto) pone todas las líneas a su alto normal en un clic, y **"Compactar"**
    (2026-11-20; las filas aplastadas en líneas y dos flechas que se cierran) las deja a la
    mitad del normal (42 px). Cada uno es un paso de deshacer y se apaga cuando ya está en su
    alto. El tercero, **"Ordenar por tipo"** (2026-11-20; una "A" y una flecha curva), pone
    cada objeto en **su propia línea**, agrupados por tipo — ingresos, gastos y luego las deudas
    (`KIND_ORDER`) y, dentro de un tipo, en el orden del plan —, sin importar cómo estaban:
    llenan **las primeras líneas, sin huecos** (las vacías sin nombre se quitan; las que la
    persona nombró y quedaron vacías van después). Cada línea nueva conserva lo de la línea de
    su objeto: excluida, solo, bloqueada, su alto; y su nombre propio si esa línea solo tenía ese
    objeto. Las fechas y montos no cambian. Un solo paso de deshacer (acción del motor
    `ARRANGE_TRACKS` / `core.arrangeTracks`; el cálculo es puro, `arrangementByKind` en
    `mapping.ts`), anunciado con "Deshacer"; lleva la vista a la primera línea y se apaga cuando
    ya están así (el puente lo cachea por líneas / tarjetas / objetos). **El alto mínimo de una línea de evento es 38 px** (2026-11-20,
    `FINANCE_PLAYLIST_METRICS.trackMinHeight`): el controlador, las flechas, el arrastre de una
    fila y un plan guardado nunca bajan de ahí (el core lo recorta); a 38, cada tarjeta (32 px)
    es su etiqueta compacta de 16 px sobre una barra de 16 px.
  - **Nada se encima, en cascada** (`lanes.ts`): un objeto de una sola fecha se dibuja tan ancho
    como su nombre, más que su día; en una fila compartida los carriles separan las tarjetas
    *dibujadas*: el que empieza primero se queda arriba y los que tocaría bajan un carril, en
    orden. Si al acercar el zoom vuelven a caber, regresan a su carril (`homeLane`). Se
    re-acomoda al crear o editar un objeto (`FinancialBridge` pasa el objeto pendiente a
    `clipMinWidth`), al cargar el plan (el shell llama `core.relayoutLanes()` tras crear el
    bridge) y al cruzar un nivel de zoom (×1.25).
  - **Cada tarjeta es su etiqueta encima de su barra, a cualquier alto** (2026-11-20; sustituye a
    la pestaña "en muesca", cuyo cuerpo era grueso a la derecha de la pestaña y delgado debajo de
    ella). La **etiqueta** —una pestaña del color del canvas desde el borde izquierdo: el
    **ícono**, el nombre en negrita **en el color del objeto**, el monto en gris y, en una tarjeta
    alta, la etiqueta de fechas (`describePeriod` → `getClipPeriod`)— va **siempre fuera de la
    barra, encima de ella**; a su derecha se ve el timeline. La **barra** corre todo el largo del
    objeto con **un solo grosor de punta a punta**: todo el alto que deja la etiqueta (el tinte, el
    acento y las marcas de pago a lo alto de la barra). Para que la barra sea lo más gruesa posible
    y no sobre aire: **3 px arriba y abajo de cada tarjeta** (`FINANCE_PLAYLIST_METRICS.clipPaddingY`;
    antes 7), y el renglón de la etiqueta mide 26 px en una tarjeta alta (≥ 62 px: ícono de 21,
    fechas, candado en la esquina) y es **compacto, 16 px**, en una más baja (nombre a 12 px, monto
    a 11, ícono de 12, candado de 14): con alto 84 la barra mide 52 px; con "Compactar" (42), 20;
    con el mínimo de 38, 16. El **candado**: en una tarjeta alta, la pestaña de la esquina inferior izquierda de la barra
    (30 px, sólida, bajo el contorno; más fuerte con las fechas fijas y bajo el puntero; al
    desplazar la tarjeta sigue el borde visible con la esquina recta); en una baja, una insignia
    dentro de la etiqueta después del monto, y **sin fechas** (las dice la tarjeta del hover y el
    inspector). El contorno normal rodea la barra (esquina superior izquierda recta: ahí se apoya
    la etiqueta); la selección y los resaltados rodean etiqueta y barra (la etiqueta dibuja su
    parte del anillo). Sin trabajo por cuadro: la etiqueta se mueve por transformación con el texto
    pegado al borde y se redibuja solo si cambia su ancho o su estado. Recortado con "…" si no
    cabe; la etiqueta de una sola fecha crece para mostrarlo todo (`clipCardWidthPx`, misma
    geometría que el dibujo, ícono incluido). El agarre del monto queda sobre la etiqueta. La zona
    de clic es el rectángulo de la tarjeta.
  - **Íconos de los objetos** (2026-11-19). Cada objeto puede llevar un ícono:
    `FinancialItem.icon` guarda solo su **nombre** (kebab-case, p. ej. `"house"`,
    `"shopping-cart"`; `ItemIconSchema` de `@slicex/contracts` valida la forma, no el catálogo:
    un nombre desconocido —un plan de una app más nueva— no dibuja nada). El motor lo ignora;
    duplicar o cambiar de tipo lo conserva; al cargar el plan un nombre mal formado se descarta
    sin perder el objeto. **Fuente: catálogo propio** (`apps/web/src/finance/icons.ts`, ~50
    íconos en 7 grupos con etiqueta y palabras de búsqueda en español): trazos SVG en una
    cuadrícula de 24 con trazo 2 redondo, dentro del bundle — cero dependencias, cero red, cero
    fuentes web: latencia cero. Los nombres siguen los de Lucide donde existe uno (un cliente
    nativo o un cambio a ese set los mapea uno a uno). Instalar Lucide quedó pendiente de
    permiso (2026-11-19); con permiso, cambiar la fuente no migra datos. Mismos datos en DOM
    (`ItemIcon`, SVG con `currentColor`) y canvas: el bridge da `getClipIcon` (el MISMO arreglo
    por ícono) y el registro de nodos arma un `GraphicsContext` por glifo, compartido por todas
    las tarjetas y teñido con el color de cada una (cero trabajo por cuadro; se reconstruye solo
    si cambia la referencia). **Tamaño en la tarjeta: 21 px** (2026-11-20; se probó 28 y se
    pidió el 75 %), dentro de la pestaña de la carpeta (26 px); con la pestaña reducida de una
    tarjeta compacta se encoge a lo que quepa (18 px con filas de 42, nunca menos de 14). El
    tamaño es una escala del mismo glifo, no otra geometría. Se elige en el editor con el botón cuadrado antes del Nombre
    (`IconPicker`): buscador (sin acentos), "Para <tipo>" primero (`KIND_ICON_SUGGESTIONS`),
    luego el catálogo por grupos, "Quitar"; flechas por geometría, Enter elige, Esc cierra. Se
    ve también en la mini timeline del editor y en "En tu plan" (en lugar del punto del tipo).
    El plan demo trae íconos.
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
  el subtítulo dice el peso de la línea en palabras. **Sin color propio (2026-11-20):** el punto
  de color de la cabecera hacía pensar que la línea acepta un solo tipo (verde = solo
  ingresos); hoy todas llevan el mismo triángulo "play" en el gris de los íconos inactivos
  (`drawRowGlyph` en `layers/track-rows.ts`; más tenue si la línea está excluida), y el nombre
  va en peso medio (500), no en negrita; las filas vacías del final, en gris. El menú de la línea
  ya no tiene "Color de la línea de evento…" (abría el `<input type="color">` nativo). `track.color`
  sigue en el modelo (y el puente lo fija al crear) pero ya no se pinta.
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

**El recuadro de selección se ancla al timeline, no a la pantalla** (2026-11-20). El gesto
`marquee` guarda su esquina de inicio como tiempo + y del contenido (`startTime`,
`startContentY`); en cada movimiento se vuelve a proyectar con el scroll y el zoom de ese
momento, así que con el botón presionado puedes bajar con la rueda (o dejar que el borde
desplace la vista) y seleccionar de arriba abajo y de lado a lado en un solo arrastre. La
selección incluye las tarjetas que ya salieron de la vista mientras el recuadro las cubra: las
visibles por su rect dibujado; las de fuera, primero filtradas por fecha y luego por la caja de su
fila. Cuando la vista se mueve bajo un puntero quieto (rueda, deslizamiento, inercia, zoom con
trackpad), el arrastre en curso se vuelve a aplicar en el último puntero
(`ViewportNavigatorOptions.onStep` → `followViewport`; el auto-scroll del borde ya lo hacía).
Aplica a los arrastres atados al contenido (recuadro, mover / estirar tarjetas, pintar, marcas…),
nunca a `pan`. Pruebas: `packages/canvas/tests/marquee-scroll.spec.ts`.

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
