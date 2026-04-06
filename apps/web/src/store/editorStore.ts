import create from "zustand";
import type { TimelineDocument } from "@slicex/core";

export type EditorState = {
  document: TimelineDocument | null;
  selection: string[];
  viewport: { x: number; y: number; zoom: number };
  playheadAt: string | null;
  dirty: boolean;
  history: any[];
  setDocument: (doc: TimelineDocument | null) => void;
  markDirty: (v: boolean) => void;
};

export const useEditorStore = create<EditorState>((set, get) => ({
  document: null,
  selection: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  playheadAt: null,
  dirty: false,
  history: [],
  setDocument(doc) {
    set({ document: doc });
  },
  markDirty(v) {
    set({ dirty: v });
  },
}));
