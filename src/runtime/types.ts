export type Flow = {
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
};

export const SYSTEM_END_ROLE_ID = "__system_end__";

export type GraphRoutingMode = "parallel_split";

export type GraphJoinMode = "all_of";

export type GraphMetadata = {
  routingModeByRoleId: Record<string, GraphRoutingMode>;
  joinModeByRoleId: Record<string, GraphJoinMode>;
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
  graph?: GraphMetadata;
};

export type RoleExecutionBinding =
  | {
      kind: "model";
      modelId: string;
    }
  | {
      kind: "profile";
      profileId: string;
    }
  | {
      kind: "noop";
    };

export type ExecutionPlanNode = {
  roleId: string;
  incoming: Flow[];
  outgoing: Flow[];
  routingMode?: GraphRoutingMode;
  joinMode?: GraphJoinMode;
  joinSources: string[];
  loopMax?: number;
  binding: RoleExecutionBinding;
  isTerminal: boolean;
};

export type ExecutionPlan = {
  systemId: string;
  systemVersion: string;
  lawBinding: LawBinding;
  entryRoleId: string;
  roleIds: string[];
  flows: Flow[];
  nodesByRoleId: Map<string, ExecutionPlanNode>;
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
  inputSchemaPath?: string;
  outputSchema: unknown;
  outputSchemaPath: string;
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
};

export type RuntimeConfig = {
  configVersion?: string;
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
  errorEnvelope?: RuntimeErrorEnvelope;
  repair?: RoleOutputRepairRecord;
  correctionRequest?: RoleOutputCorrectionRequest;
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

export type GraphRunStatus = "running" | "done" | "failed";

export type GraphState = {
  userPrompt: string;
  status: GraphRunStatus;
  error: string;
  errorEnvelope?: RuntimeErrorEnvelope;
  transitionCount: number;
  auditTrail: AuditRecord[];
  roleResults: Record<string, StoredRoleResult>;
  branchRecords: Record<string, BranchRecord>;
  loopIterations: Record<string, number>;
  selectedEventByRoleId: Record<string, string>;
  finalOutput: string;
  finalRoleId: string;
  lastExecutedRoleId: string;
};

export type RoleInputProjection = {
  role_id: string;
  task: string;
  context: string;
  allowed_events: string[];
  last_output: string;
  system_notes: string;
  round: number;
  user_profile: UserProfile | Record<string, never>;
};

export type SystemStateSnapshot = {
  status: GraphRunStatus;
  currentRoleId: string;
  nextRoleId?: string;
  finalRoleId?: string;
  transitionCount: number;
  totalTransitions: number;
  okCount: number;
  failedCount: number;
  noopCount: number;
  failureCountsByErrorCode: Record<string, number>;
  lastOutput?: string;
  error?: string;
  errorEnvelope?: RuntimeErrorEnvelope;
};

export type RunSummarySnapshot = {
  totalTransitions: number;
  okCount: number;
  failedCount: number;
  noopCount: number;
  failureCountsByErrorCode: Record<string, number>;
  repairStats: {
    attemptedCount: number;
    appliedCount: number;
  };
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
  runSummary: RunSummarySnapshot;
  stages: StageSnapshot[];
  auditTrail: AuditRecord[];
  error?: string;
  errorEnvelope?: RuntimeErrorEnvelope;
};

export type JsonSchemaValidationIssue = {
  path: string;
  message: string;
};

export type RoleOutputFailureKind = "invalid_json" | "schema_mismatch" | "unknown_event";

export type RoleOutputRepairRecord = {
  kind: RoleOutputFailureKind;
  attempted: boolean;
  applied: boolean;
  strategy: string;
  detail: string;
};

export type RoleOutputCorrectionRequest = {
  roleId: string;
  reason: RoleOutputFailureKind;
  rawOutput: string;
  allowedEvents: string[];
  schemaPath?: string;
  detail: string;
};

export type RunArtifactRetention = "runtime_consumed" | "operator_latest" | "history_only";

export type RunArtifactPolicyEntry = {
  path: string;
  retention: RunArtifactRetention;
  resumeConsumed: boolean;
  description: string;
};

export type RuntimeErrorStage =
  | "parse"
  | "validate"
  | "compile"
  | "resume"
  | "execute"
  | "lint"
  | "config"
  | "cli"
  | "doctor";

export type RuntimeErrorCategory =
  | "input"
  | "config"
  | "state"
  | "validation"
  | "execution"
  | "io"
  | "system";

export type RuntimeErrorEnvelope = {
  errorCode: string;
  errorCategory: RuntimeErrorCategory;
  message: string;
  retryable: boolean;
  stage: RuntimeErrorStage;
  roleId?: string;
  runId?: string;
  branchId?: string;
  line?: number;
};
