export type Flow = {
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
};

export const SYSTEM_END_ROLE_ID = "__system_end__";

export type LangGraphRoutingMode = "parallel_split";

export type LangGraphJoinMode = "all_of";

export type LangGraphHints = {
  routingModeByRoleId: Record<string, LangGraphRoutingMode>;
  joinModeByRoleId: Record<string, LangGraphJoinMode>;
  joinSourcesByRoleId: Record<string, string[]>;
  loopMaxByRoleId: Record<string, number>;
};

export type LawBinding = {
  globalLawRef: string;
};

export type SystemDefinition = {
  systemId: string;
  systemVersion: string;
  entryRoleId: string;
  roleIds: string[];
  flows: Flow[];
  lawBinding: LawBinding;
  talentBinding: Record<string, string>;
  executionBinding: Record<string, string>;
  modelBinding: Record<string, string>;
  langGraph?: LangGraphHints;
};

export type ExecutionProfile = {
  profileId: string;
  toolRef: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type CliTool = {
  toolRef: string;
  runner: "local_shell";
  command: string;
  argsTemplate: string[];
  stdinMode: "none" | "text";
};

export type CliToolRegistry = {
  tools: CliTool[];
};

export type LawSpec = {
  lawId: string;
  constraints?: {
    forbiddenToolRefs?: string[];
    maxTransitions?: number;
    allowNoopWithoutExecutionBinding?: boolean;
  };
};

export type LawCatalog = {
  laws: LawSpec[];
};

export type EffectiveLawConstraints = {
  forbiddenToolRefs: string[];
  maxTransitions?: number;
  allowNoopWithoutExecutionBinding: boolean;
};

export type RoleExecutionOutput = {
  event?: string;
  content?: string;
  data?: Record<string, unknown>;
};

export type RolePackageManifest = {
  roleId: string;
  roleVersion: string;
  name: string;
  description: string;
  promptTemplate: string;
  inputSchema?: string;
  outputSchema: string;
  talent?: Record<string, string>;
  preferredModelTags?: string[];
  tags?: string[];
};

export type LoadedRolePackage = {
  resolvedPath: string;
  manifest: RolePackageManifest;
  promptTemplate: string;
  inputSchema?: unknown;
  outputSchema: unknown;
  persona?: string;
  work?: string;
};

export type ModelPackageManifest = {
  modelId: string;
  executor: "opencode";
  model: string;
  args?: Record<string, string | boolean>;
  timeoutMs?: number;
  maxOutputBytes?: number;
  tags?: string[];
};

export type LoadedModelPackage = {
  resolvedPath: string;
  manifest: ModelPackageManifest;
};

export type UserProfile = {
  userProfileId: string;
  language?: string;
  style?: string;
  riskPreference?: string;
  outputLength?: string;
  domainBackground?: string[];
};

export type RuntimeWorkspaceConfig = {
  rolesDir: string;
  privateDirName: string;
  linkSharedIntoRoleDir: boolean;
};

export type RuntimeConfig = {
  executor: "opencode";
  roleRepo: string;
  modelRepo: string;
  runsDir: string;
  sharedDir?: string;
  workspace: RuntimeWorkspaceConfig;
  opencode?: {
    baseArgs?: string[];
  };
};

export type AuditRecord = {
  at: string;
  roleId: string;
  branchId?: string;
  joinId?: string;
  loopIteration?: number;
  lawRef?: string;
  modelId?: string;
  profileId?: string;
  toolRef?: string;
  command?: string;
  args?: string[];
  sessionId?: string;
  messageId?: string;
  serverPid?: number;
  exitCode: number;
  durationMs: number;
  selectedEvent?: string;
  nextRoleId?: string;
  status: "ok" | "failed" | "noop";
  stdoutPreview?: string;
  stderrPreview?: string;
  error?: string;
};

export type RoleRunDirs = {
  roleDir: string;
  privateDir: string;
  executionsDir: string;
  sessionPath: string;
};

export type RoleExecutionRecord = {
  executionId: string;
  executionIndex: number;
  executionDir: string;
  roleId: string;
  sessionKey: string;
  startedAt: string;
  branchId?: string;
  loopIteration?: number;
};

export type OpencodeSessionRecord = {
  sessionKey: string;
  roleId: string;
  sessionId: string;
  directory: string;
  createdAt: string;
  lastPromptAt: string;
  lastMessageId?: string;
  promptCount: number;
};

export type RunContext = {
  runId: string;
  runDir: string;
  auditDir: string;
  eventsPath: string;
  statePath: string;
  opencodeServerPath: string;
  sessionsPath: string;
  roleDirsById: Map<string, RoleRunDirs>;
  roleExecutionCounts: Map<string, number>;
  sessionRecordsByRoleId: Map<string, OpencodeSessionRecord>;
  sharedDir: string;
  opencodeServerUrl?: string;
  opencodeServerPid?: number;
  opencodeServerStartedAt?: string;
};

export type BranchRecord = {
  branchId: string;
  roleId: string;
  loopIteration: number;
  status: "active" | "completed";
};

export type StoredRoleResult = {
  roleId: string;
  event?: string;
  content?: string;
  data?: Record<string, unknown>;
  branchId?: string;
  loopIteration: number;
};

export type SystemStateSnapshot = {
  status: "running" | "done" | "failed";
  currentRoleId: string;
  nextRoleId?: string;
  finalRoleId?: string;
  transitionCount: number;
  lastOutput?: string;
  error?: string;
};

export type StageSnapshot = {
  stageId: string;
  at: string;
  phase: "RUNNING" | "TERMINAL" | "FAILED";
  roleId: string;
  selectedEvent?: string;
  nextRoleId?: string;
  notes?: string;
};

export type AdapterRunResult = {
  systemId: string;
  systemVersion: string;
  lawRef: string;
  status: "done" | "failed";
  finalRoleId?: string;
  finalOutput?: string;
  systemState: SystemStateSnapshot;
  stages: StageSnapshot[];
  auditTrail: AuditRecord[];
  error?: string;
};
