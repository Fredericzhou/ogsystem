type JsonRecord = Record<string, unknown>;
type Translator = (key: string, vars?: Record<string, unknown>, fallback?: string) => string;

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

export function displayUiToken(value: unknown, t: Translator): string {
  const text = String(value ?? "");
  if (!text || text === "n/a" || text === "undefined") {
    return t("common.notAvailable", undefined, "n/a");
  }
  const normalized = text.toLowerCase();
  if (normalized === "model") return t("token.model", undefined, "model");
  if (normalized === "profile") return t("token.profile", undefined, "profile");
  if (normalized === "role") return t("token.role", undefined, "role");
  if (normalized === "execution") return t("token.execution", undefined, "execution");
  if (normalized === "execute") return t("token.execute", undefined, "execution");
  if (normalized === "role_input") return t("token.roleInput", undefined, "role input");
  if (normalized === "flow") return t("token.flow", undefined, "flow");
  if (normalized === "audit") return t("token.audit", undefined, "audit");
  if (normalized === "parse") return t("token.parse", undefined, "parse");
  if (normalized === "event") return t("token.event", undefined, "event");
  return text;
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

export function normalizeStudioTargetRoleId(roleId: unknown): string {
  const value = String(roleId ?? "");
  return value === "__system_end__" ? "output" : value;
}

export function renderStudioGraphCanvas(args: {
  selectedRoleId: string;
  selectedFlowKey: string;
  busy: string;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const selection = args.selectedRoleId
    ? t("studio.roleInspector", undefined, "role inspector") + " " + args.selectedRoleId
    : args.selectedFlowKey
      ? t("studio.flowInspector", undefined, "flow inspector") + " " + args.selectedFlowKey
      : t("studio.selectRole", undefined, "Select a role to inspect metadata.");
  return [
    '<div class="studio-canvas-shell">',
    '<div class="studio-canvas-toolbar"><span class="hint">' + escapeText(t("studio.realGraph", undefined, "Studio Graph")) + '</span><span class="hint">' + escapeText(selection) + '</span></div>',
    '<div id="studio-graph-root" class="studio-graph-root" data-selected-role-id="' + escapeText(args.selectedRoleId) + '" data-selected-flow-key="' + escapeText(args.selectedFlowKey) + '"' + args.busy + "></div>",
    "</div>"
  ].join("");
}

export function renderProjectSummaryPanel(args: {
  summary: JsonRecord | null | undefined;
  roles: Array<Record<string, unknown>>;
  warnings: string[];
  workbenchSavedPath: string;
  validationOk: boolean;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
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
      "<strong>" + escapeText(flags.join(" · ") || t("project.standardRole", undefined, "standard role")) + "</strong>" +
      '<div class="hint">' + escapeText((role.summary as JsonRecord | undefined)?.label ?? t("project.rolePackageAvailable", undefined, "role package available")) + "</div>" +
      "</div>"
    );
  });
  const warningCards = args.warnings.length > 0
    ? args.warnings.map((warning) =>
        '<div class="event"><div class="event-top"><span>' + escapeText(t("project.modelWarning", undefined, "model warning")) + '</span><span>' + escapeText(t("common.attention", undefined, "attention")) + '</span></div><strong>' +
        escapeText(warning) +
        "</strong></div>"
      )
    : ['<div class="event"><div class="event-top"><span>' + escapeText(t("project.modelWarning", undefined, "model warning")) + '</span><span>' + escapeText(t("common.ok", undefined, "ok")) + '</span></div><strong>' + escapeText(t("common.none", undefined, "none")) + '</strong></div>'];

  return [
    '<div class="structure-list project-overview-grid">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("project.project", undefined, "project")) + '</span><span>' + escapeText(summary.projectId ?? "n/a") + "</span></div><strong>" +
      escapeText(summary.projectName ?? t("common.unknown", undefined, "unknown")) + '</strong><div class="hint">' +
      escapeText(t("project.systemVersionEntry", {
        systemId: String(summary.systemId ?? "n/a"),
        version: String(summary.systemVersion ?? "n/a"),
        entryRoleId: String(summary.entryRoleId ?? "n/a")
      }, "system " + String(summary.systemId ?? "n/a") + " · version " + String(summary.systemVersion ?? "n/a") + " · entry " + String(summary.entryRoleId ?? "n/a"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("project.structure", undefined, "structure")) + '</span><span>' + escapeText(summary.roleCount ?? 0) + " " + escapeText(t("common.roles", undefined, "roles")) + '</span></div><strong>' +
      escapeText(t("project.roleFlowWorkbench", {
        flowCount: String(summary.flowCount ?? 0),
        workbenchStatus: args.validationOk ? t("project.validated", undefined, "validated") : t("project.needsAttention", undefined, "needs attention")
      }, "flows " + String(summary.flowCount ?? 0) + " · workbench " + (args.validationOk ? "validated" : "needs attention"))) +
      '</strong><div class="hint">' + escapeText(t("project.systemPath", { path: args.workbenchSavedPath || "system.mmd" }, "system path " + (args.workbenchSavedPath || "system.mmd"))) + "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("project.specialRoles", undefined, "special roles")) + '</span><span>' + escapeText(t("project.graphMetadata", undefined, "graph metadata")) + '</span></div><strong>' +
      escapeText(t("common.review", undefined, "review") + " " + ((summary.reviewedRoleIds as unknown[] | undefined)?.join(", ") || t("common.none", undefined, "none"))) +
      '</strong><div class="hint">' + escapeText(t("common.join", undefined, "join") + " " + ((summary.joinRoleIds as unknown[] | undefined)?.join(", ") || t("common.none", undefined, "none"))) +
      " · " + escapeText(t("common.loop", undefined, "loop") + " " + ((summary.loopRoleIds as unknown[] | undefined)?.join(", ") || t("common.none", undefined, "none"))) +
      " · " + escapeText(t("common.context", undefined, "context") + " " + ((summary.contextMappedRoleIds as unknown[] | undefined)?.join(", ") || t("common.none", undefined, "none"))) + "</div></div>",
    ...warningCards,
    ...roleCards,
    "</div>"
  ].join("");
}

export function renderOpsSummaryPanel(args: {
  opsSummary: JsonRecord | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const summary = (args.opsSummary?.summary ?? {}) as JsonRecord;
  const failureGroups = (args.opsSummary?.failureGroups ?? {}) as JsonRecord;
  const reviewRework = (args.opsSummary?.reviewRework ?? {}) as JsonRecord;
  const resumeReadiness = (args.opsSummary?.resumeReadiness ?? {}) as JsonRecord;
  const recentFailures = Array.isArray(args.opsSummary?.recentFailures)
    ? args.opsSummary.recentFailures as JsonRecord[]
    : [];
  const topErrorCodes = Array.isArray(failureGroups.byErrorCode)
    ? failureGroups.byErrorCode as JsonRecord[]
    : [];
  const driftSources = Array.isArray(resumeReadiness.driftSources)
    ? resumeReadiness.driftSources as JsonRecord[]
    : [];
  const blockingByCategory = Array.isArray(resumeReadiness.blockingByCategory)
    ? resumeReadiness.blockingByCategory as JsonRecord[]
    : [];
  const cards = [
    '<div class="event"><div class="event-top"><span>' + escapeText(t("ops.recentFailures", undefined, "recent failures")) + '</span><span>' +
      escapeText(String(summary.recentFailureCount ?? 0)) +
      '</span></div><strong>' +
      escapeText(
        topErrorCodes.length
          ? topErrorCodes.slice(0, 3).map((item) => String(item.key) + " x" + String(item.count)).join(" · ")
          : t("ops.noRecentFailures", undefined, "no recent failures")
      ) +
      '</strong><div class="hint">' + escapeText(t("ops.failureGroupingHint", undefined, "grouped by role, errorCode, and errorCategory for operator triage")) + '</div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("ops.reviewReworkPending", undefined, "review / rework pending")) + '</span><span>' +
      escapeText(String(summary.pendingReviewCount ?? 0)) +
      " " + escapeText(t("common.reviews", undefined, "reviews")) + '</span></div><strong>' +
      escapeText(t("ops.activeReworkBranches", { count: String(reviewRework.pendingReworkCount ?? 0) }, String(reviewRework.pendingReworkCount ?? 0) + " active rework branches")) +
      '</strong><div class="hint">' +
      escapeText(t("ops.pausedReviews", { count: String(reviewRework.pausedReviewCount ?? 0) }, "paused reviews " + String(reviewRework.pausedReviewCount ?? 0))) +
      '</div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("ops.resumeBlocking", undefined, "resume blocking")) + '</span><span>' +
      escapeText(String(resumeReadiness.blockedRunCount ?? summary.resumeBlockedRunCount ?? 0)) +
      " " + escapeText(t("common.runs", undefined, "runs")) + '</span></div><strong>' +
      escapeText(
        blockingByCategory.length
          ? blockingByCategory.slice(0, 3).map((item) => String(item.key) + " x" + String(item.count)).join(" · ")
          : t("ops.noBlockingCategories", undefined, "no blocking categories")
      ) +
      '</strong><div class="hint">' +
      escapeText(t("ops.driftSources", {
        sources:
        driftSources.length
          ? driftSources.slice(0, 3).map((item) => String(item.key) + " x" + String(item.count)).join(" · ")
          : t("common.none", undefined, "none")
      }, "drift sources " + (driftSources.length ? driftSources.slice(0, 3).map((item) => String(item.key) + " x" + String(item.count)).join(" · ") : "none"))) +
      "</div></div>"
  ];
  const failureCards = recentFailures.length
    ? recentFailures.slice(0, 5).map((failure) =>
        '<div class="event"><div class="event-top"><span><code>' +
        escapeText(String(failure.roleId ?? "unknown")) +
        '</code></span><span>' +
        escapeText(String(failure.errorCategory ?? "runtime")) +
        '</span></div><strong>' +
        escapeText(String(failure.errorCode ?? "ROLE_EXECUTION_FAILED")) +
        '</strong><div class="hint">' +
        escapeText(String(failure.runId ?? "unknown") + " · " + String(failure.message ?? "No message")) +
        "</div></div>"
      )
    : ['<div class="event"><div class="event-top"><span>' + escapeText(t("ops.recentFailureList", undefined, "recent failure list")) + '</span><span>0</span></div><strong>' + escapeText(t("ops.noFailureEntries", undefined, "No failure entries in the sampled runs")) + '</strong></div>'];
  return ['<div class="structure-list">', ...cards, ...failureCards, "</div>"].join("");
}

export function renderProjectReadinessPanel(args: {
  readiness: JsonRecord | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const readiness = args.readiness ?? {};
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers as JsonRecord[] : [];
  const warnings = Array.isArray(readiness.warnings) ? readiness.warnings as JsonRecord[] : [];
  const missingBindings = Array.isArray(readiness.missingBindings) ? readiness.missingBindings as JsonRecord[] : [];
  const contractCoverage = (readiness.contractCoverage ?? {}) as JsonRecord;
  const roleRepoHealth = (readiness.roleRepoHealth ?? {}) as JsonRecord;
  const roles = Array.isArray(roleRepoHealth.roles) ? roleRepoHealth.roles as JsonRecord[] : [];
  const unhealthyRoles = roles.filter((role) => role.status !== "ok");
  const status = readiness.canDryRun ? (warnings.length ? "warning" : "ready") : "blocked";
  const issueCards = [...blockers, ...warnings].slice(0, 6).map((issue) =>
    '<div class="event"><div class="event-top"><span>' +
    escapeText(String(issue.code ?? "READINESS_ISSUE")) +
    '</span><span>' +
    escapeText(String(issue.severity ?? "warning")) +
    '</span></div><strong>' +
    escapeText(String(issue.message ?? "No readiness message.")) +
    '</strong><div class="hint">' +
    escapeText(String(issue.roleId ?? issue.flowKey ?? issue.path ?? "")) +
    "</div></div>"
  );
  if (!readiness || Object.keys(readiness).length === 0) {
    return '<div class="hint">' + escapeText(t("readiness.dataUnavailable", undefined, "Project readiness data unavailable.")) + '</div>';
  }
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("readiness.dryRunReadiness", undefined, "dry-run readiness")) + '</span><span>' +
      escapeText(t("readiness." + status, undefined, status)) +
      '</span></div><strong>' +
      escapeText(readiness.canDryRun ? t("readiness.canDryRun", undefined, "Project can dry-run with current structural checks.") : t("readiness.hasBlockers", undefined, "Project has dry-run blockers.")) +
      '</strong><div class="hint">' +
      escapeText(t("readiness.blockersWarningsSystem", {
        blockers: blockers.length,
        warnings: warnings.length,
        systemId: String(readiness.systemId ?? "n/a")
      }, "blockers " + blockers.length + " · warnings " + warnings.length + " · system " + String(readiness.systemId ?? "n/a"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("readiness.missingBindings", undefined, "missing bindings")) + '</span><span>' +
      escapeText(String(missingBindings.length)) +
      '</span></div><strong>' +
      escapeText(missingBindings.length ? missingBindings.map((item) => String(item.roleId)).join(", ") : t("readiness.none", undefined, "none")) +
      '</strong><div class="hint">' + escapeText(t("readiness.bindingChecks", undefined, "checks exec.bind, model.bind, and model-selection resolution")) + '</div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("readiness.contractCoverage", undefined, "contract coverage")) + '</span><span>' +
      escapeText(t("readiness.missing", { count: String(contractCoverage.missingFlowCount ?? 0) }, String(contractCoverage.missingFlowCount ?? 0) + " missing")) +
      '</span></div><strong>' +
      escapeText(t("readiness.flowsCovered", {
        covered: String(contractCoverage.coveredFlowCount ?? 0),
        eligible: String(contractCoverage.eligibleFlowCount ?? 0)
      }, String(contractCoverage.coveredFlowCount ?? 0) + " / " + String(contractCoverage.eligibleFlowCount ?? 0) + " eligible flows covered")) +
      '</strong><div class="hint">' +
      escapeText(t("readiness.handoffMode", { mode: String(contractCoverage.handoffMode ?? "n/a") }, "handoff mode " + String(contractCoverage.handoffMode ?? "n/a"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("readiness.roleRepoHealth", undefined, "role repo health")) + '</span><span>' +
      escapeText(t("readiness.unhealthy", { count: unhealthyRoles.length }, String(unhealthyRoles.length) + " unhealthy")) +
      '</span></div><strong>' +
      escapeText(unhealthyRoles.length ? unhealthyRoles.map((role) => String(role.roleId)).join(", ") : t("readiness.allFilesPresent", undefined, "all required files present")) +
      '</strong><div class="hint">' +
      escapeText(t("readiness.rolesInspected", { count: roles.length }, String(roles.length) + " role package(s) inspected")) +
      "</div></div>",
    ...issueCards,
    "</div>"
  ].join("");
}

export function renderStudioBridgePanel(args: {
  bridge: JsonRecord | null | undefined;
  readiness: JsonRecord | null | undefined;
  selectedRoleId: string;
  selectedFlowKey: string;
  actionBusy: string;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const bridge = args.bridge ?? {};
  const validation = (bridge.validation ?? {}) as JsonRecord;
  const extracted = (bridge.extracted ?? {}) as JsonRecord;
  const roles = Array.isArray(extracted.roles) ? extracted.roles as JsonRecord[] : [];
  const flows = Array.isArray(extracted.flows) ? extracted.flows as JsonRecord[] : [];
  const selectedRole = roles.find((role) => role.roleId === args.selectedRoleId) ?? roles[0];
  const selectedFlow = flows.find((flow) => flow.flowKey === args.selectedFlowKey) ?? flows[0];
  const diagnostics = Array.isArray(validation.diagnostics) ? validation.diagnostics as JsonRecord[] : [];
  const readiness = args.readiness ?? {};
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers as JsonRecord[] : [];
  const busy = args.actionBusy ? " disabled" : "";
  if (!bridge || Object.keys(bridge).length === 0) {
    return '<div class="hint">' + escapeText(t("studio.dataUnavailable", undefined, "Studio Bridge data unavailable.")) + '</div>';
  }
  const graphCanvas = renderStudioGraphCanvas({
    selectedRoleId: args.selectedRoleId,
    selectedFlowKey: args.selectedFlowKey,
    busy,
    t
  });
  const roleButtons = roles.length
    ? roles.map((role) => {
        const roleId = String(role.roleId ?? "");
        const active = selectedRole && selectedRole.roleId === roleId ? " active" : "";
        const badges = Array.isArray(role.badges) ? role.badges.join(" ") : "";
        return (
          '<button class="run-card' + active + '" data-studio-role-id="' + escapeText(roleId) + '"' + busy + ">" +
          '<div class="run-title"><span><code>' + escapeText(roleId) + '</code></span><span class="status ' +
          escapeText(bindingTone(String(role.bindingKind ?? "noop"))) + '">' + escapeText(String(role.bindingKind ?? "noop")) +
          '</span></div><div class="meta"><span>' + escapeText(badges || t("studio.standard", undefined, "standard")) + '</span><span>' +
          escapeText(t("studio.events", { count: String((role.allowedEvents as unknown[] | undefined)?.length ?? 0) }, "events " + String((role.allowedEvents as unknown[] | undefined)?.length ?? 0))) + "</span></div></button>"
        );
      })
    : ['<div class="hint">' + escapeText(t("studio.noRolesExtracted", undefined, "No roles extracted from the current Mermaid source.")) + '</div>'];
  const flowButtons = flows.length
    ? flows.map((flow) => {
        const key = String(flow.flowKey ?? "");
        const active = selectedFlow && selectedFlow.flowKey === key ? " active" : "";
        return (
          '<button class="run-card' + active + '" data-studio-flow-key="' + escapeText(key) + '"' + busy + ">" +
          '<div class="run-title"><span><code>' + escapeText(String(flow.fromRoleId ?? "")) + '</code> -> <code>' +
          escapeText(String(flow.toRoleId ?? "")) + '</code></span><span>' + escapeText(String(flow.eventType ?? "")) +
          '</span></div><div class="meta"><span>' + escapeText(flow.runtimeOnlyErrorFlow ? t("studio.runtimeErrorFlow", undefined, "runtime error flow") : t("studio.designFlow", undefined, "design flow")) +
          '</span><span>' + escapeText(flow.participatesInJoin ? t("studio.joinSource", undefined, "join source") : t("studio.standard", undefined, "standard")) + "</span></div></button>"
        );
      })
    : ['<div class="hint">' + escapeText(t("studio.noFlowsExtracted", undefined, "No flows extracted from the current Mermaid source.")) + '</div>'];
  const roleInspector = selectedRole
    ? [
        '<div class="event"><div class="event-top"><span>' + escapeText(t("studio.roleInspector", undefined, "role inspector")) + '</span><span>' + escapeText(String(selectedRole.bindingKind ?? "noop")) + '</span></div><strong><code>' + escapeText(String(selectedRole.roleId ?? "")) + '</code></strong>',
        '<div class="hint">' + escapeText(t("studio.modelExecRoute", {
          modelRef: String(selectedRole.modelRef ?? "n/a"),
          profileId: String(selectedRole.profileId ?? "n/a"),
          routingMode: String(selectedRole.routingMode ?? t("studio.standard", undefined, "standard"))
        }, "model " + String(selectedRole.modelRef ?? "n/a") + " · exec " + String(selectedRole.profileId ?? "n/a") + " · route " + String(selectedRole.routingMode ?? "standard"))) + "</div></div>",
        '<div class="event"><div class="event-top"><span>' + escapeText(t("common.metadata", undefined, "metadata")) + '</span><span>' + escapeText(t("common.readOnly", undefined, "read only")) + '</span></div><strong>' +
          escapeText([
            selectedRole.joinMode ? t("common.join", undefined, "join") + " " + selectedRole.joinMode : "",
            selectedRole.loopMax ? t("common.loop", undefined, "loop") + " " + selectedRole.loopMax : "",
            selectedRole.review ? t("studio.reviewRequired", undefined, "review required") : "",
            selectedRole.contextMap ? t("studio.contextMap", undefined, "context map") : ""
          ].filter(Boolean).join(" · ") || t("project.noSpecialGraphMetadata", undefined, "no special metadata")) +
          '</strong><div class="hint">' + escapeText(t("studio.incomingOutgoing", {
            incoming: String(selectedRole.incomingFlowCount ?? 0),
            outgoing: String(selectedRole.outgoingFlowCount ?? 0)
          }, "incoming " + String(selectedRole.incomingFlowCount ?? 0) + " · outgoing " + String(selectedRole.outgoingFlowCount ?? 0))) + "</div></div>"
      ].join("")
    : '<div class="hint">' + escapeText(t("studio.selectRole", undefined, "Select a role to inspect metadata.")) + '</div>';
  const flowInspector = selectedFlow
    ? '<div class="event"><div class="event-top"><span>' + escapeText(t("studio.flowInspector", undefined, "flow inspector")) + '</span><span>' + escapeText(String(selectedFlow.eventType ?? "")) +
      '</span></div><strong><code>' + escapeText(String(selectedFlow.fromRoleId ?? "")) + '</code> -> <code>' +
      escapeText(String(selectedFlow.toRoleId ?? "")) + '</code></strong><div class="hint">' +
      escapeText(selectedFlow.runtimeOnlyErrorFlow ? t("studio.runtimeOnlyErrorPath", undefined, "runtime-only error path") : t("studio.authoringDesignPath", undefined, "authoring design path")) +
      " · " + escapeText(selectedFlow.participatesInJoin ? t("studio.participatesInJoin", undefined, "participates in join.sources") : t("studio.notJoinSource", undefined, "not a join source")) + "</div></div>"
    : '<div class="hint">' + escapeText(t("studio.selectFlow", undefined, "Select a flow to inspect event metadata.")) + '</div>';
  const diagnosticCards = diagnostics.length
    ? diagnostics.slice(0, 5).map((diagnostic) =>
        '<div class="event"><div class="event-top"><span>' + escapeText(String(diagnostic.code ?? "DIAGNOSTIC")) +
        '</span><span>' + escapeText(String(diagnostic.stage ?? "validate")) + '</span></div><strong>' +
        escapeText(String(diagnostic.message ?? "")) + '</strong><div class="hint">' +
        escapeText(String(diagnostic.roleId ?? diagnostic.selector ?? diagnostic.line ?? "")) + "</div></div>"
      )
    : ['<div class="event"><div class="event-top"><span>' + escapeText(t("common.diagnostics", undefined, "diagnostics")) + '</span><span>' + escapeText(t("common.ok", undefined, "ok")) + '</span></div><strong>' + escapeText(t("studio.noParseCompileDiagnostics", undefined, "No parse or compile diagnostics.")) + '</strong></div>'];
  return [
    '<div class="structure-list studio-bridge">',
    '<div class="toolbar-row">',
    '<div class="toolbar-group">',
    '<button class="button primary" id="studio-bridge-dry-run"' + busy + '>' + escapeText(t("studio.dryRun", undefined, "Dry run")) + '</button>',
    '<button class="button" id="studio-bridge-validate"' + busy + '>' + escapeText(t("action.validate", undefined, "Validate")) + '</button>',
    '<button class="button" id="studio-bridge-save"' + busy + '>' + escapeText(t("action.saveSystem", undefined, "Save system.mmd")) + '</button>',
    '<button class="button subtle" id="studio-bridge-save-draft"' + busy + '>' + escapeText(t("studio.saveDraft", undefined, "Save draft")) + '</button>',
    '<button class="button subtle" id="studio-bridge-generate"' + busy + '>' + escapeText(t("studio.generateMmd", undefined, "Generate MMD")) + '</button>',
    '</div>',
    '<div class="toolbar-group"><span class="pill' + (validation.ok ? "" : " warn") + '">' +
      escapeText(validation.ok ? t("workbench.validationOk", undefined, "validation ok") : t("workbench.diagnostics", { count: String(diagnostics.length) }, diagnostics.length + " diagnostics")) + '</span><span class="pill' +
      (blockers.length ? " warn" : "") + '">' + escapeText(blockers.length ? t("studio.readinessBlockers", { count: String(blockers.length) }, blockers.length + " readiness blockers") : t("studio.readinessReady", undefined, "readiness ready")) + "</span></div>",
    "</div>",
    '<div class="studio-bridge-layout">',
    '<div class="studio-navigator structure-list"><div class="event"><div class="event-top"><span>' + escapeText(t("studio.roles", undefined, "roles")) + '</span><span>' + escapeText(String(roles.length)) +
      '</span></div><strong>' + escapeText(t("studio.structuredRoleDraft", undefined, "Structured role draft")) + '</strong><div class="hint">' + escapeText(t("studio.bridgeReadsWorkbench", undefined, "Bridge reads the current workbench source.")) + '</div></div>' + roleButtons.join("") + "</div>",
    '<div class="studio-graph-column">' + graphCanvas + '<div class="structure-list studio-flow-list"><div class="event"><div class="event-top"><span>' + escapeText(t("studio.flows", undefined, "flows")) + '</span><span>' + escapeText(String(flows.length)) +
      '</span></div><strong>' + escapeText(t("studio.structuredFlowDraft", undefined, "Structured flow draft")) + '</strong><div class="hint">' + escapeText(t("studio.eventsVisible", undefined, "Event types and join participation stay visible.")) + '</div></div>' + flowButtons.join("") + "</div></div>",
    '<div class="studio-inspector structure-list"><div class="event"><div class="event-top"><span>' + escapeText(t("common.system", undefined, "system")) + '</span><span>' + escapeText(String(extracted.systemVersion ?? "n/a")) +
      '</span></div><strong>' + escapeText(String(extracted.systemId ?? "unknown")) + '</strong><div class="hint">' + escapeText(t("common.entry", undefined, "entry")) + " " +
      escapeText(String(extracted.entryRoleId ?? "n/a")) + " · " + escapeText(t("common.law", undefined, "law")) + " " + escapeText(String(extracted.lawGlobal ?? "n/a")) + "</div></div>" +
      roleInspector + flowInspector + "</div>",
    '<div class="studio-diagnostics structure-list">' + diagnosticCards.join("") + "</div>",
    "</div>",
    "</div>"
  ].join("");
}

export function renderFailureSummaryPanel(args: {
  failure: Record<string, unknown> | null | undefined;
  loaded: boolean;
  stale: boolean;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  if (!args.loaded) {
    return '<div class="hint">' + escapeText(t("failure.loadsWithRun", undefined, "Failure triage loads with the selected run.")) + '</div>';
  }
  if (!args.failure) {
    return '<div class="hint">' + escapeText(t("failure.noRecentCaptured", undefined, "No recent failure captured for this run.")) + '</div>';
  }
  const summary = ((args.failure.summary ?? args.failure) || {}) as JsonRecord;
  const detail = ((args.failure.detail ?? {}) || {}) as JsonRecord;
  const errorCode = String(summary.errorCode ?? detail.errorCode ?? "none");
  const stage = String(summary.stage ?? detail.stage ?? t("common.notAvailable", undefined, "n/a"));
  const message = String(summary.message ?? detail.message ?? t("failure.noMessage", undefined, "No failure message recorded."));
  const roleId = String(summary.roleId ?? detail.roleId ?? t("common.notAvailable", undefined, "n/a"));
  const branchId = String(summary.branchId ?? detail.branchId ?? t("common.notAvailable", undefined, "n/a"));
  const retryable = Boolean(summary.retryable ?? detail.retryable);
  const durationMs = summary.durationMs ?? detail.durationMs ?? "n/a";
  const timeoutMs =
    detail.timeoutMs ??
    ((detail.selectedBinding as JsonRecord | undefined)?.timeoutMs ?? (summary.timeoutMs as unknown));
  const classifyError = (): string => {
    if (errorCode === "TOOL_EXECUTION_TIMEOUT") return t("failure.class.timeoutBudgetExhausted", undefined, "timeout budget exhausted");
    if (errorCode.includes("CONTRACT")) return t("failure.class.contractHandoffViolation", undefined, "contract handoff violation");
    if (errorCode.includes("SCHEMA")) return t("failure.class.schemaMismatch", undefined, "schema mismatch");
    if (errorCode.includes("PROVIDER") || errorCode.includes("MODEL")) return t("failure.class.providerModelFailure", undefined, "provider or model failure");
    if (errorCode === "ROLE_EXECUTION_FAILED") return t("failure.class.roleExecutionFailed", undefined, "role execution failed");
    return t("failure.class.runtimeFailure", undefined, "runtime failure");
  };
  const summaryCards = [
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.recentFailedRole", undefined, "recent failed role")) + '</span><span>' +
      escapeText(displayUiToken(stage, t)) +
      '</span></div><strong><code>' +
      escapeText(roleId) +
      '</code></strong><div class="hint">' +
      escapeText(branchId + " · " + classifyError()) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.errorCode", undefined, "error code")) + '</span><span>' +
      escapeText(retryable ? t("failure.retryable", undefined, "retryable") : t("failure.terminal", undefined, "terminal")) +
      '</span></div><strong>' +
      escapeText(errorCode) +
      '</strong><div class="hint">' +
      escapeText(message) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.budget", undefined, "budget")) + '</span><span>' +
      escapeText(args.stale ? t("common.stale", undefined, "stale") : t("common.fresh", undefined, "fresh")) +
      '</span></div><strong>' +
      escapeText(t("failure.durationMs", { durationMs: String(durationMs) }, "duration " + durationMs + " ms")) +
      '</strong><div class="hint">' +
      escapeText(timeoutMs ? t("failure.timeoutBudgetMs", { timeoutMs: String(timeoutMs) }, "timeout budget " + timeoutMs + " ms") : t("failure.timeoutBudgetUnavailable", undefined, "timeout budget unavailable")) +
      "</div></div>"
  ];
  return ['<div class="structure-list">', ...summaryCards, "</div>"].join("");
}

export function renderFailureDetailPanel(args: {
  failure: Record<string, unknown> | null | undefined;
  loaded: boolean;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  if (!args.loaded) {
    return '<div class="hint">' + escapeText(t("failure.detailNotLoaded", undefined, "Failure detail is not loaded yet.")) + '</div>';
  }
  if (!args.failure) {
    return '<div class="hint">' + escapeText(t("failure.noDetail", undefined, "No failure detail available.")) + '</div>';
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
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.projectedInput", undefined, "projected input")) + '</span><span>' +
      escapeText(Array.isArray(detail.inputContext) ? "array" : typeof detail.inputContext) +
      '</span></div><strong>' +
      escapeText(detail.correctionRequest ? t("failure.correctionRequestPresent", undefined, "correction request present") : t("failure.inputContextAvailable", undefined, "input context available")) +
      '</strong><div class="hint">' +
      escapeText(t("failure.schema", { schemaPath: String(schemaPath) }, "schema " + schemaPath)) +
      '</div>' +
      (detail.inputContext ? '<pre>' + escapeText(formatJson(detail.inputContext)) + "</pre>" : "") +
      "</div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.bindingResolution", undefined, "binding resolution")) + '</span><span>' +
      escapeText(displayUiToken(selectedBinding.bindingKind ?? selectedBinding.kind ?? "n/a", t)) +
      '</span></div><strong>' +
      escapeText(String(selectedBinding.resolvedBinding ?? selectedBinding.bindingRef ?? t("failure.bindingUnavailable", undefined, "binding unavailable"))) +
      '</strong><div class="hint">' +
      escapeText(t("failure.declaredTimeoutBudget", {
        declared: String(selectedBinding.declaredBinding ?? t("common.notAvailable", undefined, "n/a")),
        timeoutMs: String(selectedBinding.timeoutMs ?? detail.timeoutMs ?? t("common.notAvailable", undefined, "n/a")),
        maxOutputBytes: String(selectedBinding.maxOutputBytes ?? t("common.notAvailable", undefined, "n/a"))
      }, "declared " + String(selectedBinding.declaredBinding ?? "n/a") + " · timeout " + String(selectedBinding.timeoutMs ?? detail.timeoutMs ?? "n/a") + " ms · output budget " + String(selectedBinding.maxOutputBytes ?? "n/a"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.contract", undefined, "contract")) + '</span><span>' +
      escapeText(displayUiToken(contract.kind ?? "n/a", t)) +
      '</span></div><strong>' +
      escapeText(String(contract.contractId ?? t("failure.contractUnavailable", undefined, "contract unavailable"))) +
      '</strong><div class="hint">' +
      escapeText(t("failure.flowSchema", {
        flowKey: String(contract.flowKey ?? t("common.notAvailable", undefined, "n/a")),
        schemaPath: String(contract.schemaPath ?? schemaPath)
      }, "flow " + String(contract.flowKey ?? "n/a") + " · schema " + String(contract.schemaPath ?? schemaPath))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.roleSchema", undefined, "role schema")) + '</span><span>' +
      escapeText(String(allowedEvents.length)) +
      '</span></div><strong>' +
      escapeText(allowedEvents.length ? allowedEvents.join(", ") : t("failure.allowedEventsUnavailable", undefined, "allowed events unavailable")) +
      '</strong><div class="hint">' +
      escapeText(t("failure.upstream", { roles: upstreamRoleIds.length ? upstreamRoleIds.join(", ") : t("common.none", undefined, "none") }, "upstream " + (upstreamRoleIds.length ? upstreamRoleIds.join(", ") : "none"))) +
      "</div></div>",
    rawOutput
      ? '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.rawOutput", undefined, "raw output")) + '</span><span>' + escapeText(t("common.captured", undefined, "captured")) + '</span></div><strong>' + escapeText(t("failure.providerRawSnapshot", undefined, "Provider / role raw output snapshot")) + '</strong><pre>' +
        escapeText(typeof rawOutput === "string" ? rawOutput : formatJson(rawOutput)) +
        "</pre></div>"
      : '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.rawOutput", undefined, "raw output")) + '</span><span>' + escapeText(t("common.missing", undefined, "missing")) + '</span></div><strong>' + escapeText(t("failure.noRawOutputSnapshot", undefined, "No raw output snapshot captured")) + '</strong></div>',
    "</div>"
  ].join("");
}

export function renderSuggestedNextChecksPanel(args: {
  failure: Record<string, unknown> | null | undefined;
  loaded: boolean;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  if (!args.loaded) {
    return '<div class="hint">' + escapeText(t("failure.suggestedChecksAfterLoad", undefined, "Suggested checks appear after failure data loads.")) + '</div>';
  }
  if (!args.failure) {
    return '<div class="hint">' + escapeText(t("failure.noSpecificChecks", undefined, "No failure-specific next checks are needed right now.")) + '</div>';
  }
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("failure.suggestedNextChecks", undefined, "suggested next checks")) + '</span><span>' + escapeText(t("failure.actions", undefined, "actions")) + '</span></div><strong>' + escapeText(t("failure.nextChecksSummary", undefined, "Move directly to the likely root-cause surfaces")) + '</strong><div class="hint">' + escapeText(t("failure.nextChecksHint", undefined, "These actions jump to the panel that explains the failing input, binding, schema, contract, or resume blockers.")) + '</div></div>',
    '<div class="actions">',
    '<button class="button subtle" id="failure-check-input">' + escapeText(t("failure.inspectProjectedInput", undefined, "Inspect projected input")) + '</button>',
    '<button class="button subtle" id="failure-check-binding">' + escapeText(t("failure.inspectBindingResolution", undefined, "Inspect binding resolution")) + '</button>',
    '<button class="button subtle" id="failure-check-role-package">' + escapeText(t("failure.inspectRoleSchema", undefined, "Inspect role schema")) + '</button>',
    '<button class="button subtle" id="failure-check-contract">' + escapeText(t("failure.inspectContract", undefined, "Inspect contract")) + '</button>',
    '<button class="button subtle" id="failure-check-resume">' + escapeText(t("failure.inspectResumeReadiness", undefined, "Inspect resume readiness")) + '</button>',
    "</div>",
    "</div>"
  ].join("");
}

export function renderBindingExplainPanel(args: {
  bindings: Record<string, unknown> | null | undefined;
  stale?: boolean;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const bindings = args.bindings ?? {};
  const roles = Array.isArray(bindings.roles)
    ? bindings.roles as JsonRecord[]
    : Array.isArray(bindings.bindings)
      ? bindings.bindings as JsonRecord[]
      : Array.isArray(bindings.entries)
        ? bindings.entries as JsonRecord[]
        : [];
  if (!roles.length) {
    return '<div class="hint">' + escapeText(t("config.bindingUnavailable", undefined, "Binding explain data unavailable.")) + '</div>';
  }
  return [
    '<div class="structure-list">',
    '<div class="toolbar-row"><div class="toolbar-group"><span class="pill">' + escapeText(t("config.roleCards", undefined, "role cards")) + '</span><span class="pill">' + escapeText(t("config.flowCards", undefined, "flow cards")) + '</span></div><div class="toolbar-group"><span class="pill">' + escapeText(t("config.all", undefined, "all")) + '</span><span class="pill warn">' + escapeText(t("common.missing", undefined, "missing")) + '</span><span class="pill">' + escapeText(t("readiness.warning", undefined, "warning")) + '</span></div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("config.bindingExplain", undefined, "binding explain")) + '</span><span>' +
      escapeText(args.stale ? t("common.stale", undefined, "stale") : t("common.fresh", undefined, "fresh")) +
      '</span></div><strong>' +
      escapeText(t("config.rolesResolved", { count: roles.length }, roles.length + " roles resolved from system + model-selection")) +
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
      escapeText(t("config.effectiveTimeoutBudgetSource", {
        effective: String(role.effectiveBinding ?? role.resolvedBinding ?? "n/a"),
        timeoutMs: String(role.timeoutMs ?? "n/a"),
        maxOutputBytes: String(role.maxOutputBytes ?? "n/a"),
        source: String(role.source ?? t("common.unknown", undefined, "unknown"))
      }, "effective " + String(role.effectiveBinding ?? role.resolvedBinding ?? "n/a") + " · timeout " + String(role.timeoutMs ?? "n/a") + " ms · output budget " + String(role.maxOutputBytes ?? "n/a") + " · source " + String(role.source ?? "unknown"))) +
      "</div></div>"
    ),
    "</div>"
  ].join("");
}

export function renderRolePackagePanel(args: {
  rolePackages: Record<string, unknown> | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const rolePackages = args.rolePackages ?? {};
  const roles = Array.isArray(rolePackages.roles)
    ? rolePackages.roles as JsonRecord[]
    : Array.isArray(rolePackages.rolePackages)
      ? rolePackages.rolePackages as JsonRecord[]
      : Array.isArray(rolePackages.entries)
        ? rolePackages.entries as JsonRecord[]
        : [];
  if (!roles.length) {
    return '<div class="hint">' + escapeText(t("config.rolePackagesUnavailable", undefined, "Role package summaries unavailable.")) + '</div>';
  }
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("config.rolePackages", undefined, "role packages")) + '</span><span>' +
      escapeText(roles.length) +
      '</span></div><strong>' + escapeText(t("config.rolePackageHealth", undefined, "Role package health and schema coverage")) + '</strong></div>',
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
        escapeText(role.summary ?? role.label ?? t("config.package", undefined, "package")) +
        "</span></div><strong>" +
        escapeText(String(role.outputSchemaPath ?? role.schemaPath ?? t("config.outputSchemaUnavailable", undefined, "output schema unavailable"))) +
        '</strong><div class="hint">' +
        escapeText(t("config.allowedEventsFiles", {
          events: allowedEvents.length ? allowedEvents.join(", ") : t("common.unknown", undefined, "unknown"),
          files: presentFiles.length ? presentFiles.join(", ") : t("common.none", undefined, "none")
        }, "allowed events " + (allowedEvents.length ? allowedEvents.join(", ") : "unknown") + " · files " + (presentFiles.length ? presentFiles.join(", ") : "none"))) +
        "</div></div>"
      );
    }),
    "</div>"
  ].join("");
}

export function renderContractPanel(args: {
  contracts: Record<string, unknown> | null | undefined;
  runtimeStatus?: Record<string, unknown> | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const contracts = args.contracts ?? {};
  const runtimeStatus = args.runtimeStatus ?? null;
  const flows = Array.isArray(contracts.flows)
    ? contracts.flows as JsonRecord[]
    : Array.isArray(contracts.contracts)
      ? contracts.contracts as JsonRecord[]
      : Array.isArray(contracts.entries)
        ? contracts.entries as JsonRecord[]
        : [];
  const uncoveredEdges = Array.isArray(contracts.uncoveredEdges) ? contracts.uncoveredEdges : [];
  if (!flows.length && !uncoveredEdges.length && !runtimeStatus) {
    return '<div class="hint">' + escapeText(t("config.contractCoverageUnavailable", undefined, "Contract coverage data unavailable.")) + '</div>';
  }
  const runtimeCard = runtimeStatus
    ? '<div class="event"><div class="event-top"><span>' + escapeText(t("config.runContractStatus", undefined, "run contract status")) + '</span><span>' +
      escapeText(String(runtimeStatus.status ?? t("common.unknown", undefined, "unknown"))) +
      '</span></div><strong>' +
      escapeText(String(runtimeStatus.reason ?? t("config.runtimeContractSignalUnavailable", undefined, "Runtime contract signal unavailable."))) +
      '</strong><div class="hint">' +
      escapeText(t("config.runRuntimeSignals", {
        runId: String(runtimeStatus.runId ?? "n/a"),
        runStatus: String(runtimeStatus.runStatus ?? t("common.unknown", undefined, "unknown")),
        signalCount: String(runtimeStatus.signalCount ?? 0)
      }, "run " + String(runtimeStatus.runId ?? "n/a") + " · runtime " + String(runtimeStatus.runStatus ?? "unknown") + " · signals " + String(runtimeStatus.signalCount ?? 0))) +
      "</div>" +
      (runtimeStatus.attribution ? '<pre>' + escapeText(formatJson(runtimeStatus.attribution)) + "</pre>" : "") +
      "</div>"
    : "";
  return [
    '<div class="structure-list">',
    runtimeCard,
    '<div class="toolbar-row"><div class="toolbar-group"><span class="pill">' + escapeText(t("config.flowCards", undefined, "flow cards")) + '</span><span class="pill">' + escapeText(t("config.covered", undefined, "covered")) + '</span><span class="pill warn">' + escapeText(t("common.missing", undefined, "missing")) + '</span></div></div>',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("readiness.contractCoverage", undefined, "contract coverage")) + '</span><span>' +
      escapeText(uncoveredEdges.length ? t("config.uncovered", { count: uncoveredEdges.length }, uncoveredEdges.length + " uncovered") : t("common.complete", undefined, "complete")) +
      '</span></div><strong>' + escapeText(t("config.strictHandoffCoverage", undefined, "Strict handoff coverage across flows and role inputs")) + '</strong></div>',
    ...flows.map((flow) =>
      '<div class="event"><div class="event-top"><span>' +
      escapeText(String(flow.flowKey ?? flow.edgeKey ?? "flow")) +
      "</span><span>" +
      escapeText(String(flow.kind ?? "flow")) +
      "</span></div><strong>" +
      escapeText(String(flow.contractId ?? t("config.missingContract", undefined, "missing contract"))) +
      '</strong><div class="hint">' +
      escapeText(t("config.schemaStatus", {
        schemaPath: String(flow.schemaPath ?? "n/a"),
        status: String(flow.lastStatus ?? flow.coverage ?? t("common.unknown", undefined, "unknown"))
      }, "schema " + String(flow.schemaPath ?? "n/a") + " · status " + String(flow.lastStatus ?? flow.coverage ?? "unknown"))) +
      "</div></div>"
    ),
    ...uncoveredEdges.map((edge) =>
      '<div class="event"><div class="event-top"><span>' + escapeText(t("config.missingContract", undefined, "missing contract")) + '</span><span>' + escapeText(t("config.coverageGap", undefined, "coverage gap")) + '</span></div><strong>' +
      escapeText(String(edge.flowKey ?? edge.edgeKey ?? "uncovered edge")) +
      '</strong><div class="hint">' +
      escapeText(String(edge.fromRoleId ?? "n/a") + " -> " + String(edge.toRoleId ?? "n/a")) +
      "</div></div>"
    ),
    "</div>"
  ].join("");
}

export function renderReviewDetailPanel(detail: Record<string, unknown> | null | undefined, t?: Translator): string {
  const tr: Translator = typeof t === "function" ? t : (_key, _vars, fallback) => fallback ?? _key;
  if (!detail) {
    return '<div class="hint">' + escapeText(tr("state.noReviewSelected", undefined, "No review selected.")) + '</div>';
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
      escapeText(record.actor ?? tr("common.unknown", undefined, "unknown")) +
      '</strong><div class="hint">' +
      escapeText(record.comment ?? tr("review.noComment", undefined, "no comment")) +
      "</div></div>"
    );
  })
    : ['<div class="hint">' + escapeText(tr("review.noPriorDecisionHistory", undefined, "No prior decision history.")) + '</div>'];
  const nextActionSummary =
    detail.currentStatus === "pending"
      ? tr("review.awaitingDecision", undefined, "Awaiting approve, rework, pause, or terminate.")
      : detail.decisionPhase === "recorded"
        ? tr("review.decisionRecorded", undefined, "Decision recorded; runtime reconcile should be inspected next.")
        : detail.decisionPhase === "pending_reconcile"
          ? tr("review.pendingReconcile", undefined, "Decision has checkpoint state but still blocks clean resume.")
          : tr("review.noImmediateAction", undefined, "No immediate action available.");
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.review", undefined, "review")) + '</span><span>' + escapeText(detail.currentStatus ?? "unknown") + "</span></div><strong>" +
      escapeText(detail.reviewId ?? "n/a") +
      '</strong><div class="hint">' +
      escapeText((detail.roleId ?? "n/a") + " · " + (detail.branchId ?? "n/a")) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.decision", undefined, "decision")) + '</span><span>' + escapeText(detail.decisionPhase ?? tr("common.none", undefined, "none")) + "</span></div><strong>" +
      escapeText(detail.decision ?? "pending") +
      '</strong><div class="hint">' +
      escapeText((detail.actor ?? "n/a") + " · " + (detail.comment ?? tr("review.noComment", undefined, "no comment"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.timing", undefined, "timing")) + '</span><span>' + escapeText(tr("review.round", { round: String(detail.round ?? "n/a") }, "round " + String(detail.round ?? "n/a"))) + '</span></div><strong>' +
      escapeText(tr("review.requestedAt", { at: String(detail.requestedAt ?? "n/a") }, "requested " + String(detail.requestedAt ?? "n/a"))) +
      '</strong><div class="hint">' +
      escapeText(tr("review.decidedApplied", { decidedAt: String(detail.decidedAt ?? "n/a"), appliedAt: String(detail.appliedAt ?? "n/a") }, "decided " + String(detail.decidedAt ?? "n/a") + " · applied " + String(detail.appliedAt ?? "n/a"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.selectedEvent", undefined, "selected event")) + '</span><span>' + escapeText(detail.scope ?? "n/a") + '</span></div><strong>' +
      escapeText(detail.selectedEvent ?? "n/a") +
      '</strong><div class="hint">' +
      escapeText(tr("review.executionRequestedBy", {
        executionId: String(detail.executionId ?? "n/a"),
        requestedByExecutionId: String(detail.requestedByExecutionId ?? "n/a")
      }, "execution " + String(detail.executionId ?? "n/a") + " · requestedBy " + String(detail.requestedByExecutionId ?? "n/a"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.nextStep", undefined, "next step")) + '</span><span>' + escapeText(detail.branchStatus ?? "n/a") + '</span></div><strong>' +
      escapeText(nextActionSummary) +
      '</strong><div class="hint">' +
      escapeText(tr("review.selectedEventBranch", {
        event: String(detail.selectedEvent ?? "n/a"),
        branchId: String(detail.branchId ?? "n/a")
      }, "selected event " + String(detail.selectedEvent ?? "n/a") + " · branch " + String(detail.branchId ?? "n/a"))) +
      "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.history", undefined, "history")) + '</span><span>' + escapeText(history.length) + '</span></div><strong>' + escapeText(tr("review.decisionTrail", undefined, "Decision trail")) + '</strong></div>',
    ...historyCards,
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.requestSnapshot", undefined, "request snapshot")) + '</span><span>' + escapeText(tr("common.captured", undefined, "captured")) + '</span></div><strong>' + escapeText(tr("review.requestContext", undefined, "Review request context")) + '</strong><pre>' +
      escapeText(formatJson(detail.reviewRequestSnapshot ?? detail.requestSnapshot ?? detail.spec ?? null)) +
      "</pre></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.decisionSnapshot", undefined, "decision snapshot")) + '</span><span>' + escapeText(tr("common.captured", undefined, "captured")) + '</span></div><strong>' + escapeText(tr("review.decisionDurabilitySnapshot", undefined, "Decision durability snapshot")) + '</strong><pre>' +
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
    '<div class="event"><div class="event-top"><span>' + escapeText(tr("review.context", undefined, "context")) + '</span><span>' + escapeText(tr("common.snapshot", undefined, "snapshot")) + '</span></div><strong>' + escapeText(tr("review.humanReviewContext", undefined, "Human review context")) + '</strong><pre>' +
      escapeText(formatJson(detail.humanReviewContext ?? null)) +
      "</pre></div>",
    "</div>"
  ].join("");
}

export function renderReviewQueuePanel(args: {
  reviews: Record<string, unknown> | null | undefined;
  selectedReviewId: string;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const reviewList = Array.isArray(args.reviews?.reviews) ? args.reviews?.reviews as JsonRecord[] : [];
  if (!reviewList.length) {
    return '<div class="hint">' + escapeText(t("review.noReviews", undefined, "No reviews for this run.")) + '</div>';
  }
  const statusCounts = reviewList.reduce<Record<string, number>>((counts, review) => {
    const key = String(review.currentStatus ?? "unknown");
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("review.queueSummary", undefined, "queue summary")) + '</span><span>' +
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
      '<span>' + escapeText(t("review.round", { round: String(review.round ?? "n/a") }, "round " + String(review.round ?? "n/a"))) + "</span>" +
      '<span>' + escapeText(t("review.phase", { phase: String(review.decisionPhase ?? "none").replace(/_/g, " ") }, "phase " + String(review.decisionPhase ?? "none").replace(/_/g, " "))) + "</span>" +
      '<span>' + escapeText(String(review.actor ?? t("review.unassigned", undefined, "unassigned"))) + "</span>" +
      '<span>' + escapeText(String(review.reworkTarget ?? review.reworkRoleId ?? t("review.noReworkTarget", undefined, "no rework target"))) + "</span>" +
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
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  if (!args.loaded) {
    return '<div class="hint">' + escapeText(t("resume.loadsWithRun", undefined, "Resume readiness loads with the selected run.")) + '</div>';
  }
  if (!args.readiness) {
    return '<div class="hint">' + escapeText(t("resume.unavailable", undefined, "Resume readiness unavailable.")) + '</div>';
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
            ? t("resume.detailsAvailable", undefined, "details available")
            : String(value)
      }));
  const checks = Array.isArray(args.diagnostics?.checks) ? args.diagnostics?.checks as JsonRecord[] : [];
  const canResume =
    typeof args.readiness.canResume === "boolean"
      ? args.readiness.canResume
      : args.readiness.status === "ready";
  return [
    '<div class="structure-list">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("section.resumeReadiness", undefined, "Resume Readiness")) + '</span><span>' +
      escapeText(args.stale ? t("common.stale", undefined, "stale") : t("common.fresh", undefined, "fresh")) +
      '</span></div><strong>' +
      escapeText(canResume ? t("resume.canResume", undefined, "can resume") : t("resume.resumeBlocked", undefined, "resume blocked")) +
      '</strong><div class="hint">' +
      escapeText(t("resume.statusReason", {
        status: String(args.readiness.status ?? t("common.unknown", undefined, "unknown")),
        reason: String(args.readiness.reason ?? args.readiness.summary ?? "no summary")
      }, "status " + String(args.readiness.status ?? "unknown") + " · " + String(args.readiness.reason ?? args.readiness.summary ?? "no summary"))) +
      "</div></div>",
    ...(blockers.length
      ? blockers.map((blocker) =>
          '<div class="event"><div class="event-top"><span>' +
          escapeText(String(blocker.category ?? blocker.kind ?? blocker.code ?? blocker.id ?? "blocker")) +
          "</span><span>" +
          escapeText(String(blocker.blocking === false ? t("resume.nonBlocking", undefined, "non-blocking") : blocker.severity ?? t("resume.blocking", undefined, "blocking"))) +
          "</span></div><strong>" +
          escapeText(String(blocker.title ?? blocker.label ?? blocker.message ?? "resume blocker")) +
          '</strong><div class="hint">' +
          escapeText(String(blocker.source ?? "")) +
          (blocker.detail ? '<pre>' + escapeText(formatJson(blocker.detail)) + "</pre>" : "") +
          "</div></div>"
        )
      : ['<div class="event"><div class="event-top"><span>' + escapeText(t("resume.blockers", undefined, "blockers")) + '</span><span>0</span></div><strong>' + escapeText(t("resume.noBlockingIssues", undefined, "No blocking issues reported")) + '</strong></div>']),
    ...driftSources.map((drift) =>
      '<div class="event"><div class="event-top"><span>' + escapeText(t("resume.driftSource", undefined, "drift source")) + '</span><span>' +
      escapeText(String(drift.source ?? t("common.unknown", undefined, "unknown"))) +
      '</span></div><strong>' +
      escapeText(String(drift.message ?? (drift.changed ? t("common.changed", undefined, "changed") : t("common.unchanged", undefined, "unchanged")))) +
      '</strong><div class="hint">' +
      escapeText(String(drift.blocking ? t("resume.blocking", undefined, "blocking") : drift.changed ? t("common.changed", undefined, "changed") : t("common.stable", undefined, "stable"))) +
      '</div>' +
      (drift.detail ? '<pre>' + escapeText(formatJson(drift.detail)) + "</pre>" : "") +
      "</div>"
    ),
    ...(driftSources.length ? [] : [
      '<div class="event"><div class="event-top"><span>' + escapeText(t("resume.driftSource", undefined, "drift source")) + '</span><span>0</span></div><strong>' + escapeText(t("resume.noDriftSources", undefined, "No drift sources reported")) + '</strong></div>'
    ]),
    ...(checks.length
      ? checks.map((check) =>
          '<div class="event"><div class="event-top"><span>' + escapeText(t("resume.diagnosticCheck", undefined, "diagnostic check")) + '</span><span>' +
          escapeText(String(check.ok ? t("common.ok", undefined, "ok") : check.severity ?? "warn")) +
          '</span></div><strong>' +
          escapeText(String(check.label ?? check.id ?? "check")) +
          '</strong><div class="hint">' +
          escapeText(String(check.message ?? "")) +
          "</div></div>"
        )
      : ['<div class="hint">' + escapeText(t("resume.diagnosticsOnDemand", undefined, "Detailed resume diagnostics remain on-demand.")) + '</div>']),
    "</div>"
  ].join("");
}

export function renderLogsPanel(args: {
  loaded: boolean;
  stale: boolean;
  selectedRoleId: string;
  engine: unknown[];
  role: unknown[];
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  if (!args.loaded) {
    return '<div class="hint">' + escapeText(t("logs.onDemandHint", undefined, "Logs load on demand. The default view combines engine and role traces without a role filter.")) + '</div>';
  }

  const timestampOf = (record: JsonRecord): string => String(record.at ?? record.timestamp ?? "");
  const combined = [
    ...args.engine.map((item) => ({ source: "engine", record: (item ?? {}) as JsonRecord })),
    ...args.role.map((item) => ({ source: String(((item ?? {}) as JsonRecord).roleId ?? args.selectedRoleId ?? "role"), record: (item ?? {}) as JsonRecord }))
  ].sort((left, right) => timestampOf(left.record).localeCompare(timestampOf(right.record)));

  const renderLogEntries = (label: string, records: unknown[]): string => {
    if (!records.length) {
      return (
        '<div class="event"><div class="event-top"><span>' +
        escapeText(label) +
        '</span><span>0</span></div><strong>' + escapeText(t("logs.noRecords", undefined, "no records")) + '</strong></div>'
      );
    }
    return [
      '<div class="event"><div class="event-top"><span>' + escapeText(label) + '</span><span>' + escapeText(records.length) + '</span></div><strong>' +
        escapeText(label === t("logs.roleLog", undefined, "role log") ? (args.selectedRoleId || "latest role") : t("logs.engineStream", undefined, "engine stream")) +
        '</strong><div class="hint">' + escapeText(args.stale ? t("logs.stale", undefined, "stale since last stream event") : t("logs.fresh", undefined, "fresh")) + "</div></div>",
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

  const renderCombinedEntries = (): string => {
    if (!combined.length) {
      return '<div class="event"><div class="event-top"><span>' + escapeText(t("logs.combinedStream", undefined, "combined log stream")) + '</span><span>0</span></div><strong>' + escapeText(t("logs.noRecords", undefined, "no records")) + '</strong></div>';
    }
    return [
      '<div class="event"><div class="event-top"><span>' + escapeText(t("logs.combinedStream", undefined, "combined log stream")) + '</span><span>' + escapeText(String(combined.length)) +
        '</span></div><strong>' + escapeText(args.selectedRoleId ? "engine + " + args.selectedRoleId : t("logs.engineAllRoles", undefined, "engine + all loaded roles")) +
        '</strong><div class="hint">' + escapeText(args.stale ? t("logs.stale", undefined, "stale since last stream event") : t("logs.fresh", undefined, "fresh")) + "</div></div>",
      ...combined.map((item) => {
        const record = item.record;
        const summary = typeof record.message === "string"
          ? record.message
          : typeof record.line === "string"
            ? record.line
            : formatJson(record);
        return (
          '<div class="event"><div class="event-top"><span>' +
          escapeText(item.source) +
          "</span><span>" +
          escapeText(timestampOf(record) || "n/a") +
          "</span></div><strong>" +
          escapeText(summary) +
          '</strong><div class="hint">' +
          escapeText(String(record.level ?? record.type ?? "log")) +
          "</div></div>"
        );
      })
    ].join("");
  };

  return [
    '<div class="structure-list">',
    renderCombinedEntries(),
    '<div class="log-stream-grid">',
    '<div class="structure-list">' + renderLogEntries(t("logs.engineLog", undefined, "engine log"), args.engine) + "</div>",
    '<div class="structure-list">' + renderLogEntries(args.selectedRoleId ? t("logs.roleLog", undefined, "role log") : t("logs.roleLogs", undefined, "role logs"), args.role) + "</div>",
    "</div>",
    "</div>"
  ].join("");
}

export function renderRunStatePanel(args: {
  state: unknown;
  header: JsonRecord | null | undefined;
  graph: JsonRecord | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const summarizeValue = (value: unknown): { label: string; detail?: string } => {
    if (Array.isArray(value)) {
      return {
        label: t("common.arrayItems", { count: value.length }, `array · ${value.length} item(s)`),
        detail: value.length ? formatJson(value) : undefined
      };
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value as JsonRecord);
      return {
        label: t("common.objectKeys", { count: keys.length }, `object · ${keys.length} key(s)`),
        detail: keys.length ? formatJson(value) : undefined
      };
    }
    if (typeof value === "boolean") {
      return { label: value ? "true" : "false" };
    }
    if (value === null || value === undefined || value === "") {
      return { label: t("common.empty", undefined, "empty") };
    }
    return { label: displayUiToken(value, t) };
  };
  const stateFieldLabel = (path: string): string => {
    const key = path.startsWith("state.") ? path.slice("state.".length) : path;
    return t("state.field." + key, undefined, key);
  };
  const renderValueCard = (path: string, value: unknown): string => {
    const summary = summarizeValue(value);
    const label = stateFieldLabel(path);
    return (
      '<div class="event"><div class="event-top"><span>' +
      escapeText(label) +
      '</span><span><code>' +
      escapeText(path) +
      "</code></span></div><strong>" +
      escapeText(summary.label) +
      "</strong>" +
      (summary.detail ? '<pre>' + escapeText(summary.detail) + "</pre>" : "") +
      "</div>"
    );
  };
  const renderStateGroup = (title: string, cards: string[]): string => {
    if (!cards.length) {
      return "";
    }
    return '<div class="state-group"><div class="state-group-title">' + escapeText(title) + '</div><div class="state-card-grid">' + cards.join("") + "</div></div>";
  };
  const renderStructuredStateGroups = (value: unknown): string[] => {
    const record = value && typeof value === "object" && !Array.isArray(value)
      ? value as JsonRecord
      : undefined;
    if (!record) {
      return [renderValueCard("state", value)];
    }
    const keys = Object.keys(record);
    if (!keys.length) {
      return ['<div class="event"><div class="event-top"><span>' + escapeText(t("artifacts.state", undefined, "State")) + '</span><span>' + escapeText(t("common.empty", undefined, "empty")) + '</span></div><strong>' + escapeText(t("common.noFields", undefined, "no fields")) + '</strong></div>'];
    }
    const executionKeys = new Set(["status", "mode", "runMode", "transitionCount", "totalTransitions", "okCount", "failedCount", "noopCount", "lastExecutedRoleId", "finalRoleId", "currentRoleId", "nextRoleId"]);
    const branchReviewKeys = new Set(["activeBranches", "completedBranches", "branches", "branchStatuses", "pendingReviewCount", "reviews", "review", "humanReviews"]);
    const controlKeys = new Set(["stopRequest", "stopOutcome", "metrics", "artifacts", "errors", "error", "failure", "auditSummary"]);
    const executionCards: string[] = [];
    const branchReviewCards: string[] = [];
    const controlCards: string[] = [];
    const additionalCards: string[] = [];
    for (const key of keys) {
      const card = renderValueCard("state." + key, record[key]);
      if (executionKeys.has(key)) {
        executionCards.push(card);
      } else if (branchReviewKeys.has(key)) {
        branchReviewCards.push(card);
      } else if (controlKeys.has(key)) {
        controlCards.push(card);
      } else {
        additionalCards.push(card);
      }
    }
    return [
      renderStateGroup(t("state.executionState", undefined, "execution state"), executionCards),
      renderStateGroup(t("state.branchReviewState", undefined, "branch and review state"), branchReviewCards),
      renderStateGroup(t("state.controlState", undefined, "control and artifact state"), controlCards),
      renderStateGroup(t("state.additionalState", undefined, "additional state"), additionalCards)
    ].filter(Boolean);
  };
  if (args.state === null || args.state === undefined) {
    return '<div class="hint">' + escapeText(t("state.runtimeStateUnavailable", undefined, "Runtime state unavailable.")) + '</div>';
  }
  const header = args.header ?? {};
  const graph = args.graph ?? {};
  const graphNodes = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
  const graphEdges = Array.isArray(graph.edges) ? graph.edges.length : 0;
  return [
    '<div class="state-panel">',
    '<div class="state-card-grid">',
    '<div class="event"><div class="event-top"><span>' + escapeText(t("state.runtime", undefined, "runtime")) + '</span><span>' + escapeText(displayUiToken(header.status ?? t("common.unknown", undefined, "unknown"), t)) + "</span></div><strong>" +
      escapeText(displayUiToken((args.state as JsonRecord | undefined)?.status ?? header.status ?? t("state.stateAvailable", undefined, "state available"), t)) +
      '</strong><div class="hint">' + escapeText(t("state.activePending", {
        activeBranches: String(header.activeBranches ?? 0),
        pendingReviews: String(header.pendingReviewCount ?? 0)
      }, "active branches " + String(header.activeBranches ?? 0) + " · pending reviews " + String(header.pendingReviewCount ?? 0))) + "</div></div>",
    '<div class="event"><div class="event-top"><span>' + escapeText(t("state.graphSnapshot", undefined, "graph snapshot")) + '</span><span>' + escapeText(graphNodes) + " " + escapeText(t("common.nodes", undefined, "nodes")) + '</span></div><strong>' +
      escapeText(t("state.flowsCount", { count: graphEdges }, `flows ${graphEdges}`)) +
      '</strong><div class="hint">' + escapeText(t("state.lastFinalRole", {
        lastRoleId: String(header.lastExecutedRoleId ?? t("common.notAvailable", undefined, "n/a")),
        finalRoleId: String(header.finalRoleId ?? t("common.notAvailable", undefined, "n/a"))
      }, "last role " + String(header.lastExecutedRoleId ?? "n/a") + " · final role " + String(header.finalRoleId ?? "n/a"))) + "</div></div>",
    "</div>",
    ...renderStructuredStateGroups(args.state),
    "</div>"
  ].join("");
}

export function renderArtifactsPanel(args: {
  detail: Record<string, unknown> | null | undefined;
  graph: Record<string, unknown> | null | undefined;
  reviews: Record<string, unknown> | null | undefined;
  reviewDetail: Record<string, unknown> | null | undefined;
  resumeDiagnostics: Record<string, unknown> | null | undefined;
  t?: Translator;
}): string {
  const t: Translator = typeof args.t === "function" ? args.t : (_key, _vars, fallback) => fallback ?? _key;
  const summarizeValue = (value: unknown): { label: string; detail?: string } => {
    if (Array.isArray(value)) {
      return {
        label: t("common.arrayItems", { count: value.length }, `array · ${value.length} item(s)`),
        detail: value.length ? formatJson(value) : undefined
      };
    }
    if (value && typeof value === "object") {
      const keys = Object.keys(value as JsonRecord);
      return {
        label: t("common.objectKeys", { count: keys.length }, `object · ${keys.length} key(s)`),
        detail: keys.length ? formatJson(value) : undefined
      };
    }
    if (typeof value === "boolean") {
      return { label: value ? "true" : "false" };
    }
    if (value === null || value === undefined || value === "") {
      return { label: t("common.empty", undefined, "empty") };
    }
    return { label: displayUiToken(value, t) };
  };
  const renderStructuredValueCards = (title: string, value: unknown): string[] => {
    const titleLabel = (name: string): string => {
      if (name === "metrics") return t("artifacts.metrics", undefined, "Metrics");
      if (name === "state") return t("artifacts.state", undefined, "State");
      if (name === "stopRequest") return t("state.field.stopRequest", undefined, "stop request");
      if (name === "stopOutcome") return t("state.field.stopOutcome", undefined, "stop outcome");
      if (name === "summary") return t("artifacts.summary", undefined, "Summary");
      return name;
    };
    const fieldLabel = (key: string): string => t("state.field." + key, undefined, key);
    const record = value && typeof value === "object" && !Array.isArray(value)
      ? value as JsonRecord
      : undefined;
    if (!record) {
      const summary = summarizeValue(value);
      return [
        '<div class="event"><div class="event-top"><span>' + escapeText(titleLabel(title)) + '</span><span><code>' + escapeText(title) + '</code></span></div><strong>' +
        escapeText(summary.label) +
        '</strong>' +
        (summary.detail ? '<pre>' + escapeText(summary.detail) + "</pre>" : "") +
        "</div>"
      ];
    }
    const keys = Object.keys(record);
    if (!keys.length) {
      return [
        '<div class="event"><div class="event-top"><span>' + escapeText(titleLabel(title)) + '</span><span>' + escapeText(t("common.empty", undefined, "empty")) + '</span></div><strong>' + escapeText(t("common.noFields", undefined, "no fields")) + '</strong></div>'
      ];
    }
    return keys.map((key) => {
      const summary = summarizeValue(record[key]);
      return (
        '<div class="event"><div class="event-top"><span>' +
        escapeText(fieldLabel(key)) +
        '</span><span><code>' +
        escapeText(`${title}.${key}`) +
        "</code></span></div><strong>" +
        escapeText(summary.label) +
        "</strong>" +
        (summary.detail ? '<pre>' + escapeText(summary.detail) + "</pre>" : "") +
        "</div>"
      );
    });
  };
  if (!args.detail) {
    return '<div class="hint">' + escapeText(t("state.noRunSelected", undefined, "No run selected.")) + '</div>';
  }
  const header = (args.detail.header ?? {}) as JsonRecord;
  const reviewList = Array.isArray(args.reviews?.reviews) ? args.reviews.reviews as unknown[] : [];
  const graph = (args.graph?.graph ?? args.graph ?? {}) as JsonRecord;
  const graphNodes = Array.isArray(graph.nodes) ? graph.nodes.length : 0;
  const graphEdges = Array.isArray(graph.edges) ? graph.edges.length : 0;
  const sections = [
    '<div class="artifact-tabs"><span class="pill">' + escapeText(t("artifacts.summary", undefined, "Summary")) + '</span><span class="pill">' + escapeText(t("artifacts.metrics", undefined, "Metrics")) + '</span><span class="pill">' + escapeText(t("artifacts.state", undefined, "State")) + '</span><span class="pill">' + escapeText(t("artifacts.audit", undefined, "Audit")) + '</span><span class="pill">' + escapeText(t("artifacts.timeline", undefined, "Timeline")) + '</span><span class="pill">' + escapeText(t("artifacts.raw", undefined, "Raw")) + '</span></div>',
    '<div class="artifact-section"><div class="event"><div class="event-top"><span>' + escapeText(t("artifacts.summary", undefined, "Summary")) + '</span><span>' + escapeText(header.status ?? t("common.unknown", undefined, "unknown")) +
      "</span></div><strong>" + escapeText(args.detail.runId ?? "n/a") +
      '</strong><div class="hint">' + escapeText((args.detail.runDir ?? "n/a") + " · " + t("run.updated", undefined, "updated") + " " + (header.updatedAt ?? "n/a")) + "</div></div>" +
      '<div class="event"><div class="event-top"><span>' + escapeText(t("artifacts.artifactMap", undefined, "artifact map")) + '</span><span>' + escapeText(reviewList.length) +
      " " + escapeText(t("common.reviews", undefined, "reviews")) + '</span></div><strong>' + escapeText("graph " + graphNodes + " " + t("common.nodes", undefined, "nodes") + " / " + graphEdges + " " + t("common.edges", undefined, "edges")) +
      '</strong><div class="hint">' + escapeText(t("artifacts.resumeDiagnostics", undefined, "resume diagnostics")) + " " + escapeText(args.resumeDiagnostics ? t("common.loaded", undefined, "loaded") : t("common.lazy", undefined, "lazy")) + " · " + escapeText(t("artifacts.selectedReview", undefined, "selected review")) + " " +
      escapeText(args.reviewDetail?.reviewId ?? t("common.none", undefined, "none")) + "</div></div></div>",
    '<div class="artifact-section"><div class="event"><div class="event-top"><span>' + escapeText(t("artifacts.metrics", undefined, "Metrics")) + '</span><span>' + escapeText(t("common.snapshot", undefined, "snapshot")) + '</span></div><strong>' + escapeText(t("artifacts.runMetrics", undefined, "Run metrics")) + '</strong></div>' +
      renderStructuredValueCards("metrics", args.detail.metrics ?? null).join("") + "</div>",
    '<div class="artifact-section"><div class="event"><div class="event-top"><span>' + escapeText(t("artifacts.state", undefined, "State")) + '</span><span>' + escapeText(t("common.snapshot", undefined, "snapshot")) + '</span></div><strong>' + escapeText(t("artifacts.runtimeStateStopControls", undefined, "Runtime state and stop controls")) + '</strong></div>' +
      renderStructuredValueCards("state", args.detail.state ?? null).join("") +
      renderStructuredValueCards("stopRequest", args.detail.stopRequest ?? null).join("") +
      renderStructuredValueCards("stopOutcome", args.detail.stopOutcome ?? null).join("") + "</div>",
    '<div class="artifact-section"><div class="event"><div class="event-top"><span>' + escapeText(t("artifacts.raw", undefined, "Raw")) + '</span><span>' + escapeText(t("common.fallback", undefined, "fallback")) + '</span></div><strong>' + escapeText(t("artifacts.resolvedConfigSummary", undefined, "Resolved config and summary payloads")) + '</strong></div>' +
      renderStructuredValueCards("summary", args.detail.summary ?? null).join("") +
      renderStructuredValueCards("resolvedConfig", args.detail.resolvedConfig ?? null).join("") + "</div>"
  ];
  return [
    '<div class="structure-list">',
    ...sections,
    "</div>"
  ].join("");
}

export function renderRunTopologySvg(graph: Record<string, unknown> | null | undefined, t?: Translator): string {
  const tr: Translator = typeof t === "function" ? t : (_key, _vars, fallback) => fallback ?? _key;
  const labelToken = (value: unknown): string => displayUiToken(value, tr);
  if (!graph) {
    return '<div class="hint">' + escapeText(tr("graph.projectionUnavailable", undefined, "Graph projection unavailable.")) + '</div>';
  }
  const nodes = Array.isArray(graph.nodes) ? graph.nodes as JsonRecord[] : [];
  const edges = Array.isArray(graph.edges) ? graph.edges as JsonRecord[] : [];
  if (!nodes.length) {
    return '<div class="hint">' + escapeText(tr("graph.noNodes", undefined, "No graph nodes available.")) + '</div>';
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
  if (indegree.has("input")) {
    levels.set("input", 0);
  }
  if (indegree.has("output")) {
    levels.set("output", Math.max(1, ...levels.values(), 0) + 1);
  }
  if (indegree.has("__system_end__")) {
    levels.set("__system_end__", Math.max(1, ...levels.values(), 0) + 1);
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
      escapeText(labelToken(node.nodeType ?? "role") + " · " + labelToken(node.status ?? "idle")) +
      '</text>' +
      '<text x="' + (position.x + 20) + '" y="' + (position.y + 76) + '" fill="#dce7f7" font-size="12" font-family="IBM Plex Sans, sans-serif">' +
      escapeText(tr("state.activePending", {
        activeBranches: String(node.activeBranchCount ?? 0),
        pendingReviews: String(node.pendingReviewCount ?? 0)
      }, "active branches " + String(node.activeBranchCount ?? 0) + " · pending reviews " + String(node.pendingReviewCount ?? 0))) +
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
  const terminalNodes: JsonRecord[] = [
    {
      roleId: "input",
      bindingKind: "terminal",
      nodeType: "boundary"
    },
    {
      roleId: "output",
      bindingKind: "terminal",
      nodeType: "boundary"
    }
  ];
  knownRoleIds.add("input");
  knownRoleIds.add("output");
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
  const previewFlows = flows.map((flow) => ({
    sourceRoleId: flow.fromRoleId,
    targetRoleId: flow.toRoleId,
    event: flow.eventType,
    isErrorFlow: false,
    recentlyActivated: false
  }));
  const hasInputEdge = previewFlows.some((flow) => String(flow.sourceRoleId ?? "") === "input");
  if (!hasInputEdge && structure.entryRoleId) {
    previewFlows.unshift({
      sourceRoleId: "input",
      targetRoleId: structure.entryRoleId,
      event: "START",
      isErrorFlow: false,
      recentlyActivated: false
    });
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
    edges: previewFlows
  }).replace("Run topology graph", "Mermaid workbench topology");
}
