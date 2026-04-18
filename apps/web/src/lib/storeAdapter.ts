import type {
  CanvasStoreSnapshot,
  CanvasViewportSnapshot,
  StoreAdapter,
} from "@slicex/canvas";
import { useEditorStore } from "../store/editorStore";

type EditorState = ReturnType<typeof useEditorStore.getState>;

type EditorCanvasStoreAdapter = StoreAdapter & {
  getState: () => CanvasStoreSnapshot;
  subscribeState: (
    cb: (snapshot: CanvasStoreSnapshot) => void,
  ) => { unsubscribe: () => void };
  setViewport: (viewport: CanvasViewportSnapshot) => void;
  setPlayheadAt: (value: string | Date | null) => void;
  patchDocument: (
    updater: (doc: import("@slicex/core").TimelineDocument | null) =>
      | import("@slicex/core").TimelineDocument
      | null,
  ) => void;
  setSelection: (selection: string[]) => void;
};

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

export const storeAdapter: EditorCanvasStoreAdapter = {
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
  setViewport(viewport) {
    useEditorStore.getState().setViewport(viewport);
  },
  setPlayheadAt(value) {
    useEditorStore.getState().setPlayheadAt(value);
  },
  patchDocument(updater) {
    useEditorStore.getState().patchDocument(updater);
  },
  setSelection(selection) {
    useEditorStore.getState().setSelection(selection);
  },
};
