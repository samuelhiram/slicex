import type {
  PlaylistCore,
  PlaylistMetrics,
  PlaylistPoint,
  PlaylistToolId,
} from "../../playlist-core";
import type { PlaylistHit } from "../hit-test";
import type { ActiveGesture } from "../gesture-types";

export interface ToolEnvironment {
  core: PlaylistCore;
  metrics: PlaylistMetrics;
  point: PlaylistPoint;
  hit: PlaylistHit;
  event: PointerEvent;
}

export interface PlaylistTool {
  readonly id: PlaylistToolId;
  // Default cursor when this tool is active and the cursor is over the timeline.
  readonly cursor: string;
  // Decide what gesture (if any) to start when LMB hits a timeline area.
  // Returning null means the tool consumed the event but no gesture is needed
  // (e.g. discrete one-shot like delete or mute).
  onPointerDown(env: ToolEnvironment): ActiveGesture | null;
}
