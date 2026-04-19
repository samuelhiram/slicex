import { createVirtualTrack } from "./geometry";
import type {
  PlaylistAutomationClip,
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
