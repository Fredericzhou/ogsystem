import { StudioGraphIsland, type StudioGraphBridgeOptions } from "./studio-graph.js";
import { applyStudioAuthoringCommand } from "./studio-graph-commands.js";
import { injectStudioGraphStyles } from "./styles.js";
import type { StudioRuntimeProgressEvent } from "./studio-graph-runtime.js";

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
    void existing.update(options);
    return;
  }
  const island = new StudioGraphIsland(root, options);
  mounted.set(root, island);
  void island.update(options);
}

export function disposeStudioX6Bridge(root: HTMLElement): void {
  const existing = mounted.get(root);
  if (!existing) {
    return;
  }
  existing.dispose();
  mounted.delete(root);
}

export function setStudioX6RuntimeProgress(root: HTMLElement, events: readonly StudioRuntimeProgressEvent[]): void {
  mounted.get(root)?.setRuntimeProgress(events);
}

export function focusStudioX6RuntimeHandoff(root: HTMLElement, handoffId: string): void {
  mounted.get(root)?.focusRuntimeHandoff(handoffId);
}

export function focusStudioX6Node(root: HTMLElement, roleId: string): boolean {
  return mounted.get(root)?.focusRoleNode(roleId) ?? false;
}

export function highlightStudioX6FlowEdge(root: HTMLElement, flowKey: string): boolean {
  return mounted.get(root)?.highlightFlowEdge(flowKey) ?? false;
}

window.OGSVisualizerClient = window.OGSVisualizerClient || {};
Object.assign(window.OGSVisualizerClient, {
  mountStudioX6Bridge,
  disposeStudioX6Bridge,
  setStudioX6RuntimeProgress,
  focusStudioX6RuntimeHandoff,
  focusStudioX6Node,
  highlightStudioX6FlowEdge,
  applyStudioAuthoringCommand
});
