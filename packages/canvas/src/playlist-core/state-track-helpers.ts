import { createVirtualTrack } from "./geometry";
import type {
  PlaylistAutomationClip,
  PlaylistClip,
  PlaylistTrack,
  PlaylistState,
} from "./types";

// Track identity helpers are grouped here so all generated IDs live in one obvious place.
export function materializeTracksThrough(
  state: PlaylistState,
  maxTrackIndex: number,
): PlaylistState {
  if (maxTrackIndex < state.tracks.length) {
    return state;
  }

  const tracks = [...state.tracks];

  for (let index = tracks.length; index <= maxTrackIndex; index += 1) {
    tracks.push(createVirtualTrack(index));
  }

  return { ...state, tracks };
}

export function makePointId(clip: PlaylistAutomationClip): string {
  let index = clip.points.length + 1;
  let id = `${clip.id}-pt-${index}`;

  while (clip.points.some((point) => point.id === id)) {
    index += 1;
    id = `${clip.id}-pt-${index}`;
  }

  return id;
}

export function makeTrackId(tracks: PlaylistTrack[]): string {
  let index = tracks.length + 1;
  let id = `track-${index}`;

  while (tracks.some((track) => track.id === id)) {
    index += 1;
    id = `track-${index}`;
  }

  return id;
}

export function createInsertedTrack(
  tracks: PlaylistTrack[],
  afterIndex: number,
): PlaylistTrack {
  const base = createVirtualTrack(afterIndex + 1);

  return {
    ...base,
    id: makeTrackId(tracks),
    label: `Track ${afterIndex + 2}`,
  };
}

export function makeClipId(clips: PlaylistClip[]): string {
  let index = clips.length + 1;
  let id = `clip-${index}`;

  while (clips.some((clip) => clip.id === id)) {
    index += 1;
    id = `clip-${index}`;
  }

  return id;
}

export function makeMarkerId(markers: { id: string }[]): string {
  let index = markers.length + 1;
  let id = `marker-${index}`;
  while (markers.some((m) => m.id === id)) {
    index += 1;
    id = `marker-${index}`;
  }
  return id;
}

// FL Studio clip groups. Group ids are arbitrary strings; we generate them
// as `g-<n>` where n is monotonic against the largest existing g-<n> id.
// Picking n from the count alone breaks when groups are deleted, so we scan
// for the highest numeric suffix and increment.
export function makeGroupId(clips: { groupId?: string }[]): string {
  let max = 0;
  for (const clip of clips) {
    const id = clip.groupId;
    if (!id || !id.startsWith("g-")) continue;
    const tail = Number(id.slice(2));
    if (Number.isFinite(tail) && tail > max) {
      max = tail;
    }
  }
  return `g-${max + 1}`;
}
