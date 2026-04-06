import type { StoreAdapter } from '@slicex/canvas';
import { useEditorStore } from '../store/editorStore';

export const storeAdapter: StoreAdapter = {
  subscribe(cb) {
    const unsub = useEditorStore.subscribe((state) => cb(state.document));
    return { unsubscribe: unsub };
  },
  getDocument() {
    return useEditorStore.getState().document as any;
  }
};
