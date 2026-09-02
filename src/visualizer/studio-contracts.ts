export const STUDIO_SYSTEM_END_ROLE_ID = "__system_end__";

export type StudioHumanReviewSpec = {
  mode?: string;
  timeoutSeconds?: number;
  timeoutAction?: string;
  reworkTargetRoleId?: string;
  reworkMax?: number;
  terminateScope?: string;
};

export type StudioAuthoringDocument = {
  version: 1;
  project: {
    workdir: string;
    systemPath: string;
  };
  system: {
    systemId: string;
    systemVersion: string;
    entryRoleId: string;
    entryEventType?: string;
    lawGlobalRef: string;
    handoffMode?: string;
    handoffContracts?: string;
  };
  roles: Record<string, StudioAuthoringRole>;
  flows: Record<string, StudioAuthoringFlow>;
  layout: {
    nodes: Record<string, { x: number; y: number; width?: number; height?: number }>;
    viewport?: { x: number; y: number; zoom: number };
  };
};

export type StudioAuthoringRole = {
  roleId: string;
  title?: string;
  bindingKind: "model" | "exec" | "noop";
  modelRef?: string;
  profileId?: string;
  routingMode?: "parallel_split";
  routeOrder?: string[];
  joinMode?: "all_of" | "quorum_of";
  joinMin?: number;
  joinSources?: string[];
  loopMax?: number;
  review?: StudioHumanReviewSpec;
  contextMap?: Record<string, string>;
};

export type StudioAuthoringFlow = {
  flowId: string;
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
  label?: string;
  runtimeOnlyErrorFlow?: boolean;
};

/** Internal graph snapshot consumed by X6 and the authoring adapter. */
export type StudioGraphSnapshot = {
  version: 1;
  nodes: Array<{
    id: string;
    roleId: string;
    x: number;
    y: number;
    width: number;
    height: number;
    label: string;
    badges: string[];
    bindingKind: StudioAuthoringRole["bindingKind"];
  }>;
  edges: Array<{
    id?: string;
    source: string;
    target: string;
    label: string;
    eventType: string;
    runtimeOnlyErrorFlow: boolean;
    participatesInJoin: boolean;
  }>;
  viewport?: { x: number; y: number; zoom: number };
};

/** @deprecated Use StudioGraphSnapshot inside the Studio boundary. Kept for API compatibility. */
export type StudioCanvasDocument = StudioGraphSnapshot;

export type StudioDiagnosticDto = {
  source: "client-preflight" | "server-validation" | "parser" | "compiler" | "readiness" | "capability";
  severity: "info" | "warning" | "error";
  fieldPath?: string;
  roleId?: string;
  flowKey?: string;
  code: string;
  messageKey: string;
  message?: string;
  vars?: Record<string, unknown>;
  selector?: string;
};

export type GraphViewModelMode = "edit" | "run";

export type GraphViewModelLayout = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type GraphViewModelNodeStructure = {
  routingMode?: StudioAuthoringRole["routingMode"];
  joinMode?: StudioAuthoringRole["joinMode"];
  joinMin?: number;
  joinSources?: string[];
  loopMax?: number;
  review?: StudioHumanReviewSpec;
  contextFields?: string[];
  modes?: string[];
  loopScope?: {
    loopId: string;
    boundaryRoleId: string;
    maxRounds: number;
    onExhausted: string;
  };
};

export type GraphViewModelJoinWaiting = {
  expectedCount: number;
  readyCount: number;
  missingCount: number;
};

export type GraphViewModelNodeRuntime = {
  status: string;
  activeBranchCount: number;
  completedBranchCount: number;
  waitingReviewCount: number;
  pendingReviewCount: number;
  loopIteration: number;
  lastErrorCode?: string;
  lastSelectedEvent?: string;
  expectedSources: string[];
  readySources: string[];
  missingSources: string[];
  joinWaitingSummary: GraphViewModelJoinWaiting | null;
  lastFailure?: Record<string, unknown>;
};

export type GraphViewModelDiagnostic = {
  severity: "warning" | "error";
  code?: string;
  message?: string;
};

type GraphViewModelNodeBase = {
  id: string;
  roleId: string;
  label: string;
  badges: string[];
  structure: GraphViewModelNodeStructure;
  layout: GraphViewModelLayout;
  runtime?: GraphViewModelNodeRuntime;
  diagnostic?: GraphViewModelDiagnostic;
  editable: boolean;
};

/** A rendered node that represents one accountable role seat and its aggregate runtime data. */
export type ResponsibilitySeatNode = GraphViewModelNodeBase & {
  kind: "roleSeat";
  entityKind: "responsibility_seat";
  roleSeat: true;
  executionScope: "roleAggregate";
  bindingKind: StudioAuthoringRole["bindingKind"];
};

/** A synthetic graph boundary; it can never be edited or treated as a role execution seat. */
export type BoundaryNode = GraphViewModelNodeBase & {
  kind: "boundary";
  entityKind: "boundary";
  roleSeat: false;
  executionScope: "boundary";
  bindingKind: "boundary";
};

export type GraphViewModelNode = ResponsibilitySeatNode | BoundaryNode;

export type GraphViewModelEdgeRuntime = {
  recentlyActivated: boolean;
};

export type GraphViewModelEdge = {
  id: string;
  source: string;
  target: string;
  eventType: string;
  label: string;
  runtimeOnlyErrorFlow: boolean;
  participatesInJoin: boolean;
  conditionSummary?: string;
  priority?: number;
  channel?: "normal" | "error" | "loop" | "join";
  runtime?: GraphViewModelEdgeRuntime;
  diagnostic?: GraphViewModelDiagnostic;
  editable: boolean;
};

export type GraphViewModel = {
  version: 1;
  mode: GraphViewModelMode;
  nodes: GraphViewModelNode[];
  edges: GraphViewModelEdge[];
  viewport?: { x: number; y: number; zoom: number };
  capabilities: {
    editable: boolean;
    canAddRole: boolean;
    canAddEdge: boolean;
    canDelete: boolean;
  };
  validation: {
    ok: boolean;
    diagnostics: StudioDiagnosticDto[];
  };
};

export function normalizeStudioGraphTargetRoleId(roleId: unknown): string {
  const value = String(roleId ?? "");
  return value === STUDIO_SYSTEM_END_ROLE_ID ? "output" : value;
}

export function normalizeStudioGraphStoredRoleId(roleId: unknown): string {
  const value = String(roleId ?? "");
  return value === "output" ? STUDIO_SYSTEM_END_ROLE_ID : value;
}

export function studioFlowKey(flow: Pick<StudioAuthoringFlow, "fromRoleId" | "eventType" | "toRoleId">): string {
  return `${flow.fromRoleId}:${flow.eventType}:${normalizeStudioGraphTargetRoleId(flow.toRoleId)}`;
}
