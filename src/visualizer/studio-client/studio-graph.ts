import { Graph } from "@antv/x6";
import { History } from "@antv/x6-plugin-history";
import { Keyboard } from "@antv/x6-plugin-keyboard";
import { Selection } from "@antv/x6-plugin-selection";
import dagre from "dagre";

import type { StudioAuthoringDocument, StudioCanvasDocument } from "../studio-contracts.js";
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
import { canvasToStudioGraphProjection, graphToCanvasDocument, studioEdgeFlowKey } from "./studio-graph-adapter.js";
import { applyStudioAuthoringCommand, type StudioAuthoringCommand } from "./studio-graph-commands.js";
import { renderStudioGraphProjection } from "./studio-graph-render.js";
import {
  deriveStudioRuntimeVisualState,
  type StudioRuntimeVisualState
} from "./studio-graph-runtime.js";
import { canConnectStudioCells } from "./studio-graph-rules.js";

type StudioGraphLabelKey =
  | "viewportGroup"
  | "editGroup"
  | "zoomOut"
  | "zoomIn"
  | "resetView"
  | "fullscreen"
  | "fitView"
  | "autoLayout"
  | "generate"
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
  | "editBlocked";

export type StudioGraphLabels = Partial<Record<StudioGraphLabelKey, string>>;

export type StudioGraphBridgeOptions = {
  authoring?: StudioAuthoringDocument | null;
  canvas?: StudioCanvasDocument | null;
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
  onApplyCanvas?: (canvas: StudioCanvasDocument) => void | Promise<void>;
  onApplyCommand?: (result: {
    authoring: StudioAuthoringDocument;
    canvas: StudioCanvasDocument;
    selectedRoleId?: string;
    selectedFlowKey?: string;
    blockedCode?: string;
  }) => void | Promise<void>;
  onChatGenerate?: () => void | Promise<void>;
  historyEvent?: { id?: number; kind?: "push-before-replace"; label?: string } | null;
  onToggleFullscreen?: () => void;
  onValidateWorkbench?: () => void | Promise<void>;
  onSaveWorkbench?: () => void | Promise<void>;
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
  canvas: StudioCanvasDocument;
  selectedRoleId?: string;
  selectedFlowKey?: string;
};

const sharedHistory: {
  projectKey: string;
  undoStack: StudioGraphSnapshot[];
  redoStack: StudioGraphSnapshot[];
} = {
  projectKey: "",
  undoStack: [],
  redoStack: []
};

export class StudioGraphIsland {
  private graph: Graph;
  private toolbar: HTMLDivElement;
  private stageEl: HTMLDivElement;
  private canvasEl: HTMLDivElement;
  private emptyEl: HTMLDivElement;
  private dialogEl: HTMLElement;
  private fallbackDialogEl: HTMLDivElement;
  private options: StudioGraphBridgeOptions = {};
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
  private runtimeVisualState: StudioRuntimeVisualState | null = null;
  private focusMotionTimer: ReturnType<typeof setTimeout> | null = null;
  private focusMotionCellId = "";
  private reducedMotion = false;
  private readonly delegatedCommandFormSubmitListener = (event: Event) => this.handleDelegatedCommandFormSubmit(event);
  private readonlyHistory: { undoStack: StudioGraphSnapshot[]; redoStack: StudioGraphSnapshot[] } = {
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
      '</div>',
      '<div class="studio-graph-toolbar-group" data-studio-graph-generate-actions aria-label="' + this.escapeHtml(this.label("generate")) + '">',
      this.toolbarButton("chat-generate", "generate", "✦"),
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
      '</div>'
    ].join("");
    const toolbar = this.root.querySelector<HTMLDivElement>(".studio-graph-toolbar");
    const stageEl = this.root.querySelector<HTMLDivElement>(".studio-graph-stage");
    const canvasEl = this.root.querySelector<HTMLDivElement>("[data-studio-graph-canvas]");
    const emptyEl = this.root.querySelector<HTMLDivElement>("[data-studio-graph-empty]");
    if (!toolbar || !stageEl || !canvasEl || !emptyEl) {
      throw new Error("Studio graph island failed to initialize.");
    }
    this.toolbar = toolbar;
    this.stageEl = stageEl;
    this.canvasEl = canvasEl;
    this.emptyEl = emptyEl;
    this.fallbackDialogEl = document.createElement("div");
    this.fallbackDialogEl.hidden = true;
    this.fallbackDialogEl.className = "studio-command-dialog";
    this.stageEl.appendChild(this.fallbackDialogEl);
    this.dialogEl = this.fallbackDialogEl;
    this.graph = this.createGraph(canvasEl);
    this.bindToolbar();
    this.bindGraphEvents();
    this.root.addEventListener("keydown", (event) => this.handleRootKeydown(event));
    // Command forms can be mounted in a sibling host outside `root`, so use a document-level
    // submit fallback to prevent accidental native navigation during rapid host swaps.
    document.addEventListener("submit", this.delegatedCommandFormSubmitListener, true);
    this.reducedMotion = this.detectReducedMotion();
    this.updateToolbarState();
  }

  update(options: StudioGraphBridgeOptions): void {
    this.resetHistoryWhenProjectChanges(options);
    this.options = options;
    this.attachCommandFormHost();
    this.handleHistoryEvent(options.historyEvent);
    this.handleDismissCommandFormRequest(options.dismissCommandFormRequest);
    const projection = canvasToStudioGraphProjection({
      authoring: options.authoring,
      canvas: options.canvas,
      validation: options.validation
    });
    if (!options.authoring) {
      this.applying = true;
      try {
        this.graph.clearCells();
      } finally {
        this.applying = false;
      }
      this.hasRenderedProjection = false;
      this.setEmptyState(true, projection.validation.diagnostics.length > 0
        ? this.label("fixMermaidBeforeGraphEditing")
        : this.label("noRolesAvailable"));
      this.closeCommandForm();
      this.setStatus(this.label("graphUnavailable"));
      this.setBusy(true);
      return;
    }
    this.setEmptyState(false);
    this.applying = true;
    try {
      renderStudioGraphProjection(this.graph, projection);
      this.runtimeVisualState = deriveStudioRuntimeVisualState({
        authoring: options.authoring,
        projection,
        readOnly: options.readOnly === true
      });
      const autoLayoutApplied = this.applyDefaultAutoLayout();
      if (!autoLayoutApplied) {
        this.restoreViewport(options.canvas?.viewport, !this.hasRenderedProjection);
      }
      this.selectFromOptions();
      this.applyRuntimeOverlay();
      this.syncSelectionPresentation();
      this.openRequestedSelectionEditor();
      this.hasRenderedProjection = true;
    } finally {
      this.applying = false;
    }
    this.setStatus(this.label("graphReady"));
    this.setBusy(Boolean(options.busy));
  }

  dispose(): void {
    if (this.syncCanvasTimer) {
      clearTimeout(this.syncCanvasTimer);
      this.syncCanvasTimer = null;
    }
    if (this.focusMotionTimer) {
      clearTimeout(this.focusMotionTimer);
      this.focusMotionTimer = null;
    }
    document.removeEventListener("submit", this.delegatedCommandFormSubmitListener, true);
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
        validateConnection: ({ sourceCell, targetCell }) => !this.isReadOnly() && canConnectStudioCells(sourceCell, targetCell)
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
      if (action === "reset-view") void this.resetViewAndSync();
      if (action === "fullscreen") this.options.onToggleFullscreen?.();
      if (action === "chat-generate") void this.options.onChatGenerate?.();
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

  private bindGraphEvents(): void {
    this.graph.on("node:click", ({ node }) => {
      const data = node.getData() as { studioNode?: { kind?: string; roleId?: string } } | undefined;
      if (data?.studioNode?.kind === "role" && data.studioNode.roleId) {
        this.options.onSelectRole?.(data.studioNode.roleId);
        this.syncSelectionPresentation(data.studioNode.roleId, { preserveViewport: true });
        this.openEditRoleForm(data.studioNode.roleId);
        this.updateToolbarState();
      }
    });
    this.graph.on("edge:click", ({ edge }) => {
      const data = edge.getData() as { studioEdge?: { id?: string; source: string; target: string; eventType: string; runtimeOnlyErrorFlow?: boolean; participatesInJoin?: boolean; editable?: boolean } } | undefined;
      if (data?.studioEdge) {
        this.options.onSelectFlow?.(studioEdgeFlowKey(data.studioEdge));
        this.syncSelectionPresentation(data.studioEdge.id || "", { preserveViewport: true });
        this.openEditEdgeForm(data.studioEdge);
        this.updateToolbarState();
      }
    });
    this.graph.on("blank:click", () => {
      if (this.options.onBeforeClearSelection?.() === false) {
        return;
      }
      this.graph.cleanSelection();
      this.options.onClearSelection?.();
      this.lastEditSelectionSignature = "";
      this.syncSelectionPresentation();
      this.updateToolbarState();
    });
    this.graph.on("selection:changed", () => {
      this.syncSelectionPresentation("", { preserveViewport: true });
      if (!this.applying) {
        this.openSelectedEditor();
      }
      this.updateToolbarState();
    });
    this.graph.on("node:moved", () => {
      if (this.isReadOnly()) return;
      this.scheduleSyncCanvas();
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

  private openRequestedSelectionEditor(): void {
    const request = Number(this.options.editSelectionRequest || 0);
    if (!request || request === this.lastHandledEditSelectionRequest || this.isReadOnly()) {
      return;
    }
    this.lastHandledEditSelectionRequest = request;
    const selected = this.graph.getSelectedCells()[0];
    const data = selected?.getData() as {
      studioNode?: { kind?: string; roleId?: string };
      studioEdge?: { id?: string; source: string; target: string; eventType: string; runtimeOnlyErrorFlow?: boolean; participatesInJoin?: boolean; editable?: boolean };
    } | undefined;
    if (data?.studioNode?.kind === "role" && data.studioNode.roleId) {
      this.openEditRoleForm(data.studioNode.roleId);
      return;
    }
    if (data?.studioEdge) {
      this.openEditEdgeForm(data.studioEdge);
    }
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
    if (data?.studioNode?.kind === "role" && data.studioNode.roleId) {
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
    this.commandForm = null;
    this.dialogEl.hidden = true;
    this.dialogEl.innerHTML = "";
    this.notifyCommandFormState();
  }

  private renderCommandForm(): void {
    if (!this.commandForm) {
      this.closeCommandForm();
      return;
    }
    this.dialogEl.hidden = false;
    this.dialogEl.innerHTML = renderStudioCommandForm({
      state: this.commandForm,
      context: this.validationContext(),
      labels: this.options.commandFormLabels
    });
    this.notifyCommandFormState();
    this.bindCommandForm();
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
      return;
    }
    this.dialogEl.innerHTML = renderStudioCommandForm({
      state: this.commandForm,
      context: this.validationContext(),
      labels: this.options.commandFormLabels
    });
    this.bindCommandForm();
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
    this.closeCommandForm();
    await this.applyCommand(command);
  }

  private selectFromOptions(): void {
    const roleId = this.options.selectedRoleId || "";
    const flowKey = this.options.selectedFlowKey || "";
    const current = this.graph.getSelectedCells()[0];
    const currentData = current?.getData() as {
      studioNode?: { kind?: string; roleId?: string };
      studioEdge?: { source: string; target: string; eventType: string };
    } | undefined;
    const currentRoleId = currentData?.studioNode?.kind === "role" ? currentData.studioNode.roleId || "" : "";
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
    viewport: StudioCanvasDocument["viewport"] | undefined,
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
      this.graph.zoomTo(viewport.zoom);
      this.graph.translate(viewport.x, viewport.y);
      this.lastViewportSignature = signature;
      return;
    }
    if (firstRender && !viewport) {
      setTimeout(() => {
        this.graph.zoomToFit({ padding: 28, maxScale: 1 });
      }, 0);
    }
  }

  private selectedRoleId(): string {
    const selected = this.graph.getSelectedCells()[0];
    const data = selected?.getData() as { studioNode?: { kind?: string; roleId?: string } } | undefined;
    return data?.studioNode?.kind === "role" ? data.studioNode.roleId || "" : this.options.selectedRoleId || "";
  }

  private async deleteSelection(): Promise<void> {
    if (this.isReadOnly()) {
      return;
    }
    const selected = this.graph.getSelectedCells()[0];
    if (!selected) return;
    const nodeData = selected.getData() as { studioNode?: { kind?: string; roleId?: string } } | undefined;
    if (nodeData?.studioNode?.kind === "role" && nodeData.studioNode.roleId) {
      if (nodeData.studioNode.roleId === this.options.authoring?.system.entryRoleId) {
        this.toast("error", this.label("entryRoleDeletionBlocked"));
        return;
      }
      if (window.confirm && !window.confirm(this.formatLabel("deleteRoleConfirm", { roleId: nodeData.studioNode.roleId }))) {
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
    this.applyAutoLayout();
    await this.syncCanvas();
  }

  private applyDefaultAutoLayout(): boolean {
    if (!this.options.defaultAutoLayout) {
      return false;
    }
    const signature = this.defaultAutoLayoutSignature();
    if (!signature || (!this.isReadOnly() && this.hasRenderedProjection) || this.lastDefaultAutoLayoutSignature === signature) {
      return false;
    }
    this.applyAutoLayout();
    this.lastDefaultAutoLayoutSignature = signature;
    return true;
  }

  private defaultAutoLayoutSignature(): string {
    const nodes = this.graph.getNodes()
      .map((node) => node.id)
      .sort();
    const edges = this.graph.getEdges()
      .map((edge) => `${edge.getSourceCellId() || ""}->${edge.getTargetCellId() || ""}`)
      .sort();
    return nodes.length ? `${nodes.join(",")}|${edges.join(",")}` : "";
  }

  private applyAutoLayout(): void {
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
  }

  private async syncCanvas(): Promise<void> {
    if (this.applying || this.isReadOnly() || !this.options.canvas) {
      return;
    }
    const nextCanvas = graphToCanvasDocument(this.graph, this.options.canvas);
    if (this.sameCanvas(nextCanvas, this.options.canvas)) {
      return;
    }
    this.pushUndoSnapshot();
    this.applying = true;
    try {
      await this.options.onApplyCanvas?.(nextCanvas);
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

  private async applyCommand(command: StudioAuthoringCommand): Promise<void> {
    if (this.isReadOnly() || !this.options.authoring || !this.options.canvas) {
      this.toast("error", this.label("editBlocked"));
      return;
    }
    const result = applyStudioAuthoringCommand({
      authoring: this.options.authoring,
      canvas: graphToCanvasDocument(this.graph, this.options.canvas),
      command
    });
    if (result.blockedCode) {
      this.toast("error", this.blockedMessage(result.blockedCode));
      return;
    }
    this.pushUndoSnapshot();
    const nextSelectedRoleId = result.selectedRoleId || this.selectedRoleId();
    const nextSelectedFlowKey = result.selectedFlowKey || this.options.selectedFlowKey || "";
    // Keep local authoring/canvas in sync immediately so chained edits do not depend on the
    // outer visualizer state round-tripping first.
    this.options.authoring = result.authoring;
    this.options.canvas = result.canvas;
    await this.options.onApplyCommand?.(result);
    if (!this.isReadOnly() && result.authoring && result.canvas) {
      this.options.selectedRoleId = nextSelectedRoleId;
      this.options.selectedFlowKey = nextSelectedFlowKey;
      this.applyRuntimeOverlay();
      this.selectFromOptions();
      this.syncSelectionPresentation(nextSelectedRoleId || nextSelectedFlowKey);
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
    const current = this.currentSnapshot();
    if (current) {
      this.activeRedoStack().push(current);
    }
    await this.applySnapshot(previous);
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
    const current = this.currentSnapshot();
    if (current) {
      this.activeUndoStack().push(current);
    }
    await this.applySnapshot(next);
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

  private pushUndoSnapshot(): void {
    if (this.isReadOnly()) return;
    const snapshot = this.currentSnapshot();
    if (!snapshot) return;
    this.activeUndoStack().push(snapshot);
    if (this.activeUndoStack().length > 40) {
      this.activeUndoStack().shift();
    }
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
    const selectedRole = selectedData?.studioNode?.kind === "role";
    const selectedEditable = selectedRole || selectedData?.studioEdge?.editable === true;
    const editActions = this.toolbar.querySelector<HTMLElement>("[data-studio-graph-edit-actions]");
    if (editActions) {
      editActions.hidden = readOnly;
    }
    const layout = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="layout"]');
    if (layout) {
      layout.hidden = readOnly;
    }
    const generate = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="chat-generate"]');
    if (generate) {
      generate.hidden = readOnly;
      generate.disabled = this.busy || readOnly;
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

  private activeUndoStack(): StudioGraphSnapshot[] {
    return this.isReadOnly() ? this.readonlyHistory.undoStack : sharedHistory.undoStack;
  }

  private activeRedoStack(): StudioGraphSnapshot[] {
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

  private sameCanvas(left: StudioCanvasDocument, right: StudioCanvasDocument): boolean {
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
    const selectedView = this.graph.findViewByCell(selectedCell);
    const container = selectedView?.container as Element | undefined;
    if (!options.preserveViewport && selectedCell.isNode() && this.shouldCenterSelectionInViewport(container)) {
      this.graph.centerCell(selectedCell);
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
      if (this.focusMotionCellId === selectedId) {
        this.focusMotionCellId = "";
      }
      this.focusMotionTimer = null;
    }, 900);
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
