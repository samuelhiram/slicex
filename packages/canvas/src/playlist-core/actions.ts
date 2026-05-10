import type {
  PlaylistClip,
  PlaylistClipboard,
  PlaylistContextMenu,
  PlaylistHover,
  PlaylistMarker,
  PlaylistMarquee,
  PlaylistPoint,
  PlaylistSelection,
  PlaylistSnapMode,
  PlaylistToolId,
  PlaylistViewport,
} from "./types";

export interface PlaylistClipMoveUpdate {
  id: string;
  start: number;
  trackIndex: number;
}

export type PlaylistAction =
  // Document-level mutations (undoable).
  | { type: "MOVE_CLIPS"; updates: PlaylistClipMoveUpdate[] }
  | {
      type: "RESIZE_CLIP";
      clipId: string;
      edge: "left" | "right";
      time: number;
    }
  | {
      type: "ADD_AUTOMATION_POINT";
      clipId: string;
      pointId: string;
      time: number;
      value: number;
    }
  | {
      type: "MOVE_AUTOMATION_POINT";
      clipId: string;
      pointId: string;
      time: number;
      value: number;
    }
  | { type: "REMOVE_AUTOMATION_POINT"; clipId: string; pointId: string }
  | { type: "REMOVE_SELECTED" }
  | { type: "CLEAR_TRACK_CLIPS"; trackIndex: number }
  | { type: "DELETE_SELECTED_CLIPS_ON_TRACK"; trackIndex: number }
  | { type: "RENAME_TRACK"; trackIndex: number; label: string }
  | { type: "RECOLOR_TRACK"; trackIndex: number; color: string }
  | { type: "INSERT_TRACK_BELOW"; trackIndex: number }
  | { type: "DELETE_EMPTY_TRACK"; trackIndex: number }
  | { type: "CREATE_CLIP"; clip: PlaylistClip; trackIndex: number }
  | {
      type: "CREATE_CLIPS_BATCH";
      entries: { clip: PlaylistClip; trackIndex: number }[];
    }
  | { type: "DELETE_CLIP"; clipId: string }
  | { type: "TOGGLE_CLIP_MUTE"; clipId: string }
  | { type: "TOGGLE_TRACK_MUTE"; trackIndex: number }
  | { type: "TOGGLE_TRACK_SOLO"; trackIndex: number }
  | { type: "TOGGLE_TRACK_LOCK"; trackIndex: number }
  | { type: "SET_TRACK_HEIGHT"; trackIndex: number; height: number }
  | { type: "REORDER_TRACK"; fromIndex: number; toIndex: number }
  | { type: "MAKE_CLIPS_UNIQUE"; clipIds: string[] }
  | { type: "SET_CLIP_LABEL"; clipId: string; label: string }
  | { type: "SET_CLIP_COLOR"; clipId: string; color: string }
  | { type: "SET_CLIP_CONTENT_OFFSET"; clipId: string; contentOffset: number }
  | { type: "SET_CLIP_STRETCH_RATIO"; clipId: string; stretchRatio: number }
  | {
      type: "STRETCH_RESIZE_CLIP";
      clipId: string;
      edge: "left" | "right";
      time: number;
    }
  | {
      type: "SLICE_CLIPS_AT_TIME";
      time: number;
      newClips: PlaylistClip[];
    }
  | {
      type: "PASTE_CLIPS";
      entries: { clip: PlaylistClip; trackIndex: number }[];
      selectIds: string[];
    }
  | { type: "ADD_MARKER"; marker: PlaylistMarker }
  | { type: "REMOVE_MARKER"; markerId: string }
  | { type: "UPDATE_MARKER"; markerId: string; patch: Partial<PlaylistMarker> }
  // UI-only mutations (not undoable).
  | { type: "SET_SELECTION"; selection: Partial<PlaylistSelection> }
  | { type: "SET_MARQUEE"; marquee: PlaylistMarquee | null }
  | { type: "SET_HOVER"; hover: PlaylistHover }
  | { type: "SET_CONTEXT_MENU"; contextMenu: PlaylistContextMenu }
  | {
      type: "OPEN_TRACK_CONTEXT_MENU";
      trackIndex: number;
      position: PlaylistPoint;
    }
  | { type: "CLOSE_CONTEXT_MENU" }
  | { type: "SET_VIEWPORT_SIZE"; width: number; height: number }
  | {
      type: "UPDATE_VIEWPORT";
      patch: Partial<PlaylistViewport>;
      clamp: boolean;
    }
  | { type: "SET_PLAY_POSITION"; time: number }
  | { type: "SET_PLAY_RUNNING"; isRunning: boolean }
  | { type: "ADVANCE_PLAY_POSITION"; deltaTime: number }
  | { type: "SET_TOOL"; tool: PlaylistToolId }
  | { type: "SELECT_ALL_CLIPS" }
  | { type: "INVERT_CLIP_SELECTION" }
  | { type: "SET_CLIPBOARD"; clipboard: PlaylistClipboard | null }
  | { type: "SET_SNAP_MODE"; mode: PlaylistSnapMode }
  | { type: "TOGGLE_SNAP_NONE" }
  | { type: "SET_STRETCH_MODE"; enabled: boolean }
  | { type: "TOGGLE_STRETCH_MODE" }
  | {
      type: "OPEN_MARKER_CONTEXT_MENU";
      markerId: string;
      position: PlaylistPoint;
    }
  | { type: "SET_TRANSPORT_MODE"; mode: "song" | "pattern" }
  | { type: "TOGGLE_TRANSPORT_MODE" }
  | { type: "TOGGLE_TRANSPORT_RECORDING" };

export type PlaylistActionType = PlaylistAction["type"];

const UNDOABLE_ACTION_TYPES: ReadonlySet<PlaylistActionType> = new Set([
  "MOVE_CLIPS",
  "RESIZE_CLIP",
  "ADD_AUTOMATION_POINT",
  "MOVE_AUTOMATION_POINT",
  "REMOVE_AUTOMATION_POINT",
  "REMOVE_SELECTED",
  "CLEAR_TRACK_CLIPS",
  "DELETE_SELECTED_CLIPS_ON_TRACK",
  "RENAME_TRACK",
  "RECOLOR_TRACK",
  "INSERT_TRACK_BELOW",
  "DELETE_EMPTY_TRACK",
  "CREATE_CLIP",
  "CREATE_CLIPS_BATCH",
  "DELETE_CLIP",
  "TOGGLE_CLIP_MUTE",
  "PASTE_CLIPS",
  "TOGGLE_TRACK_MUTE",
  "TOGGLE_TRACK_SOLO",
  "TOGGLE_TRACK_LOCK",
  "SET_TRACK_HEIGHT",
  "REORDER_TRACK",
  "MAKE_CLIPS_UNIQUE",
  "SET_CLIP_LABEL",
  "SET_CLIP_COLOR",
  "SET_CLIP_CONTENT_OFFSET",
  "SET_CLIP_STRETCH_RATIO",
  "STRETCH_RESIZE_CLIP",
  "SLICE_CLIPS_AT_TIME",
  "ADD_MARKER",
  "REMOVE_MARKER",
  "UPDATE_MARKER",
] satisfies PlaylistActionType[]);

export function isUndoableAction(action: PlaylistAction): boolean {
  return UNDOABLE_ACTION_TYPES.has(action.type);
}
