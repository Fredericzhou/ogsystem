export type JsonRecord = Record<string, unknown>;

export type ErrorView = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type ValidationDiagnosticView = {
  code: string;
  message: string;
  severity: "error";
  stage: "parse" | "compile";
  roleId?: string;
  fieldName?: string;
  selector?: string;
  line?: number;
};

export type WorkbenchStructureRoleView = {
  roleId: string;
  bindingKind: "model" | "profile" | "noop";
  routingMode?: string;
  joinMode?: string;
  reviewMode?: string;
};

export type WorkbenchStructureFlowView = {
  fromRoleId: string;
  toRoleId: string;
  eventType: string;
};

export type WorkbenchStructureView = {
  systemId: string;
  systemVersion: string;
  entryRoleId: string;
  roleCount: number;
  flowCount: number;
  roles: WorkbenchStructureRoleView[];
  flows: WorkbenchStructureFlowView[];
};

export type WorkbenchValidationView = {
  ok: boolean;
  diagnostics: ValidationDiagnosticView[];
  structure: WorkbenchStructureView | null;
};

export type WorkbenchView = {
  workdir: string;
  systemPath: string;
  systemSource: string;
  validation: WorkbenchValidationView;
};

export type FollowUpActionView = {
  action: string;
  label: string;
  detail?: unknown;
};

export type WorkbenchSaveView = {
  workdir: string;
  savedPath: string;
  validation: WorkbenchValidationView;
  followUpActions: FollowUpActionView[];
};

export type ProjectTransferView = {
  mode: "single-project-v1";
  releaseManifest?: unknown;
  project: {
    systemPath: string;
    systemSource: string;
    runtime: unknown | null;
    modelSelection: unknown | null;
    modelCatalog: unknown | null;
    laws: unknown | null;
    userProfile: unknown | null;
    profiles: unknown | null;
    tools: unknown | null;
    project: unknown | null;
  };
};

export type ProjectLoadView = {
  workdir: string;
  mode: "single-project-v1";
  loadedFiles: string[];
  validation: WorkbenchValidationView;
  followUpActions: FollowUpActionView[];
};

export type RunResultSummaryView = {
  systemId?: string;
  systemVersion?: string;
  finalRoleId?: string;
  transitionCount?: number;
  stageCount?: number;
  error?: string;
  errorCode?: string;
};

export type RunLifecycleView = {
  runId: string;
  status: string;
  resultSummary: RunResultSummaryView;
  followUpActions: FollowUpActionView[];
};

export type ControlActionView = {
  runId: string;
  action: string;
  accepted: boolean;
  semanticStatus: string;
  detail: unknown;
};

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
  decisionPhase?: "recorded" | "pending_reconcile" | "applied";
  roleId?: string;
  branchId?: string;
  branchStatus?: string;
  round?: number;
  requestedAt?: string;
  decision?: string;
  actor?: string;
  comment?: string;
  scope?: "branch" | "run";
  decidedAt?: string;
  committedAt?: string;
  checkpointSequence?: number;
  appliedAt?: string;
  reconciledAt?: string;
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
  requestSnapshot?: unknown;
  decisionSnapshot?: unknown;
  currentState?: unknown;
  history: unknown[];
  humanReviewContext?: unknown;
};

export type ReviewQueueView = {
  runId: string;
  runDir: string;
  latestPendingReviewId?: string;
  reviews: ReviewListItem[];
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

export type BindingResolutionView = {
  roleId: string;
  bindingKind: "model" | "profile" | "noop";
  declaredBinding?: string;
  resolvedBinding?: string;
  variant?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  source: string;
};

export type FailureSummaryView = {
  errorCode: string;
  errorCategory?: string;
  message: string;
  stage?: string;
  roleId?: string;
  branchId?: string;
  retryable?: boolean;
  durationMs?: number;
};

export type FailureDetailView = {
  allowedEvents: string[];
  inputContext?: string;
  rawOutput?: string;
  schemaPath?: string;
  selectedBinding?: BindingResolutionView;
  upstreamRoleIds: string[];
  correctionKind?: string;
  correctionDetail?: string;
  providerError?: string;
};

export type FailureProjectionView = {
  runId: string;
  runDir: string;
  status: string;
  summary: FailureSummaryView | null;
  detail: FailureDetailView | null;
  suggestedNextChecks: FollowUpActionView[];
};

export type RolePackageSummaryView = {
  roleId: string;
  roleVersion?: string;
  name?: string;
  resolvedPath: string;
  manifestPath: string;
  promptTemplatePath?: string;
  outputSchemaPath?: string;
  allowedEvents: string[];
  files: {
    roleJson: boolean;
    promptTemplate: boolean;
    outputSchema: boolean;
    agent: boolean;
    source: boolean;
  };
};

export type ContractSummaryView = {
  flowKey: string;
  contractId?: string;
  kind: "flow" | "role_input";
  schemaPath?: string;
  lastStatus: string;
  onViolation?: "FAIL" | "WARN";
  fromRoleId?: string;
  toRoleId?: string;
  eventType?: string;
  roleId?: string;
};

export type ResumeReadinessBlockerView = {
  id: string;
  category: string;
  severity: "info" | "warning" | "error";
  blocking: boolean;
  message: string;
  source?: string;
  detail?: unknown;
};

export type ResumeDriftSourceView = {
  source: string;
  changed: boolean;
  blocking: boolean;
  message: string;
  detail?: unknown;
};

export type ResumeReadinessView = {
  runId: string;
  runDir: string;
  status: string;
  canResume: boolean;
  blockers: ResumeReadinessBlockerView[];
  driftSources: ResumeDriftSourceView[];
  fingerprint: unknown;
  counts: unknown;
  checks: ResumeDiagnosticsCheckView[];
  recommendations: ResumeDiagnosticsRecommendationView[];
};

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

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
    decisionPhase:
      source.decisionPhase === "recorded" ||
      source.decisionPhase === "pending_reconcile" ||
      source.decisionPhase === "applied"
        ? source.decisionPhase
        : undefined,
    roleId: asString(source.roleId),
    branchId: asString(source.branchId),
    branchStatus: asString(source.branchStatus),
    round: asNumber(source.round),
    requestedAt: asString(source.requestedAt),
    decision: asString(source.decision),
    actor: asString(source.actor),
    comment: asString(source.comment),
    scope: scopeValue === "branch" || scopeValue === "run" ? scopeValue : undefined,
    decidedAt: asString(source.decidedAt),
    committedAt: asString(source.committedAt),
    checkpointSequence: asNumber(source.checkpointSequence),
    appliedAt: asString(source.appliedAt),
    reconciledAt: asString(source.reconciledAt)
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
    requestSnapshot: record.requestSnapshot,
    decisionSnapshot: record.decisionSnapshot,
    currentState: record.currentState,
    history: Array.isArray(record.history) ? record.history : [],
    humanReviewContext: record.humanReviewContext
  };
}

export function mapReviewQueueView(value: unknown): ReviewQueueView {
  const record = asRecord(value) ?? {};
  return {
    runId: asString(record.runId) ?? "",
    runDir: asString(record.runDir) ?? "",
    latestPendingReviewId: asString(record.latestPendingReviewId),
    reviews: asArray(record.reviews)?.flatMap((item) => {
      const mapped = mapReviewListItem(item);
      return mapped ? [mapped] : [];
    }) ?? []
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

export function mapBindingResolutionView(value: unknown): BindingResolutionView | undefined {
  const record = asRecord(value);
  const roleId = asString(record?.roleId);
  const bindingKind = asString(record?.bindingKind);
  const source = asString(record?.source);
  if (
    !roleId ||
    !source ||
    (bindingKind !== "model" && bindingKind !== "profile" && bindingKind !== "noop")
  ) {
    return undefined;
  }
  return {
    roleId,
    bindingKind,
    declaredBinding: asString(record?.declaredBinding),
    resolvedBinding: asString(record?.resolvedBinding),
    variant: asString(record?.variant),
    timeoutMs: asNumber(record?.timeoutMs),
    maxOutputBytes: asNumber(record?.maxOutputBytes),
    source
  };
}

export function mapFailureProjectionView(value: unknown): FailureProjectionView {
  const record = asRecord(value) ?? {};
  const summaryRecord = asRecord(record.summary);
  const detailRecord = asRecord(record.detail);
  const summary = summaryRecord
    ? {
        errorCode: asString(summaryRecord.errorCode) ?? "UNKNOWN_FAILURE",
        errorCategory: asString(summaryRecord.errorCategory),
        message: asString(summaryRecord.message) ?? "",
        stage: asString(summaryRecord.stage),
        roleId: asString(summaryRecord.roleId),
        branchId: asString(summaryRecord.branchId),
        retryable: asBoolean(summaryRecord.retryable),
        durationMs: asNumber(summaryRecord.durationMs)
      } satisfies FailureSummaryView
    : null;
  const detail = detailRecord
    ? {
        allowedEvents:
          asArray(detailRecord.allowedEvents)
            ?.map((item) => asString(item))
            .filter((item): item is string => Boolean(item)) ?? [],
        inputContext: asString(detailRecord.inputContext),
        rawOutput: asString(detailRecord.rawOutput),
        schemaPath: asString(detailRecord.schemaPath),
        selectedBinding: mapBindingResolutionView(detailRecord.selectedBinding),
        upstreamRoleIds:
          asArray(detailRecord.upstreamRoleIds)
            ?.map((item) => asString(item))
            .filter((item): item is string => Boolean(item)) ?? [],
        correctionKind: asString(detailRecord.correctionKind),
        correctionDetail: asString(detailRecord.correctionDetail),
        providerError: asString(detailRecord.providerError)
      } satisfies FailureDetailView
    : null;
  return {
    runId: asString(record.runId) ?? "",
    runDir: asString(record.runDir) ?? "",
    status: asString(record.status) ?? "unknown",
    summary,
    detail,
    suggestedNextChecks: mapFollowUpActions(record.suggestedNextChecks)
  };
}

export function mapRolePackageSummaryView(value: unknown): RolePackageSummaryView | undefined {
  const record = asRecord(value);
  const files = asRecord(record?.files);
  const roleId = asString(record?.roleId);
  const resolvedPath = asString(record?.resolvedPath);
  const manifestPath = asString(record?.manifestPath);
  if (!roleId || !resolvedPath || !manifestPath || !files) {
    return undefined;
  }
  return {
    roleId,
    roleVersion: asString(record?.roleVersion),
    name: asString(record?.name),
    resolvedPath,
    manifestPath,
    promptTemplatePath: asString(record?.promptTemplatePath),
    outputSchemaPath: asString(record?.outputSchemaPath),
    allowedEvents:
      asArray(record?.allowedEvents)
        ?.map((item) => asString(item))
        .filter((item): item is string => Boolean(item)) ?? [],
    files: {
      roleJson: asBoolean(files.roleJson) === true,
      promptTemplate: asBoolean(files.promptTemplate) === true,
      outputSchema: asBoolean(files.outputSchema) === true,
      agent: asBoolean(files.agent) === true,
      source: asBoolean(files.source) === true
    }
  };
}

export function mapContractSummaryView(value: unknown): ContractSummaryView | undefined {
  const record = asRecord(value);
  const flowKey = asString(record?.flowKey);
  const kind = asString(record?.kind);
  const lastStatus = asString(record?.lastStatus);
  if (!flowKey || !lastStatus || (kind !== "flow" && kind !== "role_input")) {
    return undefined;
  }
  const onViolation = asString(record?.onViolation);
  return {
    flowKey,
    contractId: asString(record?.contractId),
    kind,
    schemaPath: asString(record?.schemaPath),
    lastStatus,
    onViolation: onViolation === "FAIL" || onViolation === "WARN" ? onViolation : undefined,
    fromRoleId: asString(record?.fromRoleId),
    toRoleId: asString(record?.toRoleId),
    eventType: asString(record?.eventType),
    roleId: asString(record?.roleId)
  };
}

export function mapResumeReadinessView(value: unknown): ResumeReadinessView {
  const record = asRecord(value) ?? {};
  const blockers = asArray(record.blockers)?.flatMap((item) => {
    const blocker = asRecord(item);
    const id = asString(blocker?.id);
    const category = asString(blocker?.category);
    const severity = asString(blocker?.severity);
    const message = asString(blocker?.message);
    const blocking = asBoolean(blocker?.blocking);
    if (!id || !category || !message || blocking === undefined) {
      return [];
    }
    return [{
      id,
      category,
      severity:
        severity === "info" || severity === "warning" || severity === "error" ? severity : "error",
      blocking,
      message,
      source: asString(blocker?.source),
      detail: blocker?.detail
    } satisfies ResumeReadinessBlockerView];
  }) ?? [];
  const driftSources = asArray(record.driftSources)?.flatMap((item) => {
    const drift = asRecord(item);
    const source = asString(drift?.source);
    const changed = asBoolean(drift?.changed);
    const blocking = asBoolean(drift?.blocking);
    const message = asString(drift?.message);
    if (!source || changed === undefined || blocking === undefined || !message) {
      return [];
    }
    return [{
      source,
      changed,
      blocking,
      message,
      detail: drift?.detail
    } satisfies ResumeDriftSourceView];
  }) ?? [];
  const diagnostics = mapResumeDiagnosticsView(value);
  return {
    runId: diagnostics.runId,
    runDir: diagnostics.runDir,
    status: asString(record.status) ?? diagnostics.status,
    canResume: asBoolean(record.canResume) === true,
    blockers,
    driftSources,
    fingerprint: diagnostics.fingerprint,
    counts: diagnostics.counts,
    checks: diagnostics.checks,
    recommendations: diagnostics.recommendations
  };
}

export function mapErrorView(args: {
  code: string;
  message: string;
  details?: unknown;
}): ErrorView {
  return {
    error: {
      code: args.code,
      message: args.message,
      details: args.details
    }
  };
}

export function mapWorkbenchValidationView(value: unknown): WorkbenchValidationView {
  const record = asRecord(value) ?? {};
  const diagnostics = asArray(record.diagnostics)?.flatMap((item) => {
    const diagnostic = asRecord(item);
    const code = asString(diagnostic?.code);
    const message = asString(diagnostic?.message);
    const severity = asString(diagnostic?.severity);
    const stage = asString(diagnostic?.stage);
    if (!code || !message || severity !== "error" || (stage !== "parse" && stage !== "compile")) {
      return [];
    }
    return [{
      code,
      message,
      severity,
      stage,
      roleId: asString(diagnostic?.roleId),
      fieldName: asString(diagnostic?.fieldName),
      selector: asString(diagnostic?.selector),
      line: asNumber(diagnostic?.line)
    } satisfies ValidationDiagnosticView];
  }) ?? [];
  const structureRecord = asRecord(record.structure);
  return {
    ok: asBoolean(record.ok) === true,
    diagnostics,
    structure: structureRecord
      ? {
          systemId: asString(structureRecord.systemId) ?? "",
          systemVersion: asString(structureRecord.systemVersion) ?? "",
          entryRoleId: asString(structureRecord.entryRoleId) ?? "",
          roleCount: asNumber(structureRecord.roleCount) ?? 0,
          flowCount: asNumber(structureRecord.flowCount) ?? 0,
          roles: asArray(structureRecord.roles)?.flatMap((item) => {
            const role = asRecord(item);
            const roleId = asString(role?.roleId);
            const bindingKind = asString(role?.bindingKind);
            if (!roleId || (bindingKind !== "model" && bindingKind !== "profile" && bindingKind !== "noop")) {
              return [];
            }
            return [{
              roleId,
              bindingKind,
              routingMode: asString(role?.routingMode),
              joinMode: asString(role?.joinMode),
              reviewMode: asString(role?.reviewMode)
            } satisfies WorkbenchStructureRoleView];
          }) ?? [],
          flows: asArray(structureRecord.flows)?.flatMap((item) => {
            const flow = asRecord(item);
            const fromRoleId = asString(flow?.fromRoleId);
            const toRoleId = asString(flow?.toRoleId);
            const eventType = asString(flow?.eventType);
            if (!fromRoleId || !toRoleId || !eventType) {
              return [];
            }
            return [{ fromRoleId, toRoleId, eventType } satisfies WorkbenchStructureFlowView];
          }) ?? []
        }
      : null
  };
}

export function mapWorkbenchView(value: unknown): WorkbenchView {
  const record = asRecord(value) ?? {};
  return {
    workdir: asString(record.workdir) ?? "",
    systemPath: asString(record.systemPath) ?? "",
    systemSource: asString(record.systemSource) ?? "",
    validation: mapWorkbenchValidationView(record.validation)
  };
}

export function mapFollowUpActions(value: unknown): FollowUpActionView[] {
  return asArray(value)?.flatMap((item) => {
    const action = asRecord(item);
    const id = asString(action?.action);
    const label = asString(action?.label);
    if (!id || !label) {
      return [];
    }
    return [{
      action: id,
      label,
      detail: action?.detail
    } satisfies FollowUpActionView];
  }) ?? [];
}

export function mapWorkbenchSaveView(value: unknown): WorkbenchSaveView {
  const record = asRecord(value) ?? {};
  return {
    workdir: asString(record.workdir) ?? "",
    savedPath: asString(record.savedPath) ?? "",
    validation: mapWorkbenchValidationView(record.validation),
    followUpActions: mapFollowUpActions(record.followUpActions)
  };
}

export function mapProjectTransferView(value: unknown): ProjectTransferView {
  const record = asRecord(value) ?? {};
  const project = asRecord(record.project) ?? {};
  return {
    mode: record.mode === "single-project-v1" ? "single-project-v1" : "single-project-v1",
    releaseManifest: record.releaseManifest,
    project: {
      systemPath: asString(project.systemPath) ?? "system.mmd",
      systemSource: asString(project.systemSource) ?? "",
      runtime: project.runtime ?? null,
      modelSelection: project.modelSelection ?? null,
      modelCatalog: project.modelCatalog ?? null,
      laws: project.laws ?? null,
      userProfile: project.userProfile ?? null,
      profiles: project.profiles ?? null,
      tools: project.tools ?? null,
      project: project.project ?? null
    }
  };
}

export function mapProjectLoadView(value: unknown): ProjectLoadView {
  const record = asRecord(value) ?? {};
  const loadedFiles = asArray(record.loadedFiles)
    ?.map((item) => asString(item))
    .filter((item): item is string => Boolean(item)) ?? [];
  return {
    workdir: asString(record.workdir) ?? "",
    mode: record.mode === "single-project-v1" ? "single-project-v1" : "single-project-v1",
    loadedFiles,
    validation: mapWorkbenchValidationView(record.validation),
    followUpActions: mapFollowUpActions(record.followUpActions)
  };
}

export function mapRunLifecycleView(value: unknown): RunLifecycleView {
  const record = asRecord(value) ?? {};
  const resultSummary = asRecord(record.resultSummary) ?? {};
  return {
    runId: asString(record.runId) ?? "",
    status: asString(record.status) ?? "unknown",
    resultSummary: {
      systemId: asString(resultSummary.systemId),
      systemVersion: asString(resultSummary.systemVersion),
      finalRoleId: asString(resultSummary.finalRoleId),
      transitionCount: asNumber(resultSummary.transitionCount),
      stageCount: asNumber(resultSummary.stageCount),
      error: asString(resultSummary.error),
      errorCode: asString(resultSummary.errorCode)
    },
    followUpActions: mapFollowUpActions(record.followUpActions)
  };
}

export function mapControlActionView(value: unknown): ControlActionView {
  const record = asRecord(value) ?? {};
  return {
    runId: asString(record.runId) ?? "",
    action: asString(record.action) ?? "",
    accepted: asBoolean(record.accepted) === true,
    semanticStatus: asString(record.semanticStatus) ?? "unknown",
    detail: record.detail ?? null
  };
}
