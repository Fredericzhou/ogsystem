import type { SemanticIRConditionAst } from "../runtime/semantic-ir.js";

export type DesignDiagnosticSeverity = "info" | "warning" | "error";

export type DesignDiagnostic = {
  code: string;
  severity: DesignDiagnosticSeverity;
  message: string;
  path?: string;
  seatId?: string;
  transitionId?: string;
};

export type DesignBinding =
  | {
      kind: "model";
      modelRef?: string;
    }
  | {
      kind: "exec";
      profileId?: string;
    }
  | {
      kind: "noop";
    };

export type DesignSeat = {
  seatId: string;
  title?: string;
  responsibility?: string;
  rolePackageRef: string;
  binding: DesignBinding;
  routingMode?: "parallel_split";
  routeOrder?: string[];
  join?: {
    mode: "all_of" | "quorum_of";
    sources: string[];
    min?: number;
  };
  loop?: {
    maxRounds: number;
  };
  review?: {
    mode: "required";
    timeoutSeconds?: number;
    timeoutAction?: "pause" | "terminate";
    reworkTargetSeatId?: string;
    reworkMax?: number;
    terminateScope?: "branch" | "run";
  };
  contextMap?: Record<string, string>;
};

export type DesignTransition = {
  transitionId: string;
  fromSeatId: string;
  toSeatId: string | "__system_end__";
  eventType: string;
  label?: string;
  condition?: SemanticIRConditionAst;
  priority?: number;
  channel?: "normal" | "error" | "loop" | "join";
};

export type StateDefinition = {
  schemaVersion: number;
  ref?: string;
  reducers?: Record<string, "replace" | "merge" | "append" | "increment" | "max" | "set-once">;
  defaults?: Record<string, unknown>;
};

export type RuntimePolicy = {
  maxTransitionsPerRun?: number;
  forbiddenToolRefs?: string[];
  allowNoopWithoutExecutionBinding?: boolean;
  errorFlowsEnabled?: boolean;
};

export type DesignLayoutNode = {
  x: number;
  y: number;
  width?: number;
  height?: number;
};

export type SystemDesignDocument = {
  schemaVersion: 1;
  revision: number;
  intent: {
    objective: string;
    inputs: string[];
    outputs: string[];
    constraints: string[];
    acceptanceCriteria: string[];
  };
  system: {
    systemId: string;
    systemVersion: string;
    entrySeatId: string;
    entryEventType?: string;
    lawGlobalRef: string;
    handoffMode?: "strict" | "transition";
    handoffContracts?: string;
  };
  seats: Record<string, DesignSeat>;
  transitions: DesignTransition[];
  state: StateDefinition;
  contracts: unknown[];
  policies: RuntimePolicy;
  bindings: Record<string, DesignBinding>;
  presentation: {
    nodes: Record<string, DesignLayoutNode>;
    viewport?: { x: number; y: number; zoom: number };
  };
};

export type DesignOperation =
  | { type: "addSeat"; seat: DesignSeat; layout?: DesignLayoutNode }
  | { type: "updateSeat"; seatId: string; patch: Partial<DesignSeat> }
  | { type: "deleteSeat"; seatId: string }
  | { type: "addTransition"; transition: DesignTransition }
  | { type: "updateTransition"; transitionId: string; patch: Partial<DesignTransition> }
  | { type: "deleteTransition"; transitionId: string }
  | { type: "setJoinPolicy"; seatId: string; join?: DesignSeat["join"] }
  | { type: "setLoopPolicy"; seatId: string; loop?: DesignSeat["loop"] }
  | { type: "setReviewPolicy"; seatId: string; review?: DesignSeat["review"] }
  | { type: "setContextMapping"; seatId: string; contextMap: Record<string, string> }
  | { type: "bindModel"; seatId: string; modelRef: string }
  | { type: "bindTool"; seatId: string; profileId: string }
  | { type: "setStateSchema"; state: StateDefinition }
  | { type: "setContracts"; contracts: unknown[] }
  | { type: "setPolicies"; policies: RuntimePolicy }
  | { type: "setBindings"; bindings: Record<string, DesignBinding> }
  | { type: "setSystem"; system: SystemDesignDocument["system"] }
  | { type: "setIntent"; intent: SystemDesignDocument["intent"] }
  | { type: "setPresentation"; presentation: SystemDesignDocument["presentation"] };

export type DesignAssumption = {
  id: string;
  text: string;
  affects: string[];
  confidence?: number;
};

export type ChangeSet = {
  id: string;
  baseRevision: number;
  summary: string;
  assumptions: DesignAssumption[];
  operations: DesignOperation[];
  affectedPaths: string[];
  diagnostics: DesignDiagnostic[];
  confidence?: number;
};

export type DesignValidationResult = {
  ok: boolean;
  diagnostics: DesignDiagnostic[];
  design?: SystemDesignDocument;
};

export type DesignContextSnapshot = {
  projectRevision: number;
  designDigest: string;
  supportedCapabilities: Record<string, boolean>;
  currentDesign: Pick<SystemDesignDocument, "system" | "seats" | "transitions" | "state" | "policies">;
  selectedScope?: {
    seatId?: string;
    transitionId?: string;
  };
  diagnostics: DesignDiagnostic[];
};
