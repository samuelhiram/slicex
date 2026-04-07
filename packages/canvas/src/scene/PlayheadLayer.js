import { Container, Graphics } from "pixi.js";
import { dateToPixel } from "../coordinate-system";
import { PLAYHEAD_WIDTH_PX } from "./types";
const PLAYHEAD_COLOR = 0xef4444;
function samePlayheadState(left, right) {
    const leftPlayhead = left.playheadAt == null ? null : new Date(left.playheadAt).getTime();
    const rightPlayhead = right.playheadAt == null ? null : new Date(right.playheadAt).getTime();
    return (left.height === right.height &&
        left.originDate.getTime() === right.originDate.getTime() &&
        leftPlayhead === rightPlayhead &&
        left.scrollX === right.scrollX &&
        left.width === right.width &&
        left.zoom === right.zoom);
}
export class PlayheadLayer extends Container {
    graphics = new Graphics();
    state = null;
    constructor() {
        super();
        this.eventMode = "none";
        this.addChild(this.graphics);
    }
    setPlayheadState(state) {
        const nextState = {
            ...state,
            originDate: new Date(state.originDate),
            playheadAt: state.playheadAt == null ? null : new Date(state.playheadAt),
        };
        if (this.state && samePlayheadState(this.state, nextState)) {
            return;
        }
        this.state = nextState;
        this.renderPlayhead();
    }
    renderPlayhead() {
        const state = this.state;
        this.graphics.clear();
        if (!state || !(state.zoom > 0) || state.width <= 0 || state.height <= 0 || state.playheadAt == null) {
            return;
        }
        const playheadDate = new Date(state.playheadAt);
        const x = dateToPixel(playheadDate, state.originDate, state.zoom) - state.scrollX;
        if (x < -PLAYHEAD_WIDTH_PX || x > state.width + PLAYHEAD_WIDTH_PX) {
            return;
        }
        const lineX = Math.round(x) + 0.5;
        this.graphics
            .moveTo(lineX, 0)
            .lineTo(lineX, state.height)
            .stroke({ color: PLAYHEAD_COLOR, width: PLAYHEAD_WIDTH_PX });
    }
}
