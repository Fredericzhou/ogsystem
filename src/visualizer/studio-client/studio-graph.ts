import { Export, Graph, History, Keyboard, Selection } from "@antv/x6";

import {
  normalizeStudioGraphTargetRoleId,
  STUDIO_SYSTEM_END_ROLE_ID,
  studioFlowKey
} from "../studio-contracts.js";
import type {
  GraphViewModel,
  GraphViewModelNode,
  StudioAuthoringDocument,
  StudioGraphSnapshot as StudioCanvasSnapshot
} from "../studio-contracts.js";
import { buildGraphViewModel, type BuildGraphViewModelArgs } from "../graph-view-model.js";
import {
  commandFromStudioCommandFormState,
  createDefaultStudioCommandFormState,
  defaultStudioFlowEventType,
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
  isStudioLayoutBundleEdge,
  isStudioLayoutJunction,
  renderStudioGraphViewModel,
  studioNodePortId,
  studioSccGroupMembers,
  studioSccGroupPreviousPosition
} from "./studio-graph-render.js";
import { createElkLayoutProjection } from "./elk-layout-adapter.js";
import {
  createStoredLayoutProjection,
  STUDIO_NODE_EDGE_CLEARANCE,
  type LayoutProjection,
  type StudioLayoutMode
} from "./semantic-layout-projection.js";
import {
  deriveStudioRuntimeVisualState,
  type StudioRuntimeEdgeState,
  type StudioRuntimeHandoffState,
  type StudioRuntimeNodeState,
  type StudioRuntimeProgressEvent,
  type StudioRuntimeVisualState
} from "./studio-graph-runtime.js";
import { validateStudioConnectionCells } from "./studio-graph-rules.js";

type StudioGraphLabelKey =
  | "viewportGroup"
  | "editGroup"
  | "teamConfiguration"
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
  | "technicalDetails"
  | "enabled"
  | "disabled"
  | "layoutSwitched"
  | "generate"
  | "debugRun"
  | "close"
  | "debugRunShort"
  | "quickOpen"
  | "quickOpenPlaceholder"
  | "quickOpenEmpty"
  | "quickOpenRole"
  | "quickOpenFlow"
  | "contextEditRole"
  | "contextPinRole"
  | "contextUnpinRole"
  | "contextEditFlow"
  | "contextInsertRole"
  | "contextDelete"
  | "minimap"
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
  | "boundaryEnd"
  | "exportPng";

export type StudioGraphLabels = Partial<Record<StudioGraphLabelKey, string>>;

export type StudioGraphBridgeOptions = {
  mode?: "product-edit" | "vis-edit" | "run-diagnosis";
  initialLayoutMode?: StudioLayoutMode;
  defaultAutoLayoutRequestId?: number;
  authoring?: StudioAuthoringDocument | null;
  canvas?: StudioCanvasSnapshot | null;
  viewModel?: GraphViewModel | null;
  /** Runtime fields to overlay while keeping the editable Studio projection. */
  runtimeViewModel?: GraphViewModel | null;
  runtimeProgress?: readonly StudioRuntimeProgressEvent[];
  presentation?: BuildGraphViewModelArgs["presentation"];
  validation?: { ok?: unknown; diagnostics?: unknown } | null;
  selectedRoleId?: string;
  selectedFlowKey?: string;
  historyContext?: unknown;
  editSelectionRequest?: number;
  defaultAutoLayout?: boolean;
  showTopologyOrder?: boolean;
  showTechnicalDetails?: boolean;
  busy?: boolean;
  readOnly?: boolean;
  rolePackages?: unknown;
  bindings?: unknown;
  readiness?: unknown;
  projectConfig?: unknown;
  onSelectRole?: (roleId: string) => void;
  onSelectFlow?: (flowKey: string) => void;
  onOpenTeamAssets?: () => void;
  onClearSelection?: () => void;
  viewport?: StudioCanvasSnapshot["viewport"];
  onViewportChange?: (viewport: NonNullable<StudioCanvasSnapshot["viewport"]>) => void;
  onApplyCanvas?: (canvas: StudioCanvasSnapshot) => void | Promise<void>;
  onApplyCommand?: (result: {
    authoring: StudioAuthoringDocument;
    canvas: StudioCanvasSnapshot;
    selectedRoleId?: string;
    selectedFlowKey?: string;
    historyContext?: unknown;
    blockedCode?: string;
  }) => void | Promise<void>;
  onChatGenerate?: () => void | Promise<void>;
  onOpenDebug?: () => void | Promise<void>;
  historyEvent?: { id?: number; kind?: "push-before-replace"; label?: string } | null;
  onToggleFullscreen?: () => void;
  onValidateWorkbench?: () => void | Promise<void>;
  onSaveWorkbench?: () => void | Promise<void>;
  onDebugRunInput?: (input: string) => boolean | Promise<boolean>;
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
  historyContext?: unknown;
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

function runtimeEdgeKey(edge: Pick<GraphViewModel, "edges">["edges"][number]): string {
  return `${edge.source}:${edge.eventType}:${edge.target}`;
}

function overlayRuntimeViewModel(base: GraphViewModel, runtime: GraphViewModel | null | undefined): GraphViewModel {
  if (!runtime) {
    return base;
  }
  const runtimeNodesById = new Map(runtime.nodes.map((node) => [node.id, node]));
  const runtimeEdgesById = new Map(runtime.edges.map((edge) => [edge.id, edge]));
  const runtimeEdgesByKey = new Map(runtime.edges.map((edge) => [runtimeEdgeKey(edge), edge]));
  return {
    ...base,
    nodes: base.nodes.map((node) => {
      const runtimeNode = runtimeNodesById.get(node.id);
      return runtimeNode?.runtime ? { ...node, runtime: runtimeNode.runtime } : node;
    }),
    edges: base.edges.map((edge) => {
      const runtimeEdge = runtimeEdgesById.get(edge.id) ?? runtimeEdgesByKey.get(runtimeEdgeKey(edge));
      return runtimeEdge?.runtime ? { ...edge, runtime: runtimeEdge.runtime } : edge;
    })
  };
}

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

function runtimeStatusLabel(status: StudioRuntimeNodeState["status"], locale: string): string {
  const labels = locale.startsWith("en")
    ? { running: "Working", waiting: "Waiting", waiting_review: "Review", failed: "Failed", done: "Completed", paused: "Paused", pending: "Task accepted", idle: "Idle", active: "Working", stopped: "Stopped" }
    : { running: "工作中", waiting: "等待中", waiting_review: "审核中", failed: "失败", done: "已完成", paused: "已暂停", pending: "接受任务", idle: "空闲", active: "工作中", stopped: "已停止" };
  return status ? labels[status] || "" : "";
}

function runtimeTechnicalWaitingLabel(stage: string | undefined, locale: string): string {
  if (locale.startsWith("en")) {
    return stage === "cli_tool" ? "Working (Tool)" : "Working";
  }
  return stage === "cli_tool" ? "调用工具中" : "工作中";
}

function syncRuntimeActivityMarker(args: {
  container: Element;
  width: number;
  height: number;
  state?: StudioRuntimeNodeState;
}): void {
  const state = args.state;
  const visible = Boolean(state?.active || state?.waitingReview);
  let group = args.container.querySelector<SVGGElement>(".studio-runtime-activity");
  if (!visible) {
    group?.remove();
    return;
  }
  if (!group) {
    group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("studio-runtime-activity");
    const ring = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    ring.classList.add("studio-runtime-activity-ring");
    ring.setAttribute("rx", "10");
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.classList.add("studio-runtime-activity-dot");
    group.append(ring, dot);
    args.container.append(group);
  }
  const ring = group.querySelector<SVGRectElement>(".studio-runtime-activity-ring");
  const dot = group.querySelector<SVGCircleElement>(".studio-runtime-activity-dot");
  if (!ring || !dot) return;
  group.dataset.mode = state?.waitingReview ? "review" : state?.technicalWaiting ? "technical" : "running";
  ring.setAttribute("x", "-5");
  ring.setAttribute("y", "-5");
  ring.setAttribute("width", String(args.width + 10));
  ring.setAttribute("height", String(args.height + 10));
  dot.setAttribute("cx", String(Math.max(8, args.width - 9)));
  dot.setAttribute("cy", "9");
  dot.setAttribute("r", "3.5");
}

type StudioRuntimeIconStatus = NonNullable<StudioRuntimeNodeState["status"]> | "technical_waiting";

function runtimeIconStatus(state?: StudioRuntimeNodeState): StudioRuntimeIconStatus | "" {
  if (!state) return "";
  if (state.technicalWaiting) return "technical_waiting";
  if (state.status) return state.status;
  return state.active ? "running" : "";
}

function createRuntimeStatusIconShape(status: StudioRuntimeIconStatus): SVGElement {
  const shape = document.createElementNS("http://www.w3.org/2000/svg", status === "running" ? "g" : "path");
  shape.classList.add("studio-runtime-status-icon-shape");
  if (status === "running") {
    const radar = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    radar.setAttribute("cx", "9");
    radar.setAttribute("cy", "9");
    radar.setAttribute("r", "5.2");
    radar.classList.add("studio-runtime-status-icon-radar");
    const core = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    core.setAttribute("cx", "9");
    core.setAttribute("cy", "9");
    core.setAttribute("r", "2");
    core.classList.add("studio-runtime-status-icon-core");
    shape.append(radar, core);
    return shape;
  }
  const pathByStatus: Record<Exclude<StudioRuntimeIconStatus, "running">, string> = {
    technical_waiting: "M5 3.5h8M5 14.5h8M6 4.5c0 2.2 2.5 2.5 2.5 4.5S6 11.3 6 13.5M12 4.5c0 2.2-2.5 2.5-2.5 4.5s2.5 2.3 2.5 4.5",
    waiting: "M5 3.5h8M5 14.5h8M6 4.5c0 2.2 2.5 2.5 2.5 4.5S6 11.3 6 13.5M12 4.5c0 2.2-2.5 2.5-2.5 4.5s2.5 2.3 2.5 4.5",
    waiting_review: "M3 9c1.7-3 3.7-4.5 6-4.5s4.3 1.5 6 4.5c-1.7 3-3.7 4.5-6 4.5S4.7 12 3 9zm6 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4z",
    done: "M5.5 9.2 7.8 11.5 12.8 6.5",
    failed: "M6 6l6 6M12 6l-6 6",
    stopped: "M6 5v8M12 5v8",
    paused: "M6 5v8M12 5v8",
    pending: "M9 4.5v4.8l3.1 1.8",
    idle: "M9 9m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0",
    active: "M9 2.5v3M9 12.5v3M2.5 9h3M12.5 9h3"
  };
  shape.setAttribute("d", pathByStatus[status]);
  return shape;
}

function syncRuntimeStatusIcon(args: {
  container: Element;
  width: number;
  state?: StudioRuntimeNodeState;
}): void {
  const status = runtimeIconStatus(args.state);
  let group = args.container.querySelector<SVGGElement>(".studio-runtime-status-icon");
  if (!status) {
    group?.remove();
    return;
  }
  if (!group) {
    group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("studio-runtime-status-icon");
    args.container.append(group);
  }
  if (group.dataset.status !== status) {
    group.replaceChildren();
    const background = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    background.classList.add("studio-runtime-status-icon-bg");
    background.setAttribute("cx", "9");
    background.setAttribute("cy", "9");
    background.setAttribute("r", "8.5");
    group.append(background, createRuntimeStatusIconShape(status));
    group.dataset.status = status;
    group.setAttribute("aria-hidden", "true");
  }
  group.setAttribute("transform", `translate(${Math.max(9, args.width - 24)} 6)`);
}

function syncRuntimeHandoffMarkers(args: {
  container: Element;
  edgeState?: StudioRuntimeEdgeState;
  handoffs: readonly StudioRuntimeHandoffState[];
}): void {
  const handoffs = args.handoffs;
  const activeCount = args.edgeState?.activeHandoffCount || handoffs.filter((handoff) => handoff.status === "active").length;
  const waitingCount = args.edgeState?.waitingHandoffCount || handoffs.filter((handoff) => handoff.status === "waiting").length;
  if (handoffs.length === 0) {
    args.container.removeAttribute("data-runtime-handoff-count");
    args.container.removeAttribute("data-runtime-active-handoffs");
    args.container.removeAttribute("data-runtime-waiting-handoffs");
    args.container.querySelector(".studio-runtime-handoffs")?.remove();
    return;
  }
  args.container.setAttribute("data-runtime-handoff-count", String(handoffs.length));
  args.container.setAttribute("data-runtime-active-handoffs", String(activeCount));
  args.container.setAttribute("data-runtime-waiting-handoffs", String(waitingCount));
  let group = args.container.querySelector<SVGGElement>(".studio-runtime-handoffs");
  if (!group) {
    group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("studio-runtime-handoffs");
    group.setAttribute("aria-hidden", "true");
    args.container.append(group);
  }
  const path = args.container.querySelector<SVGPathElement>("path[marker-end], path.connection");
  const length = path && typeof path.getTotalLength === "function" ? path.getTotalLength() : 0;
  const visible = handoffs.slice(-4);
  group.replaceChildren();
  for (const [index, handoff] of visible.entries()) {
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    marker.classList.add("studio-runtime-handoff-marker", `is-${handoff.status}`);
    marker.dataset.handoffId = handoff.handoffId;
    marker.dataset.index = String(index);
    marker.setAttribute("r", handoff.status === "active" ? "3.2" : "2.6");
    if (length > 1 && path && typeof path.getPointAtLength === "function") {
      const point = path.getPointAtLength(length * ((index + 1) / (visible.length + 1)));
      marker.setAttribute("cx", String(point.x));
      marker.setAttribute("cy", String(point.y));
    } else {
      marker.setAttribute("cx", String((index + 1) * 10));
      marker.setAttribute("cy", "0");
    }
    marker.style.animationDelay = `${index * 120}ms`;
    group.append(marker);
  }
}

function syncRuntimeDataPackets(args: {
  container: Element;
  edgeId: string;
  active: boolean;
  waiting: boolean;
  handoffs: readonly StudioRuntimeHandoffState[];
}): void {
  const existing = args.container.querySelector<SVGGElement>(".studio-runtime-data-packets");
  if (!args.active || args.handoffs.length === 0) {
    existing?.remove();
    return;
  }
  const path = args.container.querySelector<SVGPathElement>("path.connection, path[marker-end]");
  if (!path) return;
  const pathId = `ogs-runtime-edge-${args.edgeId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  path.id = pathId;
  const group = existing || document.createElementNS("http://www.w3.org/2000/svg", "g");
  group.classList.add("studio-runtime-data-packets");
  group.setAttribute("aria-hidden", "true");
  if (!existing) args.container.append(group);
  group.replaceChildren();
  const packetCount = Math.min(3, Math.max(1, args.handoffs.length));
  for (let index = 0; index < packetCount; index += 1) {
    const packet = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    packet.classList.add("studio-runtime-data-packet");
    packet.setAttribute("r", index === 0 ? "3" : "2.1");
    const motion = document.createElementNS("http://www.w3.org/2000/svg", "animateMotion");
    motion.setAttribute("dur", `${1.15 + index * 0.16}s`);
    motion.setAttribute("begin", `${index * 0.32}s`);
    motion.setAttribute("repeatCount", "indefinite");
    motion.setAttribute("rotate", "auto");
    const mpath = document.createElementNS("http://www.w3.org/2000/svg", "mpath");
    mpath.setAttribute("href", `#${pathId}`);
    mpath.setAttributeNS("http://www.w3.org/1999/xlink", "xlink:href", `#${pathId}`);
    motion.append(mpath);
    packet.append(motion);
    group.append(packet);
  }
  group.dataset.waiting = String(args.waiting);
}

function syncRuntimeStatusBadge(args: {
  container: Element;
  width: number;
  height: number;
  node: GraphViewModelNode;
  state?: StudioRuntimeNodeState;
  locale: string;
}): void {
  const label = args.state?.technicalWaiting
    ? runtimeTechnicalWaitingLabel(args.state.technicalWaitingStage, args.locale)
    : runtimeStatusLabel(args.state?.status, args.locale);
  const failure = [args.state?.errorCode, args.state?.errorMessage].filter(Boolean).join(": ");
  const accessibleName = [args.node.label || args.node.roleId || args.node.id, label, failure].filter(Boolean).join(" · ");
  args.container.setAttribute("aria-label", accessibleName);
  let group = args.container.querySelector<SVGGElement>(".studio-runtime-status");
  if (!label) {
    group?.remove();
    return;
  }
  if (!group) {
    group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.classList.add("studio-runtime-status");
    const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    background.classList.add("studio-runtime-status-bg");
    background.setAttribute("rx", "4");
    const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    dot.classList.add("studio-status-live-dot");
    dot.setAttribute("r", "2.6");
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.classList.add("studio-runtime-status-label");
    text.setAttribute("text-anchor", "start");
    group.append(background, dot, text);
    args.container.append(group);
  }
  const text = group.querySelector<SVGTextElement>(".studio-runtime-status-label");
  const background = group.querySelector<SVGRectElement>(".studio-runtime-status-bg");
  const dot = group.querySelector<SVGCircleElement>(".studio-status-live-dot");
  if (!text || !background) return;
  group.dataset.status = args.state?.technicalWaiting ? "technical_waiting" : args.state?.status || "";
  text.textContent = label;
  const isEn = args.locale.startsWith("en");
  const textLen = label.length;
  const badgeWidth = Math.max(38, textLen * (isEn ? 6.2 : 11) + 20);
  background.setAttribute("x", "6");
  background.setAttribute("y", String(args.height - 21));
  background.setAttribute("width", String(badgeWidth));
  background.setAttribute("height", "16");
  if (dot) {
    dot.setAttribute("cx", "14");
    dot.setAttribute("cy", String(args.height - 13));
  }
  text.setAttribute("x", "21");
  text.setAttribute("y", String(args.height - 9));
}

function syncRuntimeMetricsPill(args: {
  container: Element;
  width: number;
  height: number;
  state?: StudioRuntimeNodeState;
  nodeId?: string;
  onShowHistory?: (nodeId: string, state: StudioRuntimeNodeState, event: MouseEvent) => void;
}): void {
  const parts: string[] = [];
  if (args.state?.durationMs) {
    const sec = (args.state.durationMs / 1000).toFixed(1);
    parts.push(`⏱ ${sec}s`);
  }
  if (args.state?.loopCount && args.state.loopCount > 1) {
    parts.push(`🔄 x${args.state.loopCount}`);
  }
  if (args.state?.totalTokens) {
    const kTok = (args.state.totalTokens / 1000).toFixed(1);
    parts.push(`⚡ ${kTok}k`);
  }
  let pillGroup = args.container.querySelector<SVGGElement>(".studio-runtime-metrics");
  if (!parts.length) {
    pillGroup?.remove();
    return;
  }
  const hasHistory = Boolean(args.state?.history && args.state.history.length > 1);
  if (hasHistory) parts.push("▾");
  const metricText = parts.join(" ");
  if (!pillGroup) {
    pillGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    pillGroup.classList.add("studio-runtime-metrics");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.classList.add("studio-runtime-metrics-bg");
    bg.setAttribute("rx", "4");
    bg.setAttribute("fill", "rgba(15, 23, 42, 0.85)");
    const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    txt.classList.add("studio-runtime-metrics-text");
    txt.setAttribute("font-size", "9.5");
    txt.setAttribute("fill", "#38bdf8");
    txt.setAttribute("font-family", "monospace");
    txt.setAttribute("y", "11");
    pillGroup.append(bg, txt);
    args.container.append(pillGroup);
  }
  const txt = pillGroup.querySelector<SVGTextElement>(".studio-runtime-metrics-text");
  const bg = pillGroup.querySelector<SVGRectElement>(".studio-runtime-metrics-bg");
  if (!txt || !bg) return;
  txt.textContent = metricText;
  const pillWidth = Math.max(30, metricText.length * 6.2 + 10);
  pillGroup.setAttribute("transform", `translate(${Math.max(68, args.width - pillWidth - 6)}, ${args.height - 21})`);
  bg.setAttribute("width", String(pillWidth));
  bg.setAttribute("height", "16");
  txt.setAttribute("x", "5");
  if (hasHistory) {
    pillGroup.style.cursor = "pointer";
    (pillGroup as any)._onHistoryClick = (event: MouseEvent) => {
      event.stopPropagation();
      if (args.nodeId && args.state && args.onShowHistory) {
        args.onShowHistory(args.nodeId, args.state, event);
      }
    };
    pillGroup.onclick = (pillGroup as any)._onHistoryClick;
  } else {
    pillGroup.style.cursor = "default";
    pillGroup.onclick = null;
  }
}

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
  private lastDefaultAutoLayoutRequestId = 0;
  private lastEditSelectionSignature = "";
  private lastHandledEditSelectionRequest = 0;
  private lastHandledDismissCommandFormRequest = 0;
  private lastHandledHistoryEventId = 0;
  private syncCanvasTimer: ReturnType<typeof setTimeout> | null = null;
  private minimapRefreshFrame: number | null = null;
  private commandForm: StudioCommandFormState | null = null;
  private pendingEdgePreview: PendingStudioEdgePreview | null = null;
  private relationshipSourceRoleId = "";
  private pendingRolePlaceholderId = "";
  private pendingRoleDraftPosition: { x: number; y: number } | null = null;
  private pendingRoleInsertion: PendingStudioRoleInsertion | null = null;
  private runtimeVisualState: StudioRuntimeVisualState | null = null;
  private runtimeProgressEvents: StudioRuntimeProgressEvent[] = [];
  private runtimeFocusedHandoffId = "";
  private contextMenuState: StudioGraphContextMenuState | null = null;
  private focusMotionTimer: ReturnType<typeof setTimeout> | null = null;
  private focusMotionCellId = "";
  private quickOpenSelectedIndex = 0;
  private reducedMotion = false;
  private resizeObserver: ResizeObserver | null = null;
  private pendingEdgeCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingInitialFit = false;
  private pendingInitialFitSizeSignature = "";
  private pendingInitialFitTimer: ReturnType<typeof setTimeout> | null = null;
  private layoutMode: StudioGraphLayoutMode = "flow";
  // Flow order is useful for reading a graph and should be visible on first render.
  private showTopologyOrder = true;
  private showTechnicalDetails = true;
  private syncingSccGroupDrag = false;
  private currentLayoutProjection: LayoutProjection | null = null;
  private updateGeneration = 0;
  private readonly delegatedCommandFormSubmitListener = (event: Event) => this.handleDelegatedCommandFormSubmit(event);
  private readonly rootKeydownListener = (event: KeyboardEvent) => this.handleRootKeydown(event);
  private readonly contextPointerDownListener = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null;
    if (!target?.closest("[data-studio-graph-context-menu]")) this.hideContextMenu();
  };
  private readonly contextPointerUpListener = () => this.schedulePendingEdgeCleanup();
  private readonly contextPointerLeaveListener = () => this.schedulePendingEdgeCleanup();
  private readonly rootContextMenuListener = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest("[data-studio-graph-context-menu]")) {
      event.preventDefault();
      return;
    }
    if (!target?.closest(".x6-node, .x6-edge")) this.hideContextMenu();
  };
  private readonly themeChangeListener = () => {
    if (!this.currentViewModel || !this.currentLayoutProjection) return;
    this.applying = true;
    try {
      this.renderCurrentProjection();
      this.applyRuntimeOverlay();
      this.renderMinimap();
    } finally {
      this.applying = false;
    }
  };
  private readonlyHistory: { undoStack: StudioGraphHistoryEntry[]; redoStack: StudioGraphHistoryEntry[] } = {
    undoStack: [],
    redoStack: []
  };

  constructor(private root: HTMLElement, initialOptions: StudioGraphBridgeOptions = {}) {
    this.options = initialOptions;
    this.showTopologyOrder = initialOptions.showTopologyOrder !== false;
    this.showTechnicalDetails = initialOptions.showTechnicalDetails !== false;
    if (initialOptions.initialLayoutMode) {
      this.layoutMode = initialOptions.initialLayoutMode;
    }
    this.root.classList.add("studio-graph-island");
    this.root.dataset.runtimeHistory = initialOptions.mode === "run-diagnosis" ? "on" : "off";
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
      this.toolbarButton("technical-details", "technicalDetails", "i"),
      this.options.mode === "product-edit" ? "" : this.toolbarButton("quick-open", "quickOpen", "/"),
      this.toolbarButton("export-png", "exportPng", "⇩", "PNG"),
      '</div>',
      '<div class="studio-graph-toolbar-group" data-studio-graph-generate-actions aria-label="' + this.escapeHtml(this.label("generate")) + '">',
      this.toolbarButton("chat-generate", "generate", "✦"),
      this.toolbarButton("debug-run", "debugRun", "▶", this.label("debugRunShort")),
      '</div>',
      '<div class="studio-graph-toolbar-group" data-studio-graph-edit-actions aria-label="' + this.escapeHtml(this.label("editGroup")) + '">',
      this.toolbarButton("add-role", "addRole", "+R"),
      this.toolbarButton("add-edge", "addEdge", "+E"),
      this.toolbarButton("assets", "teamConfiguration", "⚙"),
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
      '<div class="studio-graph-minimap" data-studio-graph-minimap aria-label="' + this.escapeHtml(this.label("minimap")) + '" hidden>',
      '<div class="studio-graph-minimap-content" data-studio-graph-minimap-content></div>',
      '<div class="studio-graph-minimap-viewport" data-studio-graph-minimap-viewport></div>',
      "</div>",
      '<div class="studio-graph-quick-open" data-studio-graph-quick-open hidden>',
      '<div class="studio-graph-quick-open-panel">',
      '<label class="studio-graph-quick-open-label" for="studio-graph-quick-open-input">' + this.escapeHtml(this.label("quickOpen")) + '</label>',
      '<input id="studio-graph-quick-open-input" class="studio-graph-quick-open-input" data-studio-graph-quick-open-input autocomplete="off" spellcheck="false" aria-label="' + this.escapeHtml(this.label("quickOpen")) + '" placeholder="' + this.escapeHtml(this.label("quickOpenPlaceholder")) + '" />',
      '<div class="studio-graph-quick-open-results" data-studio-graph-quick-open-results></div>',
      "</div>",
      "</div>",
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
    if (!toolbar || !stageEl || !canvasEl || !emptyEl || !contextMenuEl || !minimapEl || !minimapContentEl || !minimapViewportEl || !quickOpenEl || !quickOpenInputEl || !quickOpenResultsEl) {
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
    this.bindResizeObserver();
    this.root.addEventListener("keydown", this.rootKeydownListener);
    document.addEventListener("ogs-visualizer-theme-change", this.themeChangeListener);
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
    if (Object.prototype.hasOwnProperty.call(options, "runtimeProgress")) {
      this.runtimeProgressEvents = [...(options.runtimeProgress ?? [])];
    }
    this.hideContextMenu();
    this.attachCommandFormHost();
    this.handleHistoryEvent(options.historyEvent);
    this.handleDismissCommandFormRequest(options.dismissCommandFormRequest);
    let viewModel = options.viewModel ?? buildGraphViewModel({
      authoring: options.authoring,
      presentation: options.presentation,
      validation: options.validation
        ? {
            ok: options.validation.ok,
            diagnostics: options.validation.diagnostics
          }
        : null,
      mode: options.readOnly ? "run" : "edit"
    });
    viewModel = overlayRuntimeViewModel(viewModel, options.runtimeViewModel);
    for (const node of viewModel.nodes) {
      if (node.kind === "specialRole" && node.specialRole === "start") {
        node.label = this.label("boundaryEntry");
      } else if (node.kind === "specialRole" && node.specialRole === "end") {
        node.label = this.label("boundaryEnd");
      }
    }
    this.preserveBoundaryNodeLayout(viewModel);
    const layoutRequested = Number(options.defaultAutoLayoutRequestId || 0) > this.lastDefaultAutoLayoutRequestId;
    if (!layoutRequested && this.currentLayoutProjection) {
      const projectedNodes = new Map(this.currentLayoutProjection.nodes.map((node) => [node.id, node]));
      viewModel = {
        ...viewModel,
        nodes: viewModel.nodes.map((node) => {
          const projected = projectedNodes.get(node.id);
          if (!projected) return node;
          return {
            ...node,
            layout: {
              ...node.layout,
              x: projected.x,
              y: projected.y,
              width: projected.width,
              height: projected.height
            }
          };
        })
      };
    }
    this.currentViewModel = viewModel;
    if (!options.authoring && !options.viewModel) {
      this.applying = true;
      try {
        this.graph.clearCells();
      } finally {
        this.applying = false;
      }
      this.hasRenderedProjection = false;
      this.currentLayoutProjection = null;
      this.setEmptyState(true, viewModel.validation.diagnostics.length > 0
        ? this.label("fixMermaidBeforeGraphEditing")
        : this.label("noRolesAvailable"));
      this.closeCommandForm();
      this.closeQuickOpen();
      this.renderMinimap();
      this.setStatus(this.label("graphUnavailable"));
      this.setBusy(true);
      return;
    }
    this.setEmptyState(false);
    this.currentLayoutProjection = createStoredLayoutProjection(this.currentViewModel);
    this.applying = true;
    try {
      this.renderCurrentProjection();
      this.syncPendingEdgePreview();
      this.runtimeVisualState = deriveStudioRuntimeVisualState({
        authoring: options.authoring,
        viewModel,
        readOnly: options.readOnly === true,
        progressEvents: this.runtimeProgressEvents
      });
      this.syncGraphViewportSize();
      const autoLayoutApplied = await this.applyDefaultAutoLayout(updateGeneration);
      if (updateGeneration !== this.updateGeneration) {
        return;
      }
      if (!autoLayoutApplied) {
        this.restoreViewport(
          options.viewport ?? viewModel.viewport ?? options.authoring?.layout?.viewport ?? options.canvas?.viewport,
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

  setRuntimeProgress(events: readonly StudioRuntimeProgressEvent[]): void {
    this.runtimeProgressEvents = [...events];
    if (!this.currentViewModel) return;
    this.runtimeVisualState = deriveStudioRuntimeVisualState({
      authoring: this.options.authoring,
      viewModel: this.currentViewModel,
      readOnly: this.options.readOnly === true,
      progressEvents: this.runtimeProgressEvents
    });
    this.applyRuntimeOverlay();
  }

  focusRuntimeHandoff(handoffId: string): void {
    this.runtimeFocusedHandoffId = handoffId;
    this.applyRuntimeOverlay();
  }

  focusRoleNode(roleId: string): boolean {
    const targetNode = this.graph.getNodes().find((node) => {
      const data = node.getData() as { studioNode?: { roleId?: string } } | undefined;
      return node.id === roleId || data?.studioNode?.roleId === roleId;
    });
    if (!targetNode) return false;
    this.graph.cleanSelection();
    this.graph.select(targetNode);
    this.focusCell(targetNode, { preserveViewport: false });
    return true;
  }

  highlightFlowEdge(flowKey: string): boolean {
    const targetEdge = this.graph.getEdges().find((edge) => {
      const data = edge.getData() as { studioEdge?: { flowKey?: string; id?: string } } | undefined;
      return edge.id === flowKey || data?.studioEdge?.flowKey === flowKey;
    });
    if (!targetEdge) return false;
    const view = this.graph.findViewByCell(targetEdge);
    const container = view?.container as Element | undefined;
    if (container) {
      container.classList.add("is-selection-active");
      setTimeout(() => container.classList.remove("is-selection-active"), 1500);
    }
    return true;
  }

  dispose(): void {
    this.updateGeneration += 1;
    if (this.minimapRefreshFrame !== null) {
      cancelAnimationFrame(this.minimapRefreshFrame);
      this.minimapRefreshFrame = null;
    }
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
    document.removeEventListener("ogs-visualizer-theme-change", this.themeChangeListener);
    this.root.removeEventListener("keydown", this.rootKeydownListener);
    this.root.removeEventListener("pointerdown", this.contextPointerDownListener);
    this.root.removeEventListener("pointerup", this.contextPointerUpListener);
    this.root.removeEventListener("pointercancel", this.contextPointerUpListener);
    this.root.removeEventListener("mouseleave", this.contextPointerLeaveListener);
    this.root.removeEventListener("contextmenu", this.rootContextMenuListener);
    this.graph.dispose();
    this.root.innerHTML = "";
    this.root.classList.remove("studio-graph-island");
  }

  private createGraph(container: HTMLElement): Graph {
    const graph = new Graph({
      container,
      grid: {
        size: 10,
        visible: true,
        type: "dot",
        args: { color: "rgba(148, 163, 184, 0.16)", thickness: 1 }
      },
      autoResize: true,
      panning: {
        enabled: true
      },
      mousewheel: {
        enabled: true,
        modifiers: [],
        minScale: 0.2,
        maxScale: 2.4
      },
      interacting: (cellView) => {
        if (cellView.cell.isNode() && isStudioLayoutJunction(cellView.cell)) {
          return false;
        }
        if (cellView.cell.isNode() && isStudioSccGroup(cellView.cell)) {
          return {
            nodeMovable: !this.isReadOnly(),
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
        connectionPoint: { name: "boundary", args: { offset: STUDIO_NODE_EDGE_CLEARANCE } },
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
                targetMarker: {
                  name: "block",
                  width: 12,
                  height: 9,
                  fill: "#38bdf8",
                  stroke: "#38bdf8",
                  strokeWidth: 1
                }
              }
            },
            labels: [{ attrs: { label: { text: "DONE" } } }]
          });
        },
        validateConnection: ({ sourceCell, targetCell }) => !this.isReadOnly() && validateStudioConnectionCells(sourceCell, targetCell).ok
      }
    });
    graph.use(new Export());
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
      this.scheduleMinimapRefresh();
      this.emitViewportChange();
    });
    graph.on("translate", () => {
      this.scheduleMinimapRefresh();
      this.emitViewportChange();
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
      this.scheduleMinimapRefresh();
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
    const technicalDetails = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="technical-details"]');
    if (technicalDetails) {
      technicalDetails.setAttribute("aria-pressed", this.showTechnicalDetails ? "true" : "false");
      technicalDetails.title = this.label("technicalDetails") + " · " + this.label(this.showTechnicalDetails ? "enabled" : "disabled");
    }
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
      if (action === "technical-details") {
        const next = !(this.showTechnicalDetails && this.showTopologyOrder);
        this.showTechnicalDetails = next;
        this.showTopologyOrder = next;
        this.renderCurrentProjection();
        this.updateToolbarState();
      }
      if (action === "quick-open") this.toggleQuickOpen();
      if (action === "export-png") this.graph.exportPNG("ogs-workflow.png", { padding: 64, ratio: 2, backgroundColor: document.documentElement.dataset.visualizerTheme === "dark" ? "#0b1220" : "#f4f7f5" });
      if (action === "chat-generate") void this.options.onChatGenerate?.();
      if (action === "debug-run") {
        if (this.options.onOpenDebug) void this.options.onOpenDebug();
        else void this.options.onFocusDebugInput?.();
      }
      if (action === "validate") void this.options.onValidateWorkbench?.();
      if (action === "save") void this.options.onSaveWorkbench?.();
      if (action === "assets") this.options.onOpenTeamAssets?.();
      if (this.isReadOnly()) return;
      if (action === "layout") void this.autoLayout();
      if (action === "undo") void this.semanticUndo();
      if (action === "redo") void this.semanticRedo();
      if (action === "edit") this.openSelectedEditor();
      if (action === "delete") void this.deleteSelection();
      if (action === "add-role") this.beginAddRoleDraft();
      if (action === "add-edge") {
        const selectedRoleId = this.selectedRoleId();
        if (!selectedRoleId) {
          this.toast("error", this.label("noRolesAvailable"));
          return;
        }
        this.relationshipSourceRoleId = selectedRoleId;
        this.updateConnectionPortPresentation();
        this.options.onStatusChange?.(this.label("connectFromSelectedRole"));
        this.updateToolbarState();
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
    this.root.addEventListener("pointerdown", this.contextPointerDownListener);
    this.root.addEventListener("pointerup", this.contextPointerUpListener);
    this.root.addEventListener("pointercancel", this.contextPointerUpListener);
    this.root.addEventListener("mouseleave", this.contextPointerLeaveListener);
    this.root.addEventListener("contextmenu", this.rootContextMenuListener);
  }

  private bindGraphEvents(): void {
    this.graph.on("node:click", ({ node }) => {
      const data = node.getData() as { studioNode?: { kind?: string; roleId?: string }; studioPendingRole?: boolean } | undefined;
      if (data?.studioPendingRole) {
        this.openCommandForm("add-role");
        return;
      }
      if ((data?.studioNode?.roleSeat || data?.studioNode?.kind === "specialRole") && data.studioNode.roleId) {
        this.selectRoleById(data.studioNode.roleId, node);
      }
    });
    this.graph.on("node:dblclick", ({ node }) => {
      const data = node.getData() as { studioNode?: { kind?: string; roleId?: string } } | undefined;
      if ((data?.studioNode?.roleSeat || data?.studioNode?.kind === "specialRole") && data.studioNode.roleId) {
        this.selectRoleById(data.studioNode.roleId, node);
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
        this.selectEdge(data.studioEdge, edge);
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
      this.relationshipSourceRoleId = "";
      this.updateConnectionPortPresentation();
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
      const sourceCell = this.relationshipSourceRoleId ? this.graph.getCellById(this.relationshipSourceRoleId) : null;
      const targetView = this.graph.findViewByCell(node);
      (targetView?.container as Element | undefined)?.classList.toggle(
        "is-connection-target",
        Boolean(this.relationshipSourceRoleId && node.id !== this.relationshipSourceRoleId && validateStudioConnectionCells(sourceCell, node).ok)
      );
      this.showDiagnosticCard(data?.studioNode, e);
    });
    this.graph.on("node:mouseleave", ({ node }) => {
      const targetView = this.graph.findViewByCell(node);
      (targetView?.container as Element | undefined)?.classList.remove("is-connection-target");
      this.hideDiagnosticCard();
    });
    this.graph.on("cell:mouseup", () => {
      this.schedulePendingEdgeCleanup();
    });
    this.graph.on("blank:mouseup", () => {
      this.schedulePendingEdgeCleanup();
    });
    this.graph.on("node:moving", ({ node }) => {
      if (this.isReadOnly() || isStudioSccGroup(node) || this.syncingSccGroupDrag) return;
      this.scheduleMinimapRefresh();
    });
    this.graph.on("node:moved", ({ node }) => {
      if (this.isReadOnly()) return;
      if (node.id === this.pendingRolePlaceholderId) {
        const position = node.getPosition();
        this.pendingRoleDraftPosition = { x: position.x, y: position.y };
        this.renderMinimap();
        return;
      }
      if (this.minimapRefreshFrame !== null) {
        cancelAnimationFrame(this.minimapRefreshFrame);
        this.minimapRefreshFrame = null;
      }
      if (isStudioSccGroup(node)) {
        const previous = studioSccGroupPreviousPosition(node);
        const current = node.getPosition();
        const delta = previous ? { x: current.x - previous.x, y: current.y - previous.y } : { x: 0, y: 0 };
        if (!this.syncingSccGroupDrag && (delta.x !== 0 || delta.y !== 0)) {
          this.syncingSccGroupDrag = true;
          try {
            for (const memberId of studioSccGroupMembers(node)) {
              const member = this.graph.getCellById(memberId);
              if (member?.isNode() && !isStudioSccGroup(member)) {
                const position = member.getPosition();
                member.position(position.x + delta.x, position.y + delta.y);
              }
            }
          } finally {
            this.syncingSccGroupDrag = false;
          }
          alignStudioSccGroups(this.graph);
          this.refreshStoredProjectionFromGraph();
          this.scheduleSyncCanvas();
        }
        this.renderMinimap();
        return;
      }
      if (this.commandForm?.kind === "add-edge") {
        this.closeCommandForm();
      }
      if (this.syncingSccGroupDrag) return;
      alignStudioSccGroups(this.graph);
      this.refreshStoredProjectionFromGraph();
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
      if (this.relationshipSourceRoleId && source !== this.relationshipSourceRoleId) {
        this.toast("error", this.label("connectFromSelectedRole"));
        return;
      }
      this.relationshipSourceRoleId = "";
      this.updateConnectionPortPresentation();
      const command = {
        type: "add-edge" as const,
        sourceRoleId: source,
        targetRoleId: target,
        eventType: defaultStudioFlowEventType(this.validationContext(), source),
        label: ""
      };
      void this.applyCommand(command).then(() => {
        this.updateToolbarState();
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
      condition?: GraphViewModelEdge["condition"];
      priority?: number;
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
      participatesInJoin: defaults.participatesInJoin,
      condition: defaults.condition,
      priority: defaults.priority
    });
    this.renderCommandForm();
  }

  private beginAddRoleDraft(): void {
    if (this.isReadOnly()) return;
    this.removePendingRolePlaceholder();
    const viewport = this.canvasEl.getBoundingClientRect();
    const workbench = this.root.closest<HTMLElement>(".studio-workbench");
    const assetDrawer = workbench?.querySelector<HTMLElement>(".studio-asset-drawer.is-open");
    const drawerLeft = assetDrawer?.getBoundingClientRect().left;
    const anchorX = drawerLeft !== undefined && drawerLeft > viewport.left && drawerLeft < viewport.right
      ? (viewport.left + drawerLeft) / 2
      : viewport.left + viewport.width / 2;
    const center = this.graph.clientToLocal(anchorX, viewport.top + viewport.height / 2);
    const position = this.nearestOpenRolePosition(center);
    const dark = document.documentElement.dataset.visualizerTheme === "dark";
    const node = this.graph.addNode({
      id: "__studio_pending_role__",
      shape: "rect",
      x: position.x,
      y: position.y,
      width: 180,
      height: 84,
      zIndex: 10,
      data: { studioPendingRole: true },
      attrs: {
        body: { fill: dark ? "#10221f" : "#f3f8f6", stroke: dark ? "#66c8b5" : "#258779", strokeWidth: 1.5, strokeDasharray: "6 4", rx: 6, ry: 6 },
        label: { text: this.label("addRole"), fill: dark ? "#b6e8df" : "#245d55", fontSize: 13, fontWeight: 600 }
      }
    });
    this.pendingRolePlaceholderId = node.id;
    this.pendingRoleDraftPosition = position;
    this.graph.cleanSelection();
    this.graph.select(node);
    this.options.onStatusChange?.(this.label("addRole"));
  }

  private nearestOpenRolePosition(center: { x: number; y: number }): { x: number; y: number } {
    const width = 180;
    const height = 84;
    const stepX = width + 32;
    const stepY = height + 32;
    const nodes = this.graph.getNodes().map((node) => node.getBBox());
    for (let radius = 0; radius < 24; radius += 1) {
      for (let row = -radius; row <= radius; row += 1) {
        for (let column = -radius; column <= radius; column += 1) {
          if (Math.max(Math.abs(row), Math.abs(column)) !== radius) continue;
          const position = {
            x: Math.round(center.x - width / 2 + column * stepX),
            y: Math.round(center.y - height / 2 + row * stepY)
          };
          const overlaps = nodes.some((box) =>
            position.x < box.x + box.width + 16 &&
            position.x + width + 16 > box.x &&
            position.y < box.y + box.height + 16 &&
            position.y + height + 16 > box.y
          );
          if (!overlaps) return position;
        }
      }
    }
    return { x: Math.round(center.x - width / 2), y: Math.round(center.y - height / 2) };
  }

  private removePendingRolePlaceholder(): void {
    if (!this.pendingRolePlaceholderId) return;
    this.graph.getCellById(this.pendingRolePlaceholderId)?.remove();
    this.pendingRolePlaceholderId = "";
    this.pendingRoleDraftPosition = null;
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
    condition?: GraphViewModelEdge["condition"];
    priority?: number;
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
      participatesInJoin: edge.participatesInJoin,
      condition: edge.condition,
      priority: edge.priority
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
    if ((data?.studioNode?.roleSeat || data?.studioNode?.kind === "specialRole") && data.studioNode.roleId) {
      this.selectRoleById(data.studioNode.roleId, selected?.isNode() ? selected : undefined);
      return;
    }
    if (data?.studioEdge) {
      this.selectEdge(data.studioEdge, selected?.isEdge() ? selected : undefined);
    }
  }

  private closeCommandForm(): void {
    const hadActiveCommandState = Boolean(
      this.commandForm ||
      this.pendingEdgePreview ||
      this.pendingRoleInsertion ||
      this.pendingRolePlaceholderId
    );
    if (!this.commandForm && this.dialogEl.hidden) {
      this.removePendingRolePlaceholder();
      if (hadActiveCommandState) {
        this.options.onStatusChange?.(this.label("graphReady"));
      }
      return;
    }
    this.pendingEdgePreview = null;
    this.pendingRoleInsertion = null;
    this.commandForm = null;
    this.removePendingRolePlaceholder();
    this.dialogEl.hidden = true;
    this.dialogEl.innerHTML = "";
    this.syncPendingEdgePreview();
    this.notifyCommandFormState();
    if (hadActiveCommandState) {
      this.options.onStatusChange?.(this.label("graphReady"));
    }
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
    if (this.options.mode === "product-edit") {
      return;
    }
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
      this.quickOpenResultsEl.innerHTML = '<div class="studio-graph-quick-open-empty">' + this.escapeHtml(this.label("quickOpenEmpty")) + '</div>';
      return;
    }
    this.quickOpenSelectedIndex = Math.max(0, Math.min(this.quickOpenSelectedIndex, items.length - 1));
    this.quickOpenResultsEl.innerHTML = items.map((item, index) => {
      const active = index === this.quickOpenSelectedIndex;
      return '<button type="button" class="studio-graph-quick-open-item' + (active ? " is-active" : "") +
        '" data-studio-graph-quick-open-item="1" data-item-kind="' + this.escapeHtml(item.kind) +
        '" data-item-id="' + this.escapeHtml(item.id) +
        '" data-item-label="' + this.escapeHtml(item.label) + '">' +
        '<span class="studio-graph-quick-open-kind">' + this.escapeHtml(this.label(item.kind === "role" ? "quickOpenRole" : "quickOpenFlow")) + '</span>' +
        '<strong>' + this.escapeHtml(item.label) + "</strong>" +
        "</button>";
    }).join("");
  }

  private quickOpenItems(): Array<{ kind: "role" | "flow"; id: string; label: string; searchText: string }> {
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
        label: node.label || node.roleId,
        searchText: [node.label, node.roleId, node.id].filter(Boolean).join(" ").toLowerCase()
      }));
    const nodesById = new Map(viewModel.nodes.map((node) => [node.id, node]));
    const flowItems = viewModel.edges.map((edge) => {
      const source = nodesById.get(edge.source);
      const target = nodesById.get(edge.target);
      const sourceLabel = source?.label || edge.source;
      const targetLabel = target?.label || edge.target;
      const relationLabel = edge.label || edge.eventType;
      return {
        kind: "flow" as const,
        id: studioEdgeFlowKey(edge),
        label: `${sourceLabel} → ${targetLabel} · ${relationLabel}`,
        searchText: [edge.label, edge.eventType, edge.id, edge.source, edge.target, source?.label, target?.label]
          .filter(Boolean).join(" ").toLowerCase()
      };
    });
    const items = roleItems.concat(flowItems);
    if (!query) {
      return items.slice(0, 24);
    }
    return items.filter((item) => item.searchText.includes(query) || item.id.toLowerCase().includes(query)).slice(0, 24);
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
    const join = runtime && typeof runtime.joinWaitingSummary === "object" && runtime.joinWaitingSummary !== null
      ? runtime.joinWaitingSummary as Record<string, unknown>
      : null;
    if (join) {
      const details = [
        join.scopeId ? `scope ${String(join.scopeId)}` : "",
        join.status ? `join ${String(join.status)}` : "",
        Number.isFinite(Number(join.elapsedSeconds)) ? `waiting ${String(join.elapsedSeconds)}s` : "",
        Number.isFinite(Number(join.timeoutSeconds)) ? `timeout ${String(join.timeoutSeconds)}s` : "",
        join.deadlineAt ? `deadline ${String(join.deadlineAt)}` : "",
        join.timeoutAction ? `on timeout ${String(join.timeoutAction)}` : ""
      ].filter(Boolean);
      if (details.length) items.push(`<div>${this.escapeHtml(details.join(" · "))}</div>`);
      for (const [label, key] of [["expected", "expectedSources"], ["ready", "readySources"], ["missing", "missingSources"]] as const) {
        const values = join[key];
        if (Array.isArray(values) && values.length) items.push(`<div>${label}: ${this.escapeHtml(values.join(", "))}</div>`);
      }
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

  private showIterationHistoryCard(nodeId: string, state: StudioRuntimeNodeState, event: MouseEvent): void {
    if (!state.history || state.history.length === 0) return;
    const isEn = this.options.locale?.startsWith("en");
    const items = state.history.map((record) => {
      const dur = record.durationMs ? `${(record.durationMs / 1000).toFixed(1)}s` : "—";
      const tok = record.totalTokens ? `${record.totalTokens.toLocaleString()} tok` : "—";
      const statusText = record.status === "failed" ? (isEn ? "failed" : "失败") : (isEn ? "ok" : "成功");
      const statusIcon = record.status === "failed" ? "❌" : "✅";
      return `<div style="display:flex;align-items:center;justify-content:space-between;gap:14px;padding:5px 0;border-bottom:1px solid rgba(148,163,184,0.15);font-size:11px;"><span>${isEn ? `Round #${record.iteration}` : `第 ${record.iteration} 轮`}</span><span style="font-family:monospace;color:#38bdf8;">${dur} · ${tok}</span><span>${statusIcon} ${statusText}</span></div>`;
    });
    this.diagnosticCardEl.innerHTML = `<div style="min-width:200px;padding:6px 2px;"><strong style="display:block;margin-bottom:6px;font-size:12px;color:var(--mint,#10b981);">${isEn ? `🔄 Loop Iteration History (${state.history.length})` : `🔄 循环历史记录 (共 ${state.history.length} 轮)`}</strong>${items.join("")}</div>`;
    this.diagnosticCardEl.hidden = false;
    const stageRect = this.stageEl.getBoundingClientRect();
    const left = event.clientX - stageRect.left + 8;
    const top = event.clientY - stageRect.top + 8;
    this.diagnosticCardEl.style.left = `${Math.max(12, Math.min(stageRect.width - 240, left))}px`;
    this.diagnosticCardEl.style.top = `${Math.max(12, Math.min(stageRect.height - 180, top))}px`;
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
    for (const fieldPath of ["repositoryRoleId", "roleId", "modelRef", "profileId", "newProfileId", "newProfileToolRef", "newProfileTimeoutMs", "newProfileMaxOutputBytes", "sourceRoleId", "targetRoleId", "eventType", "conditionJson", "priority"]) {
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
      : command.type === "add-role" && this.pendingRoleDraftPosition
        ? { ...command, ...this.pendingRoleDraftPosition }
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
    const currentRoleId = currentData?.studioNode?.roleSeat || currentData?.studioNode?.kind === "specialRole"
      ? currentData.studioNode.roleId || ""
      : "";
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

  private emitViewportChange(): void {
    if (this.applying || !this.options.onViewportChange) {
      return;
    }
    const viewport = {
      x: this.graph.translate().tx,
      y: this.graph.translate().ty,
      zoom: this.graph.zoom()
    };
    const signature = `${viewport.x}:${viewport.y}:${viewport.zoom}`;
    if (signature === this.lastViewportSignature) {
      return;
    }
    this.lastViewportSignature = signature;
    this.options.onViewportChange(viewport);
  }

  private selectedRoleId(): string {
    const selected = this.graph.getSelectedCells()[0];
    const data = selected?.getData() as { studioNode?: { kind?: string; roleId?: string } } | undefined;
    return data?.studioNode?.roleSeat || data?.studioNode?.kind === "specialRole"
      ? data.studioNode.roleId || ""
      : this.options.selectedRoleId || "";
  }

  private preserveBoundaryNodeLayout(viewModel: GraphViewModel): void {
    if (this.isReadOnly() || !this.hasRenderedProjection) {
      return;
    }
    for (const node of viewModel.nodes) {
      if (node.kind !== "specialRole") {
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
    const requestId = Number(this.options.defaultAutoLayoutRequestId || 0);
    const requested = requestId > this.lastDefaultAutoLayoutRequestId;
    if (requested && this.options.initialLayoutMode) {
      this.layoutMode = this.options.initialLayoutMode;
    }
    const signature = this.defaultAutoLayoutSignature();
    if (!signature || (!requested && !this.isReadOnly() && this.hasRenderedProjection) || (!requested && this.lastDefaultAutoLayoutSignature === signature)) {
      return false;
    }
    if (
      !requested &&
      !this.isReadOnly() &&
      !this.hasRenderedProjection &&
      this.hasCompleteStoredRoleLayout()
    ) {
      this.lastDefaultAutoLayoutSignature = signature;
      return false;
    }
    await this.applyAutoLayout(updateGeneration);
    if (updateGeneration !== this.updateGeneration) {
      return false;
    }
    this.lastDefaultAutoLayoutSignature = signature;
    if (requested) {
      this.lastDefaultAutoLayoutRequestId = requestId;
    }
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
      .filter((node) => !isStudioLayoutJunction(node))
      .map((node) => node.id)
      .sort();
    const edges = this.graph.getEdges()
      .filter((edge) => !this.isPendingEdgePreviewCell(edge) && !isStudioLayoutBundleEdge(edge))
      .map((edge) => `${edge.getSourceCellId() || ""}->${edge.getTargetCellId() || ""}`)
      .sort();
    return nodes.length ? `${nodes.join(",")}|${edges.join(",")}` : "";
  }

  private refreshStoredProjectionFromGraph(): void {
    if (!this.currentViewModel) return;
    const nextNodes = this.currentViewModel.nodes.map((node) => {
      const cell = this.graph.getCellById(node.id);
      if (!cell?.isNode()) return node;
      const position = cell.getPosition();
      const size = cell.getSize();
      return {
        ...node,
        layout: {
          ...node.layout,
          x: position.x,
          y: position.y,
          width: size.width,
          height: size.height
        }
      };
    });
    this.currentViewModel = { ...this.currentViewModel, nodes: nextNodes };
    this.currentLayoutProjection = createStoredLayoutProjection(this.currentViewModel);
    this.renderCurrentProjection();
    this.applyRuntimeOverlay();
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
    renderStudioGraphViewModel(this.graph, viewModel, this.currentLayoutProjection, {
      showTechnicalDetails: this.showTechnicalDetails
    });
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
    const nodes = this.graph.getNodes()
      .filter((node) => !isStudioLayoutJunction(node))
      .map((node) => {
        const position = node.getPosition();
        const size = node.getSize();
        return {
          left: position.x,
          top: position.y,
          right: position.x + size.width,
          bottom: position.y + size.height
        };
      })
      .filter((bounds) => [bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite));
    if (!nodes.length) {
      this.graph.zoomToFit({ padding: STUDIO_GRAPH_FIT_PADDING, maxScale });
      this.lastViewportSignature = "";
      return;
    }
    // X6 includes routed edge labels and loop geometry in zoomToFit's model
    // bbox. Long back edges can then pull the whole graph off-screen, so fit
    // from the stable node envelope and leave room for routes around it.
    const bounds = nodes.reduce((result, current) => ({
      left: Math.min(result.left, current.left),
      top: Math.min(result.top, current.top),
      right: Math.max(result.right, current.right),
      bottom: Math.max(result.bottom, current.bottom)
    }), {
      left: Number.POSITIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY
    });
    const width = Math.max(bounds.right - bounds.left, 1);
    const height = Math.max(bounds.bottom - bounds.top, 1);
    const viewportWidth = Math.max(this.canvasEl.clientWidth, 1);
    const viewportHeight = Math.max(this.canvasEl.clientHeight, 1);
    const availableWidth = Math.max(viewportWidth - STUDIO_GRAPH_FIT_PADDING * 2, 1);
    const availableHeight = Math.max(viewportHeight - STUDIO_GRAPH_FIT_PADDING * 2, 1);
    const scale = Math.max(0.2, Math.min(maxScale, availableWidth / width, availableHeight / height));
    this.graph.zoomTo(scale);
    this.graph.translate(
      (viewportWidth - width * scale) / 2 - bounds.left * scale,
      (viewportHeight - height * scale) / 2 - bounds.top * scale
    );
    this.lastViewportSignature = "";
  }

  private schedulePendingInitialFit(): void {
    this.pendingInitialFit = true;
    this.pendingInitialFitSizeSignature = "";
    this.flushPendingInitialFit();
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

  private scheduleMinimapRefresh(): void {
    if (this.minimapRefreshFrame !== null) return;
    this.minimapRefreshFrame = requestAnimationFrame(() => {
      this.minimapRefreshFrame = null;
      if (this.isReadOnly() || !this.currentViewModel) return;
      this.renderMinimap();
    });
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
    if (this.options.onToast) {
      this.options.onToast(tone, message);
      return;
    }
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
        selectedFlowKey: snapshot.selectedFlowKey,
        historyContext: snapshot.historyContext
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
      selectedFlowKey: this.options.selectedFlowKey,
      historyContext: this.options.historyContext === undefined ? undefined : this.cloneJson(this.options.historyContext)
    };
  }

  private updateToolbarState(): void {
    this.updateConnectionPortPresentation();
    const readOnly = this.isReadOnly();
    const quickOpen = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="quick-open"]');
    if (quickOpen) {
      quickOpen.hidden = this.options.mode === "product-edit";
    }
    const selected = this.graph.getSelectedCells()[0];
    const selectedData = selected?.getData() as {
      studioNode?: { kind?: string; roleId?: string };
      studioEdge?: { editable?: boolean };
    } | undefined;
    const selectedRole = selectedData?.studioNode?.roleSeat === true || selectedData?.studioNode?.kind === "specialRole";
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
      topologyOrder.hidden = this.options.showTopologyOrder === false;
      topologyOrder.setAttribute("aria-pressed", this.showTopologyOrder ? "true" : "false");
      topologyOrder.title = this.label("topologyOrder") + " · " + this.label(this.showTopologyOrder ? "enabled" : "disabled");
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
      debugRun.disabled = this.busy || readOnly || (typeof this.options.onOpenDebug !== "function" && typeof this.options.onFocusDebugInput !== "function");
    }
    for (const action of ["layout", "add-role", "add-edge", "delete", "validate", "save"]) {
      const button = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="' + action + '"]');
      if (button) button.disabled = this.busy || readOnly;
    }
    const addEdge = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="add-edge"]');
    const deleteButton = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="delete"]');
    if (addEdge) addEdge.disabled = this.busy || readOnly || !selectedRole;
    if (addEdge) addEdge.setAttribute("aria-pressed", this.relationshipSourceRoleId && selectedRole ? "true" : "false");
    if (deleteButton) deleteButton.disabled = this.busy || readOnly || !selectedEditable;
    const undo = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="undo"]');
    const redo = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="redo"]');
    const save = this.toolbar.querySelector<HTMLButtonElement>('[data-studio-graph-action="save"]');
    if (undo) undo.disabled = this.busy || readOnly || this.activeUndoStack().length === 0;
    if (redo) redo.disabled = this.busy || readOnly || this.activeRedoStack().length === 0;
    if (save) save.disabled = this.busy || readOnly || this.options.canSaveWorkbench !== true;
  }

  private updateConnectionPortPresentation(): void {
    this.root.classList.toggle("is-relationship-connecting", Boolean(this.relationshipSourceRoleId));
    for (const node of this.graph.getNodes()) {
      const view = this.graph.findViewByCell(node);
      const container = view?.container as Element | undefined;
      if (!container) continue;
      container.classList.toggle("is-relationship-source", node.id === this.relationshipSourceRoleId);
      if (!this.relationshipSourceRoleId) container.classList.remove("is-connection-target");
    }
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
    if (this.pendingRolePlaceholderId && event.key === "Escape" && !this.commandForm) {
      event.preventDefault();
      this.removePendingRolePlaceholder();
      return;
    }
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
    const expanded = action === "assets" ? ' aria-expanded="false" aria-controls="studio-asset-drawer"' : "";
    return '<button type="button" data-studio-graph-action="' + this.escapeHtml(action) + '" title="' +
      this.escapeHtml(label) + '" aria-label="' + this.escapeHtml(label) + '"' + expanded + '><span class="studio-graph-toolbar-icon" aria-hidden="true">' +
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
          width: 12,
          height: 9,
          fill: "#38bdf8",
          stroke: "#38bdf8",
          strokeWidth: 1
        }
      }
    };
    if (existing?.isEdge()) {
      existing.setData({ studioPendingEdge: preview });
      existing.setSource({
        cell: preview.sourceRoleId,
        port: studioNodePortId(sourceCell, "out"),
        anchor: { name: "right" },
        connectionPoint: { name: "boundary", args: { offset: STUDIO_NODE_EDGE_CLEARANCE } }
      });
      existing.setTarget({
        cell: targetCellId,
        port: preview.targetRoleId === STUDIO_SYSTEM_END_ROLE_ID ? undefined : studioNodePortId(targetCell, "in"),
        anchor: { name: "left" },
        connectionPoint: { name: "boundary", args: { offset: STUDIO_NODE_EDGE_CLEARANCE } }
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
        port: studioNodePortId(sourceCell, "out"),
        anchor: { name: "right" },
        connectionPoint: { name: "boundary", args: { offset: STUDIO_NODE_EDGE_CLEARANCE } }
      },
      target: {
        cell: targetCellId,
        port: preview.targetRoleId === STUDIO_SYSTEM_END_ROLE_ID ? undefined : studioNodePortId(targetCell, "in"),
        anchor: { name: "left" },
        connectionPoint: { name: "boundary", args: { offset: STUDIO_NODE_EDGE_CLEARANCE } }
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
    if (this.relationshipSourceRoleId && this.relationshipSourceRoleId !== roleId) this.relationshipSourceRoleId = "";
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
    this.relationshipSourceRoleId = "";
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
    const canDeleteRole = args.state.kind === "role";
    const items = args.state.kind === "role"
      ? [
          { action: "edit", label: this.label("contextEditRole"), disabled: false },
          { action: "toggle-pin", label: this.label(this.isRolePinned(args.state.roleId) ? "contextUnpinRole" : "contextPinRole"), disabled: false },
          { action: "delete", label: this.label("contextDelete"), disabled: !canDeleteRole, destructive: true }
        ]
      : [
          { action: "edit", label: this.label("contextEditFlow"), disabled: args.state.edge.editable === false },
          { action: "insert-role", label: this.label("contextInsertRole"), disabled: args.state.edge.editable === false },
          { action: "delete", label: this.label("contextDelete"), disabled: args.state.edge.editable === false, destructive: true }
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
        this.selectRoleById(state.roleId);
        return;
      }
      if (action === "delete") {
        await this.deleteRole(state.roleId);
      }
      if (action === "toggle-pin") {
        await this.toggleRolePin(state.roleId);
      }
      return;
    }
    if (action === "edit") {
      this.selectEdge(state.edge);
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

  private isRolePinned(roleId: string): boolean {
    const node = this.currentViewModel?.nodes.find((candidate) => candidate.roleId === roleId);
    return node?.layout.pinned === true;
  }

  private async toggleRolePin(roleId: string): Promise<void> {
    const pinned = !this.isRolePinned(roleId);
    if (this.currentViewModel) {
      this.currentViewModel = {
        ...this.currentViewModel,
        nodes: this.currentViewModel.nodes.map((node) => node.roleId === roleId
          ? { ...node, layout: { ...node.layout, pinned } }
          : node)
      };
      this.currentLayoutProjection = createStoredLayoutProjection(this.currentViewModel);
      this.renderCurrentProjection();
      this.applyRuntimeOverlay();
    }
    await this.syncCanvas();
  }

  private async deleteRole(roleId: string): Promise<void> {
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
    const focusedHandoff = runtime?.handoffStatesById.get(this.runtimeFocusedHandoffId);
    this.root.dataset.runtimeSignals = runtime?.hasRuntimeSignals ? "on" : "off";
    this.root.dataset.runtimeFocus = runtime?.nodeStates && Array.from(runtime.nodeStates.values()).some((state) => state.waitingReview)
      ? "review"
      : runtime?.nodeStates && Array.from(runtime.nodeStates.values()).some((state) => state.active)
        ? "active"
        : "idle";
    this.root.dataset.reducedMotion = this.reducedMotion ? "on" : "off";
    const canvas = this.canvasEl.querySelector<HTMLElement>(".x6-graph-svg");
    if (canvas) {
      canvas.dataset.runtimeSignals = runtime?.hasRuntimeSignals ? "on" : "off";
    }
    const viewNodesById = new Map((this.currentViewModel?.nodes || []).map((node) => [node.id, node]));
    const locale = document.documentElement.lang || navigator.language || "zh-CN";
    for (const node of this.graph.getNodes()) {
      const view = this.graph.findViewByCell(node);
      const container = view?.container as Element | undefined;
      if (!container) {
        continue;
      }
      const nodeState = runtime?.nodeStates.get(node.id);
      const viewNode = viewNodesById.get(node.id);
      container.classList.toggle("is-runtime-active", Boolean(nodeState?.active));
      container.classList.toggle("is-runtime-technical-waiting", Boolean(nodeState?.technicalWaiting));
      container.classList.toggle("is-runtime-completed", nodeState?.status === "done");
      container.classList.toggle("is-runtime-waiting-review", Boolean(nodeState?.waitingReview));
      container.classList.toggle("has-human-gate", Boolean(nodeState?.humanGateConfigured));
      container.classList.toggle("has-loop-count", Boolean((nodeState?.loopCount || 0) > 1));
      container.classList.toggle("is-runtime-focus-target", Boolean(focusedHandoff && node.id === focusedHandoff.targetRoleId));
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
      const nodeFailure = [nodeState?.errorCode, nodeState?.errorMessage].filter(Boolean).join(": ");
      if (nodeFailure) {
        container.setAttribute("title", nodeFailure);
      } else {
        container.removeAttribute("title");
      }
      if (nodeState?.loopCount && nodeState.loopCount > 1) {
        container.setAttribute("data-loop-count", String(nodeState.loopCount));
      } else {
        container.removeAttribute("data-loop-count");
      }
      if (viewNode) {
        const size = node.getSize();
        syncRuntimeActivityMarker({ container, width: size.width, height: size.height, state: nodeState });
        syncRuntimeStatusIcon({ container, width: size.width, state: nodeState });
        syncRuntimeStatusBadge({ container, width: size.width, height: size.height, node: viewNode, state: nodeState, locale });
        syncRuntimeMetricsPill({
          container,
          width: size.width,
          height: size.height,
          state: nodeState,
          nodeId: node.id,
          onShowHistory: (nodeId, state, event) => {
            this.showIterationHistoryCard(nodeId, state, event);
          }
        });
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
      const edgeHandoffs = runtime
        ? Array.from(runtime.handoffStatesById.values()).filter((handoff) => handoff.edgeId === edge.id)
        : [];
      container.classList.toggle("is-runtime-active", Boolean(edgeState?.active));
      container.classList.toggle("is-runtime-waiting", Boolean(edgeState?.waiting));
      container.classList.toggle("is-runtime-completed", Boolean(edgeState?.completed));
      container.classList.toggle("is-runtime-error", Boolean(edgeState?.error));
      container.classList.toggle("is-runtime-stopped", Boolean(edgeState?.stopped));
      const edgeFailure = [edgeState?.errorCode, edgeState?.errorMessage].filter(Boolean).join(": ");
      if (edgeFailure) {
        container.setAttribute("title", edgeFailure);
      } else {
        container.removeAttribute("title");
      }
      container.classList.toggle("is-runtime-focus-edge", Boolean(focusedHandoff && edge.id === focusedHandoff.edgeId));
      container.classList.toggle("is-loop-back", Boolean(edgeState?.loopBack));
      syncRuntimeHandoffMarkers({ container, edgeState, handoffs: edgeHandoffs });
      syncRuntimeDataPackets({
        container,
        edgeId: edge.id,
        active: Boolean(edgeState?.active),
        waiting: Boolean(edgeState?.waiting),
        handoffs: edgeHandoffs
      });
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
    const allNodes = this.graph.getNodes().filter((node) => !isStudioLayoutJunction(node));
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
    const metricsById = new Map(metrics.map((item) => [item.id, item]));
    const edgeLines = this.graph.getEdges().filter((edge) => !isStudioLayoutBundleEdge(edge)).map((edge) => {
      const sourceNode = metricsById.get(edge.getSourceCellId() || "");
      const targetNode = metricsById.get(edge.getTargetCellId() || "");
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
      const kindClass = item.kind === "specialRole" ? " is-boundary" : "";
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
