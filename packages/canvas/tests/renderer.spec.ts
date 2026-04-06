import { it, expect, vi } from 'vitest';
import { createRenderer } from '../src/renderer';

it('returns a destroyable renderer in headless mode', () => {
  let unsubCalled = false;
  const store: any = {
    getDocument() {
      return null;
    },
    subscribe(cb: any) {
      // call once to simulate initial update
      try { cb(null); } catch (e) {}
      return { unsubscribe: () => { unsubCalled = true; } };
    }
  };

  const fakeContainer: any = { appendChild: () => {} };
  const r = createRenderer(fakeContainer, store);
  expect(r).toHaveProperty('app');
  expect(typeof r.destroy).toBe('function');
  r.destroy();
  expect(unsubCalled).toBe(true);
});
