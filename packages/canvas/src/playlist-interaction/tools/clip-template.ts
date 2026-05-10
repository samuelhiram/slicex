import type {
  PlaylistClip,
  PlaylistClipType,
  PlaylistState,
} from "../../playlist-core";

export interface ClipCreateTemplate {
  type: PlaylistClipType;
  label: string;
  color: string;
  duration: number;
  sourceId?: string;
}

export function clipCreateTemplateFromSelection(
  state: PlaylistState,
  fallback: ClipCreateTemplate,
): ClipCreateTemplate {
  const selectedId = state.selection.clipIds[0];
  const clip = selectedId
    ? state.clips.find((candidate) => candidate.id === selectedId)
    : null;
  if (!clip) {
    return fallback;
  }
  return clipCreateTemplateFromClip(clip);
}

function clipCreateTemplateFromClip(clip: PlaylistClip): ClipCreateTemplate {
  return {
    type: clip.type,
    label: clip.label,
    color: clip.color,
    duration: clip.duration,
    sourceId: clip.sourceId ?? clip.id,
  };
}
