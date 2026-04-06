import create from 'zustand';
export const useEditorStore = create((set, get) => ({
    document: null,
    selection: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    playheadAt: null,
    dirty: false,
    history: [],
    setDocument(doc) { set({ document: doc }); },
    markDirty(v) { set({ dirty: v }); }
}));
