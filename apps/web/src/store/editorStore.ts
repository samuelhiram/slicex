import { create } from "zustand";
import type { TimelineDocument } from "@slicex/core";

export type EditorState = {
  document: TimelineDocument | null;
  selection: string[];
  viewport: {
    x: number;
    y: number;
    zoom: number;
    originDate?: string | Date | null;
  };
  playheadAt: string | Date | null;
  dirty: boolean;
  history: any[];
  setDocument: (doc: TimelineDocument | null) => void;
  patchDocument: (
    updater: (doc: TimelineDocument | null) => TimelineDocument | null,
  ) => void;
  setViewport: (
    viewport: {
      x: number;
      y: number;
      zoom: number;
      originDate?: string | Date | null;
    },
  ) => void;
  setPlayheadAt: (value: string | Date | null) => void;
  setSelection: (selection: string[]) => void;
  markDirty: (v: boolean) => void;
};

export const useEditorStore = create<EditorState>((set, get) => ({
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
      playheadAt:
        value instanceof Date
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
