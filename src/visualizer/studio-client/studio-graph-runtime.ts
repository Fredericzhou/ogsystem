import type {
  GraphViewModel,
  GraphViewModelEdge,
  GraphViewModelNode,
  StudioAuthoringDocument,
} from "../studio-contracts.js";

export type StudioRuntimeExecutionRecord = {
  iteration: number;
  durationMs?: number;
  totalTokens?: number;
  status?: string;
  stage?: string;
  attempt?: number;
};

export type StudioRuntimeNodeState = {
  status?: "active" | "running" | "waiting" | "waiting_review" | "done" | "failed" | "paused" | "pending" | "idle" | "stopped";
  statusLabel?: string;
  technicalWaiting?: boolean;
  technicalWaitingStage?: string;
  errorCode?: string;
  errorMessage?: string;
  loopCount?: number;
  durationMs?: number;
  totalTokens?: number;
  history?: StudioRuntimeExecutionRecord[];
  active: boolean;
  waitingReview: boolean;
  humanGateConfigured: boolean;
};

export type StudioRuntimeEdgeState = {
  active: boolean;
  waiting: boolean;
  completed: boolean;
  error: boolean;
  errorCode?: string;
  errorMessage?: string;
  stopped: boolean;
  loopBack: boolean;
  handoffCount?: number;
  activeHandoffCount?: number;
  waitingHandoffCount?: number;
};

export type StudioRuntimeHandoffState = {
  handoffId: string;
  edgeId: string;
  branchId: string;
  targetRoleId: string;
  lineageId?: string;
  loopIteration?: number;
  executionId?: string;
  attempt?: number;
  errorCode?: string;
  errorMessage?: string;
  status: "active" | "waiting" | "completed" | "failed" | "stopped";
};

export type StudioRuntimeProgressEvent = {
  type: string;
  at?: string;
  roleId?: string;
  fromRoleId?: string;
  toRoleId?: string;
  eventType?: string;
  branchId?: string;
  lineageId?: string;
  edgeId?: string;
  handoffId?: string;
  sourceExecutionId?: string;
  sourceAttempt?: number;
  executionId?: string;
  attempt?: number;
  maxAttempts?: number;
  loopIteration?: number;
  status?: string;
  errorCode?: string;
  error?: string;
  errorEnvelope?: { errorCode?: string; message?: string };
  stage?: string;
  waitKind?: string;
  elapsedMs?: number;
  durationMs?: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  audit?: { estimatedInputTokens?: number; estimatedOutputTokens?: number; durationMs?: number };
};

export type StudioRuntimeVisualState = {
  hasRuntimeSignals: boolean;
  nodeStates: Map<string, StudioRuntimeNodeState>;
  edgeStates: Map<string, StudioRuntimeEdgeState>;
  handoffStatesById: Map<string, StudioRuntimeHandoffState>;
  activeNodeCount: number;
  waitingReviewCount: number;
  activeEdgeCount: number;
};

const STATUS_MATCHERS: Array<{
  status: NonNullable<StudioRuntimeNodeState["status"]>;
  patterns: RegExp[];
}> = [
  {
    status: "waiting_review",
    patterns: [/^waiting[_ ]review$/i, /^awaiting review$/i, /^等待评审$/, /^等待审核$/, /^待评审$/, /^待审核$/]
  },
  {
    status: "running",
    patterns: [/^running$/i, /^active$/i, /^执行中$/, /^运行中$/, /^活跃$/]
  },
  {
    status: "done",
    patterns: [/^done$/i, /^completed?$/i, /^完成$/, /^已完成$/]
  },
  {
    status: "failed",
    patterns: [/^failed$/i, /^error$/i, /^失败$/, /^错误$/]
  },
  {
    status: "paused",
    patterns: [/^paused$/i, /^已暂停$/, /^暂停$/]
  },
  {
    status: "pending",
    patterns: [/^pending$/i, /^等待中$/, /^待处理$/, /^待执行$/]
  },
  {
    status: "idle",
    patterns: [/^idle$/i, /^空闲$/]
  },
  {
    status: "stopped",
    patterns: [/^stopped$/i, /^terminated$/i, /^已停止$/, /^已终止$/]
  }
];

const LOOP_PATTERNS = [
  /^(?:x|×)\s*(\d+)$/i,
  /^(?:loop|round|iteration)\s*[:x]?\s*(\d+)$/i,
  /^(?:循环|轮次|迭代)\s*[:x]?\s*(\d+)$/
];

function normalizeRuntimeBadge(value: unknown): string {
  return String(value ?? "").trim();
}

function matchRuntimeStatus(value: string): StudioRuntimeNodeState["status"] | undefined {
  if (!value) {
    return undefined;
  }
  for (const matcher of STATUS_MATCHERS) {
    if (matcher.patterns.some((pattern) => pattern.test(value))) {
      return matcher.status;
    }
  }
  return undefined;
}

function parseLoopCount(value: string): number | undefined {
  for (const pattern of LOOP_PATTERNS) {
    const match = value.match(pattern);
    if (match) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return undefined;
}

function isLikelyErrorCode(value: string): boolean {
  if (!value || matchRuntimeStatus(value)) {
    return false;
  }
  return /^[A-Z][A-Z0-9_.:-]{2,}$/.test(value);
}

function runtimeBadges(node: Pick<GraphViewModelNode, "badges">): {
  status?: StudioRuntimeNodeState["status"];
  statusLabel?: string;
  errorCode?: string;
  loopCount?: number;
  remaining: string[];
} {
  const remaining: string[] = [];
  let status: StudioRuntimeNodeState["status"];
  let statusLabel: string | undefined;
  let errorCode: string | undefined;
  let loopCount: number | undefined;
  for (const badge of node.badges || []) {
    const value = normalizeRuntimeBadge(badge);
    if (!value) {
      continue;
    }
    const matchedStatus = matchRuntimeStatus(value);
    if (matchedStatus && !status) {
      status = matchedStatus;
      statusLabel = value;
      continue;
    }
    const matchedLoopCount = parseLoopCount(value);
    if (matchedLoopCount && !loopCount) {
      loopCount = matchedLoopCount;
      continue;
    }
    if (isLikelyErrorCode(value) && !errorCode) {
      errorCode = value;
      continue;
    }
    remaining.push(value);
  }
  return { status, statusLabel, errorCode, loopCount, remaining };
}

export function formatStudioRuntimeNodeBadges(node: Pick<GraphViewModelNode, "badges">): string[] {
  const parsed = runtimeBadges(node);
  const badges: string[] = [];
  if (parsed.statusLabel) {
    badges.push(parsed.statusLabel);
  }
  if (parsed.loopCount && parsed.loopCount > 1) {
    badges.push(`x${parsed.loopCount}`);
  }
  if (parsed.errorCode) {
    badges.push(parsed.errorCode);
  }
  for (const badge of parsed.remaining) {
    if (!badges.includes(badge)) {
      badges.push(badge);
    }
  }
  return badges;
}

export function deriveStudioRuntimeNodeState(args: {
  node: GraphViewModelNode;
  authoring?: StudioAuthoringDocument | null;
}): StudioRuntimeNodeState {
  const parsed = runtimeBadges(args.node);
  const humanGateConfigured = Boolean(args.node.structure.review ?? args.authoring?.roles?.[args.node.roleId]?.review);
  const status = matchRuntimeStatus(String(args.node.runtime?.status ?? parsed.status ?? ""));
  return {
    status,
    statusLabel: String(args.node.runtime?.status ?? parsed.statusLabel ?? ""),
    errorCode: args.node.runtime?.lastErrorCode ?? parsed.errorCode,
    loopCount: args.node.runtime?.loopIteration ?? parsed.loopCount,
    humanGateConfigured,
    waitingReview: status === "waiting_review",
    active: status === "active" || status === "running" || status === "waiting_review" || status === "paused" || status === "pending"
  };
}

export function deriveStudioRuntimeEdgeState(args: {
  edge: GraphViewModelEdge;
}): StudioRuntimeEdgeState {
  return {
    active: Boolean(args.edge.runtime?.recentlyActivated === true),
    waiting: false,
    completed: false,
    error: Boolean(args.edge.runtimeOnlyErrorFlow || args.edge.diagnostic?.severity === "error"),
    stopped: false,
    loopBack: args.edge.source === args.edge.target
      || args.edge.channel === "loop"
      || args.edge.channel === "feedback"
      || args.edge.topologyOrder?.endsWith("L") === true,
    handoffCount: 0,
    activeHandoffCount: 0,
    waitingHandoffCount: 0
  };
}

export function deriveStudioRuntimeVisualState(args: {
  authoring?: StudioAuthoringDocument | null;
  viewModel: GraphViewModel;
  readOnly?: boolean;
  progressEvents?: readonly StudioRuntimeProgressEvent[];
}): StudioRuntimeVisualState {
  const nodeStates = new Map<string, StudioRuntimeNodeState>();
  const edgeStates = new Map<string, StudioRuntimeEdgeState>();
  const handoffStatesById = new Map<string, StudioRuntimeHandoffState>();
  let activeNodeCount = 0;
  let waitingReviewCount = 0;
  let activeEdgeCount = 0;

  for (const node of args.viewModel.nodes) {
    const state = deriveStudioRuntimeNodeState({ node, authoring: args.authoring });
    nodeStates.set(node.id, state);
    if (state.active) {
      activeNodeCount += 1;
    }
    if (state.waitingReview) {
      waitingReviewCount += 1;
    }
  }

  for (const edge of args.viewModel.edges) {
    const state = deriveStudioRuntimeEdgeState({ edge });
    edgeStates.set(edge.id, state);
    if (state.active) {
      activeEdgeCount += 1;
    }
  }

  if (args.progressEvents?.length) {
    const activeExecutions = new Map<string, { roleId: string; executionId?: string }>();
    const successfulRoles = new Set<string>();
    const failedRoles = new Set<string>();
    const waitingBranches = new Set<string>();
    const technicalWaitingBranches = new Set<string>();
    const technicalWaitingStageByBranch = new Map<string, string>();
    const failureByBranch = new Map<string, { roleId: string; errorCode?: string; errorMessage?: string }>();
    const waitingReviewBranches = new Set<string>();
    const stoppedRoles = new Set<string>();
    const selectedEntryRoles = new Set<string>();
    let hasEndArrival = args.progressEvents.some((event) => event.type === "flow.activated" && event.toRoleId === "__system_end__");
    const flowStateByHandoff = handoffStatesById;
    const seenEventKeys = new Set<string>();
    const latestAttemptByBranch = new Map<string, number>();
    const latestExecutionByBranch = new Map<string, string>();
    let runStatus: "running" | "completed" | "stopped" | "failed" = "running";
    const runTerminalPriority = { completed: 1, stopped: 2, failed: 3 } as const;
    const activationKey = (event: StudioRuntimeProgressEvent) =>
      String(event.branchId || `${event.roleId || ""}:${event.loopIteration || 1}`);

    // Replay in event-time order; stable input order resolves events with equal or missing timestamps.
    const orderedEvents = args.progressEvents
      .map((event, index) => ({ event, index, at: Date.parse(event.at || "") }))
      .sort((left, right) => {
        if (Number.isFinite(left.at) && Number.isFinite(right.at) && left.at !== right.at) return left.at - right.at;
        if (Number.isFinite(left.at) !== Number.isFinite(right.at)) return Number.isFinite(left.at) ? -1 : 1;
        return left.index - right.index;
      })
      .map(({ event }) => event);
    for (const event of orderedEvents) {
      const eventKey = event.handoffId && event.type === "flow.activated"
        ? `flow:${event.handoffId}`
        : event.executionId
          ? `${event.type}:${event.executionId}:${event.attempt || 0}:${event.stage || ""}:${event.elapsedMs ?? ""}`
          : `${event.type}:${event.branchId || ""}:${event.attempt || 0}:${event.at || ""}`;
      if (seenEventKeys.has(eventKey)) continue;
      seenEventKeys.add(eventKey);
      if (runStatus !== "running") {
        // Stop and failure are frozen terminal projections; late activity remains audit-only.
        if (runStatus === "stopped" || runStatus === "failed") continue;
        if (["simulation.completed", "run_stopped", "run_terminated", "simulation.failed"].includes(event.type)) {
          const candidateStatus = event.type === "simulation.failed" || event.type === "run_terminated"
            ? "failed"
            : event.type === "run_stopped" ? "stopped" : "completed";
          if (runTerminalPriority[candidateStatus] > runTerminalPriority[runStatus]) runStatus = candidateStatus;
        } else {
          continue;
        }
      }
      if (event.type === "flow.activated") {
        const edge = args.viewModel.edges.find((candidate) =>
          (event.edgeId ? candidate.id === event.edgeId : true)
          && candidate.source === event.fromRoleId
          && candidate.target === event.toRoleId
          && candidate.eventType === event.eventType
        );
        if (edge) {
          const key = event.handoffId || `${activationKey(event)}:${edge.id}`;
          flowStateByHandoff.set(key, {
            handoffId: key,
            edgeId: edge.id,
            targetRoleId: String(event.toRoleId || ""),
            branchId: String(event.branchId || ""),
            executionId: event.executionId,
            lineageId: event.lineageId,
            loopIteration: event.loopIteration,
            attempt: event.sourceAttempt,
            status: event.toRoleId === "__system_end__" ? "completed" : "active"
          });
          if (event.fromRoleId === "__system_start__" && event.toRoleId) selectedEntryRoles.add(event.toRoleId);
        }
      } else if (event.type === "role.started") {
        const key = activationKey(event);
        const attempt = event.attempt ?? 1;
        const latestAttempt = latestAttemptByBranch.get(key) ?? 0;
        if (attempt < latestAttempt) continue;
        latestAttemptByBranch.set(key, attempt);
        latestExecutionByBranch.set(key, String(event.executionId || ""));
        activeExecutions.set(key, { roleId: String(event.roleId || ""), executionId: event.executionId });
        waitingBranches.delete(key);
        technicalWaitingBranches.delete(key);
        technicalWaitingStageByBranch.delete(key);
        waitingReviewBranches.delete(key);
        failedRoles.delete(String(event.roleId || ""));
        failureByBranch.delete(key);
        for (const flow of flowStateByHandoff.values()) {
          if (flow.targetRoleId !== event.roleId || flow.branchId !== String(event.branchId || "")) continue;
          flow.executionId = event.executionId;
          flow.attempt = attempt;
          flow.status = "active";
        }
      } else if (event.type === "role_waiting" || event.type === "human_review_requested") {
        const key = activationKey(event);
        if ((event.attempt ?? 1) < (latestAttemptByBranch.get(key) ?? 1)) continue;
        const activeExecution = activeExecutions.get(key);
        const latestExecution = latestExecutionByBranch.get(key);
        if (event.executionId && latestExecution && event.executionId !== latestExecution) continue;
        if (event.executionId && activeExecution?.executionId && event.executionId !== activeExecution.executionId) continue;
        activeExecutions.set(key, { roleId: String(event.roleId || ""), executionId: event.executionId ?? activeExecution?.executionId });
        if (event.type === "human_review_requested") {
          waitingReviewBranches.add(key);
          waitingBranches.delete(key);
          technicalWaitingBranches.delete(key);
          technicalWaitingStageByBranch.delete(key);
        } else if (event.waitKind === "technical") {
          technicalWaitingBranches.add(key);
          technicalWaitingStageByBranch.set(key, String(event.stage || ""));
          waitingBranches.delete(key);
        } else {
          waitingBranches.add(key);
          technicalWaitingBranches.delete(key);
          technicalWaitingStageByBranch.delete(key);
        }
        for (const flow of flowStateByHandoff.values()) {
          if (flow.targetRoleId !== event.roleId || flow.branchId !== String(event.branchId || "")) continue;
          if (event.executionId && flow.executionId && event.executionId !== flow.executionId) continue;
          flow.status = event.type === "role_waiting" && event.waitKind === "technical" ? "active" : "waiting";
        }
      } else if (event.type === "role_retry_scheduled") {
        const key = activationKey(event);
        const activeExecution = activeExecutions.get(key);
        const latestExecution = latestExecutionByBranch.get(key);
        if (event.executionId && latestExecution && event.executionId !== latestExecution) continue;
        if (event.executionId && activeExecution?.executionId && event.executionId !== activeExecution.executionId) continue;
        failedRoles.delete(String(event.roleId || ""));
        waitingReviewBranches.delete(key);
        technicalWaitingBranches.delete(key);
        technicalWaitingStageByBranch.delete(key);
        waitingBranches.add(key);
        for (const flow of flowStateByHandoff.values()) {
          if (flow.targetRoleId !== event.roleId || flow.branchId !== String(event.branchId || "")) continue;
          flow.status = "waiting";
        }
      } else if (["human_review_approved", "human_review_rework_requested", "human_review_rejected"].includes(event.type)) {
        const key = activationKey(event);
        const activeExecution = activeExecutions.get(key);
        if (event.executionId && activeExecution?.executionId && event.executionId !== activeExecution.executionId) continue;
        waitingReviewBranches.delete(key);
        waitingBranches.delete(key);
        technicalWaitingBranches.delete(key);
        technicalWaitingStageByBranch.delete(key);
        for (const flow of flowStateByHandoff.values()) {
          if (flow.targetRoleId === event.roleId && flow.branchId === String(event.branchId || "") && flow.status === "waiting") {
            if (event.executionId && flow.executionId && event.executionId !== flow.executionId) continue;
            flow.status = "active";
          }
        }
      } else if (["role.completed", "role.skipped", "role.failed"].includes(event.type)) {
        const key = activationKey(event);
        const activeExecution = activeExecutions.get(key);
        const latestExecution = latestExecutionByBranch.get(key);
        if (event.executionId && latestExecution && event.executionId !== latestExecution) continue;
        if (event.executionId && activeExecution?.executionId && event.executionId !== activeExecution.executionId) continue;
        if ((event.attempt ?? 1) < (latestAttemptByBranch.get(key) ?? 1)) continue;
        activeExecutions.delete(key);
        latestExecutionByBranch.set(key, String(event.executionId || latestExecution || ""));
        waitingReviewBranches.delete(key);
        waitingBranches.delete(key);
        technicalWaitingBranches.delete(key);
        technicalWaitingStageByBranch.delete(key);
        if (event.roleId) {
          const roleState = nodeStates.get(event.roleId);
          if (roleState) {
            const durationMs = event.durationMs ?? event.elapsedMs ?? event.audit?.durationMs;
            if (Number.isFinite(durationMs) && Number(durationMs) > 0) {
              roleState.durationMs = Number(durationMs);
            }
            const iteration = Number.isFinite(event.loopIteration) && Number(event.loopIteration) > 0
              ? Number(event.loopIteration)
              : 1;
            roleState.loopCount = Math.max(roleState.loopCount || 1, iteration);
            const tokenUsage = Number(event.estimatedInputTokens ?? event.audit?.estimatedInputTokens ?? 0) + Number(event.estimatedOutputTokens ?? event.audit?.estimatedOutputTokens ?? 0);
            if (Number.isFinite(tokenUsage) && tokenUsage > 0) roleState.totalTokens = tokenUsage;
            if (!roleState.history) roleState.history = [];
            const existingRecord = roleState.history.find((r) => r.iteration === iteration);
            if (existingRecord) {
              if (Number.isFinite(durationMs) && Number(durationMs) > 0) existingRecord.durationMs = Number(durationMs);
              if (Number.isFinite(tokenUsage) && tokenUsage > 0) existingRecord.totalTokens = tokenUsage;
              existingRecord.status = event.type === "role.failed" ? "failed" : "completed";
            } else {
              roleState.history.push({
                iteration,
                durationMs: Number.isFinite(durationMs) ? Number(durationMs) : undefined,
                totalTokens: Number.isFinite(tokenUsage) ? tokenUsage : undefined,
                status: event.type === "role.failed" ? "failed" : "completed",
                attempt: event.attempt
              });
            }
          }
        }
        if (event.type === "role.failed") {
          const roleId = String(event.roleId || "");
          const errorCode = event.errorCode || event.errorEnvelope?.errorCode;
          const errorMessage = event.errorMessage || event.errorEnvelope?.message || event.error;
          failedRoles.add(roleId);
          failureByBranch.set(key, {
            roleId,
            ...(errorCode ? { errorCode: String(errorCode) } : {}),
            ...(errorMessage ? { errorMessage: String(errorMessage) } : {})
          });
        }
        else successfulRoles.add(String(event.roleId || ""));
        for (const flow of flowStateByHandoff.values()) {
          if (flow.targetRoleId !== event.roleId || flow.branchId !== String(event.branchId || "")) continue;
          if (event.executionId && flow.executionId && event.executionId !== flow.executionId) continue;
          flow.status = event.type === "role.failed" ? "failed" : "completed";
          if (event.type === "role.failed") {
            flow.errorCode = event.errorCode || event.errorEnvelope?.errorCode;
            flow.errorMessage = event.errorMessage || event.errorEnvelope?.message || event.error;
          }
        }
      } else if (event.type === "simulation.completed" || event.type === "simulation.failed") {
        runStatus = event.type === "simulation.completed" ? "completed" : "failed";
      } else if (event.type === "run_stopped" || event.type === "run_terminated") {
        runStatus = event.type === "run_terminated" ? "failed" : "stopped";
      }
    }

    if (runStatus === "stopped") {
      for (const execution of activeExecutions.values()) {
        if (execution.roleId) stoppedRoles.add(execution.roleId);
      }
    }
    if (runStatus !== "running" || args.readOnly) {
      for (const flow of flowStateByHandoff.values()) {
        if (flow.status !== "active" && flow.status !== "waiting") continue;
        flow.status = runStatus === "failed" ? "failed" : runStatus === "stopped" ? "stopped" : "completed";
      }
      activeExecutions.clear();
      waitingBranches.clear();
      technicalWaitingBranches.clear();
      technicalWaitingStageByBranch.clear();
      waitingReviewBranches.clear();
    }

    for (const node of args.viewModel.nodes) {
      const state = nodeStates.get(node.id);
      if (!state) continue;
      if (node.id === "__system_start__") {
        state.active = false;
        state.status = selectedEntryRoles.size ? "done" : undefined;
      } else if (node.id === "__system_end__") {
        state.status = runStatus === "completed" ? "done" : runStatus === "failed" ? "failed" : hasEndArrival && runStatus === "running" ? "running" : undefined;
        state.active = runStatus === "running" && hasEndArrival;
      } else {
        const roleBranches = Array.from(activeExecutions.entries()).filter(([, execution]) => execution.roleId === node.roleId);
        const isActive = roleBranches.some(([branchKey]) => !waitingBranches.has(branchKey) && !waitingReviewBranches.has(branchKey));
        const hasWaitingReview = !isActive && roleBranches.some(([branchKey]) => waitingReviewBranches.has(branchKey));
        const isWaiting = !isActive && !hasWaitingReview && roleBranches.some(([branchKey]) => waitingBranches.has(branchKey));
        const technicalWait = roleBranches.find(([branchKey]) => technicalWaitingBranches.has(branchKey));
        state.active = isActive;
        state.waitingReview = hasWaitingReview;
        state.technicalWaiting = Boolean(technicalWait);
        state.technicalWaitingStage = technicalWait ? technicalWaitingStageByBranch.get(technicalWait[0]) : undefined;
        const failure = Array.from(failureByBranch.values()).reverse().find((candidate) => candidate.roleId === node.roleId);
        state.errorCode = failure?.errorCode;
        state.errorMessage = failure?.errorMessage;
        const hasFailedBranch = [...failureByBranch.values()].some((candidate) => candidate.roleId === node.roleId);
        state.status = isActive ? "running" : state.waitingReview ? "waiting_review" : isWaiting ? "waiting" : hasFailedBranch || failedRoles.has(node.roleId) ? "failed" : successfulRoles.has(node.roleId) ? "done" : stoppedRoles.has(node.roleId) ? "stopped" : undefined;
      }
    }
    const flowsByEdge = new Map<string, StudioRuntimeHandoffState[]>();
    for (const flow of flowStateByHandoff.values()) {
      const flows = flowsByEdge.get(flow.edgeId) ?? [];
      flows.push(flow);
      flowsByEdge.set(flow.edgeId, flows);
    }
    for (const [edgeId, flows] of flowsByEdge) {
      const edgeState = edgeStates.get(edgeId);
      if (!edgeState) continue;
      const statuses = new Set(flows.map((flow) => flow.status));
      const failedFlow = flows.find((flow) => flow.status === "failed");
      const activeHandoffs = flows.filter((flow) => flow.status === "active").length;
      const waitingHandoffs = flows.filter((flow) => flow.status === "waiting").length;
      edgeState.handoffCount = flows.length;
      edgeState.activeHandoffCount = activeHandoffs;
      edgeState.waitingHandoffCount = waitingHandoffs;
      edgeState.error = Boolean(failedFlow);
      edgeState.errorCode = failedFlow?.errorCode;
      edgeState.errorMessage = failedFlow?.errorMessage;
      edgeState.active = statuses.has("active");
      edgeState.waiting = !edgeState.active && statuses.has("waiting");
      edgeState.stopped = !edgeState.active && !edgeState.waiting && statuses.has("stopped");
      edgeState.completed = !edgeState.active && !edgeState.waiting && !edgeState.stopped && !edgeState.error && statuses.has("completed");
    }
    if (args.readOnly) {
      for (const edgeState of edgeStates.values()) {
        edgeState.active = false;
        edgeState.waiting = false;
      }
      for (const nodeState of nodeStates.values()) {
        nodeState.active = false;
        nodeState.waitingReview = false;
        nodeState.technicalWaiting = false;
        if (nodeState.status === "running") {
          nodeState.status = runStatus === "failed" ? "failed" : "done";
        }
      }
    }
    activeNodeCount = Array.from(nodeStates.values()).filter((state) => state.active).length;
    activeEdgeCount = Array.from(edgeStates.values()).filter((state) => state.active).length;
    waitingReviewCount = Array.from(nodeStates.values()).filter((state) => state.waitingReview).length;
  }

  const hasRuntimeSignals = activeNodeCount > 0
    || waitingReviewCount > 0
    || activeEdgeCount > 0
    || Array.from(nodeStates.values()).some((state) => Boolean(state.errorCode))
    || Array.from(nodeStates.values()).some((state) => Boolean(state.humanGateConfigured))
    || Array.from(nodeStates.values()).some((state) => Boolean(state.loopCount && state.loopCount > 1))
    || args.progressEvents?.length > 0;

  return {
    hasRuntimeSignals,
    nodeStates,
    edgeStates,
    handoffStatesById,
    activeNodeCount,
    waitingReviewCount,
    activeEdgeCount
  };
}
