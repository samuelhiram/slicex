import { useEditorStore } from "../store/editorStore";
let lastEditorState = null;
let lastSnapshot = null;
function snapshotFromState(state) {
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
export const storeAdapter = {
    subscribe(cb) {
        const unsub = useEditorStore.subscribe((state) => cb(state.document));
        return { unsubscribe: unsub };
    },
    getDocument() {
        return useEditorStore.getState().document;
    },
    getState() {
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
