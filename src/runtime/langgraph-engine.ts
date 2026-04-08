import type { AuditRecord, SystemDefinition } from "./types.js";

export type LangGraphRoutingMode = "sequential" | "parallel_split";
export type LangGraphJoinMode = "all_of";

export type LangGraphEngineHints = {
  engine: "langgraph";
  routingModeByRoleId: Record<string, LangGraphRoutingMode>;
  joinModeByRoleId: Record<string, LangGraphJoinMode>;
  joinSourcesByRoleId: Record<string, string[]>;
  loopMaxByRoleId: Record<string, number>;
};

export type LangGraphBranchState = {
  branchId: string;
  roleId: string;
  loopIteration: number;
};

export type LangGraphRunState = {
  status: "running" | "done" | "failed";
  activeBranches: LangGraphBranchState[];
  pendingJoinRoleIds: string[];
  error?: string;
};

export type LangGraphEngineResult = {
  state: LangGraphRunState;
  auditTrail: AuditRecord[];
  finalOutput?: string;
};

export type LangGraphEngineRunArgs = {
  system: SystemDefinition;
  hints: LangGraphEngineHints;
  prompt: string;
  workdir: string;
  dryRun?: boolean;
};

export type LangGraphEngine = {
  run(args: LangGraphEngineRunArgs): Promise<LangGraphEngineResult>;
};
