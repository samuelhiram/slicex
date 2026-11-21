// Several bridge writes as ONE undo entry (Rec, a pasted statement, an
// avalanche payment): "Deshacer" / Ctrl+Z take the whole commit back.
//
// The playlist history is the app's single undo stack and every bridge
// write is one entry of it (replaceItem, setInitialCash, addItem…). The
// core's gesture brackets coalesce every undoable dispatch between them into
// one entry whose undo target is the state before the first of them — the
// same mechanism a pointer drag uses. Nested brackets are safe (counter).
import type { PlaylistCore } from "@slicex/canvas";

type GestureCore = Pick<PlaylistCore, "beginGesture" | "endGesture">;

/**
 * Runs `write` so that everything it changes is one undo step. Returns what
 * `write` returns. A core without gesture brackets (test fakes) just runs it.
 */
export function inOneUndoStep<T>(core: PlaylistCore, write: () => T): T {
  const brackets = core as Partial<GestureCore>;
  if (typeof brackets.beginGesture !== "function" || typeof brackets.endGesture !== "function") {
    return write();
  }
  brackets.beginGesture.call(core);
  try {
    return write();
  } finally {
    brackets.endGesture.call(core);
  }
}
