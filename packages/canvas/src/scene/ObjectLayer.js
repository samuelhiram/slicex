import { Container, Graphics } from "pixi.js";
const POSITIVE_OBJECT_COLOR = 0x16a34a;
const NEGATIVE_OBJECT_COLOR = 0xdc2626;
const ZERO_OBJECT_COLOR = 0x64748b;
function sameViewportState(left, right) {
    return (left.height === right.height &&
        left.originDate.getTime() === right.originDate.getTime() &&
        left.scrollX === right.scrollX &&
        left.width === right.width &&
        left.zoom === right.zoom);
}
export class ObjectLayer extends Container {
    graphics = new Graphics();
    objects = [];
    state = null;
    constructor() {
        super();
        this.eventMode = "none";
        this.addChild(this.graphics);
    }
    setViewportState(state) {
        const nextState = {
            ...state,
            originDate: new Date(state.originDate),
        };
        if (this.state && sameViewportState(this.state, nextState)) {
            return;
        }
        this.state = nextState;
        this.renderObjects();
    }
    setObjects(objects) {
        this.objects = [...objects];
        this.renderObjects();
    }
    renderObjects() {
        const state = this.state;
        this.graphics.clear();
        if (!state || !(state.zoom > 0) || state.width <= 0 || state.height <= 0) {
            return;
        }
        for (const placement of this.objects) {
            if (placement.y + placement.heightPx < 0 ||
                placement.y > state.height ||
                placement.x + placement.widthPx < 0 ||
                placement.x > state.width) {
                continue;
            }
            const fillColor = placement.object.amount > 0
                ? POSITIVE_OBJECT_COLOR
                : placement.object.amount < 0
                    ? NEGATIVE_OBJECT_COLOR
                    : ZERO_OBJECT_COLOR;
            this.graphics
                .roundRect(Math.round(placement.x), placement.y, placement.widthPx, placement.heightPx, 8)
                .fill({ alpha: 0.92, color: fillColor })
                .stroke({ alpha: 0.18, color: 0xffffff, width: 1 });
        }
    }
}
