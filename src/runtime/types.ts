import type { SemanticIR, SemanticIRConditionAst } from "./semantic-ir.js";

/**
 * Core System & Graph Definitions
 * -------------------------------
 * Captures the immutable System contract that the runtime executes against.
 * In OGS, System is a bounded collaboration organization: it declares abstract Responsibility
 * Roles, their transitions, contracts, and policies. It is not an HR organization chart and does
 * not contain concrete people or operator identities.
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

export const SYSTEM_START_ROLE_ID = "__system_start__";
export const SYSTEM_END_ROLE_ID = "__system_end__";

export type SystemStartDispatch =
  | { mode: "all" }
  | { mode: "random_n"; count: number };

export type GraphRoutingMode = "parallel_split";

export type GraphJoinMode = "all_of" | "quorum_of";

export type SystemEndJoin = {
  mode: GraphJoinMode;
  min?: number;
};

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

export type HumanReviewDecision = "approve" | "rework" | "pause" | "terminate";

export type HumanReviewSpec = {
  mode: "required";
  timeoutSeconds?: number;
  timeoutAction: "pause" | "terminate";
  reworkTargetRoleId: string;
  reworkMax?: number;
  terminateScope: "branch" | "run";
};

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
  reviewByRoleId?: Record<string, HumanReviewSpec>;
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
  /** Derived from explicit Start -> Role flows. */
  entryRoleIds: string[];
  startDispatch: SystemStartDispatch;
  startEventType: string;
  /** Explicit Start -> Role flows are kept separate from executable role flows. */
  startFlows: Flow[];
  endJoin?: SystemEndJoin;
  terminalRoleOrder?: string[];
  roleIds: string[];
  flows: Flow[];
  lawBinding: LawBinding;
  executionBinding: Record<string, string>;
  modelBinding: Record<string, string>;
  /** Resolves runtime role ids to role-package ids without changing the consumer map keys. */
  rolePackageRefByRoleId?: Record<string, string>;
  graph?: GraphMetadata;
};

/**
 * Execution Plan
 * --------------
 * A compiled version of the SystemDefinition, optimized for the runtime engine.
 * Maps roles to their execution bindings and defines graph topology for traversal.
 */

/**
 * Defines how a Responsibility Role is technically realized for one run.
 * This is an execution binding, not the role's identity or a personnel assignment. Only one
 * binding kind is allowed, ensuring deterministic routing.
 */
export type RoleExecutionBinding =
  | {
      kind: "model";
      backend: string;
      modelId: string;
      modelRef: string;
      fallback?: ResolvedFallbackModel;
      variant?: string;
      reasoningEffort?: ReasoningEffort;
      effectiveReasoningEffort?: ReasoningEffortLevel;
      /** Effective value frozen by a previous attempt and replayed on resume. */
      frozenReasoningEffort?: ReasoningEffortLevel;
      timeoutMs?: number;
      maxOutputBytes?: number;
      bindingSource: "selection";
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
  /** Compiled execution-role mode; distinct from graph routing mode. */
  executionMode?: string;
  modeAllowedEvents?: string[];
  incoming: Flow[];
  outgoing: Flow[];
  routingMode?: GraphRoutingMode;
  joinMode?: GraphJoinMode;
  joinSources: string[];
  joinMin?: number;
  contextMap?: Record<string, string>;
  loopMax?: number;
  review?: HumanReviewSpec;
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
  /** All candidate roles connected directly from Start. */
  entryRoleIds: string[];
  startDispatch: SystemStartDispatch;
  startEventType: string;
  endJoin: SystemEndJoin;
  /** Only roles with a direct Role -> End flow, in graph order. */
  terminalRoleOrder: string[];
  roleIds: string[];
  flows: Flow[];
  nodesByRoleId: Map<string, ExecutionPlanNode>;
  semanticIR?: SemanticIR;
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
    maxPromptCharsPerRole?: number;
    maxTotalPromptCharsPerRun?: number;
    isolateExternalData?: boolean;
  };
};

export type LawCatalog = {
  laws: LawSpec[];
};

export type EffectiveLawConstraints = {
  forbiddenToolRefs: string[];
  maxTransitions?: number;
  allowNoopWithoutExecutionBinding: boolean;
  maxPromptCharsPerRole?: number;
  maxTotalPromptCharsPerRun?: number;
  isolateExternalData: boolean;
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
  /** Stable responsibility identity; it is not a concrete person or runtime execution id. */
  roleId: string;
  /** Version of this implementation contract, included in runtime fingerprints. */
  roleVersion: string;
  name: string;
  description: string;
  promptTemplate: string;
  outputSchema: string;
  /** OGS responsibility contract. Roles are abstract responsibilities, never people or models. */
  contractVersion: 1;
  purpose: string;
  responsibility: {
    kind: "atomic" | "composite";
    owns: string[];
    contributes: string[];
    doesNotOwn: string[];
    composition?: {
      nestedSystemRef: string;
      inputContract: string;
      outputContract: string;
      stateNamespace: string;
      checkpointNamespace: string;
      errorPropagation: "fail" | "route" | "contain";
      terminationPropagation: "propagate" | "contain";
    };
  };
  inputs: { preconditions: SemanticIRConditionAst[] };
  outputs: { events: string[]; postconditions: SemanticIRConditionAst[] };
  authority: { controlActions: Array<"approve" | "rework" | "pause" | "terminate"> };
  constraints: { writableStateFields: string[]; allowedTools: string[] };
  failure: { retryableErrorCodes: string[]; terminalErrorCodes: string[] };
  audit: { requiredFields: string[] };
  preferredModelTags?: string[];
  tags?: string[];
};

export type LoadedRolePackage = {
  resolvedPath: string;
  manifest: RolePackageManifest;
  promptTemplate: string;
  outputSchema: unknown;
  outputSchemaPath: string;
  agent: string;
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

export type RuntimeToolEnvironmentConfig = {
  environmentPolicy: "inherit" | "minimal";
  envAllowlist: string[];
};

export type RuntimeConfig = {
  configVersion?: string;
  executor: "opencode";
  roleRepo: string;
  runsDir: string;
  sharedDir?: string;
  workspace: RuntimeWorkspaceConfig;
  retention?: RuntimeRetentionConfig;
  redaction?: RuntimeRedactionConfig;
  tools: RuntimeToolEnvironmentConfig;
  opencode?: {
    baseArgs?: string[];
  };
  runtime: {
    error_flows: {
      v1: boolean;
    };
  };
};

export type ModelCatalogCapabilitySummary = {
  textInput: boolean;
  textOutput: boolean;
  toolcall: boolean;
};

/** Canonical OGS reasoning/thinking selection values. Provider-specific values stay in adapters. */
export type ReasoningEffort =
  | "auto"
  | "off"
  | "on"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export type ReasoningEffortLevel = Exclude<ReasoningEffort, "auto">;
export type ReasoningEffortCapability = {
  supported: true;
  kind: "effort";
  levels: Array<Exclude<ReasoningEffortLevel, "on">>;
  default?: Exclude<ReasoningEffortLevel, "on">;
};
export type ReasoningToggleCapability = {
  supported: true;
  kind: "toggle";
  levels: Array<"off" | "on">;
  default?: "off" | "on";
};
export type ReasoningNoneCapability = {
  supported: false;
  kind: "none";
  levels: [];
  default?: never;
};
export type ReasoningCapability =
  | ReasoningEffortCapability
  | ReasoningToggleCapability
  | ReasoningNoneCapability;

export type ResolvedFallbackModel = {
  backend: string;
  modelId: string;
  modelRef: string;
  reasoningEffort?: ReasoningEffort;
  effectiveReasoningEffort?: ReasoningEffortLevel;
};

export type ReasoningResolution = {
  requested: ReasoningEffort;
  effective?: ReasoningEffortLevel;
  kind: ReasoningCapability["kind"];
  supported: boolean;
  capabilityDigest?: string;
  providerValue?: string;
};

export type ReasoningErrorCode =
  | "REASONING_UNSUPPORTED"
  | "REASONING_CONFIG_FAILED"
  | "REASONING_CAPABILITY_UNKNOWN";

export type ModelCatalogSourceStatus =
  | "runnable"
  | "unavailable"
  | "not_installed"
  | "installed_but_broken"
  | "service_unavailable";

export type ModelCatalogSource = {
  backend: string;
  displayName: string;
  iconKey: string;
  transport: "http" | "stdio-jsonrpc" | "cli-stdio" | "acp-stdio" | "acp-http" | "rpc-stdio";
  sessionKind: "server-session" | "app-server-thread" | "logical-session" | "process-session";
  processOwnership: "spawned_by_ogs" | "attached_external";
  status: ModelCatalogSourceStatus;
  detail?: string;
};

export type ModelCatalogEntry = {
  backend: string;
  modelId: string;
  runnable: boolean;
  name?: string;
  status?: string;
  capabilities: ModelCatalogCapabilitySummary;
  variants: string[];
  reasoning?: ReasoningCapability;
};

export type ModelCatalog = {
  catalogVersion: "3";
  generatedAt: string;
  sources: ModelCatalogSource[];
  models: ModelCatalogEntry[];
};

export type ModelSelectionDefaults = {
  backend?: string;
  modelId?: string;
  variant?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  reasoningEffort?: ReasoningEffort;
  fallback?: ResolvedFallbackModel;
};

export type ModelSelectionRoleOverride = {
  backend?: string;
  modelId?: string;
  variant?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  reasoningEffort?: ReasoningEffort;
  fallback?: ResolvedFallbackModel;
};

export type ModelSelectionSystemOverride = {
  defaults?: ModelSelectionDefaults;
  roles?: Record<string, ModelSelectionRoleOverride>;
};

export type ModelSelectionConfig = {
  configVersion: "3";
  defaults?: ModelSelectionDefaults;
  roles?: Record<string, ModelSelectionRoleOverride>;
};

/**
 * Immutable log entry for every role execution. Optional IDs exist so recovery can trace
 * specific sessions/branches when rerunning checkpoints or investigating failures.
 */
export type AuditRecord = {
  at: string;
  roleId: string;
  branchId?: string;
  lineageId?: string;
  joinId?: string;
  loopIteration?: number;
  lawRef?: string;
  modelId?: string;
  backend?: string;
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
  executionId?: string;
  attempt?: number;
  maxAttempts?: number;
  promptCalls?: PromptCallMeterRecord[];
  projectedInputChars?: number;
  renderedPromptChars?: number;
  outputChars?: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  externalDataIsolated?: boolean;
  fallbackUsed?: boolean;
  primaryModelId?: string;
  requestedReasoningEffort?: ReasoningEffort;
  effectiveReasoningEffort?: ReasoningEffortLevel;
  reasoningKind?: ReasoningCapability["kind"];
  reasoningSupported?: boolean;
  reasoningErrorCode?: ReasoningErrorCode;
};

export type PromptCallMeterRecord = {
  callId: string;
  executionId: string;
  phase: "primary" | "fallback" | "repair";
  modelId?: string;
  projectedInputChars: number;
  renderedPromptChars: number;
  outputChars: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
};

export type RunPromptBudgetLedger = {
  maxTotalPromptCharsPerRun?: number;
  legacyBaseCommittedChars: number;
  committedChars: number;
  reservedChars: number;
  committedByCallId: Map<string, number>;
  reservedByCallId: Map<string, number>;
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
  backend?: string;
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
  reviewsDir: string;
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
  promptBudgetLedgerPath: string;
  promptBudgetLedger: RunPromptBudgetLedger;
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
  status: "active" | "waiting_review" | "completed" | "cancelled";
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

export type PendingHumanReview = {
  reviewId: string;
  roleId: string;
  branchId: string;
  lineageId: string;
  loopIteration: number;
  executionId: string;
  selectedEvent?: string;
  draftResult: StoredRoleResult;
  requestedAt: string;
  requestedByExecutionId: string;
  status: "pending" | "paused" | "resolved" | "expired";
  round: number;
  spec: HumanReviewSpec;
  stateVersion?: number;
  irDigest?: string;
};

export type HumanReviewContext = {
  reviewId: string;
  branchId: string;
  round: number;
  comment?: string;
  previousOutput: StoredRoleResult;
};

export type HumanReviewDecisionRecord = {
  reviewId: string;
  committedAt: string;
  decidedAt: string;
  decision: HumanReviewDecision;
  timedOut?: boolean;
  expiredAt?: string;
  comment?: string;
  actor?: string;
  principal?: import("./identity.js").ControlPlanePrincipal;
  scope?: "branch" | "run";
  checkpointSequence?: number;
  appliedAt?: string;
  reconciledAt?: string;
};

export type GraphRunStatus = "running" | "stopping" | "stopped" | "terminated" | "done" | "failed";

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
  promptCallsByCallId?: Record<string, PromptCallMeterRecord>;
  committedPromptCharsByCallId?: Record<string, number>;
  legacyBaseCommittedChars?: number;
  totalProjectedInputChars?: number;
  totalRenderedPromptChars?: number;
  totalOutputChars?: number;
  totalEstimatedInputTokens?: number;
  totalEstimatedOutputTokens?: number;
  fallbackActivationCount?: number;
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
  /** Monotonic business-state version used by versioned persistence adapters. */
  stateVersion: number;
  lastEventId?: string;
  userPrompt: string;
  selectedEntryRoleIds: string[];
  /** User/business state governed by Semantic IR reducers; runtime metadata stays separate. */
  businessState?: Record<string, unknown>;
  status: GraphRunStatus;
  error: string;
  errorEnvelope?: RuntimeErrorEnvelope;
  transitionCount: number;
  recentAudits: AuditRecord[];
  auditSummary: GraphAuditSummary;
  roleMetricsByRoleId: Record<string, GraphRoleMetricSummary>;
  roleResults: Record<string, StoredRoleResult>;
  pendingReviewsById: Record<string, PendingHumanReview>;
  reviewHistoryByBranchId: Record<string, HumanReviewDecisionRecord[]>;
  humanReviewContextByBranchId: Record<string, HumanReviewContext>;
  reviewRoundByRoleLineageKey: Record<string, number>;
  lastWaitingReviewId?: string;
  branchRecords: Record<string, BranchRecord>;
  loopIterations: Record<string, number>;
  /** Business loop counters keyed by lineageId + loopId; role loopIterations is a projection. */
  loopCountersByScope?: Record<string, number>;
  /** Per-role activation guards keyed by lineageId + roleId. */
  roleActivationsByScope?: Record<string, number>;
  joinScopes?: Record<string, JoinScopeState>;
  selectedEventByBranchId: Record<string, string>;
  finalOutputsByRoleId: Record<string, Array<{ content?: string; data?: Record<string, unknown> }>>;
  finalOutputRoleOrder: string[];
  finalRoleIds: string[];
  lastExecutedRoleId: string;
  nextBranchSequence: number;
  lastCheckpointSequence: number;
};

export type JoinScopeState = {
  joinId: string;
  runId: string;
  joinRoleId: string;
  lineageId: string;
  loopIteration: number;
  joinMode?: GraphJoinMode;
  joinMin?: number;
  expectedSourceRoleIds: string[];
  readySourceRoleIds: string[];
  missingSourceRoleIds: string[];
  startedAt: string;
  timeoutSeconds: number;
  status: "waiting" | "activated" | "timed_out" | "failed";
  timeoutAction?: "fail" | "quorum_continue" | "pause" | "terminate";
  failurePolicy?: "wait" | "fail" | "quorum_continue";
  resolutionReason?: string;
  resolutionAction?: "fail" | "pause" | "terminate";
  completedAt?: string;
};

export type GraphStateUpdate = Partial<GraphState>;

/**
 * Append-only WAL record written after a durable role outcome. `update` is intentionally partial so
 * resume can replay only the state delta that became durable at that checkpoint.
 */
export type RuntimeCheckpointRecord = {
  checkpointSequence: number;
  eventId?: string;
  expectedStateVersion?: number;
  resultingStateVersion?: number;
  idempotencyKey?: string;
  irDigest?: string;
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
      supersededByExecutionId?: string;
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
      supersededByExecutionId?: string;
      status: "failed";
      error: string;
      failure: RuntimeErrorEnvelope;
      audit: AuditRecord;
    };

export type RoleInputProjection = {
  role_id: string;
  mode?: string;
  task: string;
  input: string;
  allowed_events: string[];
  user_preferences: UserProfile | Record<string, never>;
};

export type SystemStateSnapshot = {
  status: GraphRunStatus;
  currentRoleId: string;
  nextRoleId?: string;
  finalRoleIds?: string[];
  transitionCount: number;
  totalTransitions: number;
  okCount: number;
  failedCount: number;
  noopCount: number;
  failureCountsByErrorCode: Record<string, number>;
  finalOutputsByRoleId?: GraphState["finalOutputsByRoleId"];
  finalOutputRoleOrder?: string[];
  error?: string;
  errorEnvelope?: RuntimeErrorEnvelope;
  pendingReviewCount?: number;
  hasWaitingHumanReview?: boolean;
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
  committedPromptCharsByCallId?: Record<string, number>;
  legacyBaseCommittedChars?: number;
  totalProjectedInputChars?: number;
  totalRenderedPromptChars?: number;
  totalOutputChars?: number;
  totalEstimatedInputTokens?: number;
  totalEstimatedOutputTokens?: number;
  fallbackActivationCount?: number;
  pendingReviewCount?: number;
  hasWaitingHumanReview?: boolean;
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
  status: "done" | "failed" | "stopped" | "terminated";
  finalRoleIds?: string[];
  finalOutputsByRoleId?: GraphState["finalOutputsByRoleId"];
  finalOutputRoleOrder?: string[];
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
