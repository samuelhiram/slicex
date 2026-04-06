import * as PIXI from 'pixi.js';
import type { StoreAdapter } from './types';

export function createRenderer(container: any, store: StoreAdapter) {
  // Detect non-browser (test) environments and avoid creating a real PIXI.Application
  const canUseDom =
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    container &&
    typeof container.appendChild === 'function' &&
    (() => {
      try {
        // Ensure canvas API is available (JSDOM often lacks canvas)
        const c = document.createElement('canvas');
        return typeof (c as any).getContext === 'function';
      } catch (e) {
        return false;
      }
    })();

  let app: any;
  if (canUseDom) {
    app = new PIXI.Application({ resizeTo: container, backgroundAlpha: 0 });
    container.appendChild(app.view as HTMLCanvasElement);
  } else {
    // Headless fallback for tests / server environments
    app = {
      view: {} as any,
      stage: { removeChildren: () => {}, addChild: () => {} },
      renderer: { width: 0, height: 0 },
      destroy: (opts?: any) => {}
    };
  }

  let currentDoc = store.getDocument();

  const sub = store.subscribe((doc) => {
    currentDoc = doc;
    try {
      // minimal update trigger: clear and redraw simple layers when PIXI is available
      if (app && app.stage && typeof app.stage.removeChildren === 'function') {
        app.stage.removeChildren();
        if (PIXI && PIXI.Graphics) {
          const g = new PIXI.Graphics();
          g.beginFill(0xf0f0f0);
          try {
            g.drawRect(0, 0, app.renderer.width, app.renderer.height);
          } catch (e) {
            // ignore drawing errors in headless mocks
          }
          g.endFill();
          app.stage.addChild(g);
        }
      }
    } catch (e) {
      // swallow render errors in non-browser environments
    }
  });

  return {
    app,
    destroy() {
      try {
        sub.unsubscribe();
      } catch (e) {}
      try {
        app.destroy(true);
      } catch (e) {}
    }
  };
}
