import { Container, Graphics, Text } from "pixi.js";
import { TRACK_HEIGHT_PX } from "./types";
const EVEN_ROW_COLOR = 0xf8fafc;
const ODD_ROW_COLOR = 0xffffff;
const ROW_DIVIDER_COLOR = 0xe2e8f0;
const LABEL_COLOR = 0x334155;
const LABEL_FONT_SIZE = 12;
const TRACK_STRIP_WIDTH_PX = 4;
function createTrackLabel(text, color) {
    return new Text(text, {
        fill: color ?? LABEL_COLOR,
        fontFamily: "Arial",
        fontSize: LABEL_FONT_SIZE,
    });
}
export class TrackLayer extends Container {
    background = new Graphics();
    labels = new Container();
    tracks = [];
    width = 0;
    constructor() {
        super();
        this.eventMode = "none";
        this.addChild(this.background, this.labels);
    }
    setWidth(width) {
        if (this.width === width) {
            return;
        }
        this.width = width;
        this.renderTracks();
    }
    setTracks(tracks, width = this.width) {
        this.tracks = [...tracks];
        this.width = width;
        this.renderTracks();
    }
    renderTracks() {
        this.background.clear();
        this.labels.removeChildren();
        if (this.width <= 0 || this.tracks.length === 0) {
            return;
        }
        for (let index = 0; index < this.tracks.length; index += 1) {
            const track = this.tracks[index];
            const top = index * TRACK_HEIGHT_PX;
            const fillColor = index % 2 === 0 ? EVEN_ROW_COLOR : ODD_ROW_COLOR;
            this.background
                .rect(0, top, this.width, TRACK_HEIGHT_PX)
                .fill({ color: fillColor });
            if (track.color != null) {
                this.background
                    .rect(0, top, TRACK_STRIP_WIDTH_PX, TRACK_HEIGHT_PX)
                    .fill({ color: track.color });
            }
            this.background
                .moveTo(0, top + TRACK_HEIGHT_PX - 1)
                .lineTo(this.width, top + TRACK_HEIGHT_PX - 1)
                .stroke({ color: ROW_DIVIDER_COLOR, width: 1 });
            const label = createTrackLabel(track.label ?? track.id, track.color);
            label.position.set(12, top + 10);
            this.labels.addChild(label);
        }
    }
}
