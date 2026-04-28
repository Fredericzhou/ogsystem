type JsonRecord = Record<string, unknown>;

function escapeText(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatJson(value: unknown): string {
  return JSON.stringify(value ?? null, null, 2);
}

export function statusTone(status: string | undefined): {
  fill: string;
  stroke: string;
  text: string;
} {
  switch (status) {
    case "active":
    case "waiting_review":
      return {
        fill: "rgba(56, 189, 248, 0.16)",
        stroke: "rgba(56, 189, 248, 0.52)",
        text: "#c8f4ff"
      };
    case "done":
    case "completed":
      return {
        fill: "rgba(52, 211, 153, 0.14)",
        stroke: "rgba(52, 211, 153, 0.44)",
        text: "#d8fff0"
      };
    case "failed":
      return {
        fill: "rgba(248, 113, 113, 0.14)",
        stroke: "rgba(248, 113, 113, 0.44)",
        text: "#ffe2e2"
      };
    default:
      return {
        fill: "rgba(148, 163, 184, 0.1)",
        stroke: "rgba(148, 163, 184, 0.3)",
        text: "#e5eefb"
      };
  }
}

export function bindingTone(bindingKind: string | undefined): string {
  switch (bindingKind) {
    case "model":
      return "model";
    case "profile":
      return "profile";
    default:
      return "noop";
  }
}

export function renderProjectSummaryPanel(args: {
  summary: JsonRecord | null | undefined;
  roles: Array<Record<string, unknown>>;
  warnings: string[];
  workbenchSavedPath: string;
  validationOk: boolean;
}): string {
  const summary = args.summary ?? {};
  const roleCards = args.roles.map((role) => {
    const roleId = escapeText(role.roleId);
    const binding = escapeText((role.binding as JsonRecord | undefined)?.bindingKind ?? "n/a");
    const flags = [
      role.review ? "review" : "",
      role.join ? "join" : "",
      role.loop ? "loop" : "",
      role.projection ? "projection" : ""
    ].filter(Boolean);
    return (
      '<div class="event">' +
      '<div class="event-top"><span><code>' + roleId + "</code></span><span>" + binding + "</span></div>" +
      "<strong>" + escapeText(flags.join(" · ") || "standard role") + "</strong>" +
      '<div class="hint">' + escapeText((role.summary as JsonRecord | undefined)?.label ?? "role package available") + "</div>" +
      "</div>"
    );
  });
  const warningCards = args.warnings.length > 0
    ? args.warnings.map((warning) =>
        '<div class="event"><div class="event-top"><span>model warning</span><span>attention</span></div><strong>' +
        escapeText(warning) +
        "</strong></div>"
      )
    : ['<div class="event"><div class="event-top"><span>model warning</span><span>ok</span></div><strong>none</strong></div>'];

  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>project</span><span>' + escapeText(summary.projectId ?? "n/a") + "</span></div><strong>" +
      escapeText(summary.projectName ?? "unknown") + '</strong><div class="hint">system ' + escapeText(summary.systemId ?? "n/a") +
      " · version " + escapeText(summary.systemVersion ?? "n/a") +
      " · entry " + escapeText(summary.entryRoleId ?? "n/a") + "</div></div>",
    '<div class="event"><div class="event-top"><span>structure</span><span>' + escapeText(summary.roleCount ?? 0) + " roles</span></div><strong>" +
      escapeText("flows " + String(summary.flowCount ?? 0) + " · workbench " + (args.validationOk ? "validated" : "needs attention")) +
      '</strong><div class="hint">system path ' + escapeText(args.workbenchSavedPath || "system.mmd") + "</div></div>",
    '<div class="event"><div class="event-top"><span>special roles</span><span>graph metadata</span></div><strong>' +
      escapeText("review " + ((summary.reviewedRoleIds as unknown[] | undefined)?.join(", ") || "none")) +
      '</strong><div class="hint">join ' + escapeText((summary.joinRoleIds as unknown[] | undefined)?.join(", ") || "none") +
      " · loop " + escapeText((summary.loopRoleIds as unknown[] | undefined)?.join(", ") || "none") +
      " · context " + escapeText((summary.contextMappedRoleIds as unknown[] | undefined)?.join(", ") || "none") + "</div></div>",
    ...warningCards,
    ...roleCards,
    "</div>"
  ].join("");
}

export function renderFailureSummaryPanel(args: {
  failure: Record<string, unknown> | null | undefined;
  loaded: boolean;
  stale: boolean;
}): string {
  if (!args.loaded) {
    return '<div class="hint">Failure triage loads with the selected run.</div>';
  }
  if (!args.failure) {
    return '<div class="hint">No recent failure captured for this run.</div>';
  }
  const summary = ((args.failure.summary ?? args.failure) || {}) as JsonRecord;
  const detail = ((args.failure.detail ?? {}) || {}) as JsonRecord;
  const errorCode = String(summary.errorCode ?? detail.errorCode ?? "none");
  const stage = String(summary.stage ?? detail.stage ?? "n/a");
  const message = String(summary.message ?? detail.message ?? "No failure message recorded.");
  const roleId = String(summary.roleId ?? detail.roleId ?? "n/a");
  const branchId = String(summary.branchId ?? detail.branchId ?? "n/a");
  const retryable = Boolean(summary.retryable ?? detail.retryable);
  const durationMs = summary.durationMs ?? detail.durationMs ?? "n/a";
  const timeoutMs =
    detail.timeoutMs ??
    ((detail.selectedBinding as JsonRecord | undefined)?.timeoutMs ?? (summary.timeoutMs as unknown));
  const classifyError = (): string => {
    if (errorCode === "TOOL_EXECUTION_TIMEOUT") return "timeout budget exhausted";
    if (errorCode.includes("CONTRACT")) return "contract handoff violation";
    if (errorCode.includes("SCHEMA")) return "schema mismatch";
    if (errorCode.includes("PROVIDER") || errorCode.includes("MODEL")) return "provider or model failure";
    if (errorCode === "ROLE_EXECUTION_FAILED") return "role execution failed";
    return "runtime failure";
  };
  const summaryCards = [
    '<div class="event"><div class="event-top"><span>recent failed role</span><span>' +
      escapeText(stage) +
      '</span></div><strong><code>' +
      escapeText(roleId) +
      '</code></strong><div class="hint">' +
      escapeText(branchId + " · " + classifyError()) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>error code</span><span>' +
      escapeText(retryable ? "retryable" : "terminal") +
      '</span></div><strong>' +
      escapeText(errorCode) +
      '</strong><div class="hint">' +
      escapeText(message) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>budget</span><span>' +
      escapeText(args.stale ? "stale" : "fresh") +
      '</span></div><strong>' +
      escapeText("duration " + durationMs + " ms") +
      '</strong><div class="hint">' +
      escapeText(timeoutMs ? "timeout budget " + timeoutMs + " ms" : "timeout budget unavailable") +
      "</div></div>"
  ];
  return ['<div class="structure-list">', ...summaryCards, "</div>"].join("");
}

export function renderFailureDetailPanel(args: {
  failure: Record<string, unknown> | null | undefined;
  loaded: boolean;
}): string {
  if (!args.loaded) {
    return '<div class="hint">Failure detail is not loaded yet.</div>';
  }
  if (!args.failure) {
    return '<div class="hint">No failure detail available.</div>';
  }
  const summary = ((args.failure.summary ?? args.failure) || {}) as JsonRecord;
  const detail = ((args.failure.detail ?? {}) || {}) as JsonRecord;
  const selectedBinding = ((detail.selectedBinding ?? summary.selectedBinding) || {}) as JsonRecord;
  const upstreamRoleIds = Array.isArray(detail.upstreamRoleIds) ? detail.upstreamRoleIds : [];
  const allowedEvents = Array.isArray(detail.allowedEvents) ? detail.allowedEvents : [];
  const contract = ((detail.contract ?? summary.contract) || {}) as JsonRecord;
  const schemaPath = detail.schemaPath ?? contract.schemaPath ?? "n/a";
  const rawOutput = detail.rawOutput ?? detail.rawModelOutput ?? summary.rawOutput ?? null;
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>projected input</span><span>' +
      escapeText(Array.isArray(detail.inputContext) ? "array" : typeof detail.inputContext) +
      '</span></div><strong>' +
      escapeText(detail.correctionRequest ? "correction request present" : "input context available") +
      '</strong><div class="hint">' +
      escapeText("schema " + schemaPath) +
      '</div>' +
      (detail.inputContext ? '<pre>' + escapeText(formatJson(detail.inputContext)) + "</pre>" : "") +
      "</div>",
    '<div class="event"><div class="event-top"><span>binding resolution</span><span>' +
      escapeText(String(selectedBinding.bindingKind ?? selectedBinding.kind ?? "n/a")) +
      '</span></div><strong>' +
      escapeText(String(selectedBinding.resolvedBinding ?? selectedBinding.bindingRef ?? "binding unavailable")) +
      '</strong><div class="hint">' +
      escapeText(
        "declared " + String(selectedBinding.declaredBinding ?? "n/a")
          + " · timeout " + String(selectedBinding.timeoutMs ?? detail.timeoutMs ?? "n/a")
          + " ms · output budget " + String(selectedBinding.maxOutputBytes ?? "n/a")
      ) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>contract</span><span>' +
      escapeText(String(contract.kind ?? "n/a")) +
      '</span></div><strong>' +
      escapeText(String(contract.contractId ?? "contract unavailable")) +
      '</strong><div class="hint">' +
      escapeText(
        "flow " + String(contract.flowKey ?? "n/a")
          + " · schema " + String(contract.schemaPath ?? schemaPath)
      ) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>role schema</span><span>' +
      escapeText(String(allowedEvents.length)) +
      '</span></div><strong>' +
      escapeText(allowedEvents.length ? allowedEvents.join(", ") : "allowed events unavailable") +
      '</strong><div class="hint">' +
      escapeText("upstream " + (upstreamRoleIds.length ? upstreamRoleIds.join(", ") : "none")) +
      "</div></div>",
    rawOutput
      ? '<div class="event"><div class="event-top"><span>raw output</span><span>captured</span></div><strong>Provider / role raw output snapshot</strong><pre>' +
        escapeText(typeof rawOutput === "string" ? rawOutput : formatJson(rawOutput)) +
        "</pre></div>"
      : '<div class="event"><div class="event-top"><span>raw output</span><span>missing</span></div><strong>No raw output snapshot captured</strong></div>',
    "</div>"
  ].join("");
}

export function renderSuggestedNextChecksPanel(args: {
  failure: Record<string, unknown> | null | undefined;
  loaded: boolean;
}): string {
  if (!args.loaded) {
    return '<div class="hint">Suggested checks appear after failure data loads.</div>';
  }
  if (!args.failure) {
    return '<div class="hint">No failure-specific next checks are needed right now.</div>';
  }
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>suggested next checks</span><span>actions</span></div><strong>Move directly to the likely root-cause surfaces</strong><div class="hint">These actions jump to the panel that explains the failing input, binding, schema, contract, or resume blockers.</div></div>',
    '<div class="actions">',
    '<button class="button subtle" id="failure-check-input">Inspect projected input</button>',
    '<button class="button subtle" id="failure-check-binding">Inspect binding resolution</button>',
    '<button class="button subtle" id="failure-check-role-package">Inspect role schema</button>',
    '<button class="button subtle" id="failure-check-contract">Inspect contract</button>',
    '<button class="button subtle" id="failure-check-resume">Inspect resume readiness</button>',
    "</div>",
    "</div>"
  ].join("");
}

export function renderBindingExplainPanel(args: {
  bindings: Record<string, unknown> | null | undefined;
  stale?: boolean;
}): string {
  const bindings = args.bindings ?? {};
  const roles = Array.isArray(bindings.roles)
    ? bindings.roles as JsonRecord[]
    : Array.isArray(bindings.bindings)
      ? bindings.bindings as JsonRecord[]
      : Array.isArray(bindings.entries)
        ? bindings.entries as JsonRecord[]
        : [];
  if (!roles.length) {
    return '<div class="hint">Binding explain data unavailable.</div>';
  }
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>binding explain</span><span>' +
      escapeText(args.stale ? "stale" : "fresh") +
      '</span></div><strong>' +
      escapeText(roles.length + " roles resolved from system + model-selection") +
      "</strong></div>",
    ...roles.map((role) =>
      '<div class="event"><div class="event-top"><span><code>' +
      escapeText(role.roleId ?? "n/a") +
      '</code></span><span>' +
      escapeText(role.bindingKind ?? "n/a") +
      "</span></div><strong>" +
      escapeText(
        String(role.declaredBinding ?? "undeclared")
          + " -> " + String(role.resolvedBinding ?? role.effectiveBinding ?? "unresolved")
      ) +
      '</strong><div class="hint">' +
      escapeText(
        "effective " + String(role.effectiveBinding ?? role.resolvedBinding ?? "n/a")
          + " · timeout " + String(role.timeoutMs ?? "n/a")
          + " ms · output budget " + String(role.maxOutputBytes ?? "n/a")
          + " · source " + String(role.source ?? "unknown")
      ) +
      "</div></div>"
    ),
    "</div>"
  ].join("");
}

export function renderRolePackagePanel(args: {
  rolePackages: Record<string, unknown> | null | undefined;
}): string {
  const rolePackages = args.rolePackages ?? {};
  const roles = Array.isArray(rolePackages.roles)
    ? rolePackages.roles as JsonRecord[]
    : Array.isArray(rolePackages.rolePackages)
      ? rolePackages.rolePackages as JsonRecord[]
      : Array.isArray(rolePackages.entries)
        ? rolePackages.entries as JsonRecord[]
        : [];
  if (!roles.length) {
    return '<div class="hint">Role package summaries unavailable.</div>';
  }
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>role packages</span><span>' +
      escapeText(roles.length) +
      '</span></div><strong>Role package health and schema coverage</strong></div>',
    ...roles.map((role) => {
      const files = ((role.files ?? role.health) || {}) as JsonRecord;
      const allowedEvents = Array.isArray(role.allowedEvents) ? role.allowedEvents : [];
      const presentFiles = Object.entries(files)
        .filter(([, present]) => Boolean(present))
        .map(([key]) => key);
      return (
        '<div class="event"><div class="event-top"><span><code>' +
        escapeText(role.roleId ?? "n/a") +
        '</code></span><span>' +
        escapeText(role.summary ?? role.label ?? "package") +
        "</span></div><strong>" +
        escapeText(String(role.outputSchemaPath ?? role.schemaPath ?? "output schema unavailable")) +
        '</strong><div class="hint">' +
        escapeText(
          "allowed events " + (allowedEvents.length ? allowedEvents.join(", ") : "unknown")
            + " · files " + (presentFiles.length ? presentFiles.join(", ") : "none")
        ) +
        "</div></div>"
      );
    }),
    "</div>"
  ].join("");
}

export function renderContractPanel(args: {
  contracts: Record<string, unknown> | null | undefined;
}): string {
  const contracts = args.contracts ?? {};
  const flows = Array.isArray(contracts.flows)
    ? contracts.flows as JsonRecord[]
    : Array.isArray(contracts.contracts)
      ? contracts.contracts as JsonRecord[]
      : Array.isArray(contracts.entries)
        ? contracts.entries as JsonRecord[]
        : [];
  const uncoveredEdges = Array.isArray(contracts.uncoveredEdges) ? contracts.uncoveredEdges : [];
  if (!flows.length && !uncoveredEdges.length) {
    return '<div class="hint">Contract coverage data unavailable.</div>';
  }
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>contract coverage</span><span>' +
      escapeText(uncoveredEdges.length ? uncoveredEdges.length + " uncovered" : "complete") +
      '</span></div><strong>Strict handoff coverage across flows and role inputs</strong></div>',
    ...flows.map((flow) =>
      '<div class="event"><div class="event-top"><span>' +
      escapeText(String(flow.flowKey ?? flow.edgeKey ?? "flow")) +
      "</span><span>" +
      escapeText(String(flow.kind ?? "flow")) +
      "</span></div><strong>" +
      escapeText(String(flow.contractId ?? "missing contract")) +
      '</strong><div class="hint">' +
      escapeText(
        "schema " + String(flow.schemaPath ?? "n/a")
          + " · status " + String(flow.lastStatus ?? flow.coverage ?? "unknown")
      ) +
      "</div></div>"
    ),
    ...uncoveredEdges.map((edge) =>
      '<div class="event"><div class="event-top"><span>missing contract</span><span>coverage gap</span></div><strong>' +
      escapeText(String(edge.flowKey ?? edge.edgeKey ?? "uncovered edge")) +
      '</strong><div class="hint">' +
      escapeText(String(edge.fromRoleId ?? "n/a") + " -> " + String(edge.toRoleId ?? "n/a")) +
      "</div></div>"
    ),
    "</div>"
  ].join("");
}

export function renderReviewDetailPanel(detail: Record<string, unknown> | null | undefined): string {
  if (!detail) {
    return '<div class="hint">No review selected.</div>';
  }
  const history = Array.isArray(detail.history) ? detail.history : [];
  const historyCards = history.length > 0
    ? history.map((entry) => {
        const record = (entry ?? {}) as JsonRecord;
        return (
          '<div class="event"><div class="event-top"><span>' +
          escapeText(record.decision ?? "history") +
          "</span><span>" +
          escapeText(record.decidedAt ?? record.committedAt ?? "n/a") +
          "</span></div><strong>" +
          escapeText(record.actor ?? "unknown actor") +
          '</strong><div class="hint">' +
          escapeText(record.comment ?? "no comment") +
          "</div></div>"
        );
      })
    : ['<div class="hint">No prior decision history.</div>'];
  const nextActionSummary =
    detail.currentStatus === "pending"
      ? "Awaiting approve, rework, pause, or terminate."
      : detail.decisionPhase === "recorded"
        ? "Decision recorded; runtime reconcile should be inspected next."
        : detail.decisionPhase === "pending_reconcile"
          ? "Decision has checkpoint state but still blocks clean resume."
          : "No immediate action available.";
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>review</span><span>' + escapeText(detail.currentStatus ?? "unknown") + "</span></div><strong>" +
      escapeText(detail.reviewId ?? "n/a") +
      '</strong><div class="hint">' +
      escapeText((detail.roleId ?? "n/a") + " · " + (detail.branchId ?? "n/a")) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>decision</span><span>' + escapeText(detail.decisionPhase ?? "none") + "</span></div><strong>" +
      escapeText(detail.decision ?? "pending") +
      '</strong><div class="hint">' +
      escapeText((detail.actor ?? "n/a") + " · " + (detail.comment ?? "no comment")) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>timing</span><span>round ' + escapeText(detail.round ?? "n/a") + '</span></div><strong>' +
      escapeText("requested " + (detail.requestedAt ?? "n/a")) +
      '</strong><div class="hint">' +
      escapeText("decided " + (detail.decidedAt ?? "n/a") + " · applied " + (detail.appliedAt ?? "n/a")) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>selected event</span><span>' + escapeText(detail.scope ?? "n/a") + '</span></div><strong>' +
      escapeText(detail.selectedEvent ?? "n/a") +
      '</strong><div class="hint">' +
      escapeText("execution " + (detail.executionId ?? "n/a") + " · requestedBy " + (detail.requestedByExecutionId ?? "n/a")) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>next step</span><span>' + escapeText(detail.branchStatus ?? "n/a") + '</span></div><strong>' +
      escapeText(nextActionSummary) +
      '</strong><div class="hint">' +
      escapeText("selected event " + (detail.selectedEvent ?? "n/a") + " · branch " + (detail.branchId ?? "n/a")) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>history</span><span>' + escapeText(history.length) + '</span></div><strong>Decision trail</strong></div>',
    ...historyCards,
    '<div class="event"><div class="event-top"><span>request snapshot</span><span>captured</span></div><strong>Review request context</strong><pre>' +
      escapeText(formatJson(detail.reviewRequestSnapshot ?? detail.requestSnapshot ?? detail.spec ?? null)) +
      "</pre></div>",
    '<div class="event"><div class="event-top"><span>decision snapshot</span><span>captured</span></div><strong>Decision durability snapshot</strong><pre>' +
      escapeText(formatJson(detail.decisionSnapshot ?? {
        decision: detail.decision ?? null,
        actor: detail.actor ?? null,
        comment: detail.comment ?? null,
        decidedAt: detail.decidedAt ?? null,
        committedAt: detail.committedAt ?? null,
        checkpointSequence: detail.checkpointSequence ?? null,
        appliedAt: detail.appliedAt ?? null,
        reconciledAt: detail.reconciledAt ?? null
      })) +
      "</pre></div>",
    '<div class="event"><div class="event-top"><span>context</span><span>snapshot</span></div><strong>Human review context</strong><pre>' +
      escapeText(formatJson(detail.humanReviewContext ?? null)) +
      "</pre></div>",
    "</div>"
  ].join("");
}

export function renderReviewQueuePanel(args: {
  reviews: Record<string, unknown> | null | undefined;
  selectedReviewId: string;
}): string {
  const reviewList = Array.isArray(args.reviews?.reviews) ? args.reviews?.reviews as JsonRecord[] : [];
  if (!reviewList.length) {
    return '<div class="hint">No reviews for this run.</div>';
  }
  const statusCounts = reviewList.reduce<Record<string, number>>((counts, review) => {
    const key = String(review.currentStatus ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>queue summary</span><span>' +
      escapeText(reviewList.length) +
      '</span></div><strong>' +
      escapeText(
        Object.entries(statusCounts)
          .map(([status, count]) => status.replace(/_/g, " ") + " " + count)
          .join(" · ")
      ) +
      "</strong></div>",
    ...reviewList.map((review) =>
      '<button class="run-card ' + (review.reviewId === args.selectedReviewId ? "active" : "") + '" data-review-id="' + escapeText(review.reviewId) + '">' +
      '<div class="run-title"><span class="truncate" title="' + escapeText(review.reviewId) + '"><code>' + escapeText(review.reviewId) + '</code></span>' +
      '<span class="status ' + escapeText(String(review.currentStatus ?? "unknown")) + '">' + escapeText(String(review.currentStatus ?? "unknown").replace(/_/g, " ")) + "</span></div>" +
      '<div class="meta">' +
      '<span>' + escapeText(String(review.roleId ?? "n/a")) + "</span>" +
      '<span>' + escapeText("round " + String(review.round ?? "n/a")) + "</span>" +
      '<span>' + escapeText("phase " + String(review.decisionPhase ?? "none").replace(/_/g, " ")) + "</span>" +
      '<span>' + escapeText(String(review.actor ?? "unassigned")) + "</span>" +
      '<span>' + escapeText(String(review.reworkTarget ?? review.reworkRoleId ?? "no rework target")) + "</span>" +
      "</div>" +
      (review.comment ? '<div class="hint">' + escapeText(String(review.comment)) + "</div>" : "") +
      "</button>"
    ),
    "</div>"
  ].join("");
}

export function renderResumeReadinessPanel(args: {
  readiness: Record<string, unknown> | null | undefined;
  loaded: boolean;
  stale: boolean;
  diagnostics: Record<string, unknown> | null | undefined;
}): string {
  if (!args.loaded) {
    return '<div class="hint">Resume readiness loads with the selected run.</div>';
  }
  if (!args.readiness) {
    return '<div class="hint">Resume readiness unavailable.</div>';
  }
  const blockers = Array.isArray(args.readiness.blockers)
    ? args.readiness.blockers as JsonRecord[]
    : Array.isArray(args.readiness.blockingIssues)
      ? args.readiness.blockingIssues as JsonRecord[]
      : Array.isArray(args.readiness.issues)
        ? args.readiness.issues as JsonRecord[]
        : [];
  const driftSources = Array.isArray(args.readiness.driftSources)
    ? args.readiness.driftSources as JsonRecord[]
    : Object.entries((args.readiness.driftBySource ?? {}) as JsonRecord).map(([source, value]) => ({
        source,
        detail: value,
        changed: Boolean(value),
        blocking: false,
        message: Array.isArray(value)
          ? value.length + " issue(s)"
          : typeof value === "object" && value !== null
            ? "details available"
            : String(value)
      }));
  const checks = Array.isArray(args.diagnostics?.checks) ? args.diagnostics?.checks as JsonRecord[] : [];
  const canResume =
    typeof args.readiness.canResume === "boolean"
      ? args.readiness.canResume
      : args.readiness.status === "ready";
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>resume readiness</span><span>' +
      escapeText(args.stale ? "stale" : "fresh") +
      '</span></div><strong>' +
      escapeText(canResume ? "can resume" : "resume blocked") +
      '</strong><div class="hint">' +
      escapeText(
        "status " + String(args.readiness.status ?? "unknown")
          + " · " + String(args.readiness.reason ?? args.readiness.summary ?? "no summary")
      ) +
      "</div></div>",
    ...(blockers.length
      ? blockers.map((blocker) =>
          '<div class="event"><div class="event-top"><span>' +
          escapeText(String(blocker.category ?? blocker.kind ?? blocker.code ?? blocker.id ?? "blocker")) +
          "</span><span>" +
          escapeText(String(blocker.blocking === false ? "non-blocking" : blocker.severity ?? "blocking")) +
          "</span></div><strong>" +
          escapeText(String(blocker.title ?? blocker.label ?? blocker.message ?? "resume blocker")) +
          '</strong><div class="hint">' +
          escapeText(String(blocker.source ?? "")) +
          (blocker.detail ? '<pre>' + escapeText(formatJson(blocker.detail)) + "</pre>" : "") +
          "</div></div>"
        )
      : ['<div class="event"><div class="event-top"><span>blockers</span><span>0</span></div><strong>No blocking issues reported</strong></div>']),
    ...driftSources.map((drift) =>
      '<div class="event"><div class="event-top"><span>drift source</span><span>' +
      escapeText(String(drift.source ?? "unknown")) +
      '</span></div><strong>' +
      escapeText(String(drift.message ?? (drift.changed ? "changed" : "unchanged"))) +
      '</strong><div class="hint">' +
      escapeText(String(drift.blocking ? "blocking" : drift.changed ? "changed" : "stable")) +
      '</div>' +
      (drift.detail ? '<pre>' + escapeText(formatJson(drift.detail)) + "</pre>" : "") +
      "</div>"
    ),
    ...(driftSources.length ? [] : [
      '<div class="event"><div class="event-top"><span>drift source</span><span>0</span></div><strong>No drift sources reported</strong></div>'
    ]),
    ...(checks.length
      ? checks.map((check) =>
          '<div class="event"><div class="event-top"><span>diagnostic check</span><span>' +
          escapeText(String(check.ok ? "ok" : check.severity ?? "warn")) +
          '</span></div><strong>' +
          escapeText(String(check.label ?? check.id ?? "check")) +
          '</strong><div class="hint">' +
          escapeText(String(check.message ?? "")) +
          "</div></div>"
        )
      : ['<div class="hint">Detailed resume diagnostics remain on-demand.</div>']),
    "</div>"
  ].join("");
}

export function renderLogsPanel(args: {
  loaded: boolean;
  stale: boolean;
  selectedRoleId: string;
  engine: unknown[];
  role: unknown[];
}): string {
  if (!args.loaded) {
    return '<div class="hint">Logs load on demand. Use the control above when you need engine or role traces.</div>';
  }

  const renderLogEntries = (label: string, records: unknown[]): string => {
    if (!records.length) {
      return (
        '<div class="event"><div class="event-top"><span>' +
        escapeText(label) +
        '</span><span>0</span></div><strong>no records</strong></div>'
      );
    }
    return [
      '<div class="event"><div class="event-top"><span>' + escapeText(label) + '</span><span>' + escapeText(records.length) + '</span></div><strong>' +
        escapeText(label === "role log" ? (args.selectedRoleId || "latest role") : "engine stream") +
        '</strong><div class="hint">' + escapeText(args.stale ? "stale since last stream event" : "fresh") + "</div></div>",
      ...records.map((item) => {
        const record = (item ?? {}) as JsonRecord;
        const summary = typeof record.message === "string"
          ? record.message
          : typeof record.line === "string"
            ? record.line
            : formatJson(record);
        return (
          '<div class="event"><div class="event-top"><span>' +
          escapeText(record.level ?? label) +
          "</span><span>" +
          escapeText(record.at ?? record.timestamp ?? "n/a") +
          "</span></div><strong>" +
          escapeText(summary) +
          "</strong></div>"
        );
      })
    ].join("");
  };

  return [
    '<div class="structure-list">',
    renderLogEntries("engine log", args.engine),
    renderLogEntries("role log", args.role),
    "</div>"
  ].join("");
}

export function renderRunStatePanel(args: {
  state: unknown;
  header: JsonRecord | null | undefined;
  graph: JsonRecord | null | undefined;
}): string {
  const summarizeValue = (value: unknown): { label: string; detail?: string } => {
    if (Array.isArray(value)) {
      return {
        label: `array · ${value.length} item${value.length === 1 ? "" : "s"}`,
        detail: value.length ? formatJson(value) : undefined
      };
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value as JsonRecord);
      return {
        label: `object · ${keys.length} key${keys.length === 1 ? "" : "s"}`,
        detail: keys.length ? formatJson(value) : undefined
      };
    }
    if (typeof value === "boolean") {
      return { label: value ? "true" : "false" };
    }
    if (value === null || value === undefined || value === "") {
      return { label: "empty" };
    }
    return { label: String(value) };
  };
  const renderStructuredValueCards = (title: string, value: unknown): string[] => {
    const record = value && typeof value === "object" && !Array.isArray(value)
      ? value as JsonRecord
      : undefined;
    if (!record) {
      const summary = summarizeValue(value);
      return [
        '<div class="event"><div class="event-top"><span>' + escapeText(title) + '</span><span>value</span></div><strong>' +
        escapeText(summary.label) +
        '</strong>' +
        (summary.detail ? '<pre>' + escapeText(summary.detail) + "</pre>" : "") +
        "</div>"
      ];
    }
    const keys = Object.keys(record);
    if (!keys.length) {
      return [
        '<div class="event"><div class="event-top"><span>' + escapeText(title) + '</span><span>empty</span></div><strong>no fields</strong></div>'
      ];
    }
    return keys.map((key) => {
      const summary = summarizeValue(record[key]);
      return (
        '<div class="event"><div class="event-top"><span>' +
        escapeText(`${title}.${key}`) +
        "</span><span>" +
        escapeText(summary.label) +
        "</span></div><strong>" +
        escapeText(key) +
        "</strong>" +
        (summary.detail ? '<pre>' + escapeText(summary.detail) + "</pre>" : "") +
        "</div>"
      );
    });
  };
  if (args.state === null || args.state === undefined) {
    return '<div class="hint">Runtime state unavailable.</div>';
  }
  const header = args.header ?? {};
  const graph = args.graph ?? {};
  const graphNodes = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
  const graphEdges = Array.isArray(graph.edges) ? graph.edges.length : 0;
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>runtime</span><span>' + escapeText(header.status ?? "unknown") + "</span></div><strong>" +
      escapeText(String((args.state as JsonRecord | undefined)?.status ?? header.status ?? "state available")) +
      '</strong><div class="hint">active branches ' + escapeText(header.activeBranches ?? 0) +
      " · pending reviews " + escapeText(header.pendingReviewCount ?? 0) + "</div></div>",
    '<div class="event"><div class="event-top"><span>graph snapshot</span><span>' + escapeText(graphNodes) + " nodes</span></div><strong>" +
      escapeText(`flows ${graphEdges}`) +
      '</strong><div class="hint">last role ' + escapeText(header.lastExecutedRoleId ?? "n/a") +
      " · final role " + escapeText(header.finalRoleId ?? "n/a") + "</div></div>",
    ...renderStructuredValueCards("state", args.state),
    "</div>"
  ].join("");
}

export function renderArtifactsPanel(args: {
  detail: Record<string, unknown> | null | undefined;
  graph: Record<string, unknown> | null | undefined;
  reviews: Record<string, unknown> | null | undefined;
  reviewDetail: Record<string, unknown> | null | undefined;
  resumeDiagnostics: Record<string, unknown> | null | undefined;
}): string {
  const summarizeValue = (value: unknown): { label: string; detail?: string } => {
    if (Array.isArray(value)) {
      return {
        label: `array · ${value.length} item${value.length === 1 ? "" : "s"}`,
        detail: value.length ? formatJson(value) : undefined
      };
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value as JsonRecord);
      return {
        label: `object · ${keys.length} key${keys.length === 1 ? "" : "s"}`,
        detail: keys.length ? formatJson(value) : undefined
      };
    }
    if (typeof value === "boolean") {
      return { label: value ? "true" : "false" };
    }
    if (value === null || value === undefined || value === "") {
      return { label: "empty" };
    }
    return { label: String(value) };
  };
  const renderStructuredValueCards = (title: string, value: unknown): string[] => {
    const record = value && typeof value === "object" && !Array.isArray(value)
      ? value as JsonRecord
      : undefined;
    if (!record) {
      const summary = summarizeValue(value);
      return [
        '<div class="event"><div class="event-top"><span>' + escapeText(title) + '</span><span>value</span></div><strong>' +
        escapeText(summary.label) +
        '</strong>' +
        (summary.detail ? '<pre>' + escapeText(summary.detail) + "</pre>" : "") +
        "</div>"
      ];
    }
    const keys = Object.keys(record);
    if (!keys.length) {
      return [
        '<div class="event"><div class="event-top"><span>' + escapeText(title) + '</span><span>empty</span></div><strong>no fields</strong></div>'
      ];
    }
    return keys.map((key) => {
      const summary = summarizeValue(record[key]);
      return (
        '<div class="event"><div class="event-top"><span>' +
        escapeText(`${title}.${key}`) +
        "</span><span>" +
        escapeText(summary.label) +
        "</span></div><strong>" +
        escapeText(key) +
        "</strong>" +
        (summary.detail ? '<pre>' + escapeText(summary.detail) + "</pre>" : "") +
        "</div>"
      );
    });
  };
  if (!args.detail) {
    return '<div class="hint">No run selected.</div>';
  }
  const header = (args.detail.header ?? {}) as JsonRecord;
  const reviewList = Array.isArray(args.reviews?.reviews) ? args.reviews.reviews as unknown[] : [];
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>run</span><span>' + escapeText(header.status ?? "unknown") + "</span></div><strong>" +
      escapeText(args.detail.runId ?? "n/a") +
      '</strong><div class="hint">' +
      escapeText((args.detail.runDir ?? "n/a") + " · updated " + (header.updatedAt ?? "n/a")) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>artifacts</span><span>' + escapeText(reviewList.length) + " reviews</span></div><strong>" +
      escapeText(`graph ${args.graph?.graph ? "available" : "missing"} · diagnostics ${args.resumeDiagnostics ? "loaded" : "lazy"}`) +
      '</strong><div class="hint">selected review ' + escapeText(args.reviewDetail?.reviewId ?? "none") + "</div></div>",
    ...renderStructuredValueCards("summary", args.detail.summary ?? null),
    ...renderStructuredValueCards("metrics", args.detail.metrics ?? null),
    ...renderStructuredValueCards("resolvedConfig", args.detail.resolvedConfig ?? null),
    ...renderStructuredValueCards("stopRequest", args.detail.stopRequest ?? null),
    ...renderStructuredValueCards("stopOutcome", args.detail.stopOutcome ?? null),
    "</div>"
  ].join("");
}

export function renderRunTopologySvg(graph: Record<string, unknown> | null | undefined): string {
  if (!graph) {
    return '<div class="hint">Graph projection unavailable.</div>';
  }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes as JsonRecord[] : [];
  const edges = Array.isArray(graph.edges) ? graph.edges as JsonRecord[] : [];
  if (!nodes.length) {
    return '<div class="hint">No graph nodes available.</div>';
  }

  const adjacency = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const node of nodes) {
    const roleId = String(node.roleId ?? "");
    adjacency.set(roleId, []);
    indegree.set(roleId, 0);
  }
  for (const edge of edges) {
    const source = String(edge.sourceRoleId ?? "");
    const target = String(edge.targetRoleId ?? "");
    if (!adjacency.has(source) || !indegree.has(target)) {
      continue;
    }
    adjacency.get(source)?.push(target);
    indegree.set(target, (indegree.get(target) ?? 0) + 1);
  }

  const levels = new Map<string, number>();
  const queue: string[] = [];
  const entryRoleId = String(graph.entryRoleId ?? "");
  if (entryRoleId && indegree.has(entryRoleId)) {
    queue.push(entryRoleId);
  }
  for (const [roleId, degree] of indegree.entries()) {
    if (degree === 0 && roleId !== entryRoleId) {
      queue.push(roleId);
    }
  }
  const pendingIndegree = new Map(indegree);
  const visited = new Set<string>();
  while (queue.length > 0) {
    const roleId = queue.shift() ?? "";
    if (!roleId || visited.has(roleId)) {
      continue;
    }
    visited.add(roleId);
    const currentLevel = levels.get(roleId) ?? 0;
    for (const target of adjacency.get(roleId) ?? []) {
      levels.set(target, Math.max(levels.get(target) ?? 0, currentLevel + 1));
      pendingIndegree.set(target, (pendingIndegree.get(target) ?? 1) - 1);
      if ((pendingIndegree.get(target) ?? 0) <= 0) {
        queue.push(target);
      }
    }
  }
  let fallbackLevel = Math.max(0, ...levels.values(), 0);
  for (const node of nodes) {
    const roleId = String(node.roleId ?? "");
    if (!levels.has(roleId)) {
      fallbackLevel += 1;
      levels.set(roleId, fallbackLevel);
    }
  }

  const columns = new Map<number, JsonRecord[]>();
  for (const node of nodes) {
    const level = levels.get(String(node.roleId ?? "")) ?? 0;
    const bucket = columns.get(level) ?? [];
    bucket.push(node);
    columns.set(level, bucket);
  }

  const nodeWidth = 220;
  const nodeHeight = 112;
  const gapX = 140;
  const gapY = 44;
  const padding = 40;
  const positions = new Map<string, { x: number; y: number }>();
  const columnEntries = [...columns.entries()].sort((left, right) => left[0] - right[0]);
  const maxRows = Math.max(...columnEntries.map(([, columnNodes]) => columnNodes.length), 1);
  for (const [columnIndex, columnNodes] of columnEntries) {
    columnNodes.forEach((node, rowIndex) => {
      const roleId = String(node.roleId ?? "");
      const x = padding + (columnIndex * (nodeWidth + gapX));
      const topOffset = ((maxRows - columnNodes.length) * (nodeHeight + gapY)) / 2;
      const y = padding + topOffset + (rowIndex * (nodeHeight + gapY));
      positions.set(roleId, { x, y });
    });
  }

  const width = padding * 2 + (Math.max(columnEntries.length, 1) * nodeWidth) + (Math.max(columnEntries.length - 1, 0) * gapX);
  const height = padding * 2 + (maxRows * nodeHeight) + (Math.max(maxRows - 1, 0) * gapY);
  const edgeSvg = edges.map((edge) => {
    const source = positions.get(String(edge.sourceRoleId ?? ""));
    const target = positions.get(String(edge.targetRoleId ?? ""));
    if (!source || !target) {
      return "";
    }
    const x1 = source.x + nodeWidth;
    const y1 = source.y + (nodeHeight / 2);
    const x2 = target.x;
    const y2 = target.y + (nodeHeight / 2);
    const midX = (x1 + x2) / 2;
    const stroke = edge.isErrorFlow ? "rgba(248,113,113,0.64)" : edge.recentlyActivated ? "rgba(56,189,248,0.72)" : "rgba(148,163,184,0.34)";
    return (
      '<g>' +
      '<path d="M ' + x1 + " " + y1 + " C " + midX + " " + y1 + ", " + midX + " " + y2 + ", " + x2 + " " + y2 +
      '" fill="none" stroke="' + stroke + '" stroke-width="3" marker-end="url(#run-arrow)" />' +
      '<text x="' + midX + '" y="' + (Math.min(y1, y2) + Math.abs(y2 - y1) / 2 - 8) + '" text-anchor="middle" fill="#8fa1c3" font-size="11" font-family="IBM Plex Mono, monospace">' +
      escapeText(edge.event ?? "") +
      "</text></g>"
    );
  }).join("");

  const nodeSvg = nodes.map((node) => {
    const roleId = String(node.roleId ?? "");
    const position = positions.get(roleId);
    if (!position) {
      return "";
    }
    const tone = statusTone(String(node.status ?? ""));
    const binding = bindingTone(String(node.bindingKind ?? ""));
    const badge = binding === "model" ? "#38bdf8" : binding === "profile" ? "#34d399" : "#94a3b8";
    return (
      '<g>' +
      '<rect x="' + position.x + '" y="' + position.y + '" width="' + nodeWidth + '" height="' + nodeHeight + '" rx="22" ry="22" fill="' + tone.fill + '" stroke="' + tone.stroke + '" stroke-width="2" />' +
      '<circle cx="' + (position.x + 20) + '" cy="' + (position.y + 22) + '" r="7" fill="' + badge + '" />' +
      '<text x="' + (position.x + 34) + '" y="' + (position.y + 27) + '" fill="' + tone.text + '" font-size="15" font-family="IBM Plex Sans, sans-serif">' + escapeText(roleId) + '</text>' +
      '<text x="' + (position.x + 20) + '" y="' + (position.y + 54) + '" fill="#8fa1c3" font-size="12" font-family="IBM Plex Sans, sans-serif">' +
      escapeText(String(node.nodeType ?? "role") + " · " + String(node.status ?? "idle")) +
      '</text>' +
      '<text x="' + (position.x + 20) + '" y="' + (position.y + 76) + '" fill="#dce7f7" font-size="12" font-family="IBM Plex Sans, sans-serif">' +
      escapeText("active " + String(node.activeBranchCount ?? 0) + " · wait " + String(node.waitingReviewCount ?? 0) + " · pending " + String(node.pendingReviewCount ?? 0)) +
      '</text>' +
      '<text x="' + (position.x + 20) + '" y="' + (position.y + 96) + '" fill="#8fa1c3" font-size="11" font-family="IBM Plex Mono, monospace">' +
      escapeText(String(node.lastSelectedEvent ?? node.lastErrorCode ?? node.joinMode ?? "steady")) +
      "</text></g>"
    );
  }).join("");

  return (
    '<div class="preview">' +
    '<svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="Run topology graph">' +
    '<defs><marker id="run-arrow" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(148,163,184,0.58)"></path></marker></defs>' +
    edgeSvg +
    nodeSvg +
    "</svg></div>"
  );
}

export function renderWorkbenchTopologySvg(structure: Record<string, unknown> | null | undefined): string {
  if (!structure || !Array.isArray(structure.roles) || !structure.roles.length) {
    return '<div class="hint">Rendered view is available after Mermaid validation succeeds.</div>';
  }
  const roles = structure.roles as JsonRecord[];
  const flows = Array.isArray(structure.flows) ? structure.flows as JsonRecord[] : [];
  const knownRoleIds = new Set(roles.map((role) => String(role.roleId ?? "")));
  const terminalNodes: JsonRecord[] = [];
  for (const flow of flows) {
    for (const endpoint of [flow.fromRoleId, flow.toRoleId]) {
      const roleId = String(endpoint ?? "");
      if (!roleId || knownRoleIds.has(roleId)) {
        continue;
      }
      knownRoleIds.add(roleId);
      terminalNodes.push({
        roleId,
        bindingKind: "terminal",
        nodeType: "terminal"
      });
    }
  }
  return renderRunTopologySvg({
    entryRoleId: structure.entryRoleId,
    nodes: roles.concat(terminalNodes).map((role) => ({
      roleId: role.roleId,
      nodeType: role.nodeType ?? "role",
      status: "idle",
      bindingKind: role.bindingKind,
      activeBranchCount: 0,
      waitingReviewCount: 0,
      pendingReviewCount: 0,
      lastSelectedEvent: role.reviewMode || role.joinMode || role.routingMode || "structure"
    })),
    edges: flows.map((flow) => ({
          sourceRoleId: flow.fromRoleId,
          targetRoleId: flow.toRoleId,
          event: flow.eventType,
          isErrorFlow: false,
          recentlyActivated: false
        }))
  }).replace("Run topology graph", "Mermaid workbench topology");
}
