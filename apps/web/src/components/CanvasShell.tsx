'use client';
import React from 'react';
import dynamic from 'next/dynamic';
import { storeAdapter } from '../lib/storeAdapter';

const CanvasRenderer = dynamic(() => import('@slicex/canvas').then((m) => m.CanvasRenderer), { ssr: false });

export function CanvasShell() {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <CanvasRenderer store={storeAdapter} />
    </div>
  );
}
