import { StudioGraphIsland, type StudioGraphBridgeOptions } from "./studio-graph.js";
import { injectStudioGraphStyles } from "./styles.js";

declare global {
  interface Window {
    OGSVisualizerClient?: Record<string, unknown>;
  }
}

const mounted = new WeakMap<HTMLElement, StudioGraphIsland>();

export function mountStudioX6Bridge(root: HTMLElement, options: StudioGraphBridgeOptions): void {
  injectStudioGraphStyles();
  const existing = mounted.get(root);
  if (existing) {
    existing.update(options);
    return;
  }
  const island = new StudioGraphIsland(root);
  mounted.set(root, island);
  island.update(options);
}

export function disposeStudioX6Bridge(root: HTMLElement): void {
  const existing = mounted.get(root);
  if (!existing) {
    return;
  }
  existing.dispose();
  mounted.delete(root);
}

window.OGSVisualizerClient = window.OGSVisualizerClient || {};
Object.assign(window.OGSVisualizerClient, {
  mountStudioX6Bridge,
  disposeStudioX6Bridge
});
