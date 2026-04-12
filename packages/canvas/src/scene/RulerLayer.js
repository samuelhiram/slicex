import { Container, Graphics } from "pixi.js";
import { DAY_WIDTH_PX, dateToPixel, pixelToDate } from "../coordinate-system";
import { RULER_HEIGHT_PX, } from "./types";
const DEFAULT_THEME = {
    rulerBackground: 0xf8fafc,
    rulerBorder: 0xcbd5e1,
    gridLine: 0xdbe2ea,
    trackRowEven: 0xf8fafc,
    trackRowOdd: 0xffffff,
    trackRowDivider: 0xe2e8f0,
};
function toUtcMidnight(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function addDays(date, days) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}
function getGranularity(zoom) {
    const pixelsPerDay = DAY_WIDTH_PX * zoom;
    if (pixelsPerDay >= 48) {
        return "day";
    }
    if (pixelsPerDay >= 16) {
        return "week";
    }
    return "month";
}
function alignToGranularity(date, granularity) {
    const midnight = toUtcMidnight(date);
    if (granularity === "day") {
        return midnight;
    }
    if (granularity === "week") {
        const dayOfWeek = midnight.getUTCDay();
        const offset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        return addDays(midnight, offset);
    }
    return new Date(Date.UTC(midnight.getUTCFullYear(), midnight.getUTCMonth(), 1));
}
function advance(date, granularity) {
    if (granularity === "day") {
        return addDays(date, 1);
    }
    if (granularity === "week") {
        return addDays(date, 7);
    }
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}
function sameViewportState(left, right) {
    return (left.height === right.height &&
        left.originDate.getTime() === right.originDate.getTime() &&
        left.scrollX === right.scrollX &&
        left.width === right.width &&
        left.zoom === right.zoom);
}
export class RulerLayer extends Container {
    gridLines = new Graphics();
    background = new Graphics();
    ticks = new Graphics();
    theme = DEFAULT_THEME;
    state = null;
    constructor() {
        super();
        this.eventMode = "none";
        this.addChild(this.gridLines, this.background, this.ticks);
    }
    setTheme(theme) {
        this.theme = theme;
        this.renderRuler();
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
        this.renderRuler();
    }
    renderRuler() {
        const state = this.state;
        this.gridLines.clear();
        this.background.clear();
        this.ticks.clear();
        if (!state || !(state.zoom > 0) || state.width <= 0 || state.height <= 0) {
            return;
        }
        this.background
            .rect(0, 0, state.width, RULER_HEIGHT_PX)
            .fill({ color: this.theme.rulerBackground });
        this.background
            .moveTo(0, RULER_HEIGHT_PX - 1)
            .lineTo(state.width, RULER_HEIGHT_PX - 1)
            .stroke({ color: this.theme.rulerBorder, width: 1 });
        const granularity = getGranularity(state.zoom);
        const visibleStartDate = pixelToDate(state.scrollX, state.originDate, state.zoom);
        let tickDate = alignToGranularity(visibleStartDate, granularity);
        const tickHeight = granularity === "day" ? 16 : granularity === "week" ? 14 : 12;
        const overscan = Math.max(48, DAY_WIDTH_PX * state.zoom);
        for (let guard = 0; guard < 500; guard += 1) {
            const x = dateToPixel(tickDate, state.originDate, state.zoom) - state.scrollX;
            if (x > state.width + overscan) {
                break;
            }
            if (x >= -overscan) {
                const tickX = Math.round(x) + 0.5;
                this.gridLines
                    .moveTo(tickX, RULER_HEIGHT_PX)
                    .lineTo(tickX, state.height)
                    .stroke({ alpha: 0.45, color: this.theme.gridLine, width: 1 });
                this.ticks
                    .moveTo(tickX, RULER_HEIGHT_PX - 1)
                    .lineTo(tickX, RULER_HEIGHT_PX - tickHeight)
                    .stroke({ color: this.theme.gridLine, width: 1 });
            }
            tickDate = advance(tickDate, granularity);
        }
    }
}
