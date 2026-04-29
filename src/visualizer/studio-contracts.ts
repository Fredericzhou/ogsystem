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
  runtimeOnlyErrorFlow?: boolean;
};

export type StudioCanvasDocument = {
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

export type StudioGraphProjectionNode = {
  id: string;
  roleId: string;
  kind: "role" | "boundary";
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  badges: string[];
  bindingKind: StudioAuthoringRole["bindingKind"] | "boundary";
  editable: boolean;
  severity?: "warning" | "error";
};

export type StudioGraphProjectionEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  eventType: string;
  runtimeOnlyErrorFlow: boolean;
  participatesInJoin: boolean;
  editable: boolean;
  severity?: "warning" | "error";
};

export type StudioGraphProjection = {
  version: 1;
  nodes: StudioGraphProjectionNode[];
  edges: StudioGraphProjectionEdge[];
  capabilities: {
    editable: boolean;
    canAddRole: boolean;
    canAddEdge: boolean;
    canDelete: boolean;
  };
  validation: {
    ok: boolean;
    diagnostics: Array<{
      code?: string;
      message?: string;
      severity?: string;
      roleId?: string;
      selector?: string;
      flowKey?: string;
    }>;
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
