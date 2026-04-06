'use client';
import React from 'react';
import dynamic from 'next/dynamic';

export default function Page() {
  return (
    <main style={{ width: '100vw', height: '100vh' }}>
      <h1>SliceX — Editor shell</h1>
      <div id="editor-root" style={{ width: '100%', height: '80vh', border: '1px solid #ddd' }}>
        {/* Canvas will mount here via client component */}
      </div>
    </main>
  );
}
