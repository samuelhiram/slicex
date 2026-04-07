import { Container, Graphics } from "pixi.js";
import { DAY_WIDTH_PX, dateToPixel } from "../coordinate-system";
import {
  OBJECT_HEIGHT_PX,
  OBJECT_VERTICAL_PADDING_PX,
  TRACK_HEIGHT_PX,
  type SceneObjectPlacement,
  type SceneViewportState,
} from "./types";

const POSITIVE_OBJECT_COLOR = 0x16a34a;
const NEGATIVE_OBJECT_COLOR = 0xdc2626;
const ZERO_OBJECT_COLOR = 0x64748b;

function sameViewportState(
  left: SceneViewportState,
  right: SceneViewportState,
): boolean {
  return (
    left.height === right.height &&
    left.originDate.getTime() === right.originDate.getTime() &&
    left.scrollX === right.scrollX &&
    left.width === right.width &&
    left.zoom === right.zoom
  );
}

export class ObjectLayer extends Container {
  private readonly graphics = new Graphics();

  private objects: readonly SceneObjectPlacement[] = [];

  private state: SceneViewportState | null = null;

  constructor() {
    super();

    this.eventMode = "none";
    this.addChild(this.graphics);
  }

  setViewportState(state: SceneViewportState): void {
    const nextState: SceneViewportState = {
      ...state,
      originDate: new Date(state.originDate),
    };

    if (this.state && sameViewportState(this.state, nextState)) {
      return;
    }

    this.state = nextState;
    this.renderObjects();
  }

  setObjects(objects: readonly SceneObjectPlacement[]): void {
    this.objects = [...objects];
    this.renderObjects();
  }

  private renderObjects(): void {
    const state = this.state;

    this.graphics.clear();

    if (!state || !(state.zoom > 0) || state.width <= 0 || state.height <= 0) {
      return;
    }

    const objectWidth = Math.max(4, DAY_WIDTH_PX * state.zoom);

    for (const placement of this.objects) {
      const top = placement.trackIndex * TRACK_HEIGHT_PX;

      if (top + TRACK_HEIGHT_PX < 0 || top > state.height) {
        continue;
      }

      const objectDate = new Date(placement.object.date);
      const x =
        dateToPixel(objectDate, state.originDate, state.zoom) - state.scrollX;

      if (x > state.width + objectWidth || x + objectWidth < -objectWidth) {
        continue;
      }

      const fillColor =
        placement.object.amount > 0
          ? POSITIVE_OBJECT_COLOR
          : placement.object.amount < 0
            ? NEGATIVE_OBJECT_COLOR
            : ZERO_OBJECT_COLOR;

      const y = top + OBJECT_VERTICAL_PADDING_PX;

      this.graphics
        .roundRect(Math.round(x), y, objectWidth, OBJECT_HEIGHT_PX, 8)
        .fill({ alpha: 0.92, color: fillColor })
        .stroke({ alpha: 0.18, color: 0xffffff, width: 1 });
    }
  }
}
