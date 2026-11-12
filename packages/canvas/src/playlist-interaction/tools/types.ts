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
  // Press count resolved by the controller (2 = double-click). Browsers
  // report 0 in PointerEvent.detail, so tools must read this instead.
  // Optional for direct tool calls in tests; falls back to event.detail.
  clickCount?: number;
  // Host-owned creation (PlaylistInteractionOptions.onCreateRequest): when
  // set, tools never create clips on empty space themselves — Draw asks the
  // host instead (double-click now, drag on release).
  onCreateRequest?: (request: PlaylistCreateRequest) => void;
  // Host option (PlaylistInteractionOptions.deferDelete): the Delete tool
  // marks what it touches and deletes on release instead of at once.
  deferDelete?: boolean;
}

// What the Draw tool asks a host that creates through its own flow: the
// row, the snapped start and, for a drag, the length (null = default).
// `templateClipId`: the selected clip Draw would have stamped (FL), if any.
export interface PlaylistCreateRequest {
  trackIndex: number;
  start: number;
  duration: number | null;
  templateClipId: string | null;
  // Where the press happened (host-local px): anchor for a menu.
  point?: PlaylistPoint;
  // Lane the new clip would take in that row (ghost of a menu).
  lane?: number;
  // 2 = the second press of a double-click (open at once, no menu).
  clickCount?: number;
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
