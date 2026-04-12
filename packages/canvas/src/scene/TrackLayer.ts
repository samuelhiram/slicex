import { Container, Graphics } from "pixi.js";
import {
  TRACK_HEIGHT_PX,
  type SceneThemePalette,
  type SceneTrack,
} from "./types";

const TRACK_STRIP_WIDTH_PX = 4;

const DEFAULT_THEME: SceneThemePalette = {
  rulerBackground: 0xf8fafc,
  rulerBorder: 0xcbd5e1,
  gridLine: 0xdbe2ea,
  trackRowEven: 0xf8fafc,
  trackRowOdd: 0xffffff,
  trackRowDivider: 0xe2e8f0,
};

export class TrackLayer extends Container {
  private readonly background = new Graphics();

  private tracks: readonly SceneTrack[] = [];

  private trackWidth = 0;

  private trackHeight = 0;

  private theme: SceneThemePalette = DEFAULT_THEME;

  constructor() {
    super();

    this.eventMode = "none";
    this.addChild(this.background);
  }

  setTheme(theme: SceneThemePalette): void {
    this.theme = theme;
    this.renderTracks();
  }

  setWidth(width: number): void {
    if (this.trackWidth === width) {
      return;
    }

    this.trackWidth = width;
    this.renderTracks();
  }

  setTracks(
    tracks: readonly SceneTrack[],
    width = this.trackWidth,
    height = this.trackHeight,
  ): void {
    this.tracks = [...tracks];
    this.trackWidth = width;
    this.trackHeight = height;
    this.renderTracks();
  }

  private renderTracks(): void {
    this.background.clear();

    if (this.trackWidth <= 0 || this.trackHeight <= 0) {
      return;
    }

    const visibleRowCount = Math.max(
      Math.ceil(this.trackHeight / TRACK_HEIGHT_PX),
      1,
    );
    const rowCount = Math.max(this.tracks.length, visibleRowCount);

    for (let index = 0; index < rowCount; index += 1) {
      const track = this.tracks[index];
      const top = index * TRACK_HEIGHT_PX;
      const rowHeight = Math.min(TRACK_HEIGHT_PX, this.trackHeight - top);

      if (rowHeight <= 0) {
        break;
      }

      const fillColor =
        index % 2 === 0 ? this.theme.trackRowEven : this.theme.trackRowOdd;

      this.background
        .rect(0, top, this.trackWidth, rowHeight)
        .fill({ color: fillColor });

      if (track?.color != null) {
        this.background
          .rect(0, top, TRACK_STRIP_WIDTH_PX, rowHeight)
          .fill({ color: track.color });
      }

      this.background
        .moveTo(0, top + rowHeight - 1)
        .lineTo(this.trackWidth, top + rowHeight - 1)
        .stroke({ color: this.theme.trackRowDivider, width: 1 });
    }
  }
}
