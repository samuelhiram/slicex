import { create } from "zustand";
export const useEditorStore = create((set, get) => ({
    document: null,
    selection: [],
    viewport: { x: 0, y: 0, zoom: 1, originDate: null },
    playheadAt: null,
    dirty: false,
    history: [],
    setDocument(doc) {
        set({ document: doc, dirty: false });
    },
    patchDocument(updater) {
        set((state) => ({
            document: updater(state.document),
            dirty: true,
        }));
    },
    setViewport(viewport) {
        set((state) => ({
            viewport: { ...state.viewport, ...viewport },
        }));
    },
    setPlayheadAt(value) {
        set({
            playheadAt: value instanceof Date
                ? Number.isNaN(value.getTime())
                    ? null
                    : value.toISOString()
                : value,
        });
    },
    setSelection(selection) {
        set({ selection: [...selection] });
    },
    markDirty(v) {
        set({ dirty: v });
    },
}));
