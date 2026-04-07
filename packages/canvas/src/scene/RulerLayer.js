import { Container, Graphics, Text } from "pixi.js";
import { DAY_WIDTH_PX, dateToPixel, pixelToDate } from "../coordinate-system";
import { RULER_HEIGHT_PX } from "./types";
const BACKGROUND_COLOR = 0xf8fafc;
const BORDER_COLOR = 0xcbd5e1;
const TICK_COLOR = 0x94a3b8;
const LABEL_COLOR = 0x334155;
const LABEL_FONT_SIZE = 11;
const dayFormatter = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
});
const monthFormatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
});
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
function formatTickLabel(date, granularity) {
    if (granularity === "month") {
        return monthFormatter.format(date);
    }
    return dayFormatter.format(date);
}
function createTickLabel(text) {
    return new Text(text, {
        fill: LABEL_COLOR,
        fontFamily: "Arial",
        fontSize: LABEL_FONT_SIZE,
    });
}
function sameViewportState(left, right) {
    return (left.height === right.height &&
        left.originDate.getTime() === right.originDate.getTime() &&
        left.scrollX === right.scrollX &&
        left.width === right.width &&
        left.zoom === right.zoom);
}
export class RulerLayer extends Container {
    background = new Graphics();
    ticks = new Graphics();
    labels = new Container();
    state = null;
    constructor() {
        super();
        this.eventMode = "none";
        this.addChild(this.background, this.ticks, this.labels);
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
        this.background.clear();
        this.ticks.clear();
        this.labels.removeChildren();
        if (!state || !(state.zoom > 0) || state.width <= 0 || state.height <= 0) {
            return;
        }
        this.background
            .rect(0, 0, state.width, RULER_HEIGHT_PX)
            .fill({ color: BACKGROUND_COLOR });
        this.background
            .moveTo(0, RULER_HEIGHT_PX - 1)
            .lineTo(state.width, RULER_HEIGHT_PX - 1)
            .stroke({ color: BORDER_COLOR, width: 1 });
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
                this.ticks
                    .moveTo(tickX, RULER_HEIGHT_PX - 1)
                    .lineTo(tickX, RULER_HEIGHT_PX - tickHeight)
                    .stroke({ color: TICK_COLOR, width: 1 });
                const label = createTickLabel(formatTickLabel(tickDate, granularity));
                label.position.set(Math.round(x) + 4, 3);
                this.labels.addChild(label);
            }
            tickDate = advance(tickDate, granularity);
        }
    }
}
