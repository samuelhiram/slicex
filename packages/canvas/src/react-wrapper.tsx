import React, { useEffect, useRef } from 'react';
import type { StoreAdapter } from './types';
import { createRenderer } from './renderer';

export function CanvasRenderer({ store }: { store: StoreAdapter }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!ref.current) return;
    const r = createRenderer(ref.current, store);
    return () => r.destroy();
  }, [store]);
  return <div ref={ref} style={{ width: '100%', height: '100%' }} />;
}
