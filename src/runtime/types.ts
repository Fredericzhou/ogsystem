/**
 * Core System & Graph Definitions
 * -------------------------------
 * Captures the immutable system contract that the runtime executes against.
 * Responsibilities: describe role topology, binding metadata, and join/routing rules.
 * Boundaries: this file does not cover live state or execution telemetry.
 * Trade-off: keeping contracts lean keeps parsing/validation simple but requires extra
 * annotations elsewhere when additional runtime features are added.
 */

/**
 * A deterministic transition that maps fromRoleId to toRoleId with a well-defined eventType.
 */
export type Flow = {
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
};

export const SYSTEM_END_ROLE_ID = "__system_end__";

export type GraphRoutingMode = "parallel_split";

export type GraphJoinMode = "all_of" | "quorum_of";

export type HandoffMode = "strict" | "transition";

export type FlowContractKind = "flow" | "role_input";

export type FlowContractViolationPolicy = "FAIL" | "WARN";

export type FlowContractMatch = {
  fromRoleId?: string;
  eventType?: string;
  toRoleId?: string;
  mode?: "split";
  roleId?: string;
};

export type FlowContractDefinition = {
  id: string;
  kind: FlowContractKind;
  match: FlowContractMatch;
  schema: string;
  onViolation?: FlowContractViolationPolicy;
};

export type FlowContractFile = {
  version: number;
  contracts: FlowContractDefinition[];
};

export type CompiledFlowContract = {
  definition: FlowContractDefinition;
  schema: unknown;
  schemaPath: string;
};

export type FlowContractPlan = {
  handoffMode?: HandoffMode;
  contractPath?: string;
  digest: string;
  flowContractsByKey: Map<string, CompiledFlowContract>;
  roleInputContractsByRoleId: Map<string, CompiledFlowContract>;
};

export type ContextMapByRoleId = Record<string, Record<string, string>>;

/**
 * Computed graph metadata used to enforce join/routing invariants and loop budgets.
 * The runtime assumes keys exist only when corresponding metadata was declared, making
 * undefined entries equivalent to "default" behavior.
 */
export type GraphMetadata = {
  handoffMode?: HandoffMode;
  handoffContracts?: string;
  routeOrderByRoleId?: Record<string, string[]>;
  routingModeByRoleId: Record<string, GraphRoutingMode>;
  joinModeByRoleId: Record<string, GraphJoinMode>;
  joinSourcesByRoleId: Record<string, string[]>;
  joinMinByRoleId: Record<string, number>;
  contextMapByRoleId: ContextMapByRoleId;
  loopMaxByRoleId: Record<string, number>;
};

export type LawBinding = {
  globalLawRef: string;
};

/**
 * Compiled description of a system that the runtime can safely execute.
 * `graph` is optional metadata that supplements runtime planning when available.
 */
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

/**
 * Execution Plan
 * --------------
 * A compiled version of the SystemDefinition, optimized for the runtime engine.
 * Maps roles to their execution bindings and defines graph topology for traversal.
 */

/**
 * Defines how a role is fulfilled. Only one binding kind is allowed, ensuring deterministic routing.
 */
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

/**
 * Represents a role within an execution plan, including outgoing/incoming flows and optional
 * join/context metadata. For join nodes, `joinSources` carries the declared source role ids that
 * readiness checks use at runtime.
 */
export type ExecutionPlanNode = {
  roleId: string;
  incoming: Flow[];
  outgoing: Flow[];
  routingMode?: GraphRoutingMode;
  joinMode?: GraphJoinMode;
  joinSources: string[];
  joinMin?: number;
  contextMap?: Record<string, string>;
  loopMax?: number;
  binding: RoleExecutionBinding;
  isTerminal: boolean;
};

/**
 * ExecutionPlan is the runtime-ready graph. `nodesByRoleId` must include every role in `roleIds`,
 * ensuring the planner can scan predictable maps when advancing the system.
 */
export type ExecutionPlan = {
  systemId: string;
  systemVersion: string;
  lawBinding: LawBinding;
  entryRoleId: string;
  roleIds: string[];
  flows: Flow[];
  nodesByRoleId: Map<string, ExecutionPlanNode>;
};

/**
 * Laws & Constraints
 * ------------------
 * Defines the safety boundaries and operational constraints (e.g., forbidden tools,
 * max transitions) applied to the system during execution.
 */

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

/**
 * Role & Model Packages
 * ---------------------
 * Metadata and manifests for the modular role and model definitions
 * loaded from the repository.
 */

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
  outputSchema: string;
  talent?: Record<string, string>;
  preferredModelTags?: string[];
  tags?: string[];
};

export type LoadedRolePackage = {
  resolvedPath: string;
  manifest: RolePackageManifest;
  promptTemplate: string;
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

/**
 * Runtime Configuration & Context
 * ------------------------------
 * Environment settings, directory mappings, and the dynamic context
 * maintained for a specific run.
 */

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
  workspaceIsolation?: "role" | "branch";
};

export type RuntimeRetentionConfig = {
  enabled: boolean;
  executionDirThreshold: number;
  keepLatest: number;
};

export type RuntimeRedactionConfig = {
  enabled: boolean;
};

export type RuntimeConfig = {
  configVersion?: string;
  executor: "opencode";
  roleRepo: string;
  modelRepo: string;
  runsDir: string;
  sharedDir?: string;
  workspace: RuntimeWorkspaceConfig;
  retention?: RuntimeRetentionConfig;
  redaction?: RuntimeRedactionConfig;
  opencode?: {
    baseArgs?: string[];
  };
  runtime: {
    error_flows: {
      v1: boolean;
    };
  };
};

/**
 * Immutable log entry for every role execution. Optional IDs exist so recovery can trace
 * specific sessions/branches when rerunning checkpoints or investigating failures.
 */
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
  compilerDigest?: string;
  compilerDiagnosticCode?: string;
  repair?: RoleOutputRepairRecord;
  correctionRequest?: RoleOutputCorrectionRequest;
  inputContext?: string;
  handledByEvent?: string;
  handledTargetRoleId?: string;
};

export type RoleRunDirs = {
  roleDir: string;
  privateDir: string;
  executionsDir: string;
  latestSessionPath: string;
};

export type RoleExecutionRecord = {
  executionId: string;
  executionIndex: number;
  executionDir: string;
  roleId: string;
  sessionKey: string;
  sessionLineageId?: string;
  startedAt: string;
  branchId?: string;
  loopIteration?: number;
};

export type OpencodeSessionRecord = {
  sessionKey: string;
  roleId: string;
  sessionLineageId?: string;
  branchId?: string;
  sessionId: string;
  directory: string;
  createdAt: string;
  lastPromptAt: string;
  lastMessageId?: string;
  promptCount: number;
};

/**
 * Captures directories, counters, and the optional resume-lock release callback maintained during
 * a run. `roleExecutionCounts`/`executionDirCount` track allocated execution directories, and
 * `releaseResumeLock` is present only when setup acquired an advisory resume lock.
 */
export type RunContext = {
  runId: string;
  createdAt: string;
  runDir: string;
  resolvedConfigPath: string;
  auditDir: string;
  logsDir: string;
  engineLogPath: string;
  roleLogsDir: string;
  controlDir: string;
  stopRequestPath: string;
  stopOutcomePath: string;
  eventsPath: string;
  statePath: string;
  metricsPath: string;
  summaryPath: string;
  timelinePath: string;
  opencodeDir: string;
  opencodePidPath: string;
  opencodeEndpointPath: string;
  sessionsPath: string;
  checkpointsDir: string;
  roleDirsById: Map<string, RoleRunDirs>;
  roleExecutionCounts: Map<string, number>;
  executionDirCount: number;
  sessionRecordsByKey: Map<string, OpencodeSessionRecord>;
  nextCheckpointSequence: number;
  sharedDir: string;
  workspaceIsolation: "role" | "branch";
  redaction: RuntimeRedactionConfig;
  releaseResumeLock?: () => Promise<void>;
};

/**
 * Runtime State & Status
 * ----------------------
 * The live state of a graph execution, including active branches,
 * role results, and the overall status.
 */

export type BranchRecord = {
  branchId: string;
  roleId: string;
  loopIteration: number;
  branchSequence: number;
  lineageId: string;
  sessionLineageId: string;
  parentBranchId?: string;
  activatedByRoleId?: string;
  activatedByEvent?: string;
  status: "active" | "completed";
};

export type StoredRoleResult = {
  roleId: string;
  event?: string;
  content?: string;
  data?: Record<string, unknown>;
  branchId: string;
  lineageId: string;
  loopIteration: number;
};

export type GraphRunStatus = "running" | "stopping" | "stopped" | "done" | "failed";

export type GraphAuditSummary = {
  okCount: number;
  failedCount: number;
  noopCount: number;
  handledFailureCount: number;
  unhandledFailureCount: number;
  handledFailureByEvent: Record<string, number>;
  handledFailureByTargetRole: Record<string, number>;
  repairAttemptedCount: number;
  repairAppliedCount: number;
  failureCountsByErrorCode: Record<string, number>;
};

export type GraphRoleMetricSummary = {
  total: number;
  ok: number;
  failed: number;
  noop: number;
  durationMsTotal: number;
};

/**
 * Materialized runtime state persisted in `state.json` and reconstructed by replaying checkpoint
 * updates. Branch/result maps are keyed by branch id so recovery can reconcile partial progress.
 */
export type GraphState = {
  userPrompt: string;
  status: GraphRunStatus;
  error: string;
  errorEnvelope?: RuntimeErrorEnvelope;
  transitionCount: number;
  recentAudits: AuditRecord[];
  auditSummary: GraphAuditSummary;
  roleMetricsByRoleId: Record<string, GraphRoleMetricSummary>;
  roleResults: Record<string, StoredRoleResult>;
  branchRecords: Record<string, BranchRecord>;
  loopIterations: Record<string, number>;
  selectedEventByBranchId: Record<string, string>;
  finalOutput: string;
  finalRoleId: string;
  lastExecutedRoleId: string;
  nextBranchSequence: number;
  lastCheckpointSequence: number;
};

export type GraphStateUpdate = Partial<GraphState>;

/**
 * Append-only WAL record written after a durable role outcome. `update` is intentionally partial so
 * resume can replay only the state delta that became durable at that checkpoint.
 */
export type RuntimeCheckpointRecord = {
  checkpointSequence: number;
  roleId: string;
  branchId: string;
  loopIteration: number;
  executionId: string;
  update: GraphStateUpdate;
};

/**
 * Durable per-execution outcome written before its matching checkpoint. `checkpointSequence` and
 * `reconciledAt` stay unset until the graph runner either writes or matches the WAL entry.
 */
export type RoleExecutionOutcomeRecord =
  | {
      version: 1;
      executionId: string;
      roleId: string;
      branchId: string;
      loopIteration: number;
      sessionKey: string;
      branch: BranchRecord;
      committedAt: string;
      checkpointSequence?: number;
      reconciledAt?: string;
      status: "ok" | "noop";
      selectedEvent?: string;
      storedResult?: StoredRoleResult;
      audit: AuditRecord;
    }
  | {
      version: 1;
      executionId: string;
      roleId: string;
      branchId: string;
      loopIteration: number;
      sessionKey: string;
      branch: BranchRecord;
      committedAt: string;
      checkpointSequence?: number;
      reconciledAt?: string;
      status: "failed";
      error: string;
      failure: RuntimeErrorEnvelope;
      audit: AuditRecord;
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
  handledFailureCount: number;
  unhandledFailureCount: number;
  handledFailureByEvent: Record<string, number>;
  handledFailureByTargetRole: Record<string, number>;
  failureCountsByErrorCode: Record<string, number>;
  repairStats: {
    attemptedCount: number;
    appliedCount: number;
  };
};

export type HandledFailureArtifactData = {
  error_code: string;
  error_category: string;
  error_message: string;
  retryable: boolean;
  stage: string;
  failed_role: string;
  branch_id: string;
  lineage_id: string;
  loop_iteration: number;
  last_context: string;
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
  status: "done" | "failed" | "stopped";
  finalRoleId?: string;
  finalOutput?: string;
  systemState: SystemStateSnapshot;
  runSummary: RunSummarySnapshot;
  stages: StageSnapshot[];
  auditTrail: AuditRecord[];
  error?: string;
  errorEnvelope?: RuntimeErrorEnvelope;
};

/**
 * Validation & Error Handling
 * ---------------------------
 * Types for JSON Schema validation, output repair strategies,
 * and structured runtime errors.
 */

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

/**
 * Standardized error payload enriched with stage/run identifiers so recovery logic can decide
 * whether to retry, resume, or abort.
 */
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
