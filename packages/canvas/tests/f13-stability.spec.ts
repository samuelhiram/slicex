// F13 — Bloque de estabilidad. Cada test aquí fija un defecto real que el
// audit de paridad FL sacó a la luz y que antes pasaba en verde porque nadie
// verificaba la propiedad correcta.
import { describe, expect, it } from "vitest";
import {
  automationValueAtTime,
  createDemoPlaylistState,
  createPlaylistCore,
  DEFAULT_PLAYLIST_METRICS,
  splitAutomationPoints,
  type PlaylistAutomationClip,
  type PlaylistCore,
} from "../src/playlist-core";
import { createPlaylistInteractionController } from "../src/playlist-interaction";

const M = DEFAULT_PLAYLIST_METRICS;

function automationClip(core: PlaylistCore, id: string): PlaylistAutomationClip {
  const clip = core.getState().clips.find((c) => c.id === id);
  if (!clip || clip.type !== "automation") {
    throw new Error(`${id} no es un automation clip`);
  }
  return clip;
}

function createHost() {
  const listeners = new Map<string, (event: Event) => void>();
  const host = {
    style: { cursor: "" } as Record<string, string>,
    focus() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1200, height: 700 };
    },
    addEventListener(type: string, listener: (event: Event) => void) {
      listeners.set(type, listener);
    },
    removeEventListener(type: string) {
      listeners.delete(type);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    dispatchEvent() {
      return true;
    },
  };
  return { host: host as unknown as HTMLElement, listeners };
}

function pointerEvent(
  x: number,
  y: number,
  extra: { button?: number; altKey?: boolean } = {},
): PointerEvent {
  return {
    pointerId: 1,
    button: extra.button ?? 0,
    clientX: x,
    clientY: y,
    altKey: extra.altKey ?? false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    detail: 1,
    preventDefault() {},
  } as unknown as PointerEvent;
}

describe("F13/B1 — slice preserva la envolvente de automatización", () => {
  it("interpola linealmente entre puntos", () => {
    const points = [
      { id: "p1", time: 0, value: 0 },
      { id: "p2", time: 10, value: 1 },
    ];
    expect(automationValueAtTime(points, 5)).toBeCloseTo(0.5, 6);
    // Fuera del rango la envolvente sostiene el extremo.
    expect(automationValueAtTime(points, -3)).toBe(0);
    expect(automationValueAtTime(points, 99)).toBe(1);
  });

  it("cada mitad conserva la forma y materializa el corte", () => {
    const points = [
      { id: "a-pt-1", time: 0, value: 0 },
      { id: "a-pt-2", time: 4, value: 1 },
      { id: "a-pt-3", time: 8, value: 0 },
    ];
    const { left, right } = splitAutomationPoints(points, 6, "a", "b");

    // Izquierda: los puntos previos + el corte con el valor interpolado (0.5).
    expect(left.map((p) => p.time)).toEqual([0, 4, 6]);
    expect(left[left.length - 1]!.value).toBeCloseTo(0.5, 6);
    // Antes del fix, los puntos posteriores al corte se apelmazaban aquí.
    expect(left.every((p) => p.time <= 6 + 1e-9)).toBe(true);

    // Derecha: rebasada a 0, arrancando en el mismo valor del corte.
    expect(right[0]!.time).toBe(0);
    expect(right[0]!.value).toBeCloseTo(0.5, 6);
    expect(right.map((p) => p.time)).toEqual([0, 2]);

    // Ids reconstruidos por mitad: comparten prefijo con su clip dueño y no
    // colisionan entre halves (los ids derivan del id del clip).
    expect(left.every((p) => p.id.startsWith("a-pt-"))).toBe(true);
    expect(right.every((p) => p.id.startsWith("b-pt-"))).toBe(true);
    const ids = new Set([...left, ...right].map((p) => p.id));
    expect(ids.size).toBe(left.length + right.length);
  });

  it("una mitad nunca queda con menos de dos puntos", () => {
    const points = [
      { id: "a-pt-1", time: 5, value: 0.4 },
      { id: "a-pt-2", time: 9, value: 0.9 },
    ];
    // Corte antes del primer punto: la izquierda se quedaría con uno solo.
    const { left, right } = splitAutomationPoints(points, 2, "a", "b");
    expect(left.length).toBeGreaterThanOrEqual(2);
    expect(right.length).toBeGreaterThanOrEqual(2);
  });

  it("sliceClipsAtTime no aplana la envolvente del clip real", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = automationClip(core, "clip-auto-1");
    const cut = before.start + 10;
    const valueAtCut = automationValueAtTime(before.points, 10)!;

    const newIds = core.sliceClipsAtTime(cut);

    const left = automationClip(core, "clip-auto-1");
    const rightId = newIds.find((id) => {
      const clip = core.getState().clips.find((c) => c.id === id);
      return clip?.type === "automation";
    })!;
    const right = automationClip(core, rightId);

    // La prueba que faltaba: los puntos siguen distribuidos, no colapsados
    // contra el borde. Antes del fix todos los > cut valían exactamente
    // left.duration.
    const stackedOnEdge = left.points.filter(
      (p) => Math.abs(p.time - left.duration) < 1e-9,
    );
    expect(stackedOnEdge.length).toBe(1);
    expect(new Set(left.points.map((p) => p.time)).size).toBe(left.points.length);

    // El corte es continuo: la izquierda termina donde la derecha empieza.
    expect(left.points[left.points.length - 1]!.value).toBeCloseTo(valueAtCut, 6);
    expect(right.points[0]!.time).toBe(0);
    expect(right.points[0]!.value).toBeCloseTo(valueAtCut, 6);

    // Ningún punto se sale de su mitad.
    expect(left.points.every((p) => p.time <= left.duration + 1e-9)).toBe(true);
    expect(right.points.every((p) => p.time <= right.duration + 1e-9)).toBe(true);
  });

  it("un escalon vertical (dos puntos en el mismo time) sobrevive al corte", () => {
    const points = [
      { id: "a-pt-1", time: 0, value: 0.2 },
      { id: "a-pt-2", time: 6, value: 0.7 },
      { id: "a-pt-3", time: 6, value: 0.1 },
      { id: "a-pt-4", time: 12, value: 0.9 },
    ];
    const { left, right } = splitAutomationPoints(points, 6, "a", "b");
    // Ningun valor del escalon se pierde: el corte cae justo encima y ambos
    // puntos existen a cada lado.
    expect(left.filter((p) => Math.abs(p.time - 6) < 1e-9).map((p) => p.value)).toEqual(
      [0.7, 0.1],
    );
    expect(right.filter((p) => p.time === 0).map((p) => p.value)).toEqual([0.7, 0.1]);
    expect(left.length + right.length).toBeGreaterThanOrEqual(points.length);
  });

  it("una envolvente vacia sigue vacia (no inventa una linea plana)", () => {
    const { left, right } = splitAutomationPoints([], 4, "a", "b");
    expect(left).toEqual([]);
    expect(right).toEqual([]);
    // Y sin datos no hay valor que reportar.
    expect(automationValueAtTime([], 3)).toBeNull();
  });

  it("la mitad izquierda conserva los ids: una seleccion viva no se repunta", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const pointId = core.addAutomationPoint("clip-auto-1", 3, 0.5)!;
    expect(pointId).toBeTruthy();
    const timeOfSelected = automationClip(core, "clip-auto-1").points.find(
      (p) => p.id === pointId,
    )!.time;

    core.sliceClipsAtTime(automationClip(core, "clip-auto-1").start + 25);

    // El id seleccionado debe seguir designando el MISMO punto, no otro.
    const still = automationClip(core, "clip-auto-1").points.find(
      (p) => p.id === pointId,
    );
    expect(still, "el id de la seleccion desaparecio").toBeTruthy();
    expect(still!.time).toBeCloseTo(timeOfSelected, 6);
  });

  it("la mitad derecha no codifica el desfase dos veces", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = automationClip(core, "clip-auto-1");
    const baseOffset = before.contentOffset ?? 0;
    const newIds = core.sliceClipsAtTime(before.start + 25);
    const rightId = newIds.find(
      (id) => core.getState().clips.find((c) => c.id === id)?.type === "automation",
    )!;
    const right = automationClip(core, rightId);
    // Los puntos ya estan rebasados a 0: avanzar tambien contentOffset
    // pintaria un badge "↻25" sobre una envolvente que empieza limpia.
    expect(right.points[0]!.time).toBe(0);
    expect(right.contentOffset ?? 0).toBe(baseOffset);
  });

  it("no trunca clips en tracks bloqueadas", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const target = core.getState().clips.find((c) => c.duration > 8)!;
    const trackIndex = core
      .getState()
      .tracks.findIndex((t) => t.id === target.trackId);
    core.toggleTrackLock(trackIndex);

    const originalDuration = target.duration;
    const newIds = core.sliceClipsAtTime(target.start + 4);

    // El clip bloqueado no se parte NI se acorta: antes se quedaba truncado
    // sin mitad derecha, o sea pérdida de contenido.
    const after = core.getState().clips.find((c) => c.id === target.id)!;
    expect(after.duration).toBe(originalDuration);
    expect(newIds.some((id) => id === target.id)).toBe(false);
  });
});

describe("F13/B2 — RMB sobre un automation clip añade punto, no lo borra", () => {
  for (const tool of ["draw", "paint", "mute"] as const) {
    it(`con la herramienta ${tool}`, () => {
      const core = createPlaylistCore(createDemoPlaylistState());
      core.setViewportSize(1200, 700);
      core.setTool(tool);
      const { host, listeners } = createHost();
      const controller = createPlaylistInteractionController(host, core);

      const before = automationClip(core, "clip-auto-1");
      const pointsBefore = before.points.length;
      const view = core.getPresentation().clipViewsById.get("clip-auto-1")!;
      // Punto medio del cuerpo, por debajo de la franja de título para no
      // caer en los handles de resize.
      const cx = view.bodyRect.x + view.bodyRect.width / 2;
      const cy = view.bodyRect.y + view.bodyRect.height * 0.7;

      listeners.get("pointerdown")?.(pointerEvent(cx, cy, { button: 2 }));

      const after = core.getState().clips.find((c) => c.id === "clip-auto-1");
      expect(after, "el clip de automatización no debe borrarse").toBeTruthy();
      expect(automationClip(core, "clip-auto-1").points.length).toBe(
        pointsBefore + 1,
      );
      controller.destroy();
    });
  }

  it("tampoco lo borra por RMB en la barra de titulo ni en los bordes", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setTool("draw");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const view = core.getPresentation().clipViewsById.get("clip-auto-1")!;

    // Barra de titulo: el hit es "clip", no "automation-body".
    listeners.get("pointerdown")?.(
      pointerEvent(view.rect.x + view.rect.width / 2, view.rect.y + 3, {
        button: 2,
      }),
    );
    expect(core.getState().clips.find((c) => c.id === "clip-auto-1")).toBeTruthy();

    // Borde derecho: el hit es "resize-right".
    listeners.get("pointerdown")?.(
      pointerEvent(view.rect.x + view.rect.width - 2, view.rect.y + 3, {
        button: 2,
      }),
    );
    expect(core.getState().clips.find((c) => c.id === "clip-auto-1")).toBeTruthy();
    controller.destroy();
  });

  it("el barrido de borrado se salta los automation clips", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setTool("draw");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);

    const victim = core
      .getState()
      .clips.find((c) => c.type !== "automation" && c.id !== "clip-auto-1")!;
    const victimView = core.getPresentation().clipViewsById.get(victim.id)!;
    const autoView = core.getPresentation().clipViewsById.get("clip-auto-1")!;

    // RMB sobre un clip normal arranca el barrido, y luego cruza el
    // automation clip.
    listeners.get("pointerdown")?.(
      pointerEvent(
        victimView.bodyRect.x + victimView.bodyRect.width / 2,
        victimView.bodyRect.y + victimView.bodyRect.height / 2,
        { button: 2 },
      ),
    );
    listeners.get("pointermove")?.(
      pointerEvent(
        autoView.bodyRect.x + autoView.bodyRect.width / 2,
        autoView.bodyRect.y + autoView.bodyRect.height / 2,
      ),
    );
    listeners.get("pointerup")?.(
      pointerEvent(
        autoView.bodyRect.x + autoView.bodyRect.width / 2,
        autoView.bodyRect.y + autoView.bodyRect.height / 2,
      ),
    );

    expect(core.getState().clips.find((c) => c.id === victim.id)).toBeUndefined();
    expect(
      core.getState().clips.find((c) => c.id === "clip-auto-1"),
      "el barrido no debe comerse la envolvente",
    ).toBeTruthy();
    controller.destroy();
  });

  it("RMB sobre un clip normal sigue borrando con draw", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setTool("draw");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const view = core.getPresentation().clipViewsById.get("clip-drums-1")!;
    const cx = view.bodyRect.x + view.bodyRect.width / 2;
    const cy = view.bodyRect.y + view.bodyRect.height / 2;

    listeners.get("pointerdown")?.(pointerEvent(cx, cy, { button: 2 }));

    expect(
      core.getState().clips.find((c) => c.id === "clip-drums-1"),
    ).toBeUndefined();
    controller.destroy();
    void M;
  });
});

describe("F13 — resize de automatizacion no destruye la envolvente", () => {
  it("acortar y volver a estirar restaura los puntos", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    const before = automationClip(core, "clip-auto-1");
    const originalTimes = before.points.map((p) => p.time);
    const originalDuration = before.duration;

    // Acortar de 32 a 10 beats: antes esto apilaba irreversiblemente los tres
    // puntos posteriores contra t=10, porque normalizeState clampeaba
    // point.time contra duration en CADA dispatch y el resultado entraba al
    // historial.
    core.resizeClip("clip-auto-1", "right", before.start + 10);
    const shrunk = automationClip(core, "clip-auto-1");
    expect(shrunk.duration).toBeCloseTo(10, 6);

    // Volver a estirar: el clip es una ventana, no una tijera.
    core.resizeClip("clip-auto-1", "right", before.start + originalDuration);
    const regrown = automationClip(core, "clip-auto-1");
    expect(regrown.points.map((p) => p.time)).toEqual(originalTimes);
  });

  it("la presentacion recorta los puntos fuera de la ventana", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    const clip = automationClip(core, "clip-auto-1");
    const visibleBefore = core
      .getPresentation()
      .clipViewsById.get("clip-auto-1")!.automationPoints.length;

    core.resizeClip("clip-auto-1", "right", clip.start + 10);

    const view = core.getPresentation().clipViewsById.get("clip-auto-1")!;
    // El modelo los conserva...
    expect(automationClip(core, "clip-auto-1").points.length).toBe(
      clip.points.length,
    );
    // ...pero fuera de la ventana no se dibujan.
    expect(view.automationPoints.length).toBeLessThan(visibleBefore);
    expect(
      view.automationPoints.every((p) => p.point.time <= 10 + 1e-6),
    ).toBe(true);
  });
});

describe("F13 — Paint no estampa encima de un clip existente", () => {
  it("Alt+click sobre un clip no crea un duplicado solapado", () => {
    const core = createPlaylistCore(createDemoPlaylistState());
    core.setViewportSize(1200, 700);
    core.setTool("paint");
    core.setSnapMode("beat");
    const { host, listeners } = createHost();
    const controller = createPlaylistInteractionController(host, core);
    const countBefore = core.getState().clips.length;
    const view = core.getPresentation().clipViewsById.get("clip-drums-1")!;

    // Alt = bypass de snap: la celda "ocupada" se calcula sobre el tiempo
    // snappeado, asi que sin esta guarda el clip caia entre celdas y el grid
    // reportaba el hueco como libre.
    listeners.get("pointerdown")?.(
      pointerEvent(
        view.bodyRect.x + view.bodyRect.width / 2 + 3,
        view.bodyRect.y + view.bodyRect.height / 2,
        { altKey: true },
      ),
    );
    listeners.get("pointerup")?.(
      pointerEvent(
        view.bodyRect.x + view.bodyRect.width / 2 + 3,
        view.bodyRect.y + view.bodyRect.height / 2,
        { altKey: true },
      ),
    );

    expect(core.getState().clips.length).toBe(countBefore);
    controller.destroy();
  });
});
