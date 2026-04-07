import type { CanvasStoreSnapshot, StoreAdapter } from "@slicex/canvas";
import { useEditorStore } from "../store/editorStore";

type EditorState = ReturnType<typeof useEditorStore.getState>;

let lastEditorState: EditorState | null = null;
let lastSnapshot: CanvasStoreSnapshot | null = null;

function snapshotFromState(state: EditorState): CanvasStoreSnapshot {
  if (state === lastEditorState && lastSnapshot) {
    return lastSnapshot;
  }

  lastEditorState = state;
  lastSnapshot = {
    document: state.document,
    viewport: state.viewport,
    playheadAt: state.playheadAt,
    selection: [...state.selection],
  };

  return lastSnapshot;
}

export const storeAdapter: StoreAdapter = {
  subscribe(cb) {
    const unsub = useEditorStore.subscribe((state) => cb(state.document));
    return { unsubscribe: unsub };
  },
  getDocument() {
    return useEditorStore.getState().document;
  },
  getState(): CanvasStoreSnapshot {
    return snapshotFromState(useEditorStore.getState());
  },
  subscribeState(cb) {
    const unsub = useEditorStore.subscribe((state) => {
      cb(snapshotFromState(state));
    });

    return { unsubscribe: unsub };
  },
};
