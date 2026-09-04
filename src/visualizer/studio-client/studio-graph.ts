import { Graph } from "@antv/x6";
import { History } from "@antv/x6-plugin-history";
import { Keyboard } from "@antv/x6-plugin-keyboard";
import { Selection } from "@antv/x6-plugin-selection";

import {
  normalizeStudioGraphTargetRoleId,
  STUDIO_SYSTEM_END_ROLE_ID,
  studioFlowKey
} from "../studio-contracts.js";
import type {
  GraphViewModel,
  StudioAuthoringDocument,
  StudioGraphSnapshot as StudioCanvasSnapshot
} from "../studio-contracts.js";
import { buildGraphViewModel } from "../graph-view-model.js";
import {
  commandFromStudioCommandFormState,
  createDefaultStudioCommandFormState,
  readStudioCommandFormState,
  renderStudioCommandFormDiagnostics,
  renderStudioCommandFormFieldError,
  renderStudioCommandForm,
  type StudioCommandFormLabels,
  type StudioCommandFormState
} from "./studio-graph-command-forms.js";
import { graphToCanvasDocument, studioEdgeFlowKey } from "./studio-graph-adapter.js";
import {
  applyStudioAuthoringCommand,
  deriveInverseCommand,
  type StudioAuthoringCommand
} from "./studio-graph-commands.js";
import {
  alignStudioSccGroups,
  isStudioSccGroup,
  renderStudioGraphViewModel
} from "./studio-graph-render.js";
import { createElkLayoutProjection } from "./elk-layout-adapter.js";
import {
  createStoredLayoutProjection,
  type LayoutProjection,
  type StudioLayoutMode
} from "./semantic-layout-projection.js";
import {
  deriveStudioRuntimeVisualState,
  type StudioRuntimeVisualState
} from "./studio-graph-runtime.js";
import { validateStudioConnectionCells } from "./studio-graph-rules.js";

type StudioGraphLabelKey =
  | "viewportGroup"
  | "editGroup"
  | "zoomOut"
  | "zoomIn"
  | "resetView"
  | "fullscreen"
  | "fitView"
  | "autoLayout"
  | "layoutModeFlow"
  | "layoutModeCompact"
  | "layoutModeStacked"
  | "topologyOrder"
  | "layoutSwitched"
  | "generate"
  | "debugRun"
  | "debugAdvanced"
  | "debugRunNow"
  | "debugQuickInput"
  | "debugQuickHint"
  | "debugQuickPlaceholder"
  | "debugQuickOpen"
  | "addRole"
  | "addEdge"
  | "editSelection"
  | "editRole"
  | "editEdge"
  | "deleteSelection"
  | "undo"
  | "redo"
  | "validateWorkbench"
  | "saveWorkbench"
  | "ready"
  | "graphUnavailable"
  | "graphReady"
  | "fixMermaidBeforeGraphEditing"
  | "noRolesAvailable"
  | "selectRoleBeforeAddingEdge"
  | "invalidConnection"
  | "entryRoleDeletionBlocked"
  | "invalidEdgeEndpoints"
  | "duplicateRoleId"
  | "invalidRoleId"
  | "duplicateEdge"
  | "invalidEventType"
  | "deleteRoleConfirm"
  | "editBlocked"
  | "boundaryEntry"
  | "boundaryEnd";

export type StudioGraphLabels = Partial<Record<StudioGraphLabelKey, string>>;

export type StudioGraphBridgeOptions = {
  authoring?: StudioAuthoringDocument | null;
  canvas?: StudioCanvasSnapshot | null;
  viewModel?: GraphViewModel | null;
  validation?: { ok?: unknown; diagnostics?: unknown } | null;
  selectedRoleId?: string;
  selectedFlowKey?: string;
  editSelectionRequest?: number;
  defaultAutoLayout?: boolean;
  busy?: boolean;
  readOnly?: boolean;
  rolePackages?: unknown;
  bindings?: unknown;
  readiness?: unknown;
  projectConfig?: unknown;
  onSelectRole?: (roleId: string) => void;
  onSelectFlow?: (flowKey: string) => void;
  onClearSelection?: () => void;
  onApplyCanvas?: (canvas: StudioCanvasSnapshot) => void | Promise<void>;
  onApplyCommand?: (result: {
    authoring: StudioAuthoringDocument;
    canvas: StudioCanvasSnapshot;
    selectedRoleId?: string;
    selectedFlowKey?: string;
    blockedCode?: string;
  }) => void | Promise<void>;
  onChatGenerate?: () => void | Promise<void>;
  historyEvent?: { id?: number; kind?: "push-before-replace"; label?: string } | null;
  onToggleFullscreen?: () => void;
  onValidateWorkbench?: () => void | Promise<void>;
  onSaveWorkbench?: () => void | Promise<void>;
  onQuickDebugRun?: (input: string) => boolean | Promise<boolean>;
  onFocusDebugInput?: () => boolean | Promise<boolean>;
  canSaveWorkbench?: boolean;
  onToast?: (tone: "error" | "success" | "info", message: string) => void;
  onStatusChange?: (message: string) => void;
  labels?: StudioGraphLabels;
  commandFormLabels?: StudioCommandFormLabels;
  commandFormHost?: HTMLElement | null;
  dismissCommandFormRequest?: number;
  onBeforeClearSelection?: () => boolean;
  onCommandFormStateChange?: (state: {
    open: boolean;
    kind?: "add-role" | "add-edge" | "edit-role" | "edit-edge";
    roleId?: string;
    flowKey?: string;
  }) => void;
};

type StudioGraphSnapshot = {
  authoring: StudioAuthoringDocument;
  canvas: StudioCanvasSnapshot;
  selectedRoleId?: string;
  selectedFlowKey?: string;
};

type StudioGraphHistoryEntry =
  | {
      kind: "snapshot";
      snapshot: StudioGraphSnapshot;
    }
  | {
      kind: "command";
      forward: StudioAuthoringCommand;
      inverse: StudioAuthoringCommand;
      undoSelectedRoleId?: string;
      undoSelectedFlowKey?: string;
      redoSelectedRoleId?: string;
      redoSelectedFlowKey?: string;
    };

const sharedHistory: {
  projectKey: string;
  undoStack: StudioGraphHistoryEntry[];
  redoStack: StudioGraphHistoryEntry[];
} = {
  projectKey: "",
  undoStack: [],
  redoStack: []
};

const STUDIO_PENDING_EDGE_ID = "__studio_pending_edge__";
const STUDIO_GRAPH_FIT_PADDING = 28;
const STUDIO_GRAPH_FIT_MAX_SCALE = 1.8;
const STUDIO_GRAPH_MIN_READABLE_ROLE_WIDTH = 90;
const STUDIO_GRAPH_MIN_READABLE_ROLE_HEIGHT = 40;
const STUDIO_GRAPH_READABILITY_ROLE_LIMIT = 4;
const STUDIO_GRAPH_EDGE_ROUTER = {
  name: "orth",
  args: {
    padding: 18
  }
} as const;
const STUDIO_GRAPH_EDGE_CONNECTOR = {
  name: "rounded",
  args: {
    radius: 10
  }
} as const;

type StudioGraphLayoutMode = StudioLayoutMode;

type PendingStudioEdgePreview = {
  sourceRoleId: string;
  targetRoleId: string;
  eventType: string;
  label: string;
};

type StudioGraphEdgeRecord = {
  id?: string;
  source: string;
  target: string;
  eventType: string;
  label?: string;
  runtimeOnlyErrorFlow?: boolean;
  participatesInJoin?: boolean;
  editable?: boolean;
};

type StudioGraphContextMenuState =
  | {
      kind: "role";
      roleId: string;
    }
  | {
      kind: "flow";
      edge: StudioGraphEdgeRecord;
    };

type PendingStudioRoleInsertion = {
  edge: StudioGraphEdgeRecord;
  x: number;
  y: number;
};

export class StudioGraphIsland {
  private graph: Graph;
  private toolbar: HTMLDivElement;
  private stageEl: HTMLDivElement;
  private canvasEl: HTMLDivElement;
  private emptyEl: HTMLDivElement;
  private minimapEl: HTMLDivElement;
  private minimapContentEl: HTMLDivElement;
  private minimapViewportEl: HTMLDivElement;
  private contextMenuEl: HTMLDivElement;
  private quickOpenEl: HTMLDivElement;
  private quickOpenInputEl: HTMLInputElement;
  private quickOpenResultsEl: HTMLDivElement;
  private quickDebugEl: HTMLDivElement;
  private quickDebugInputEl: HTMLTextAreaElement;
  private dialogEl: HTMLElement;
  private fallbackDialogEl: HTMLDivElement;
  private diagnosticCardEl: HTMLDivElement;
  private options: StudioGraphBridgeOptions = {};
  private currentViewModel: GraphViewModel | null = null;
  private applying = false;
  private busy = false;
  private hasRenderedProjection = false;
  private lastViewportSignature = "";
  private lastDefaultAutoLayoutSignature = "";
  private lastEditSelectionSignature = "";
  private lastHandledEditSelectionRequest = 0;
  private lastHandledDismissCommandFormRequest = 0;
  private lastHandledHistoryEventId = 0;
  private syncCanvasTimer: ReturnType<typeof setTimeout> | null = null;
  private commandForm: StudioCommandFormState | null = null;
  private pendingEdgePreview: PendingStudioEdgePreview | null = null;
  private pendingRoleInsertion: PendingStudioRoleInsertion | null = null;
  private runtimeVisualState: StudioRuntimeVisualState | null = null;
  private contextMenuState: StudioGraphContextMenuState | null = null;
  private focusMotionTimer: ReturnType<typeof setTimeout> | null = null;
  private focusMotionCellId = "";
  private quickOpenSelectedIndex = 0;
  private quickDebugBusy = false;
  private reducedMotion = false;
  private resizeObserver: ResizeObserver | null = null;
  private pendingEdgeCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingInitialFit = false;
  private pendingInitialFitSizeSignature = "";
  private pendingInitialFitTimer: ReturnType<typeof setTimeout> | null = null;
  private layoutMode: StudioGraphLayoutMode = "flow";
  // Flow order is useful for reading a graph and should be visible on first render.
  private showTopologyOrder = true;
  private currentLayoutProjection: LayoutProjection | null = null;
  private updateGeneration = 0;
  private readonly delegatedCommandFormSubmitListener = (event: Event) => this.handleDelegatedCommandFormSubmit(event);
  private readonlyHistory: { undoStack: StudioGraphHistoryEntry[]; redoStack: StudioGraphHistoryEntry[] } = {
    undoStack: [],
    redoStack: []
  };

  constructor(private root: HTMLElement, initialOptions: StudioGraphBridgeOptions = {}) {
    this.options = initialOptions;
    this.root.classList.add("studio-graph-island");
    this.root.innerHTML = [
      '<div class="studio-graph-toolbar">',
      '<div class="studio-graph-toolbar-main">',
      '<div class="studio-graph-toolbar-group" aria-label="' + this.escapeHtml(this.label("viewportGroup")) + '">',
      this.toolbarButton("zoom-out", "zoomOut", "−", "−"),
      this.toolbarButton("zoom-in", "zoomIn", "+", "+"),
      this.toolbarButton("reset-view", "resetView", "1:1", "100%"),
      this.toolbarButton("fullscreen", "fullscreen", "⛶"),
      this.toolbarButton("fit", "fitView", "◎"),
      this.toolbarButton("layout", "autoLayout", "⇄"),
      '<select class="studio-graph-layout-select" data-studio-graph-layout aria-label="' + this.escapeHtml(this.label("autoLayout")) + '">' +
      '<option value="flow">' + this.escapeHtml(this.label("layoutModeFlow")) + '</option>' +
      '<option value="compact">' + this.escapeHtml(this.label("layoutModeCompact")) + '</option>' +
      '<option value="stacked">' + this.escapeHtml(this.label("layoutModeStacked")) + '</option>' +
      '</select>',
      this.toolbarButton("topology-order", "topologyOrder", "#"),
      '</div>',
      '<div class="studio-graph-toolbar-group" data-studio-graph-generate-actions aria-label="' + this.escapeHtml(this.label("generate")) + '">',
      this.toolbarButton("chat-generate", "generate", "✦"),
      this.toolbarButton("debug-run", "debugRun", "▶", "Run"),
      '</div>',
      '<div class="studio-graph-toolbar-group" data-studio-graph-edit-actions aria-label="' + this.escapeHtml(this.label("editGroup")) + '">',
      this.toolbarButton("add-role", "addRole", "+R"),
      this.toolbarButton("add-edge", "addEdge", "+E"),
      this.toolbarButton("edit", "editSelection", "✎"),
      this.toolbarButton("delete", "deleteSelection", "⌫"),
      this.toolbarButton("undo", "undo", "↶"),
      this.toolbarButton("redo", "redo", "↷"),
      this.toolbarButton("validate", "validateWorkbench", "✓"),
      this.toolbarButton("save", "saveWorkbench", "Sv"),
      '</div>',
      '</div>',
      '</div>',
      '<div class="studio-graph-stage">',
      '<div class="studio-graph-empty" data-studio-graph-empty hidden></div>',
      '<div class="studio-graph-canvas" data-studio-graph-canvas></div>',
      '<div class="studio-graph-context-menu" data-studio-graph-context-menu hidden></div>',
      '<div class="studio-graph-minimap" data-studio-graph-minimap aria-label="Graph minimap" hidden>',
      '<div class="studio-graph-minimap-content" data-studio-graph-minimap-content></div>',
      '<div class="studio-graph-minimap-viewport" data-studio-graph-minimap-viewport></div>',
      "</div>",
      '<div class="studio-graph-quick-open" data-studio-graph-quick-open hidden>',
      '<div class="studio-graph-quick-open-panel">',
      '<label class="studio-graph-quick-open-label" for="studio-graph-quick-open-input">Quick open</label>',
      '<input id="studio-graph-quick-open-input" class="studio-graph-quick-open-input" data-studio-graph-quick-open-input autocomplete="off" spellcheck="false" placeholder="Jump to role or flow" />',
      '<div class="studio-graph-quick-open-results" data-studio-graph-quick-open-results></div>',
      "</div>",
      "</div>",
      '<div class="studio-graph-quick-debug" data-studio-graph-quick-debug hidden>',
      '<div class="studio-graph-quick-debug-panel">',
      '<div class="studio-graph-quick-debug-head"><strong>' + this.escapeHtml(this.label("debugQuickOpen")) + '</strong><button type="button" class="button subtle" data-studio-graph-quick-debug-close="1">×</button></div>',
      '<label class="studio-graph-quick-debug-label" for="studio-graph-quick-debug-input">' + this.escapeHtml(this.label("debugQuickInput")) + '</label>',
      '<textarea id="studio-graph-quick-debug-input" class="studio-graph-quick-debug-input" data-studio-graph-quick-debug-input placeholder="' + this.escapeHtml(this.label("debugQuickPlaceholder")) + '"></textarea>',
      '<div class="hint studio-graph-quick-debug-hint">' + this.escapeHtml(this.label("debugQuickHint")) + '</div>',
      '<div class="studio-graph-quick-debug-actions"><button type="button" class="button primary" data-studio-graph-quick-debug-run="1">' + this.escapeHtml(this.label("debugRunNow")) + '</button><button type="button" class="button subtle" data-studio-graph-quick-debug-advanced="1">' + this.escapeHtml(this.label("debugAdvanced")) + '</button></div>',
      '</div>',
      '</div>',
      '</div>'
    ].join("");
    const toolbar = this.root.querySelector<HTMLDivElement>(".studio-graph-toolbar");
    const stageEl = this.root.querySelector<HTMLDivElement>(".studio-graph-stage");
    const canvasEl = this.root.querySelector<HTMLDivElement>("[data-studio-graph-canvas]");
    const emptyEl = this.root.querySelector<HTMLDivElement>("[data-studio-graph-empty]");
    const contextMenuEl = this.root.querySelector<HTMLDivElement>("[data-studio-graph-context-menu]");
    const minimapEl = this.root.querySelector<HTMLDivElement>("[data-studio-graph-minimap]");
    const minimapContentEl = this.root.querySelector<HTMLDivElement>("[data-studio-graph-minimap-content]");
    const minimapViewportEl = this.root.querySelector<HTMLDivElement>("[data-studio-graph-minimap-viewport]");
    const quickOpenEl = this.root.querySelector<HTMLDivElement>("[data-studio-graph-quick-open]");
    const quickOpenInputEl = this.root.querySelector<HTMLInputElement>("[data-studio-graph-quick-open-input]");
    const quickOpenResultsEl = this.root.querySelector<HTMLDivElement>("[data-studio-graph-quick-open-results]");
    const quickDebugEl = this.root.querySelector<HTMLDivElement>("[data-studio-graph-quick-debug]");
    const quickDebugInputEl = this.root.querySelector<HTMLTextAreaElement>("[data-studio-graph-quick-debug-input]");
    if (!toolbar || !stageEl || !canvasEl || !emptyEl || !contextMenuEl || !minimapEl || !minimapContentEl || !minimapViewportEl || !quickOpenEl || !quickOpenInputEl || !quickOpenResultsEl || !quickDebugEl || !quickDebugInputEl) {
      throw new Error("Studio graph island failed to initialize.");
    }
    this.toolbar = toolbar;
    this.stageEl = stageEl;
    this.canvasEl = canvasEl;
    this.emptyEl = emptyEl;
    this.contextMenuEl = contextMenuEl;
    this.minimapEl = minimapEl;
    this.minimapContentEl = minimapContentEl;
    this.minimapViewportEl = minimapViewportEl;
    this.quickOpenEl = quickOpenEl;
    this.quickOpenInputEl = quickOpenInputEl;
    this.quickOpenResultsEl = quickOpenResultsEl;
    this.quickDebugEl = quickDebugEl;
    this.quickDebugInputEl = quickDebugInputEl;
    this.fallbackDialogEl = document.createElement("div");
    this.fallbackDialogEl.hidden = true;
    this.fallbackDialogEl.className = "studio-command-dialog";
    this.stageEl.appendChild(this.fallbackDialogEl);
    this.dialogEl = this.fallbackDialogEl;
    this.diagnosticCardEl = document.createElement("div");
    this.diagnosticCardEl.hidden = true;
    this.diagnosticCardEl.className = "studio-graph-diagnostic-card";
    this.stageEl.appendChild(this.diagnosticCardEl);
    this.graph = this.createGraph(canvasEl);
    this.bindToolbar();
    this.bindGraphEvents();
    this.bindContextMenu();
    this.bindQuickOpen();
    this.bindQuickDebug();
    this.bindResizeObserver();
    this.root.addEventListener("keydown", (event) => this.handleRootKeydown(event));
    // Command forms can be mounted in a sibling host outside `root`, so use a document-level
    // submit fallback to prevent accidental native navigation during rapid host swaps.
    document.addEventListener("submit", this.delegatedCommandFormSubmitListener, true);
    this.reducedMotion = this.detectReducedMotion();
    this.updateToolbarState();
  }

  async update(options: StudioGraphBridgeOptions): Promise<void> {
    const updateGeneration = ++this.updateGeneration;
    this.resetHistoryWhenProjectChanges(options);
    this.options = options;
    this.hideContextMenu();
    this.attachCommandFormHost();
    this.handleHistoryEvent(options.historyEvent);
    this.handleDismissCommandFormRequest(options.dismissCommandFormRequest);
    const viewModel = options.viewModel ?? buildGraphViewModel({
      authoring: options.authoring,
      validation: options.validation
        ? {
            ok: options.validation.ok,
            diagnostics: options.validation.diagnostics
          }
        : null,
      mode: options.readOnly ? "run" : "edit"
    });
    for (const node of viewModel.nodes) {
      if (node.kind === "boundary" && node.id === "input") {
        node.label = "▶ " + this.label("boundaryEntry");
      } else if (node.kind === "boundary" && node.id === "output") {
        node.label = "■ " + this.label("boundaryEnd");
      }
    }
    this.preserveBoundaryNodeLayout(viewModel);
    this.currentViewModel = viewModel;
    if (!options.authoring && !options.viewModel) {
      this.applying = true;
      try {
        this.graph.clearCells();
      } finally {
        this.applying = false;
      }
      this.hasRenderedProjection = false;
      this.setEmptyState(true, viewModel.validation.diagnostics.length > 0
        ? this.label("fixMermaidBeforeGraphEditing")
        : this.label("noRolesAvailable"));
      this.closeCommandForm();
      this.closeQuickOpen();
      this.closeQuickDebug();
      this.renderMinimap();
      this.setStatus(this.label("graphUnavailable"));
      this.setBusy(true);
      return;
    }
    this.setEmptyState(false);
    this.currentLayoutProjection = createStoredLayoutProjection(viewModel);
    this.applying = true;
    try {
      this.renderCurrentProjection();
      this.syncPendingEdgePreview();
      this.runtimeVisualState = deriveStudioRuntimeVisualState({
        authoring: options.authoring,
        viewModel,
        readOnly: options.readOnly === true
      });
      this.syncGraphViewportSize();
      const autoLayoutApplied = await this.applyDefaultAutoLayout(updateGeneration);
      if (updateGeneration !== this.updateGeneration) {
        return;
      }
      if (!autoLayoutApplied) {
        this.restoreViewport(
          viewModel.viewport ?? options.authoring?.layout?.viewport ?? options.canvas?.viewport,
          !this.hasRenderedProjection
        );
      } else if (!this.hasRenderedProjection) {
        this.schedulePendingInitialFit();
      }
      this.selectFromOptions();
      this.applyRuntimeOverlay();
      this.syncSelectionPresentation();
      this.focusRequestedSelection();
      this.flushPendingInitialFit();
      this.renderMinimap();
      this.hasRenderedProjection = true;
    } finally {
      this.applying = false;
    }
    this.setStatus(this.label("graphReady"));
    this.setBusy(Boolean(options.busy));
  }

  dispose(): void {
    this.updateGeneration += 1;
    if (this.syncCanvasTimer) {
      clearTimeout(this.syncCanvasTimer);
      this.syncCanvasTimer = null;
    }
    if (this.pendingEdgeCleanupTimer) {
      clearTimeout(this.pendingEdgeCleanupTimer);
      this.pendingEdgeCleanupTimer = null;
    }
    if (this.focusMotionTimer) {
      clearTimeout(this.focusMotionTimer);
      this.focusMotionTimer = null;
    }
    if (this.pendingInitialFitTimer) {
      clearTimeout(this.pendingInitialFitTimer);
      this.pendingInitialFitTimer = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    document.removeEventListener("submit", this.delegatedCommandFormSubmitListener, true);
    this.quickDebugBusy = false;
    this.graph.dispose();
    this.root.innerHTML = "";
    this.root.classList.remove("studio-graph-island");
  }

  private createGraph(container: HTMLElement): Graph {
    const graph = new Graph({
      container,
      grid: true,
      autoResize: true,
      panning: {
        enabled: true
      },
      mousewheel: {
        enabled: true,
        modifiers: ["ctrl", "meta"],
        minScale: 0.2,
        maxScale: 2.4
      },
      interacting: (cellView) => {
        const data = cellView.cell.getData() as { studioNode?: { kind?: string } } | undefined;
        if (data?.studioNode?.kind === "boundary") {
          return {
            magnetConnectable: false
          };
        }
        return true;
      },
      connecting: {
        allowBlank: false,
        allowLoop: false,
        snap: true,
        highlight: true,
        anchor: { name: "midSide", args: { direction: "H" } },
        connectionPoint: { name: "boundary" },
        router: STUDIO_GRAPH_EDGE_ROUTER,
        connector: STUDIO_GRAPH_EDGE_CONNECTOR,
        createEdge() {
          return graph.createEdge({
            id: STUDIO_PENDING_EDGE_ID,
            zIndex: 0,
            data: { studioPendingEdge: true },
            attrs: {
              line: {
                stroke: "#38bdf8",
                strokeWidth: 1.8,
                strokeDasharray: "7 5",
                targetMarker: { name: "block", width: 8, height: 6 }
              }
            },
            labels: [{ attrs: { label: { text: "DONE" } } }]
          });
        },
        validateConnection: ({ sourceCell, targetCell }) => !this.isReadOnly() && validateStudioConnectionCells(sourceCell, targetCell).ok
      }
    });
    graph.use(new History({ enabled: false }));
    graph.use(new Keyboard({ enabled: true }));
    graph.use(new Selection({ enabled: true, multiple: false, rubberband: true, modifiers: ["shift"] }));
    graph.bindKey(["backspace", "delete"], () => {
      void this.deleteSelection();
      return false;
    });
    graph.bindKey(["meta+z", "ctrl+z"], () => {
      void this.semanticUndo();
      return false;
    });
    graph.bindKey(["meta+shift+z", "ctrl+shift+z"], () => {
      void this.semanticRedo();
      return false;
    });
    graph.bindKey(["f2"], () => {
      this.openSelectedEditor();
      return false;
    });
    graph.bindKey(["meta+p", "ctrl+p"], () => {
      this.toggleQuickOpen();
      return false;
    });
    graph.on("scale", () => {
      this.renderMinimap();
    });
    graph.on("translate", () => {
      this.renderMinimap();
    });
    return graph;
  }

  private bindResizeObserver(): void {
    if (typeof ResizeObserver !== "function") {
      return;
    }
    this.resizeObserver = new ResizeObserver(() => {
      this.syncGraphViewportSize();
      this.flushPendingInitialFit();
      this.renderMinimap();
    });
    this.resizeObserver.observe(this.root);
    this.resizeObserver.observe(this.stageEl);
    this.resizeObserver.observe(this.canvasEl);
  }

  private syncGraphViewportSize(): void {
    const width = Math.max(this.canvasEl.clientWidth, 1);
    const height = Math.max(this.canvasEl.clientHeight, 1);
    this.graph.resize(width, height);
  }

  private bindToolbar(): void {
    const layoutSelect = this.toolbar.querySelector<HTMLSelectElement>("[data-studio-graph-layout]");
    layoutSelect?.addEventListener("change", () => {
      const mode = layoutSelect.value as StudioGraphLayoutMode;
      if (!["flow", "compact", "stacked"].includes(mode) || this.isReadOnly()) return;
      this.layoutMode = mode;
      void this.applyAutoLayout();
    });
    this.toolbar.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>("[data-studio-graph-action]");
      if (!button) return;
      const action = button.dataset.studioGraphAction || "";
      if (action === "zoom-in") this.graph.zoom(0.12);
      if (action === "zoom-out") this.graph.zoom(-0.12);
      if (action === "fit") void this.fitAndSync();
      if (action === "reset-view") void this.resetViewAndSync();
      if (action === "fullscreen") this.options.onToggleFullscreen?.();
      if (action === "topology-order") {
        this.showTopologyOrder = !this.showTopologyOrder;
        this.renderCurrentProjection();
        this.updateToolbarState();
      }
      if (action === "chat-generate") void this.options.onChatGenerate?.();
      if (action === "debug-run") this.toggleQuickDebug();
      if (action === "validate") void this.options.onValidateWorkbench?.();
      if (action === "save") void this.options.onSaveWorkbench?.();
      if (this.isReadOnly()) return;
      if (action === "layout") void this.autoLayout();
      if (action === "undo") void this.semanticUndo();
      if (action === "redo") void this.semanticRedo();
      if (action === "edit") this.openSelectedEditor();
      if (action === "delete") void this.deleteSelection();
      if (action === "add-role") this.openCommandForm("add-role");
      if (action === "add-edge") {
        const selectedRoleId = this.selectedRoleId();
        if (selectedRoleId) {
          this.openCommandForm("add-edge", {
            sourceRoleId: selectedRoleId,
            targetRoleId: "__system_end__"
          });
        } else {
          this.toast("error", this.label("selectRoleBeforeAddingEdge"));
        }
      }
    });
  }

  private bindContextMenu(): void {
    this.contextMenuEl.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>("[data-studio-graph-context-action]");
      if (!button || button.disabled) {
        return;
      }
      const action = button.dataset.studioGraphContextAction || "";
      void this.handleContextMenuAction(action);
      this.hideContextMenu();
    });
    this.root.addEventListener("pointerdown", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-studio-graph-context-menu]")) {
        return;
      }
      this.hideContextMenu();
    });
    this.root.addEventListener("pointerup", () => this.schedulePendingEdgeCleanup());
    this.root.addEventListener("pointercancel", () => this.schedulePendingEdgeCleanup());
    this.root.addEventListener("mouseleave", () => this.schedulePendingEdgeCleanup());
    this.root.addEventListener("contextmenu", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-studio-graph-context-menu]")) {
        event.preventDefault();
        return;
      }
      if (!target?.closest(".x6-node, .x6-edge")) {
        this.hideContextMenu();
      }
    });
  }

  private bindGraphEvents(): void {
    this.graph.on("node:click", ({ node }) => {
      const data = node.getData() as { studioNode?: { kind?: string; roleId?: string } } | undefined;
      if (data?.studioNode?.roleSeat && data.studioNode.roleId) {
        this.selectRoleById(data.studioNode.roleId, node);
      }
    });
    this.graph.on("node:dblclick", ({ node }) => {
      const data = node.getData() as { studioNode?: { kind?: string; roleId?: string } } | undefined;
      if (data?.studioNode?.roleSeat && data.studioNode.roleId) {
        this.openEditRoleForm(data.studioNode.roleId);
      }
    });
    this.graph.on("node:contextmenu", ({ node, e }) => {
      const data = node.getData() as { studioNode?: { kind?: string; roleId?: string } } | undefined;
      if (this.isReadOnly() || !data?.studioNode?.roleSeat || !data.studioNode.roleId) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.closeCommandForm();
      this.selectRoleById(data.studioNode.roleId, node);
      this.showContextMenu({
        x: e.clientX,
        y: e.clientY,
        state: {
          kind: "role",
          roleId: data.studioNode.roleId
        }
      });
    });
    this.graph.on("edge:click", ({ edge }) => {
      const data = this.edgeRecordFromCell(edge);
      if (data?.studioEdge) {
        this.selectEdge(data.studioEdge, edge);
      }
    });
    this.graph.on("edge:dblclick", ({ edge }) => {
      const data = this.edgeRecordFromCell(edge);
      if (data?.studioEdge) {
        this.openEditEdgeForm(data.studioEdge);
      }
    });
    this.graph.on("edge:contextmenu", ({ edge, e }) => {
      const data = this.edgeRecordFromCell(edge);
      if (this.isReadOnly() || !data?.studioEdge) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      this.closeCommandForm();
      this.selectEdge(data.studioEdge, edge);
      this.showContextMenu({
        x: e.clientX,
        y: e.clientY,
        state: {
          kind: "flow",
          edge: data.studioEdge
        }
      });
    });
    this.graph.on("blank:click", () => {
      if (this.options.onBeforeClearSelection?.() === false) {
        return;
      }
      this.graph.cleanSelection();
      this.options.onClearSelection?.();
      this.lastEditSelectionSignature = "";
      this.closeCommandForm();
      this.hideDiagnosticCard();
      this.syncSelectionPresentation();
      this.updateToolbarState();
    });
    this.graph.on("blank:contextmenu", ({ e }) => {
      e.preventDefault();
      this.hideContextMenu();
    });
    this.graph.on("selection:changed", () => {
      if (this.commandForm?.kind === "add-edge") {
        this.closeCommandForm();
      }
      this.hideContextMenu();
      this.syncSelectionPresentation("", { preserveViewport: true });
      this.hideDiagnosticCard();
      this.updateToolbarState();
    });
    this.graph.on("node:mouseenter", ({ node, e }) => {
      const data = node.getData() as { studioNode?: Record<string, unknown> } | undefined;
      this.showDiagnosticCard(data?.studioNode, e);
    });
    this.graph.on("node:mouseleave", () => {
      this.hideDiagnosticCard();
    });
    this.graph.on("cell:mouseup", () => {
      this.schedulePendingEdgeCleanup();
    });
    this.graph.on("blank:mouseup", () => {
      this.schedulePendingEdgeCleanup();
    });
    this.graph.on("node:moved", ({ node }) => {
      if (this.isReadOnly()) return;
      if (isStudioSccGroup(node)) {
        // SCC frames are independently draggable annotations. Moving one does
        // not alter graph semantics or the positions of its member nodes.
        this.renderMinimap();
        return;
      }
      if (this.commandForm?.kind === "add-edge") {
        this.closeCommandForm();
      }
      alignStudioSccGroups(this.graph);
      this.scheduleSyncCanvas();
      this.renderMinimap();
    });
    this.graph.on("edge:connected", ({ edge, isNew }) => {
      if (!isNew) return;
      if (this.isReadOnly()) {
        edge.remove();
        return;
      }
      const source = edge.getSourceCellId();
      const target = edge.getTargetCellId();
      edge.remove();
      if (!source || !target) {
        this.toast("error", this.label("invalidConnection"));
        return;
      }
      const sourceCell = this.graph.getCellById(source);
      const targetCell = this.graph.getCellById(target);
      if (!validateStudioConnectionCells(sourceCell, targetCell).ok) {
        this.toast("error", this.label("invalidConnection"));
        return;
      }
      this.openCommandForm("add-edge", {
        sourceRoleId: source,
        targetRoleId: target
      });
    });
  }

  private openCommandForm(
    kind: "add-role" | "add-edge" | "edit-role" | "edit-edge",
    defaults: {
      roleId?: string;
      flowId?: string;
      sourceRoleId?: string;
      targetRoleId?: string;
      eventType?: string;
      label?: string;
      runtimeOnlyErrorFlow?: boolean;
      participatesInJoin?: boolean;
    } = {}
  ): void {
    if (this.isReadOnly()) {
      return;
    }
    if (kind !== "add-role") {
      this.pendingRoleInsertion = null;
    }
    this.hideContextMenu();
    this.commandForm = createDefaultStudioCommandFormState({
      kind,
      context: this.validationContext(),
      roleId: defaults.roleId,
      flowId: defaults.flowId,
      sourceRoleId: defaults.sourceRoleId,
      targetRoleId: defaults.targetRoleId,
      eventType: defaults.eventType,
      label: defaults.label,
      runtimeOnlyErrorFlow: defaults.runtimeOnlyErrorFlow,
      participatesInJoin: defaults.participatesInJoin
    });
    this.renderCommandForm();
  }

  private openEditRoleForm(roleId: string): void {
    if (this.isReadOnly() || !this.options.authoring?.roles?.[roleId]) {
      return;
    }
    const signature = `role:${roleId}`;
    if (this.lastEditSelectionSignature === signature && this.commandForm?.kind === "edit-role") {
      return;
    }
    this.lastEditSelectionSignature = signature;
    this.openCommandForm("edit-role", { roleId });
  }

  private openEditEdgeForm(edge: {
    id?: string;
    source: string;
    target: string;
    eventType: string;
    label?: string;
    runtimeOnlyErrorFlow?: boolean;
    participatesInJoin?: boolean;
    editable?: boolean;
  }): void {
    if (this.isReadOnly() || edge.editable === false) {
      return;
    }
    const signature = `edge:${edge.id || studioEdgeFlowKey(edge)}`;
    if (this.lastEditSelectionSignature === signature && this.commandForm?.kind === "edit-edge") {
      return;
    }
    this.lastEditSelectionSignature = signature;
    this.openCommandForm("edit-edge", {
      flowId: edge.id,
      sourceRoleId: edge.source,
      targetRoleId: edge.target,
      eventType: edge.eventType,
      label: edge.label,
      runtimeOnlyErrorFlow: edge.runtimeOnlyErrorFlow,
      participatesInJoin: edge.participatesInJoin
    });
  }

  private focusRequestedSelection(): void {
    const request = Number(this.options.editSelectionRequest || 0);
    if (!request || request === this.lastHandledEditSelectionRequest || this.isReadOnly()) {
      return;
    }
    this.lastHandledEditSelectionRequest = request;
    const selected = this.graph.getSelectedCells()[0];
    if (!selected) {
      return;
    }
    this.focusCell(selected, { preserveViewport: false });
  }

  private openSelectedEditor(): void {
    if (this.isReadOnly()) {
      return;
    }
    const selected = this.graph.getSelectedCells()[0];
    const data = selected?.getData() as {
      studioNode?: { kind?: string; roleId?: string };
      studioEdge?: { id?: string; source: string; target: string; eventType: string; runtimeOnlyErrorFlow?: boolean; participatesInJoin?: boolean; editable?: boolean };
    } | undefined;
    if (data?.studioNode?.roleSeat && data.studioNode.roleId) {
      this.openEditRoleForm(data.studioNode.roleId);
      return;
    }
    if (data?.studioEdge) {
      this.openEditEdgeForm(data.studioEdge);
    }
  }

  private closeCommandForm(): void {
    if (!this.commandForm && this.dialogEl.hidden) {
      return;
    }
    this.pendingEdgePreview = null;
    this.pendingRoleInsertion = null;
    this.commandForm = null;
    this.dialogEl.hidden = true;
    this.dialogEl.innerHTML = "";
    this.syncPendingEdgePreview();
    this.notifyCommandFormState();
  }

  private bindQuickOpen(): void {
    this.quickOpenInputEl.addEventListener("input", () => {
      this.quickOpenSelectedIndex = 0;
      this.renderQuickOpenResults();
    });
    this.quickOpenInputEl.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeQuickOpen();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        this.moveQuickOpenSelection(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        this.moveQuickOpenSelection(-1);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        this.activateQuickOpenSelection();
      }
    });
    this.quickOpenResultsEl.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>("[data-studio-graph-quick-open-item]");
      if (!button) {
        return;
      }
      this.activateQuickOpenItem({
        kind: button.dataset.itemKind === "flow" ? "flow" : "role",
        id: button.dataset.itemId || "",
        label: button.dataset.itemLabel || ""
      });
    });
  }

  private toggleQuickOpen(): void {
    if (this.quickOpenEl.hidden) {
      this.quickOpenSelectedIndex = 0;
      this.quickOpenEl.hidden = false;
      this.quickOpenInputEl.value = "";
      this.renderQuickOpenResults();
      this.quickOpenInputEl.focus();
      this.quickOpenInputEl.select();
      return;
    }
    this.closeQuickOpen();
  }

  private closeQuickOpen(): void {
    this.quickOpenEl.hidden = true;
    this.quickOpenInputEl.value = "";
    this.quickOpenResultsEl.innerHTML = "";
  }

  private bindQuickDebug(): void {
    this.quickDebugEl.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-studio-graph-quick-debug-close]")) {
        this.closeQuickDebug();
        return;
      }
      if (target?.closest("[data-studio-graph-quick-debug-advanced]")) {
        void this.openAdvancedDebugFromQuickDebug();
        return;
      }
      if (target?.closest("[data-studio-graph-quick-debug-run]")) {
        void this.submitQuickDebug();
      }
    });
    this.quickDebugInputEl.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        void this.submitQuickDebug();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.closeQuickDebug();
      }
    });
  }

  private toggleQuickDebug(): void {
    if (this.quickDebugEl.hidden) {
      this.closeQuickOpen();
      this.quickDebugEl.hidden = false;
      this.quickDebugInputEl.focus();
      return;
    }
    this.closeQuickDebug();
  }

  private closeQuickDebug(force = false): void {
    if (this.quickDebugBusy && !force) {
      return;
    }
    this.quickDebugEl.hidden = true;
    this.quickDebugInputEl.value = "";
  }

  private async submitQuickDebug(): Promise<void> {
    if (this.quickDebugBusy) {
      return;
    }
    const input = this.quickDebugInputEl.value.trim();
    if (!input) {
      this.toast("error", this.label("debugQuickInput"));
      this.quickDebugInputEl.focus();
      return;
    }
    this.quickDebugBusy = true;
    this.updateToolbarState();
    try {
      const launched = await this.options.onQuickDebugRun?.(input);
      if (launched !== false) {
        this.closeQuickDebug(true);
      }
    } finally {
      this.quickDebugBusy = false;
      this.updateToolbarState();
    }
  }

  private async openAdvancedDebugFromQuickDebug(): Promise<void> {
    if (this.quickDebugBusy) {
      return;
    }
    const moved = await this.options.onFocusDebugInput?.();
    if (moved !== false) {
      this.closeQuickDebug(true);
    }
  }

  private moveQuickOpenSelection(delta: number): void {
    const items = this.quickOpenItems();
    if (!items.length) {
      return;
    }
    this.quickOpenSelectedIndex = (this.quickOpenSelectedIndex + delta + items.length) % items.length;
    this.renderQuickOpenResults();
  }

  private activateQuickOpenSelection(): void {
    const items = this.quickOpenItems();
    if (!items.length) {
      return;
    }
    const item = items[Math.max(0, Math.min(this.quickOpenSelectedIndex, items.length - 1))];
    this.activateQuickOpenItem(item);
  }

  private activateQuickOpenItem(item: { kind: "role" | "flow"; id: string; label: string }): void {
    if (!item.id) {
      return;
    }
    this.closeQuickOpen();
    if (item.kind === "role") {
      const node = this.graph.getCellById(item.id);
      if (!node) {
        return;
      }
      this.options.selectedRoleId = item.id;
      this.options.selectedFlowKey = "";
      this.graph.cleanSelection();
      this.graph.select(node);
      this.options.onSelectRole?.(item.id);
      this.focusCell(node, { preserveViewport: false });
      this.syncSelectionPresentation(item.id, { preserveViewport: true });
      this.updateToolbarState();
      return;
    }
    const edge = this.graph.getEdges().find((candidate) => {
      const data = candidate.getData() as { studioEdge?: { source: string; target: string; eventType: string } } | undefined;
      return data?.studioEdge ? studioEdgeFlowKey(data.studioEdge) === item.id : false;
    });
    if (!edge) {
      return;
    }
    this.options.selectedRoleId = "";
    this.options.selectedFlowKey = item.id;
    this.graph.cleanSelection();
    this.graph.select(edge);
    this.options.onSelectFlow?.(item.id);
    this.focusCell(edge, { preserveViewport: false });
    this.syncSelectionPresentation(edge.id, { preserveViewport: true });
    this.updateToolbarState();
  }

  private renderQuickOpenResults(): void {
    const items = this.quickOpenItems();
    if (!items.length) {
      this.quickOpenResultsEl.innerHTML = '<div class="studio-graph-quick-open-empty">No matching roles or flows.</div>';
      return;
    }
    this.quickOpenSelectedIndex = Math.max(0, Math.min(this.quickOpenSelectedIndex, items.length - 1));
    this.quickOpenResultsEl.innerHTML = items.map((item, index) => {
      const active = index === this.quickOpenSelectedIndex;
      return '<button type="button" class="studio-graph-quick-open-item' + (active ? " is-active" : "") +
        '" data-studio-graph-quick-open-item="1" data-item-kind="' + this.escapeHtml(item.kind) +
        '" data-item-id="' + this.escapeHtml(item.id) +
        '" data-item-label="' + this.escapeHtml(item.label) + '">' +
        '<span class="studio-graph-quick-open-kind">' + this.escapeHtml(item.kind === "role" ? "Role" : "Flow") + '</span>' +
        '<strong>' + this.escapeHtml(item.label) + "</strong>" +
        "</button>";
    }).join("");
  }

  private quickOpenItems(): Array<{ kind: "role" | "flow"; id: string; label: string }> {
    const viewModel = this.currentViewModel;
    if (!viewModel) {
      return [];
    }
    const query = this.quickOpenInputEl.value.trim().toLowerCase();
    const roleItems = viewModel.nodes
      .filter((node) => node.roleSeat)
      .map((node) => ({
        kind: "role" as const,
        id: node.roleId,
        label: node.title ? `${node.roleId} · ${node.title}` : node.roleId
      }));
    const flowItems = viewModel.edges.map((edge) => ({
      kind: "flow" as const,
      id: studioEdgeFlowKey(edge),
      label: `${edge.source} -> ${edge.target} · ${edge.eventType}`
    }));
    const items = roleItems.concat(flowItems);
    if (!query) {
      return items.slice(0, 24);
    }
    return items.filter((item) => item.label.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)).slice(0, 24);
  }

  private showDiagnosticCard(node: Record<string, unknown> | undefined, event: Event | undefined): void {
    if (!node || node.roleSeat !== true) {
      this.hideDiagnosticCard();
      return;
    }
    const diagnostic = typeof node.diagnostic === "object" && node.diagnostic !== null
      ? node.diagnostic as Record<string, unknown>
      : null;
    const runtime = typeof node.runtime === "object" && node.runtime !== null
      ? node.runtime as Record<string, unknown>
      : null;
    const items: string[] = [];
    if (typeof diagnostic?.message === "string" && diagnostic.message.trim()) {
      items.push(`<div><strong>${this.escapeHtml(String(diagnostic.severity ?? "warning"))}</strong> ${this.escapeHtml(diagnostic.message)}</div>`);
    }
    if (Array.isArray(runtime?.missingSources) && runtime.missingSources.length > 0) {
      items.push(`<div>missing inputs: ${this.escapeHtml(runtime.missingSources.join(", "))}</div>`);
    }
    if (typeof runtime?.lastErrorCode === "string" && runtime.lastErrorCode) {
      items.push(`<div>last error: ${this.escapeHtml(runtime.lastErrorCode)}</div>`);
    }
    if (typeof runtime?.status === "string" && runtime.status === "waiting_review") {
      items.push(`<div>waiting review</div>`);
    }
    if (Number.isFinite(Number(runtime?.loopIteration)) && Number(runtime?.loopIteration) > 0) {
      items.push(`<div>loop: ${this.escapeHtml(String(runtime?.loopIteration))}</div>`);
    }
    if (items.length === 0) {
      this.hideDiagnosticCard();
      return;
    }
    this.diagnosticCardEl.innerHTML = items.join("");
    this.diagnosticCardEl.hidden = false;
    const pointer = event instanceof MouseEvent
      ? { x: event.clientX, y: event.clientY }
      : null;
    const stageRect = this.stageEl.getBoundingClientRect();
    const left = pointer ? pointer.x - stageRect.left + 12 : 16;
    const top = pointer ? pointer.y - stageRect.top + 12 : 16;
    this.diagnosticCardEl.style.left = `${Math.max(12, left)}px`;
    this.diagnosticCardEl.style.top = `${Math.max(12, top)}px`;
  }

  private hideDiagnosticCard(): void {
    this.diagnosticCardEl.hidden = true;
    this.diagnosticCardEl.innerHTML = "";
  }

  private renderCommandForm(): void {
    if (!this.commandForm) {
      this.closeCommandForm();
      return;
    }
    this.hideContextMenu();
    this.dialogEl.hidden = false;
    this.dialogEl.innerHTML = renderStudioCommandForm({
      state: this.commandForm,
      context: this.validationContext(),
      labels: this.options.commandFormLabels
    });
    this.notifyCommandFormState();
    this.bindCommandForm();
    this.syncPendingEdgePreview();
    const firstInput = this.dialogEl.querySelector<HTMLInputElement | HTMLSelectElement>("input:not([type=radio]):not([type=checkbox]), select");
    firstInput?.focus();
  }

  private bindCommandForm(): void {
    const form = this.dialogEl.querySelector<HTMLFormElement>("form");
    const close = this.dialogEl.querySelector<HTMLButtonElement>("[data-studio-command-close]");
    close?.addEventListener("click", () => this.closeCommandForm());
    if (!form) {
      return;
    }
    form.addEventListener("input", (event) => this.refreshCommandFormFromDom(form, event));
    form.addEventListener("change", (event) => this.refreshCommandFormFromDom(form, event));
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void this.submitCommandForm(form);
    });
  }

  private refreshCommandFormFromDom(form: HTMLFormElement, event?: Event): void {
    if (!this.commandForm) {
      return;
    }
    const target = event?.target as HTMLElement | null;
    const targetName = target?.getAttribute("name") || "";
    const requiresStructureRefresh =
      event?.type === "change" && ["mode", "repositoryRoleId", "bindingKind", "profileMode", "sourceRoleId", "targetRoleId"].includes(targetName);
    this.commandForm = readStudioCommandFormState({
      form,
      previous: this.commandForm,
      context: this.validationContext()
    });
    if (!requiresStructureRefresh) {
      this.patchCommandFormValidation();
      this.syncPendingEdgePreview();
      return;
    }
    this.dialogEl.innerHTML = renderStudioCommandForm({
      state: this.commandForm,
      context: this.validationContext(),
      labels: this.options.commandFormLabels
    });
    this.bindCommandForm();
    this.syncPendingEdgePreview();
    if (targetName) {
      const active = this.dialogEl.querySelector<HTMLInputElement | HTMLSelectElement>('[name="' + this.cssEscape(targetName) + '"]');
      active?.focus();
    }
  }

  private patchCommandFormValidation(): void {
    if (!this.commandForm) {
      return;
    }
    const diagnostics = this.dialogEl.querySelector<HTMLElement>("[data-studio-command-diagnostics]");
    if (diagnostics) {
      diagnostics.outerHTML = renderStudioCommandFormDiagnostics(this.commandForm);
    }
    for (const fieldPath of ["repositoryRoleId", "roleId", "modelRef", "profileId", "newProfileId", "newProfileToolRef", "newProfileTimeoutMs", "newProfileMaxOutputBytes", "sourceRoleId", "targetRoleId", "eventType"]) {
      const current = this.dialogEl.querySelector<HTMLElement>('[data-studio-command-error="' + this.cssEscape(fieldPath) + '"]');
      if (current) {
        current.outerHTML = renderStudioCommandFormFieldError(this.commandForm, fieldPath);
      }
    }
    const submit = this.dialogEl.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) {
      submit.disabled = !this.commandForm.validation.ok;
    }
  }

  private async submitCommandForm(form: HTMLFormElement): Promise<void> {
    if (!this.commandForm) {
      return;
    }
    this.commandForm = readStudioCommandFormState({
      form,
      previous: this.commandForm,
      context: this.validationContext()
    });
    if (!this.commandForm.validation.ok) {
      this.renderCommandForm();
      return;
    }
    const command = commandFromStudioCommandFormState(this.commandForm);
    if (!command) {
      this.renderCommandForm();
      return;
    }
    const pendingRoleInsertion = this.pendingRoleInsertion && this.commandForm.kind === "add-role"
      ? { ...this.pendingRoleInsertion }
      : null;
    const nextCommand = pendingRoleInsertion && command.type === "add-role"
      ? this.commandForInsertedRole(command, pendingRoleInsertion)
      : command;
    const selectionOverride = pendingRoleInsertion && command.type === "add-role"
      ? { selectedRoleId: command.roleId?.trim() || "", selectedFlowKey: "" }
      : undefined;
    this.pendingEdgePreview = null;
    this.closeCommandForm();
    await this.applyCommand(nextCommand, selectionOverride);
  }

  private selectFromOptions(): void {
    const roleId = this.options.selectedRoleId || "";
    const flowKey = this.options.selectedFlowKey || "";
    const current = this.graph.getSelectedCells()[0];
    const currentData = current?.getData() as {
      studioNode?: { kind?: string; roleId?: string };
      studioEdge?: { source: string; target: string; eventType: string };
    } | undefined;
    const currentRoleId = currentData?.studioNode?.roleSeat ? currentData.studioNode.roleId || "" : "";
    const currentFlowKey = currentData?.studioEdge ? studioEdgeFlowKey(currentData.studioEdge) : "";
    if (currentRoleId === roleId && currentFlowKey === flowKey) {
      this.syncSelectionPresentation(roleId || current?.id || flowKey || "");
      return;
    }
    this.graph.cleanSelection();
    if (roleId) {
      const node = this.graph.getCellById(roleId);
      if (node) this.graph.select(node);
      this.syncSelectionPresentation(roleId);
      return;
    }
    if (flowKey) {
      const edge = this.graph.getEdges().find((cell) => {
        const data = cell.getData() as { studioEdge?: { source: string; target: string; eventType: string } } | undefined;
        return data?.studioEdge ? studioEdgeFlowKey(data.studioEdge) === flowKey : false;
      });
      if (edge) this.graph.select(edge);
      this.syncSelectionPresentation(edge?.id || "");
      return;
    }
    this.syncSelectionPresentation();
  }

  private restoreViewport(
    viewport: StudioCanvasSnapshot["viewport"] | undefined,
    firstRender: boolean
  ): void {
    const signature = viewport
      ? `${viewport.x}:${viewport.y}:${viewport.zoom}`
      : "";
    if (
      viewport &&
      Number.isFinite(viewport.x) &&
      Number.isFinite(viewport.y) &&
      Number.isFinite(viewport.zoom) &&
      signature !== this.lastViewportSignature
    ) {
      this.clearPendingInitialFit();
      this.graph.zoomTo(viewport.zoom);
      this.graph.translate(viewport.x, viewport.y);
      this.lastViewportSignature = signature;
      return;
    }
    if (firstRender && !viewport) {
      this.schedulePendingInitialFit();
    }
  }

  private selectedRoleId(): string {
    const selected = this.graph.getSelectedCells()[0];
    const data = selected?.getData() as { studioNode?: { kind?: string; roleId?: string } } | undefined;
    return data?.studioNode?.roleSeat ? data.studioNode.roleId || "" : this.options.selectedRoleId || "";
  }

  private preserveBoundaryNodeLayout(viewModel: GraphViewModel): void {
    if (this.isReadOnly() || !this.hasRenderedProjection) {
      return;
    }
    for (const node of viewModel.nodes) {
      if (node.kind !== "boundary") {
        continue;
      }
      const cell = this.graph.getCellById(node.id);
      if (!cell?.isNode()) {
        continue;
      }
      const position = cell.getPosition();
      const size = cell.getSize();
      if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
        continue;
      }
      node.layout = {
        ...node.layout,
        x: position.x,
        y: position.y,
        width: Number.isFinite(size.width) ? size.width : node.layout.width,
        height: Number.isFinite(size.height) ? size.height : node.layout.height
      };
    }
  }

  private async deleteSelection(): Promise<void> {
    if (this.isReadOnly()) {
      return;
    }
    const selected = this.graph.getSelectedCells()[0];
    if (!selected) return;
    const nodeData = selected.getData() as { studioNode?: { kind?: string; roleId?: string } } | undefined;
    if (nodeData?.studioNode?.roleSeat && nodeData.studioNode.roleId) {
      await this.deleteRole(nodeData.studioNode.roleId);
      return;
    }
    const edgeData = this.edgeRecordFromCell(selected);
    if (edgeData?.studioEdge?.editable) {
      await this.deleteEdge(edgeData.studioEdge);
    }
  }

  private async fitAndSync(): Promise<void> {
    this.fitGraphToViewport();
    if (this.isReadOnly()) {
      return;
    }
    await this.syncCanvas();
  }

  private async resetViewAndSync(): Promise<void> {
    this.graph.zoomTo(1);
    this.graph.centerContent();
    if (this.isReadOnly()) {
      return;
    }
    await this.syncCanvas();
  }

  private async autoLayout(): Promise<void> {
    if (this.isReadOnly()) {
      return;
    }
    this.layoutMode = this.nextLayoutMode(this.layoutMode);
    await this.applyAutoLayout();
    this.toast("info", this.formatLabel("layoutSwitched", {
      layout: this.layoutModeLabel(this.layoutMode)
    }));
    await this.syncCanvas();
  }

  private async applyDefaultAutoLayout(updateGeneration: number): Promise<boolean> {
    if (!this.options.defaultAutoLayout) {
      return false;
    }
    const signature = this.defaultAutoLayoutSignature();
    if (!signature || (!this.isReadOnly() && this.hasRenderedProjection) || this.lastDefaultAutoLayoutSignature === signature) {
      return false;
    }
    if (!this.isReadOnly() && !this.hasRenderedProjection && this.hasCompleteStoredRoleLayout()) {
      this.lastDefaultAutoLayoutSignature = signature;
      return false;
    }
    await this.applyAutoLayout(updateGeneration);
    if (updateGeneration !== this.updateGeneration) {
      return false;
    }
    this.lastDefaultAutoLayoutSignature = signature;
    return true;
  }

  private hasCompleteStoredRoleLayout(): boolean {
    const authoring = this.options.authoring;
    const roles = authoring?.roles && typeof authoring.roles === "object"
      ? Object.keys(authoring.roles)
      : [];
    if (!roles.length) {
      return false;
    }
    const nodes = authoring?.layout?.nodes ?? {};
    return roles.every((roleId) => {
      const layout = nodes[roleId];
      return Number.isFinite(layout?.x) &&
        Number.isFinite(layout?.y) &&
        Number.isFinite(layout?.width) &&
        Number.isFinite(layout?.height);
    });
  }

  private defaultAutoLayoutSignature(): string {
    const nodes = this.graph.getNodes()
      .map((node) => node.id)
      .sort();
    const edges = this.graph.getEdges()
      .filter((edge) => !this.isPendingEdgePreviewCell(edge))
      .map((edge) => `${edge.getSourceCellId() || ""}->${edge.getTargetCellId() || ""}`)
      .sort();
    return nodes.length ? `${nodes.join(",")}|${edges.join(",")}` : "";
  }

  private async applyAutoLayout(updateGeneration = this.updateGeneration): Promise<void> {
    if (!this.currentViewModel) return;
    const viewModel = this.currentViewModel;
    const projection = await createElkLayoutProjection(viewModel, this.layoutMode);
    if (updateGeneration !== this.updateGeneration || viewModel !== this.currentViewModel) {
      return;
    }
    this.currentLayoutProjection = projection;
    this.renderCurrentProjection();
    this.fitGraphToViewport();
  }

  private renderCurrentProjection(): void {
    if (!this.currentViewModel || !this.currentLayoutProjection) return;
    const viewModel = this.showTopologyOrder
      ? this.currentViewModel
      : {
          ...this.currentViewModel,
          // SCC boundaries remain visible as structural context; the toggle
          // controls only the optional edge numbering overlay.
          nodes: this.currentViewModel.nodes,
          edges: this.currentViewModel.edges.map((edge) => ({ ...edge, topologyOrder: undefined }))
        };
    renderStudioGraphViewModel(this.graph, viewModel, this.currentLayoutProjection);
  }

  private nextLayoutMode(current: StudioGraphLayoutMode): StudioGraphLayoutMode {
    const modes: StudioGraphLayoutMode[] = ["flow", "compact", "stacked"];
    const index = modes.indexOf(current);
    return modes[(index + 1) % modes.length] || "flow";
  }

  private layoutModeLabel(mode: StudioGraphLayoutMode): string {
    if (mode === "compact") return this.label("layoutModeCompact");
    if (mode === "stacked") return this.label("layoutModeStacked");
    return this.label("layoutModeFlow");
  }

  private fitGraphToViewport(maxScale = STUDIO_GRAPH_FIT_MAX_SCALE): void {
    this.graph.zoomToFit({ padding: STUDIO_GRAPH_FIT_PADDING, maxScale });
    this.ensureReadablePrimaryViewport();
    this.lastViewportSignature = "";
  }

  private schedulePendingInitialFit(): void {
    this.pendingInitialFit = true;
    this.pendingInitialFitSizeSignature = "";
    this.flushPendingInitialFit();
  }

  private ensureReadablePrimaryViewport(): void {
    const roleNodes = this.graph.getNodes().filter((node) => {
      const data = node.getData() as { studioNode?: { kind?: string } } | undefined;
      return data?.studioNode?.roleSeat === true;
    });
    if (!roleNodes.length || roleNodes.length > STUDIO_GRAPH_READABILITY_ROLE_LIMIT) {
      return;
    }
    const currentScale = this.graph.zoom();
    if (!Number.isFinite(currentScale) || currentScale <= 0) {
      return;
    }
    const primaryRole = roleNodes[0];
    const size = primaryRole.getSize();
    const readableScale = Math.max(
      STUDIO_GRAPH_MIN_READABLE_ROLE_WIDTH / Math.max(size.width, 1),
      STUDIO_GRAPH_MIN_READABLE_ROLE_HEIGHT / Math.max(size.height, 1)
    );
    const desiredScale = Math.min(STUDIO_GRAPH_FIT_MAX_SCALE, readableScale);
    if (!Number.isFinite(desiredScale) || desiredScale <= currentScale + 0.01) {
      return;
    }
    this.graph.zoomTo(desiredScale);
    this.graph.centerContent();
  }

  private clearPendingInitialFit(): void {
    this.pendingInitialFit = false;
    this.pendingInitialFitSizeSignature = "";
    if (this.pendingInitialFitTimer) {
      clearTimeout(this.pendingInitialFitTimer);
      this.pendingInitialFitTimer = null;
    }
  }

  private flushPendingInitialFit(): void {
    if (!this.pendingInitialFit || this.pendingInitialFitTimer) {
      return;
    }
    this.pendingInitialFitTimer = setTimeout(() => {
      this.pendingInitialFitTimer = null;
      if (!this.pendingInitialFit) {
        return;
      }
      const width = this.canvasEl.clientWidth;
      const height = this.canvasEl.clientHeight;
      if (!Number.isFinite(width) || !Number.isFinite(height) || width < 24 || height < 24) {
        this.flushPendingInitialFit();
        return;
      }
      const sizeSignature = `${Math.round(width)}x${Math.round(height)}`;
      if (sizeSignature !== this.pendingInitialFitSizeSignature) {
        this.pendingInitialFitSizeSignature = sizeSignature;
        this.flushPendingInitialFit();
        return;
      }
      this.pendingInitialFit = false;
      this.fitGraphToViewport();
      this.renderMinimap();
    }, 32);
  }

  private async syncCanvas(): Promise<void> {
    if (this.applying || this.isReadOnly() || !this.options.authoring || !this.options.canvas) {
      return;
    }
    const previous = this.currentSnapshot();
    const nextCanvas = graphToCanvasDocument(this.graph, this.options.authoring);
    if (this.sameCanvas(nextCanvas, this.options.canvas)) {
      return;
    }
    this.applying = true;
    try {
      await this.options.onApplyCanvas?.(nextCanvas);
      if (previous) {
        this.pushHistoryEntry({
          kind: "snapshot",
          snapshot: previous
        });
      }
      this.activeRedoStack().length = 0;
      this.updateToolbarState();
    } finally {
      this.applying = false;
    }
  }

  private scheduleSyncCanvas(): void {
    if (this.applying || this.isReadOnly()) {
      return;
    }
    if (this.syncCanvasTimer) {
      clearTimeout(this.syncCanvasTimer);
    }
    this.syncCanvasTimer = setTimeout(() => {
      this.syncCanvasTimer = null;
      void this.syncCanvas();
    }, 250);
  }

  private async applyCommand(
    command: StudioAuthoringCommand,
    selectionOverride?: { selectedRoleId?: string; selectedFlowKey?: string }
  ): Promise<void> {
    if (this.isReadOnly() || !this.options.authoring || !this.options.canvas) {
      if (command.type === "add-edge") {
        this.pendingEdgePreview = null;
        this.syncPendingEdgePreview();
      }
      this.toast("error", this.label("editBlocked"));
      return;
    }
    const previous = this.currentSnapshot();
    const inverse = deriveInverseCommand(this.options.authoring, command);
    const result = applyStudioAuthoringCommand({
      authoring: this.options.authoring,
      command
    });
    if (result.blockedCode) {
      if (command.type === "add-edge") {
        this.pendingEdgePreview = null;
        this.syncPendingEdgePreview();
      }
      this.toast("error", this.blockedMessage(result.blockedCode));
      return;
    }
    const nextSelectedRoleId = selectionOverride && Object.hasOwn(selectionOverride, "selectedRoleId")
      ? selectionOverride.selectedRoleId || ""
      : result.selectedRoleId || this.selectedRoleId();
    const nextSelectedFlowKey = selectionOverride && Object.hasOwn(selectionOverride, "selectedFlowKey")
      ? selectionOverride.selectedFlowKey || ""
      : result.selectedFlowKey || this.options.selectedFlowKey || "";
    await this.applyResolvedCommandResult(result, {
      selectedRoleId: nextSelectedRoleId,
      selectedFlowKey: nextSelectedFlowKey
    });
    if (previous) {
      this.pushHistoryEntry(
        inverse
          ? {
              kind: "command",
              forward: command,
              inverse,
              undoSelectedRoleId: previous.selectedRoleId || "",
              undoSelectedFlowKey: previous.selectedFlowKey || "",
              redoSelectedRoleId: nextSelectedRoleId || "",
              redoSelectedFlowKey: nextSelectedFlowKey || ""
            }
          : {
              kind: "snapshot",
              snapshot: previous
            }
      );
    }
    this.activeRedoStack().length = 0;
    this.updateToolbarState();
  }

  private setStatus(text: string): void {
    this.options.onStatusChange?.(text);
  }

  private setBusy(busy: boolean): void {
    this.toolbar.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = busy;
    });
    this.busy = busy;
    this.updateToolbarState();
  }

  private setEmptyState(empty: boolean, message = ""): void {
    this.stageEl.classList.toggle("is-empty", empty);
    this.emptyEl.hidden = !empty;
    if (empty) {
      this.emptyEl.textContent = message;
    }
  }

  private toast(tone: "error" | "success" | "info", message: string): void {
    this.options.onToast?.(tone, message);
    this.setStatus(message);
  }

  private async semanticUndo(): Promise<void> {
    if (this.isReadOnly()) {
      this.updateToolbarState();
      return;
    }
    const previous = this.activeUndoStack().pop();
    if (!previous) {
      this.updateToolbarState();
      return;
    }
    if (previous.kind === "command") {
      if (!this.options.authoring) {
        this.updateToolbarState();
        return;
      }
      const result = applyStudioAuthoringCommand({
        authoring: this.options.authoring,
        command: previous.inverse
      });
      if (result.blockedCode) {
        this.toast("error", this.blockedMessage(result.blockedCode));
        this.activeUndoStack().push(previous);
        this.updateToolbarState();
        return;
      }
      await this.applyResolvedCommandResult(result, {
        selectedRoleId: previous.undoSelectedRoleId || "",
        selectedFlowKey: previous.undoSelectedFlowKey || ""
      });
      this.activeRedoStack().push(previous);
      this.updateToolbarState();
      return;
    }
    const current = this.currentSnapshot();
    if (current) {
      this.activeRedoStack().push({
        kind: "snapshot",
        snapshot: current
      });
    }
    await this.applySnapshot(previous.snapshot);
    this.updateToolbarState();
  }

  private async semanticRedo(): Promise<void> {
    if (this.isReadOnly()) {
      this.updateToolbarState();
      return;
    }
    const next = this.activeRedoStack().pop();
    if (!next) {
      this.updateToolbarState();
      return;
    }
    if (next.kind === "command") {
      if (!this.options.authoring) {
        this.updateToolbarState();
        return;
      }
      const result = applyStudioAuthoringCommand({
        authoring: this.options.authoring,
        command: next.forward
      });
      if (result.blockedCode) {
        this.toast("error", this.blockedMessage(result.blockedCode));
        this.activeRedoStack().push(next);
        this.updateToolbarState();
        return;
      }
      await this.applyResolvedCommandResult(result, {
        selectedRoleId: next.redoSelectedRoleId || "",
        selectedFlowKey: next.redoSelectedFlowKey || ""
      });
      this.activeUndoStack().push(next);
      this.updateToolbarState();
      return;
    }
    const current = this.currentSnapshot();
    if (current) {
      this.activeUndoStack().push({
        kind: "snapshot",
        snapshot: current
      });
    }
    await this.applySnapshot(next.snapshot);
    this.updateToolbarState();
  }

  private async applySnapshot(snapshot: StudioGraphSnapshot): Promise<void> {
    this.applying = true;
    try {
      await this.options.onApplyCommand?.({
        authoring: snapshot.authoring,
        canvas: snapshot.canvas,
        selectedRoleId: snapshot.selectedRoleId,
        selectedFlowKey: snapshot.selectedFlowKey
      });
    } finally {
      this.applying = false;
    }
  }

  private async applyResolvedCommandResult(
    result: {
      authoring: StudioAuthoringDocument;
      canvas: StudioCanvasSnapshot;
      selectedRoleId?: string;
      selectedFlowKey?: string;
      blockedCode?: string;
      repositoryRoleId?: string;
      profileDrafts?: unknown;
      toolDrafts?: unknown;
    },
    selection: {
      selectedRoleId?: string;
      selectedFlowKey?: string;
    }
  ): Promise<void> {
    const appliedResult = {
      ...result,
      selectedRoleId: selection.selectedRoleId,
      selectedFlowKey: selection.selectedFlowKey
    };
    // Keep local authoring/canvas in sync immediately so chained edits do not depend on the
    // outer visualizer state round-tripping first.
    this.options.authoring = result.authoring;
    this.options.canvas = result.canvas;
    await this.options.onApplyCommand?.(appliedResult);
    if (!this.isReadOnly() && result.authoring && result.canvas) {
      this.options.selectedRoleId = selection.selectedRoleId || "";
      this.options.selectedFlowKey = selection.selectedFlowKey || "";
      this.applyRuntimeOverlay();
      this.selectFromOptions();
      this.syncSelectionPresentation((selection.selectedRoleId || "") || (selection.selectedFlowKey || ""));
    }
  }

  private pushUndoSnapshot(): void {
    if (this.isReadOnly()) return;
    const snapshot = this.currentSnapshot();
    if (!snapshot) return;
    this.pushHistoryEntry({
      kind: "snapshot",
      snapshot
    });
    this.updateToolbarState();
  }

  private currentSnapshot(): StudioGraphSnapshot | null {
    if (this.isReadOnly() || !this.options.authoring || !this.options.canvas) {
      return null;
    }
    return {
      authoring: this.cloneJson(this.options.authoring),
      canvas: this.cloneJson(this.options.canvas),
      selectedRoleId: this.options.selectedRoleId,
      selectedFlowKey: this.options.selectedFlowKey
    };
  }

  private updateToolbarState(): void {
    const readOnly = this.isReadOnly();
    const selected = this.graph.getSelectedCells()[0];
    const selectedData = selected?.getData() as {
      studioNode?: { kind?: string; roleId?: string };
      studioEdge?: { editable?: boolean };
    } | undefined;
    const selectedRole = selectedData?.studioNode?.roleSeat === true;
    const selectedEditable = selectedRole || selectedData?.studioEdge?.editable === true;
    const editActions = this.toolbar.querySelector<HTMLElement>("[data-studio-graph-edit-actions]");
    if (editActions) {
      editActions.hidden = readOnly;
    }
    const layout = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="layout"]');
    if (layout) {
      layout.hidden = readOnly;
      const layoutTitle = `${this.label("autoLayout")} · ${this.layoutModeLabel(this.layoutMode)}`;
      layout.title = layoutTitle;
      layout.setAttribute("aria-label", layoutTitle);
    }
    const topologyOrder = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="topology-order"]');
    if (topologyOrder) {
      topologyOrder.setAttribute("aria-pressed", this.showTopologyOrder ? "true" : "false");
      topologyOrder.title = this.label("topologyOrder") + (this.showTopologyOrder ? " · on" : " · off");
    }
    const layoutSelect = this.toolbar.querySelector<HTMLSelectElement>("[data-studio-graph-layout]");
    if (layoutSelect) {
      layoutSelect.value = this.layoutMode;
      layoutSelect.disabled = this.isReadOnly();
    }
    const generate = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="chat-generate"]');
    const debugRun = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="debug-run"]');
    if (generate) {
      generate.hidden = readOnly;
      generate.disabled = this.busy || readOnly;
    }
    if (debugRun) {
      debugRun.hidden = readOnly;
      debugRun.disabled = this.busy || readOnly || this.quickDebugBusy || typeof this.options.onQuickDebugRun !== "function";
    }
    for (const action of ["layout", "add-role", "add-edge", "edit", "delete", "validate", "save"]) {
      const button = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="' + action + '"]');
      if (button) button.disabled = this.busy || readOnly;
    }
    const addEdge = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="add-edge"]');
    const edit = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="edit"]');
    const deleteButton = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="delete"]');
    if (addEdge) addEdge.disabled = this.busy || readOnly || !selectedRole;
    if (edit) edit.disabled = this.busy || readOnly || !selectedEditable;
    if (deleteButton) deleteButton.disabled = this.busy || readOnly || !selectedEditable;
    const undo = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="undo"]');
    const redo = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="redo"]');
    const save = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="save"]');
    if (undo) undo.disabled = this.busy || readOnly || this.activeUndoStack().length === 0;
    if (redo) redo.disabled = this.busy || readOnly || this.activeRedoStack().length === 0;
    if (save) save.disabled = this.busy || readOnly || this.options.canSaveWorkbench !== true;
  }

  private isReadOnly(): boolean {
    return this.options.readOnly === true;
  }

  private handleHistoryEvent(event: StudioGraphBridgeOptions["historyEvent"]): void {
    if (!event || event.kind !== "push-before-replace") {
      return;
    }
    const eventId = Number(event.id || 0);
    if (!eventId || eventId === this.lastHandledHistoryEventId) {
      return;
    }
    this.lastHandledHistoryEventId = eventId;
    this.pushUndoSnapshot();
    this.activeRedoStack().length = 0;
    this.updateToolbarState();
  }

  private resetHistoryWhenProjectChanges(options: StudioGraphBridgeOptions): void {
    if (this.isReadOnly()) {
      this.readonlyHistory.undoStack.length = 0;
      this.readonlyHistory.redoStack.length = 0;
      return;
    }
    const project = options.authoring?.project;
    const nextKey = project ? `${project.workdir}\n${project.systemPath}` : "";
    if (!nextKey) return;
    if (sharedHistory.projectKey && sharedHistory.projectKey !== nextKey) {
      sharedHistory.undoStack.length = 0;
      sharedHistory.redoStack.length = 0;
    }
    sharedHistory.projectKey = nextKey;
  }

  private pushHistoryEntry(entry: StudioGraphHistoryEntry): void {
    this.activeUndoStack().push(entry);
    if (this.activeUndoStack().length > 40) {
      this.activeUndoStack().shift();
    }
  }

  private activeUndoStack(): StudioGraphHistoryEntry[] {
    return this.isReadOnly() ? this.readonlyHistory.undoStack : sharedHistory.undoStack;
  }

  private activeRedoStack(): StudioGraphHistoryEntry[] {
    return this.isReadOnly() ? this.readonlyHistory.redoStack : sharedHistory.redoStack;
  }

  private blockedMessage(code: string): string {
    if (code === "entry-role-delete") return this.label("entryRoleDeletionBlocked");
    if (code === "invalid-edge-endpoints") return this.label("invalidEdgeEndpoints");
    if (code === "duplicate-role-id") return this.label("duplicateRoleId");
    if (code === "invalid-role-id") return this.label("invalidRoleId");
    if (code === "duplicate-edge") return this.label("duplicateEdge");
    if (code === "invalid-event-type") return this.label("invalidEventType");
    return this.label("invalidConnection");
  }

  private validationContext() {
    return {
      authoring: this.options.authoring,
      rolePackages: this.options.rolePackages,
      bindings: this.options.bindings,
      readiness: this.options.readiness,
      projectConfig: this.options.projectConfig
    };
  }

  private label(key: StudioGraphLabelKey): string {
    return this.options.labels?.[key] ?? key;
  }

  private formatLabel(key: StudioGraphLabelKey, vars: Record<string, string>): string {
    return this.label(key).replace(/\{([A-Za-z0-9_.-]+)\}/g, (placeholder, name) => vars[name] ?? placeholder);
  }

  private handleRootKeydown(event: KeyboardEvent): void {
    if (!this.contextMenuEl.hidden && event.key === "Escape") {
      event.preventDefault();
      this.hideContextMenu();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
      event.preventDefault();
      this.toggleQuickOpen();
      return;
    }
    if (!this.quickOpenEl.hidden && event.key === "Escape") {
      event.preventDefault();
      this.closeQuickOpen();
      return;
    }
    if (!this.quickDebugEl.hidden && event.key === "Escape") {
      event.preventDefault();
      this.closeQuickDebug();
      return;
    }
    if (!this.commandForm || this.dialogEl.hidden) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeCommandForm();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = Array.from(
      this.dialogEl.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.offsetParent !== null || element === document.activeElement);
    if (focusable.length === 0) {
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }
    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private handleDelegatedCommandFormSubmit(event: Event): void {
    if (event.defaultPrevented) {
      return;
    }
    const target = event.target;
    const form = target instanceof HTMLFormElement
      ? target
      : target instanceof HTMLElement
        ? target.closest("form")
        : null;
    if (!form || !this.dialogEl.contains(form) || !form.matches("[data-studio-command-form]")) {
      return;
    }
    event.preventDefault();
    void this.submitCommandForm(form);
  }

  private toolbarButton(action: string, key: StudioGraphLabelKey, icon: string, shortLabel?: string): string {
    const label = this.label(key);
    return '<button type="button" data-studio-graph-action="' + this.escapeHtml(action) + '" title="' +
      this.escapeHtml(label) + '" aria-label="' + this.escapeHtml(label) + '"><span class="studio-graph-toolbar-icon" aria-hidden="true">' +
      this.escapeHtml(icon) + '</span><span class="studio-graph-toolbar-text">' + this.escapeHtml(shortLabel ?? label) + '</span></button>';
  }

  private sameCanvas(left: StudioCanvasSnapshot, right: StudioCanvasSnapshot): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private cloneJson<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
  }

  private escapeHtml(value: unknown): string {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  private cssEscape(value: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
      return CSS.escape(value);
    }
    return value.replace(/["\\]/g, "\\$&");
  }

  private attachCommandFormHost(): void {
    const host = this.options.commandFormHost instanceof HTMLElement
      ? this.options.commandFormHost
      : this.fallbackDialogEl;
    if (this.dialogEl === host) {
      return;
    }
    this.dialogEl.hidden = true;
    this.dialogEl.innerHTML = "";
    this.dialogEl = host;
    this.dialogEl.classList.add("studio-command-dialog");
    if (!this.commandForm) {
      this.dialogEl.hidden = true;
      return;
    }
    this.renderCommandForm();
  }

  private handleDismissCommandFormRequest(request: number | undefined): void {
    const value = Number(request || 0);
    if (!value || value === this.lastHandledDismissCommandFormRequest) {
      return;
    }
    this.lastHandledDismissCommandFormRequest = value;
    this.closeCommandForm();
  }

  private notifyCommandFormState(): void {
    if (!this.options.onCommandFormStateChange) {
      return;
    }
    if (!this.commandForm) {
      this.options.onCommandFormStateChange({ open: false });
      return;
    }
    const state: {
      open: boolean;
      kind?: "add-role" | "add-edge" | "edit-role" | "edit-edge";
      roleId?: string;
      flowKey?: string;
    } = {
      open: true,
      kind: this.commandForm.kind
    };
    if (this.commandForm.kind === "add-role" || this.commandForm.kind === "edit-role") {
      state.roleId = this.commandForm.fields.roleId || "";
    } else {
      state.flowKey = studioEdgeFlowKey({
        source: this.commandForm.fields.sourceRoleId || "",
        target: this.commandForm.fields.targetRoleId || "",
        eventType: this.commandForm.fields.eventType || ""
      });
    }
    this.options.onCommandFormStateChange(state);
  }

  private commandFormPendingEdgePreview(): PendingStudioEdgePreview | null {
    if (!this.commandForm || this.commandForm.kind !== "add-edge") {
      return null;
    }
    const sourceRoleId = (this.commandForm.fields.sourceRoleId || "").trim();
    const rawTargetRoleId = (this.commandForm.fields.targetRoleId || "").trim();
    const targetRoleId = rawTargetRoleId === "output" ? STUDIO_SYSTEM_END_ROLE_ID : rawTargetRoleId;
    const eventType = (this.commandForm.fields.eventType || "").trim() || "DONE";
    const label = (this.commandForm.fields.label || "").trim() || eventType;
    const targetCellId = normalizeStudioGraphTargetRoleId(targetRoleId);
    const sourceCell = this.graph.getCellById(sourceRoleId);
    const targetCell = this.graph.getCellById(targetCellId);
    if (!sourceRoleId || !targetRoleId || !sourceCell || !targetCell) {
      return null;
    }
    if (!validateStudioConnectionCells(sourceCell, targetCell).ok) {
      return null;
    }
    return {
      sourceRoleId,
      targetRoleId,
      eventType,
      label
    };
  }

  private syncPendingEdgePreview(): void {
    const commandFormPreview = this.commandFormPendingEdgePreview();
    let preview = commandFormPreview;
    if (preview && this.committedEdgeExists(preview)) {
      preview = null;
    }
    const pendingEdges = this.graph.getEdges().filter((edge) => this.isPendingEdgePreviewCell(edge));
    const [existing, ...duplicates] = pendingEdges;
    duplicates.forEach((edge) => edge.remove());
    if (!preview) {
      this.removePendingEdgePreviewCells();
      return;
    }
    const targetCellId = normalizeStudioGraphTargetRoleId(preview.targetRoleId);
    const nextLabels = [{
      attrs: {
        label: {
          text: preview.label,
          fill: "#dbeafe",
          fontSize: 11
        },
        body: {
          fill: "rgba(8, 47, 73, 0.92)",
          stroke: "#38bdf8",
          strokeWidth: 1,
          strokeDasharray: "6 4"
        }
      }
    }];
    const nextAttrs = {
      line: {
        stroke: "#38bdf8",
        strokeWidth: 1.9,
        strokeDasharray: "7 5",
        targetMarker: {
          name: "block",
          width: 8,
          height: 6
        }
      }
    };
    if (existing?.isEdge()) {
      existing.setData({ studioPendingEdge: preview });
      existing.setSource({
        cell: preview.sourceRoleId,
        port: "out",
        anchor: { name: "right" },
        connectionPoint: { name: "anchor" }
      });
      existing.setTarget({
        cell: targetCellId,
        port: preview.targetRoleId === STUDIO_SYSTEM_END_ROLE_ID ? undefined : "in",
        anchor: { name: "left" },
        connectionPoint: { name: "anchor" }
      });
      existing.setLabels(nextLabels);
      existing.attr(nextAttrs);
      existing.setRouter(STUDIO_GRAPH_EDGE_ROUTER);
      existing.setConnector(STUDIO_GRAPH_EDGE_CONNECTOR);
      this.applyRuntimeOverlay();
      return;
    }
    this.graph.addEdge({
      id: STUDIO_PENDING_EDGE_ID,
      source: {
        cell: preview.sourceRoleId,
        port: "out",
        anchor: { name: "right" },
        connectionPoint: { name: "anchor" }
      },
      target: {
        cell: targetCellId,
        port: preview.targetRoleId === STUDIO_SYSTEM_END_ROLE_ID ? undefined : "in",
        anchor: { name: "left" },
        connectionPoint: { name: "anchor" }
      },
      zIndex: 0,
      data: { studioPendingEdge: preview },
      labels: nextLabels,
      attrs: nextAttrs,
      router: STUDIO_GRAPH_EDGE_ROUTER,
      connector: STUDIO_GRAPH_EDGE_CONNECTOR
    });
    this.applyRuntimeOverlay();
  }

  private removePendingEdgePreviewCells(): void {
    let removed = false;
    for (const edge of this.graph.getEdges()) {
      if (!this.isPendingEdgePreviewCell(edge)) {
        continue;
      }
      edge.remove();
      removed = true;
    }
    if (removed) {
      this.applyRuntimeOverlay();
    }
  }

  private schedulePendingEdgeCleanup(): void {
    if (this.pendingEdgeCleanupTimer) {
      clearTimeout(this.pendingEdgeCleanupTimer);
    }
    this.pendingEdgeCleanupTimer = setTimeout(() => {
      this.pendingEdgeCleanupTimer = null;
      if (this.commandForm?.kind === "add-edge") {
        this.syncPendingEdgePreview();
        return;
      }
      this.removePendingEdgePreviewCells();
    }, 0);
  }

  private committedEdgeExists(preview: PendingStudioEdgePreview): boolean {
    const previewFlowKey = studioFlowKey({
      fromRoleId: preview.sourceRoleId,
      eventType: preview.eventType,
      toRoleId: preview.targetRoleId
    });
    return this.graph.getEdges().some((edge) => {
      if (this.isPendingEdgePreviewCell(edge)) {
        return false;
      }
      const data = edge.getData() as { studioEdge?: { source: string; target: string; eventType: string } } | undefined;
      return data?.studioEdge
        ? studioEdgeFlowKey(data.studioEdge) === previewFlowKey
        : false;
    });
  }

  private isPendingEdgePreviewCell(edge: ReturnType<Graph["getEdges"]>[number] | null | undefined): boolean {
    if (!edge) {
      return false;
    }
    if (edge.id === STUDIO_PENDING_EDGE_ID) {
      return true;
    }
    const data = edge.getData() as { studioPendingEdge?: unknown } | undefined;
    return Boolean(data?.studioPendingEdge);
  }

  private edgeRecordFromCell(cell: { getData(): unknown } | null | undefined): { studioEdge?: StudioGraphEdgeRecord } | undefined {
    return cell
      ? cell.getData() as { studioEdge?: StudioGraphEdgeRecord } | undefined
      : undefined;
  }

  private selectRoleById(roleId: string, node?: ReturnType<Graph["getNodes"]>[number]): void {
    const roleNode = node || this.graph.getCellById(roleId);
    if (!roleNode) {
      return;
    }
    // Once the user interacts, a delayed first-fit must not move the graph underneath the selection.
    this.clearPendingInitialFit();
    this.options.selectedRoleId = roleId;
    this.options.selectedFlowKey = "";
    this.graph.cleanSelection();
    this.graph.select(roleNode);
    this.options.onSelectRole?.(roleId);
    this.syncSelectionPresentation(roleId, { preserveViewport: true });
    this.updateToolbarState();
  }

  private selectEdge(edgeData: StudioGraphEdgeRecord, edge?: ReturnType<Graph["getEdges"]>[number]): void {
    const edgeCell = edge || this.graph.getEdges().find((candidate) => {
      const data = this.edgeRecordFromCell(candidate);
      return data?.studioEdge
        ? studioEdgeFlowKey(data.studioEdge) === studioEdgeFlowKey(edgeData)
        : false;
    });
    if (!edgeCell) {
      return;
    }
    this.clearPendingInitialFit();
    this.options.selectedRoleId = "";
    this.options.selectedFlowKey = studioEdgeFlowKey(edgeData);
    this.graph.cleanSelection();
    this.graph.select(edgeCell);
    this.options.onSelectFlow?.(studioEdgeFlowKey(edgeData));
    this.syncSelectionPresentation(edgeCell.id, { preserveViewport: true });
    this.updateToolbarState();
  }

  private showContextMenu(args: {
    x: number;
    y: number;
    state: StudioGraphContextMenuState;
  }): void {
    if (this.isReadOnly()) {
      return;
    }
    this.contextMenuState = args.state;
    const canDeleteRole = args.state.kind === "role"
      ? args.state.roleId !== this.options.authoring?.system.entryRoleId
      : Boolean(args.state.edge.editable);
    const items = args.state.kind === "role"
      ? [
          { action: "edit", label: "Edit", disabled: false },
          { action: "delete", label: "Delete", disabled: !canDeleteRole, destructive: true }
        ]
      : [
          { action: "edit", label: "Edit", disabled: args.state.edge.editable === false },
          { action: "insert-role", label: "Insert role", disabled: args.state.edge.editable === false },
          { action: "delete", label: "Delete", disabled: args.state.edge.editable === false, destructive: true }
        ];
    this.contextMenuEl.innerHTML = items.map((item) =>
      '<button type="button" class="studio-graph-context-menu-item' +
      (item.destructive ? " is-destructive" : "") +
      '" data-studio-graph-context-action="' + this.escapeHtml(item.action) + '"' +
      (item.disabled ? " disabled" : "") + ">" +
      this.escapeHtml(item.label) +
      "</button>"
    ).join("");
    this.contextMenuEl.hidden = false;
    const stageRect = this.stageEl.getBoundingClientRect();
    const menuWidth = this.contextMenuEl.offsetWidth;
    const menuHeight = this.contextMenuEl.offsetHeight;
    const left = Math.min(
      Math.max(10, args.x - stageRect.left + 6),
      Math.max(10, this.stageEl.clientWidth - menuWidth - 10)
    );
    const top = Math.min(
      Math.max(10, args.y - stageRect.top + 6),
      Math.max(10, this.stageEl.clientHeight - menuHeight - 10)
    );
    this.contextMenuEl.style.left = `${left}px`;
    this.contextMenuEl.style.top = `${top}px`;
  }

  private hideContextMenu(): void {
    this.contextMenuState = null;
    this.contextMenuEl.hidden = true;
    this.contextMenuEl.innerHTML = "";
  }

  private async handleContextMenuAction(action: string): Promise<void> {
    const state = this.contextMenuState;
    if (!state || this.isReadOnly()) {
      return;
    }
    if (state.kind === "role") {
      if (action === "edit") {
        this.openEditRoleForm(state.roleId);
        return;
      }
      if (action === "delete") {
        await this.deleteRole(state.roleId);
      }
      return;
    }
    if (action === "edit") {
      this.openEditEdgeForm(state.edge);
      return;
    }
    if (action === "delete") {
      await this.deleteEdge(state.edge);
      return;
    }
    if (action === "insert-role") {
      this.beginFlowRoleInsertion(state.edge);
    }
  }

  private async deleteRole(roleId: string): Promise<void> {
    if (roleId === this.options.authoring?.system.entryRoleId) {
      this.toast("error", this.label("entryRoleDeletionBlocked"));
      return;
    }
    if (window.confirm && !window.confirm(this.formatLabel("deleteRoleConfirm", { roleId }))) {
      return;
    }
    const rewire = this.roleAutoRewireCandidate(roleId);
    if (rewire) {
      await this.applyCommand(rewire.command);
      return;
    }
    await this.applyCommand({ type: "delete-role", roleId });
  }

  private async deleteEdge(edge: StudioGraphEdgeRecord): Promise<void> {
    if (edge.editable === false) {
      return;
    }
    await this.applyCommand({
      type: "delete-edge",
      flowId: edge.id,
      sourceRoleId: edge.source,
      targetRoleId: edge.target,
      eventType: edge.eventType
    });
  }

  private roleAutoRewireCandidate(roleId: string): { command: StudioAuthoringCommand } | null {
    const committedEdges = this.graph.getEdges()
      .filter((edge) => !this.isPendingEdgePreviewCell(edge))
      .map((edge) => this.edgeRecordFromCell(edge)?.studioEdge)
      .filter((edge): edge is StudioGraphEdgeRecord => Boolean(edge));
    const incoming = committedEdges.filter((edge) => edge.target === roleId);
    const outgoing = committedEdges.filter((edge) => edge.source === roleId);
    if (incoming.length !== 1 || outgoing.length !== 1) {
      return null;
    }
    const [incomingEdge] = incoming;
    const [outgoingEdge] = outgoing;
    if (incomingEdge.editable === false || outgoingEdge.editable === false) {
      return null;
    }
    if (incomingEdge.source === outgoingEdge.target) {
      return null;
    }
    if (incomingEdge.eventType !== outgoingEdge.eventType) {
      return null;
    }
    if (Boolean(incomingEdge.runtimeOnlyErrorFlow) !== Boolean(outgoingEdge.runtimeOnlyErrorFlow)) {
      return null;
    }
    const incomingLabel = (incomingEdge.label || "").trim();
    const outgoingLabel = (outgoingEdge.label || "").trim();
    if (incomingLabel && outgoingLabel && incomingLabel !== outgoingLabel) {
      return null;
    }
    return {
      command: {
        type: "batch",
        commands: [
          {
            type: "delete-edge",
            flowId: incomingEdge.id,
            sourceRoleId: incomingEdge.source,
            targetRoleId: incomingEdge.target,
            eventType: incomingEdge.eventType
          },
          {
            type: "delete-edge",
            flowId: outgoingEdge.id,
            sourceRoleId: outgoingEdge.source,
            targetRoleId: outgoingEdge.target,
            eventType: outgoingEdge.eventType
          },
          { type: "delete-role", roleId },
          {
            type: "add-edge",
            sourceRoleId: incomingEdge.source,
            targetRoleId: outgoingEdge.target,
            eventType: incomingEdge.eventType,
            label: incomingLabel || outgoingLabel || incomingEdge.eventType,
            runtimeOnlyErrorFlow: Boolean(incomingEdge.runtimeOnlyErrorFlow),
            participatesInJoin: Boolean(outgoingEdge.participatesInJoin)
          }
        ]
      }
    };
  }

  private beginFlowRoleInsertion(edge: StudioGraphEdgeRecord): void {
    if (edge.editable === false) {
      return;
    }
    const position = this.flowInsertionPosition(edge);
    this.openCommandForm("add-role");
    this.pendingRoleInsertion = {
      edge,
      x: position.x,
      y: position.y
    };
  }

  private flowInsertionPosition(edge: StudioGraphEdgeRecord): { x: number; y: number } {
    const sourceNode = this.graph.getCellById(edge.source);
    const targetNode = this.graph.getCellById(normalizeStudioGraphTargetRoleId(edge.target));
    const sourceBox = sourceNode?.isNode() ? sourceNode.getBBox() : null;
    const targetBox = targetNode?.isNode() ? targetNode.getBBox() : null;
    const sourceCenterX = sourceBox ? sourceBox.x + sourceBox.width / 2 : 210;
    const sourceCenterY = sourceBox ? sourceBox.y + sourceBox.height / 2 : 162;
    const targetCenterX = targetBox ? targetBox.x + targetBox.width / 2 : sourceCenterX + 220;
    const targetCenterY = targetBox ? targetBox.y + targetBox.height / 2 : sourceCenterY;
    return {
      x: Math.round((sourceCenterX + targetCenterX) / 2 - 90),
      y: Math.round((sourceCenterY + targetCenterY) / 2 - 42)
    };
  }

  private commandForInsertedRole(
    command: Extract<StudioAuthoringCommand, { type: "add-role" }>,
    insertion: PendingStudioRoleInsertion
  ): StudioAuthoringCommand {
    return {
      type: "batch",
      commands: [
        {
          ...command,
          x: insertion.x,
          y: insertion.y
        },
        {
          type: "delete-edge",
          flowId: insertion.edge.id,
          sourceRoleId: insertion.edge.source,
          targetRoleId: insertion.edge.target,
          eventType: insertion.edge.eventType
        },
        {
          type: "add-edge",
          sourceRoleId: insertion.edge.source,
          targetRoleId: command.roleId?.trim() || "",
          eventType: insertion.edge.eventType,
          label: insertion.edge.label,
          runtimeOnlyErrorFlow: Boolean(insertion.edge.runtimeOnlyErrorFlow),
          participatesInJoin: false
        },
        {
          type: "add-edge",
          sourceRoleId: command.roleId?.trim() || "",
          targetRoleId: insertion.edge.target,
          eventType: "DONE",
          participatesInJoin: Boolean(insertion.edge.participatesInJoin)
        }
      ]
    };
  }

  private applyRuntimeOverlay(): void {
    const runtime = this.runtimeVisualState;
    this.root.dataset.runtimeSignals = runtime?.hasRuntimeSignals ? "on" : "off";
    this.root.dataset.reducedMotion = this.reducedMotion ? "on" : "off";
    const canvas = this.canvasEl.querySelector<HTMLElement>(".x6-graph-svg");
    if (canvas) {
      canvas.dataset.runtimeSignals = runtime?.hasRuntimeSignals ? "on" : "off";
    }
    for (const node of this.graph.getNodes()) {
      const view = this.graph.findViewByCell(node);
      const container = view?.container as Element | undefined;
      if (!container) {
        continue;
      }
      const nodeState = runtime?.nodeStates.get(node.id);
      container.classList.toggle("is-runtime-active", Boolean(nodeState?.active));
      container.classList.toggle("is-runtime-waiting-review", Boolean(nodeState?.waitingReview));
      container.classList.toggle("has-human-gate", Boolean(nodeState?.humanGateConfigured));
      container.classList.toggle("has-loop-count", Boolean((nodeState?.loopCount || 0) > 1));
      if (nodeState?.status) {
        container.setAttribute("data-runtime-status", nodeState.status);
      } else {
        container.removeAttribute("data-runtime-status");
      }
      if (nodeState?.errorCode) {
        container.setAttribute("data-runtime-error-code", nodeState.errorCode);
      } else {
        container.removeAttribute("data-runtime-error-code");
      }
      if (nodeState?.loopCount && nodeState.loopCount > 1) {
        container.setAttribute("data-loop-count", String(nodeState.loopCount));
      } else {
        container.removeAttribute("data-loop-count");
      }
    }
    for (const edge of this.graph.getEdges()) {
      const view = this.graph.findViewByCell(edge);
      const container = view?.container as Element | undefined;
      if (!container) {
        continue;
      }
      container.classList.toggle("is-pending-preview", this.isPendingEdgePreviewCell(edge));
      const edgeState = runtime?.edgeStates.get(edge.id);
      container.classList.toggle("is-runtime-active", Boolean(edgeState?.active));
      container.classList.toggle("is-runtime-error", Boolean(edgeState?.error));
      container.classList.toggle("is-loop-back", Boolean(edgeState?.loopBack));
    }
  }

  private syncSelectionPresentation(preferredCellId = "", options: { preserveViewport?: boolean } = {}): void {
    const selectedId = preferredCellId || this.graph.getSelectedCells()[0]?.id || "";
    for (const cell of this.graph.getCells()) {
      const view = this.graph.findViewByCell(cell);
      const container = view?.container as Element | undefined;
      if (!container) {
        continue;
      }
      container.classList.toggle("is-selection-active", selectedId === cell.id);
      if (selectedId !== cell.id) {
        container.classList.remove("is-selection-focus-pulse");
      }
    }
    if (!selectedId || this.reducedMotion || this.focusMotionCellId === selectedId) {
      return;
    }
    this.focusMotionCellId = selectedId;
    const selectedCell = this.graph.getCellById(selectedId);
    if (!selectedCell) {
      return;
    }
    this.focusCell(selectedCell, { preserveViewport: options.preserveViewport === true });
    this.renderMinimap();
  }

  private focusCell(
    cell: ReturnType<Graph["getSelectedCells"]>[number],
    options: { preserveViewport?: boolean } = {}
  ): void {
    if (!cell) {
      return;
    }
    this.focusMotionCellId = cell.id;
    const selectedView = this.graph.findViewByCell(cell);
    const container = selectedView?.container as Element | undefined;
    if (!options.preserveViewport && this.shouldCenterSelectionInViewport(container)) {
      this.graph.centerCell(cell);
    }
    if (!container) {
      return;
    }
    container.classList.add("is-selection-focus-pulse");
    if (this.focusMotionTimer) {
      clearTimeout(this.focusMotionTimer);
    }
    this.focusMotionTimer = setTimeout(() => {
      container.classList.remove("is-selection-focus-pulse");
      if (this.focusMotionCellId === cell.id) {
        this.focusMotionCellId = "";
      }
      this.focusMotionTimer = null;
    }, 900);
  }

  private renderMinimap(): void {
    const allNodes = this.graph.getNodes();
    const roleNodes = allNodes.filter((node) => {
      const data = node.getData() as { studioNode?: { kind?: string } } | undefined;
      return data?.studioNode?.roleSeat === true;
    });
    if (!roleNodes.length) {
      this.minimapEl.hidden = true;
      this.minimapContentEl.innerHTML = "";
      return;
    }
    this.minimapEl.hidden = false;
    const metrics = allNodes.map((node) => {
      const data = node.getData() as { studioNode?: { kind?: string } } | undefined;
      const position = node.getPosition();
      const size = node.getSize();
      return {
        id: node.id,
        kind: data?.studioNode?.kind || "role",
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height
      };
    });
    const minX = Math.min(...metrics.map((item) => item.x));
    const minY = Math.min(...metrics.map((item) => item.y));
    const maxX = Math.max(...metrics.map((item) => item.x + item.width));
    const maxY = Math.max(...metrics.map((item) => item.y + item.height));
    const totalWidth = Math.max(maxX - minX, 1);
    const totalHeight = Math.max(maxY - minY, 1);
    const edgeLines = this.graph.getEdges().map((edge) => {
      const sourceNode = metrics.find((m) => m.id === edge.getSourceCellId());
      const targetNode = metrics.find((m) => m.id === edge.getTargetCellId());
      if (!sourceNode || !targetNode) return "";
      const x1 = ((sourceNode.x + sourceNode.width - minX) / totalWidth) * 100;
      const y1 = ((sourceNode.y + sourceNode.height / 2 - minY) / totalHeight) * 100;
      const x2 = ((targetNode.x - minX) / totalWidth) * 100;
      const y2 = ((targetNode.y + targetNode.height / 2 - minY) / totalHeight) * 100;
      return '<line x1="' + x1.toFixed(2) + '" y1="' + y1.toFixed(2) + '" x2="' + x2.toFixed(2) + '" y2="' + y2.toFixed(2) + '" />';
    }).filter(Boolean);
    const nodeHtml = metrics.map((item) => {
      const left = ((item.x - minX) / totalWidth) * 100;
      const top = ((item.y - minY) / totalHeight) * 100;
      const width = Math.max((item.width / totalWidth) * 100, 5);
      const height = Math.max((item.height / totalHeight) * 100, 8);
      const selected = this.options.selectedRoleId === item.id;
      const kindClass = item.kind === "boundary" ? " is-boundary" : "";
      return '<div class="studio-graph-minimap-node' + kindClass + (selected ? " is-selected" : "") +
        '" data-minimap-role-id="' + this.escapeHtml(item.id) +
        '" style="left:' + left.toFixed(3) + "%;top:" + top.toFixed(3) + "%;width:" + width.toFixed(3) + "%;height:" + height.toFixed(3) + '%"></div>';
    }).join("");
    const svgHtml = edgeLines.length
      ? '<svg class="studio-graph-minimap-edges" viewBox="0 0 100 100" preserveAspectRatio="none">' + edgeLines.join("") + '</svg>'
      : "";
    this.minimapContentEl.innerHTML = svgHtml + nodeHtml;
    const translate = this.graph.translate();
    const scale = this.graph.zoom();
    const viewportWidth = Math.max(this.canvasEl.clientWidth, 1);
    const viewportHeight = Math.max(this.canvasEl.clientHeight, 1);
    const viewportBoxWidth = Math.max(10, Math.min((viewportWidth / scale / totalWidth) * 100, 100));
    const viewportBoxHeight = Math.max(10, Math.min((viewportHeight / scale / totalHeight) * 100, 100));
    const viewportLeft = Math.max(0, Math.min(((-translate.tx - minX) / totalWidth) * 100, 100 - viewportBoxWidth));
    const viewportTop = Math.max(0, Math.min(((-translate.ty - minY) / totalHeight) * 100, 100 - viewportBoxHeight));
    this.minimapViewportEl.style.left = `${viewportLeft}%`;
    this.minimapViewportEl.style.top = `${viewportTop}%`;
    this.minimapViewportEl.style.width = `${viewportBoxWidth}%`;
    this.minimapViewportEl.style.height = `${viewportBoxHeight}%`;
  }

  private shouldCenterSelectionInViewport(container: Element | undefined): boolean {
    if (!container || typeof (container as HTMLElement).getBoundingClientRect !== "function") {
      return false;
    }
    const stageRect = this.stageEl.getBoundingClientRect();
    const cellRect = (container as HTMLElement).getBoundingClientRect();
    if (
      stageRect.width <= 0 ||
      stageRect.height <= 0 ||
      cellRect.width <= 0 ||
      cellRect.height <= 0
    ) {
      return false;
    }
    const margin = 24;
    const withinHorizontalViewport =
      cellRect.left >= stageRect.left + margin &&
      cellRect.right <= stageRect.right - margin;
    const withinVerticalViewport =
      cellRect.top >= stageRect.top + margin &&
      cellRect.bottom <= stageRect.bottom - margin;
    return !(withinHorizontalViewport && withinVerticalViewport);
  }

  private detectReducedMotion(): boolean {
    try {
      return Boolean(typeof window !== "undefined"
        && typeof window.matchMedia === "function"
        && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    } catch {
      return false;
    }
  }
}
