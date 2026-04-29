import { Graph } from "@antv/x6";
import { History } from "@antv/x6-plugin-history";
import { Keyboard } from "@antv/x6-plugin-keyboard";
import { Selection } from "@antv/x6-plugin-selection";
import dagre from "dagre";

import type { StudioAuthoringDocument, StudioCanvasDocument } from "../studio-contracts.js";
import { canvasToStudioGraphProjection, graphToCanvasDocument, studioEdgeFlowKey } from "./studio-graph-adapter.js";
import { applyStudioAuthoringCommand, type StudioAuthoringCommand } from "./studio-graph-commands.js";
import { renderStudioGraphProjection } from "./studio-graph-render.js";
import { canConnectStudioCells } from "./studio-graph-rules.js";

export type StudioGraphBridgeOptions = {
  authoring?: StudioAuthoringDocument | null;
  canvas?: StudioCanvasDocument | null;
  validation?: { ok?: unknown; diagnostics?: unknown } | null;
  selectedRoleId?: string;
  selectedFlowKey?: string;
  busy?: boolean;
  onSelectRole?: (roleId: string) => void;
  onSelectFlow?: (flowKey: string) => void;
  onClearSelection?: () => void;
  onApplyCanvas?: (canvas: StudioCanvasDocument) => void | Promise<void>;
  onApplyCommand?: (result: {
    authoring: StudioAuthoringDocument;
    canvas: StudioCanvasDocument;
    selectedRoleId?: string;
    selectedFlowKey?: string;
    blockedReason?: string;
  }) => void | Promise<void>;
  onToast?: (tone: "error" | "success" | "info", message: string) => void;
};

export class StudioGraphIsland {
  private graph: Graph;
  private toolbar: HTMLDivElement;
  private canvasEl: HTMLDivElement;
  private options: StudioGraphBridgeOptions = {};
  private applying = false;

  constructor(private root: HTMLElement) {
    this.root.classList.add("studio-graph-island");
    this.root.innerHTML = [
      '<div class="studio-graph-toolbar">',
      '<div class="studio-graph-toolbar-group">',
      '<button type="button" data-studio-graph-action="zoom-out" title="Zoom out">-</button>',
      '<button type="button" data-studio-graph-action="zoom-in" title="Zoom in">+</button>',
      '<button type="button" data-studio-graph-action="fit" title="Fit view">Fit</button>',
      '<button type="button" data-studio-graph-action="layout" title="Auto layout">Layout</button>',
      '</div>',
      '<div class="studio-graph-toolbar-group">',
      '<button type="button" data-studio-graph-action="add-role" title="Add role">Role</button>',
      '<button type="button" data-studio-graph-action="add-edge" title="Add edge to output">Edge</button>',
      '<button type="button" data-studio-graph-action="delete" title="Delete selection">Delete</button>',
      '<button type="button" data-studio-graph-action="undo" title="Undo">Undo</button>',
      '<button type="button" data-studio-graph-action="redo" title="Redo">Redo</button>',
      '</div>',
      '<span class="studio-graph-status" data-studio-graph-status>ready</span>',
      '</div>',
      '<div class="studio-graph-canvas" data-studio-graph-canvas></div>'
    ].join("");
    const toolbar = this.root.querySelector<HTMLDivElement>(".studio-graph-toolbar");
    const canvasEl = this.root.querySelector<HTMLDivElement>("[data-studio-graph-canvas]");
    if (!toolbar || !canvasEl) {
      throw new Error("Studio graph island failed to initialize.");
    }
    this.toolbar = toolbar;
    this.canvasEl = canvasEl;
    this.graph = this.createGraph(canvasEl);
    this.bindToolbar();
    this.bindGraphEvents();
  }

  update(options: StudioGraphBridgeOptions): void {
    this.options = options;
    const projection = canvasToStudioGraphProjection({
      authoring: options.authoring,
      canvas: options.canvas,
      validation: options.validation
    });
    renderStudioGraphProjection(this.graph, projection);
    this.selectFromOptions();
    this.setStatus(projection.nodes.length > 2 ? "X6 graph ready" : "No roles available");
    this.setBusy(Boolean(options.busy));
    if (projection.nodes.length > 2) {
      setTimeout(() => {
        this.graph.zoomToFit({ padding: 28, maxScale: 1 });
      }, 0);
    }
  }

  dispose(): void {
    this.graph.dispose();
    this.root.innerHTML = "";
    this.root.classList.remove("studio-graph-island");
  }

  private createGraph(container: HTMLElement): Graph {
    const graph = new Graph({
      container,
      grid: true,
      autoResize: true,
      panning: true,
      mousewheel: {
        enabled: true,
        modifiers: ["ctrl", "meta"],
        minScale: 0.2,
        maxScale: 2.4
      },
      connecting: {
        allowBlank: false,
        allowLoop: false,
        snap: true,
        highlight: true,
        createEdge() {
          return graph.createEdge({
            attrs: {
              line: {
                stroke: "#38bdf8",
                strokeWidth: 1.8,
                targetMarker: { name: "block", width: 8, height: 6 }
              }
            },
            labels: [{ attrs: { label: { text: "DONE" } } }]
          });
        },
        validateConnection: ({ sourceCell, targetCell }) => canConnectStudioCells(sourceCell, targetCell)
      }
    });
    graph.use(new History({ enabled: true }));
    graph.use(new Keyboard({ enabled: true }));
    graph.use(new Selection({ enabled: true, multiple: false, rubberband: true }));
    graph.bindKey(["backspace", "delete"], () => {
      void this.deleteSelection();
      return false;
    });
    graph.bindKey(["meta+z", "ctrl+z"], () => graph.undo());
    graph.bindKey(["meta+shift+z", "ctrl+shift+z"], () => graph.redo());
    return graph;
  }

  private bindToolbar(): void {
    this.toolbar.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>("[data-studio-graph-action]");
      if (!button) return;
      const action = button.dataset.studioGraphAction || "";
      if (action === "zoom-in") this.graph.zoom(0.12);
      if (action === "zoom-out") this.graph.zoom(-0.12);
      if (action === "fit") void this.fitAndSync();
      if (action === "layout") void this.autoLayout();
      if (action === "undo") this.graph.undo();
      if (action === "redo") this.graph.redo();
      if (action === "delete") void this.deleteSelection();
      if (action === "add-role") void this.applyCommand({ type: "add-role" });
      if (action === "add-edge") {
        const selectedRoleId = this.selectedRoleId();
        if (selectedRoleId) {
          void this.applyCommand({ type: "add-edge", sourceRoleId: selectedRoleId, targetRoleId: "__system_end__" });
        } else {
          this.toast("error", "Select a role before adding an edge.");
        }
      }
    });
  }

  private bindGraphEvents(): void {
    this.graph.on("node:click", ({ node }) => {
      const data = node.getData() as { studioNode?: { kind?: string; roleId?: string } } | undefined;
      if (data?.studioNode?.kind === "role" && data.studioNode.roleId) {
        this.options.onSelectRole?.(data.studioNode.roleId);
      }
    });
    this.graph.on("edge:click", ({ edge }) => {
      const data = edge.getData() as { studioEdge?: { source: string; target: string; eventType: string } } | undefined;
      if (data?.studioEdge) {
        this.options.onSelectFlow?.(studioEdgeFlowKey(data.studioEdge));
      }
    });
    this.graph.on("blank:click", () => {
      this.graph.cleanSelection();
      this.options.onClearSelection?.();
    });
    this.graph.on("node:moved", () => {
      void this.syncCanvas();
    });
    this.graph.on("edge:connected", ({ edge, isNew }) => {
      if (!isNew) return;
      const source = edge.getSourceCellId();
      const target = edge.getTargetCellId();
      edge.remove();
      if (!source || !target) {
        this.toast("error", "Invalid Studio connection.");
        return;
      }
      void this.applyCommand({
        type: "add-edge",
        sourceRoleId: source,
        targetRoleId: target
      });
    });
  }

  private selectFromOptions(): void {
    this.graph.cleanSelection();
    const roleId = this.options.selectedRoleId || "";
    const flowKey = this.options.selectedFlowKey || "";
    if (roleId) {
      const node = this.graph.getCellById(roleId);
      if (node) this.graph.select(node);
      return;
    }
    if (flowKey) {
      const edge = this.graph.getEdges().find((cell) => {
        const data = cell.getData() as { studioEdge?: { source: string; target: string; eventType: string } } | undefined;
        return data?.studioEdge ? studioEdgeFlowKey(data.studioEdge) === flowKey : false;
      });
      if (edge) this.graph.select(edge);
    }
  }

  private selectedRoleId(): string {
    const selected = this.graph.getSelectedCells()[0];
    const data = selected?.getData() as { studioNode?: { kind?: string; roleId?: string } } | undefined;
    return data?.studioNode?.kind === "role" ? data.studioNode.roleId || "" : this.options.selectedRoleId || "";
  }

  private async deleteSelection(): Promise<void> {
    const selected = this.graph.getSelectedCells()[0];
    if (!selected) return;
    const nodeData = selected.getData() as { studioNode?: { kind?: string; roleId?: string } } | undefined;
    if (nodeData?.studioNode?.kind === "role" && nodeData.studioNode.roleId) {
      if (nodeData.studioNode.roleId === this.options.authoring?.system.entryRoleId) {
        this.toast("error", "Entry role deletion is blocked.");
        return;
      }
      if (window.confirm && !window.confirm(`Delete role ${nodeData.studioNode.roleId}?`)) {
        return;
      }
      await this.applyCommand({ type: "delete-role", roleId: nodeData.studioNode.roleId });
      return;
    }
    const edgeData = selected.getData() as { studioEdge?: { id?: string; source: string; target: string; eventType: string; editable?: boolean } } | undefined;
    if (edgeData?.studioEdge?.editable) {
      await this.applyCommand({
        type: "delete-edge",
        flowId: edgeData.studioEdge.id,
        sourceRoleId: edgeData.studioEdge.source,
        targetRoleId: edgeData.studioEdge.target,
        eventType: edgeData.studioEdge.eventType
      });
    }
  }

  private async fitAndSync(): Promise<void> {
    this.graph.zoomToFit({ padding: 28, maxScale: 1 });
    await this.syncCanvas();
  }

  private async autoLayout(): Promise<void> {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({ rankdir: "LR", nodesep: 70, ranksep: 100 });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const node of this.graph.getNodes()) {
      const data = node.getData() as { studioNode?: { kind?: string } } | undefined;
      if (data?.studioNode?.kind !== "role") continue;
      const size = node.getSize();
      graph.setNode(node.id, { width: size.width, height: size.height });
    }
    for (const edge of this.graph.getEdges()) {
      const source = edge.getSourceCellId();
      const target = edge.getTargetCellId();
      if (source && target && graph.hasNode(source) && graph.hasNode(target)) {
        graph.setEdge(source, target);
      }
    }
    dagre.layout(graph);
    graph.nodes().forEach((id) => {
      const layoutNode = graph.node(id);
      const cell = this.graph.getCellById(id);
      if (cell?.isNode()) {
        cell.position(layoutNode.x - layoutNode.width / 2 + 120, layoutNode.y - layoutNode.height / 2 + 120);
      }
    });
    this.graph.zoomToFit({ padding: 28, maxScale: 1 });
    await this.syncCanvas();
  }

  private async syncCanvas(): Promise<void> {
    if (this.applying || !this.options.canvas) {
      return;
    }
    this.applying = true;
    try {
      await this.options.onApplyCanvas?.(graphToCanvasDocument(this.graph, this.options.canvas));
    } finally {
      this.applying = false;
    }
  }

  private async applyCommand(command: StudioAuthoringCommand): Promise<void> {
    if (!this.options.authoring || !this.options.canvas) {
      this.toast("error", "Studio Bridge cannot edit until Mermaid parses successfully.");
      return;
    }
    const result = applyStudioAuthoringCommand({
      authoring: this.options.authoring,
      canvas: graphToCanvasDocument(this.graph, this.options.canvas),
      command
    });
    if (result.blockedReason) {
      this.toast("error", result.blockedReason);
      return;
    }
    await this.options.onApplyCommand?.(result);
  }

  private setStatus(text: string): void {
    const status = this.root.querySelector<HTMLElement>("[data-studio-graph-status]");
    if (status) status.textContent = text;
  }

  private setBusy(busy: boolean): void {
    this.toolbar.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = busy;
    });
  }

  private toast(tone: "error" | "success" | "info", message: string): void {
    this.options.onToast?.(tone, message);
    this.setStatus(message);
  }
}
