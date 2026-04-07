import { useEditorStore } from "../store/editorStore";
export const storeAdapter = {
    subscribe(cb) {
        const unsub = useEditorStore.subscribe((state) => cb(state.document));
        return { unsubscribe: unsub };
    },
    getDocument() {
        return useEditorStore.getState().document;
    },
    getState() {
        const state = useEditorStore.getState();
        return {
            document: state.document,
            viewport: state.viewport,
            playheadAt: state.playheadAt,
            selection: [...state.selection],
        };
    },
    subscribeState(cb) {
        const unsub = useEditorStore.subscribe((state) => {
            cb({
                document: state.document,
                viewport: state.viewport,
                playheadAt: state.playheadAt,
                selection: [...state.selection],
            });
        });
        return { unsubscribe: unsub };
    },
};
