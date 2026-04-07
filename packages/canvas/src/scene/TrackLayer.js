import { Container, Graphics } from "pixi.js";
import { TRACK_HEIGHT_PX } from "./types";
const EVEN_ROW_COLOR = 0xf8fafc;
const ODD_ROW_COLOR = 0xffffff;
const ROW_DIVIDER_COLOR = 0xe2e8f0;
const TRACK_STRIP_WIDTH_PX = 4;
export class TrackLayer extends Container {
    background = new Graphics();
    tracks = [];
    trackWidth = 0;
    constructor() {
        super();
        this.eventMode = "none";
        this.addChild(this.background);
    }
    setWidth(width) {
        if (this.trackWidth === width) {
            return;
        }
        this.trackWidth = width;
        this.renderTracks();
    }
    setTracks(tracks, width = this.trackWidth) {
        this.tracks = [...tracks];
        this.trackWidth = width;
        this.renderTracks();
    }
    renderTracks() {
        this.background.clear();
        if (this.trackWidth <= 0 || this.tracks.length === 0) {
            return;
        }
        for (let index = 0; index < this.tracks.length; index += 1) {
            const track = this.tracks[index];
            const top = index * TRACK_HEIGHT_PX;
            const fillColor = index % 2 === 0 ? EVEN_ROW_COLOR : ODD_ROW_COLOR;
            this.background
                .rect(0, top, this.trackWidth, TRACK_HEIGHT_PX)
                .fill({ color: fillColor });
            if (track.color != null) {
                this.background
                    .rect(0, top, TRACK_STRIP_WIDTH_PX, TRACK_HEIGHT_PX)
                    .fill({ color: track.color });
            }
            this.background
                .moveTo(0, top + TRACK_HEIGHT_PX - 1)
                .lineTo(this.trackWidth, top + TRACK_HEIGHT_PX - 1)
                .stroke({ color: ROW_DIVIDER_COLOR, width: 1 });
        }
    }
}
