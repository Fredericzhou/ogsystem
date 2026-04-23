export type JsonRecord = Record<string, unknown>;

export type RunHeader = {
  runId: string;
  runDir: string;
  status: string;
  transitionCount: number;
  finalRoleId?: string;
  lastExecutedRoleId?: string;
  error?: string;
  updatedAt: string;
  activeBranches: number;
  pendingReviewCount: number;
  hasWaitingHumanReview: boolean;
  recentAudits: number;
  systemSource: string | null;
  isSimulation: boolean;
  runMode: "simulation" | "runtime";
};

export type RunDetailView = {
  runId: string;
  runDir: string;
  header: RunHeader;
  state: unknown | null;
  metrics: unknown | null;
  resolvedConfig: unknown | null;
  stopRequest: unknown | null;
  stopOutcome: unknown | null;
  summary: unknown | null;
  systemSource: string | null;
};

export type ReviewListItem = {
  reviewId: string;
  currentStatus: string;
  roleId?: string;
  branchId?: string;
  branchStatus?: string;
  round?: number;
  requestedAt?: string;
  decision?: string;
  actor?: string;
  comment?: string;
  scope?: "branch" | "run";
};

export type ReviewDetailView = ReviewListItem & {
  runId: string;
  runDir: string;
  lineageId?: string;
  loopIteration?: number;
  executionId?: string;
  requestedByExecutionId?: string;
  selectedEvent?: string;
  spec?: unknown;
  decidedAt?: string;
  committedAt?: string;
  checkpointSequence?: number;
  appliedAt?: string;
  reconciledAt?: string;
  requestSnapshot?: unknown;
  decisionSnapshot?: unknown;
  currentState?: unknown;
  history: unknown[];
  humanReviewContext?: unknown;
};

export type ResumeDiagnosticsCheckView = {
  id: string;
  label: string;
  ok: boolean;
  severity: "info" | "warning" | "error";
  message?: string;
  detail?: unknown;
};

export type ResumeDiagnosticsRecommendationView = {
  action: string;
  label: string;
  detail?: unknown;
};

export type ResumeDiagnosticsView = {
  runId: string;
  runDir: string;
  status: string;
  fingerprint: unknown;
  counts: unknown;
  checks: ResumeDiagnosticsCheckView[];
  recommendations: ResumeDiagnosticsRecommendationView[];
};

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function mapRunDetailView(args: {
  runId: string;
  runDir: string;
  header: RunHeader;
  state?: unknown;
  metrics?: unknown;
  resolvedConfig?: unknown;
  stopRequest?: unknown;
  stopOutcome?: unknown;
  summary?: unknown;
  systemSource: string | null;
}): RunDetailView {
  return {
    runId: args.runId,
    runDir: args.runDir,
    header: args.header,
    state: args.state ?? null,
    metrics: args.metrics ?? null,
    resolvedConfig: args.resolvedConfig ?? null,
    stopRequest: args.stopRequest ?? null,
    stopOutcome: args.stopOutcome ?? null,
    summary: args.summary ?? null,
    systemSource: args.systemSource
  };
}

export function mapReviewListItem(value: unknown): ReviewListItem | undefined {
  const record = asRecord(value);
  const reviewId = asString(record?.reviewId);
  const currentStatus = asString(record?.currentStatus);
  if (!reviewId || !currentStatus) {
    return undefined;
  }
  const source = record ?? {};
  const scopeValue = asString(source.scope);
  return {
    reviewId,
    currentStatus,
    roleId: asString(source.roleId),
    branchId: asString(source.branchId),
    branchStatus: asString(source.branchStatus),
    round: asNumber(source.round),
    requestedAt: asString(source.requestedAt),
    decision: asString(source.decision),
    actor: asString(source.actor),
    comment: asString(source.comment),
    scope: scopeValue === "branch" || scopeValue === "run" ? scopeValue : undefined
  };
}

export function mapReviewDetailView(value: unknown): ReviewDetailView {
  const record = asRecord(value) ?? {};
  const listItem = mapReviewListItem(record);
  if (!listItem) {
    throw new Error("Invalid review detail payload.");
  }
  return {
    ...listItem,
    runId: asString(record.runId) ?? "",
    runDir: asString(record.runDir) ?? "",
    lineageId: asString(record.lineageId),
    loopIteration: asNumber(record.loopIteration),
    executionId: asString(record.executionId),
    requestedByExecutionId: asString(record.requestedByExecutionId),
    selectedEvent: asString(record.selectedEvent),
    spec: record.spec,
    decidedAt: asString(record.decidedAt),
    committedAt: asString(record.committedAt),
    checkpointSequence: asNumber(record.checkpointSequence),
    appliedAt: asString(record.appliedAt),
    reconciledAt: asString(record.reconciledAt),
    requestSnapshot: record.requestSnapshot,
    decisionSnapshot: record.decisionSnapshot,
    currentState: record.currentState,
    history: Array.isArray(record.history) ? record.history : [],
    humanReviewContext: record.humanReviewContext
  };
}

export function mapResumeDiagnosticsView(value: unknown): ResumeDiagnosticsView {
  const record = asRecord(value) ?? {};
  const checks = Array.isArray(record.checks)
    ? record.checks.flatMap((item) => {
        const check = asRecord(item);
        const id = asString(check?.id);
        const label = asString(check?.label);
        const ok = asBoolean(check?.ok);
        const severity = asString(check?.severity);
        if (!id || !label || ok === undefined) {
          return [];
        }
        return [
          {
            id,
            label,
            ok,
            severity:
              severity === "warning" || severity === "error" || severity === "info"
                ? severity
                : (ok ? "info" : "error"),
            message: asString(check?.message),
            detail: check?.detail
          } satisfies ResumeDiagnosticsCheckView
        ];
      })
    : [];
  const recommendations = Array.isArray(record.recommendations)
    ? record.recommendations.flatMap((item) => {
        const recommendation = asRecord(item);
        const action = asString(recommendation?.action);
        const label = asString(recommendation?.label);
        if (!action || !label) {
          return [];
        }
        return [
          {
            action,
            label,
            detail: recommendation?.detail
          } satisfies ResumeDiagnosticsRecommendationView
        ];
      })
    : [];
  return {
    runId: asString(record.runId) ?? "",
    runDir: asString(record.runDir) ?? "",
    status: asString(record.status) ?? "unknown",
    fingerprint: record.fingerprint ?? null,
    counts: record.counts ?? null,
    checks,
    recommendations
  };
}
