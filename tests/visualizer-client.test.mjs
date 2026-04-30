import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  appendStreamEntry,
  buildClientAppScript,
  buildRouteSearch,
  formatReviewStatusLabel,
  getStreamRefreshPlan,
  normalizeLifecycleView,
  readRouteStateFromSearch
} from "../dist/visualizer/client-app.js";

const PAGE_ELEMENT_IDS = [
  "run-list",
  "search",
  "flash",
  "selected-title",
  "selected-subtitle",
  "action-form-section",
  "action-form",
  "console-tabs",
  "console-panel-debug",
  "console-panel-project",
  "console-panel-build",
  "console-panel-ops",
  "console-panel-config",
  "console-panel-logs",
  "console-panel-artifacts",
  "console-panel-validate-release",
  "release-gate",
  "release-export",
  "workdir",
  "workbench-meta",
  "workbench-status",
  "workbench-actions",
  "workbench-tabs",
  "workbench-body",
  "project-summary",
  "build-project-summary",
  "ops-summary",
  "project-readiness",
  "stats",
  "failure-controls",
  "failure-summary",
  "failure-detail",
  "failure-next-checks",
  "timeline",
  "timeline-role",
  "timeline-type",
  "timeline-status",
  "timeline-branch",
  "timeline-review",
  "timeline-error",
  "timeline-apply",
  "timeline-clear",
  "graph-view",
  "state",
  "reviews",
  "review-actions",
  "review-detail",
  "binding-explain",
  "role-packages",
  "contract-explain",
  "resume-readiness",
  "resume-diagnostics",
  "resume-controls",
  "logs-controls",
  "logs-filters",
  "logs",
  "detail",
  "live",
  "log-role",
  "log-page-size",
  "log-tail",
  "log-since",
  "sidebar",
  "sidebar-overlay",
  "sidebar-toggle",
  "project-home",
  "project-load",
  "project-export",
  "reindex",
  "start-run",
  "resume-run",
  "stop-run",
  "refresh",
  "locale-select"
];

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseAttributes(source) {
  const attributes = {};
  const matcher = /([a-zA-Z0-9:-]+)=("([^"]*)"|'([^']*)')/g;
  for (const match of source.matchAll(matcher)) {
    attributes[match[1]] = match[3] ?? match[4] ?? "";
  }
  return attributes;
}

function matchesSelector(element, selector) {
  const attributeSelector = selector.match(/^\[([a-zA-Z0-9:-]+)(?:="([^"]*)")?\]$/);
  if (attributeSelector) {
    const [, name, value] = attributeSelector;
    if (!Object.hasOwn(element.attributes, name)) {
      return false;
    }
    return value === undefined || element.attributes[name] === value;
  }
  if (selector === "[data-run-id]") {
    return Object.hasOwn(element.attributes, "data-run-id");
  }
  if (selector === "[data-review-id]") {
    return Object.hasOwn(element.attributes, "data-review-id");
  }
  if (selector === "[data-review-action]") {
    return Object.hasOwn(element.attributes, "data-review-action");
  }
  if (selector === "[data-console-tab]") {
    return Object.hasOwn(element.attributes, "data-console-tab");
  }
  if (selector === "[data-studio-role-id]") {
    return Object.hasOwn(element.attributes, "data-studio-role-id");
  }
  if (selector === "[data-studio-flow-key]") {
    return Object.hasOwn(element.attributes, "data-studio-flow-key");
  }
  if (selector === "[data-studio-bridge-filter]") {
    return Object.hasOwn(element.attributes, "data-studio-bridge-filter");
  }
  if (selector === "[data-studio-bridge-list-mode]") {
    return Object.hasOwn(element.attributes, "data-studio-bridge-list-mode");
  }
  if (selector === "[data-studio-bridge-fullscreen]") {
    return Object.hasOwn(element.attributes, "data-studio-bridge-fullscreen");
  }
  if (selector === "[data-workbench-view]") {
    return Object.hasOwn(element.attributes, "data-workbench-view");
  }
  if (selector === "[data-workbench-view=\"source\"]") {
    return element.attributes["data-workbench-view"] === "source";
  }
  if (selector === "[data-workbench-view=\"bridge\"]") {
    return element.attributes["data-workbench-view"] === "bridge";
  }
  return false;
}

class FakeElement {
  constructor(document, id = "", tagName = "div", attributes = {}, dynamic = false) {
    this.document = document;
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.dynamic = dynamic;
    this.listeners = new Map();
    this.children = [];
    this._innerHTML = "";
    this.textContent = "";
    this.className = "";
    this.classList = {
      toggle: (name, enabled) => {
        const classes = new Set(String(this.attributes.class ?? "").split(/\s+/).filter(Boolean));
        if (enabled) {
          classes.add(name);
        } else {
          classes.delete(name);
        }
        this.attributes.class = Array.from(classes).join(" ");
      }
    };
    this.dataset = {};
    this.disabled = false;
    this.value = attributes.value ?? "";
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async dispatch(type) {
    const handlers = this.listeners.get(type) ?? [];
    for (const handler of handlers) {
      await handler({ target: this });
    }
  }

  async click() {
    await this.dispatch("click");
  }

  async change(value) {
    this.value = value;
    await this.dispatch("change");
  }

  async input(value) {
    this.value = value;
    await this.dispatch("input");
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  set innerHTML(value) {
    this.document.unregisterChildren(this.children);
    this._innerHTML = String(value);
    this.textContent = this._innerHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    this.children = this.document.parseChildren(this._innerHTML);
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelectorAll(selector) {
    return this.children.filter((child) => matchesSelector(child, selector));
  }
}

class FakeDocument {
  constructor() {
    this.elements = new Map();
    this.body = {
      classList: {
        classes: new Set(),
        toggle(name, enabled) {
          if (enabled) {
            this.classes.add(name);
          } else {
            this.classes.delete(name);
          }
        }
      }
    };
    for (const id of PAGE_ELEMENT_IDS) {
      this.elements.set(id, new FakeElement(this, id));
    }
  }

  getElementById(id) {
    return this.elements.get(id) ?? null;
  }

  unregisterChildren(children) {
    for (const child of children) {
      this.unregisterChildren(child.children);
      if (child.dynamic && child.id && this.elements.get(child.id) === child) {
        this.elements.delete(child.id);
      }
    }
  }

  parseChildren(html) {
    const children = [];
    const matcher = /<(button|input|select|option|textarea|div|span)\b([^>]*)>/g;
    for (const match of html.matchAll(matcher)) {
      const tagName = match[1];
      const attributes = parseAttributes(match[2] ?? "");
      const id = attributes.id ?? "";
      const element = new FakeElement(this, id, tagName, attributes, true);
      children.push(element);
      if (id) {
        this.elements.set(id, element);
      }
    }
    return children;
  }

  createElement(tagName) {
    return new FakeElement(this, "", tagName, {}, true);
  }
}

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.closed = false;
  }

  close() {
    this.closed = true;
  }

  emit(payload) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

function createResponse(payload, status = 200, statusText = "OK") {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? "application/json; charset=utf-8" : null;
      }
    },
    async json() {
      return cloneJson(payload);
    },
    async text() {
      return typeof payload === "string" ? payload : JSON.stringify(payload);
    }
  };
}

function createDeferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: resolvePromise
  };
}

function buildRunFixture({
  runId,
  reviewId,
  runStatus = "stopped",
  decisionPhase,
  roleId = "demo-analyst",
  branchId = "demo-analyst@1#1",
  reviewStatus = "pending",
  failureCode = "TOOL_EXECUTION_TIMEOUT",
  failureMessage = "Command timeout after 120000ms (timeout)",
  failureStage = "execute",
  failureCategory = "timeout budget exhausted",
  timeoutMs = 120000,
  durationMs = 120229,
  bindingSource = "system.mmd",
  resolvedBinding = "opencode/gpt-5-nano",
  readinessStatus = "blocked",
  canResume = false,
  readinessReason = "Review decision is recorded but not applied.",
  readinessBlockerKind = "review_not_applied",
  reviewComment = "ship it",
  errorEventCode = "E_DEMO"
}) {
  const review = {
    reviewId,
    currentStatus: reviewStatus,
    decisionPhase,
    roleId,
    branchId,
    branchStatus: reviewStatus === "pending" ? "waiting_review" : "paused",
    round: 1,
    requestedAt: "2026-04-23T09:15:00.000Z",
    decision: decisionPhase ? "approve" : undefined,
    actor: decisionPhase ? "qa" : undefined,
    comment: decisionPhase ? reviewComment : undefined,
    scope: "branch",
    reworkTarget: "answer-engineer",
    decidedAt: decisionPhase ? "2026-04-23T09:15:01.000Z" : undefined,
    committedAt: decisionPhase ? "2026-04-23T09:15:01.000Z" : undefined,
    checkpointSequence: decisionPhase === "pending_reconcile" || decisionPhase === "applied" ? 7 : undefined,
    appliedAt:
      decisionPhase === "pending_reconcile" || decisionPhase === "applied"
        ? "2026-04-23T09:15:02.000Z"
        : undefined,
    reconciledAt: decisionPhase === "applied" ? "2026-04-23T09:15:03.000Z" : undefined
  };
  return {
    runId,
    reviewId,
    review,
    reviewDetail: {
      ...cloneJson(review),
      runId,
      runDir: `/tmp/${runId}`,
      executionId: `exec-${runId}`,
      requestedByExecutionId: `exec-${runId}`,
      selectedEvent: "DONE",
      spec: { terminateScope: "branch" },
      history: [],
      reviewRequestSnapshot: {
        selectedEvent: "DONE",
        scope: "branch",
        roleId,
        branchId
      },
      decisionSnapshot: {
        decision: review.decision ?? null,
        actor: review.actor ?? null,
        comment: review.comment ?? null,
        decisionPhase: review.decisionPhase ?? null
      },
      humanReviewContext: { comment: reviewComment }
    },
    detail: {
      runId,
      runDir: `/tmp/${runId}`,
      header: {
        runId,
        runDir: `/tmp/${runId}`,
        status: runStatus,
        transitionCount: 1,
        finalRoleId: "",
        lastExecutedRoleId: roleId,
        updatedAt: "2026-04-23T09:15:01.000Z",
        activeBranches: 0,
        pendingReviewCount: 1,
        hasWaitingHumanReview: true,
        recentAudits: 1,
        systemSource: null,
        isSimulation: false,
        runMode: "runtime"
      },
      state: {
        status: runStatus,
        transitionCount: 1,
        totalTransitions: 3,
        noopCount: 1,
        loopIterations: { [roleId]: 2 },
        pendingReviewCount: 1,
        stopOutcome: null
      },
      metrics: {
        runId,
        systemId: "viz.review.demo",
        summary: {
          totalTransitions: 3,
          noopCount: 1
        }
      },
      resolvedConfig: null,
      stopRequest: null,
      stopOutcome: null,
      summary: null,
      systemSource: "flowchart TD"
    },
    graph: {
      simulation: { mode: "runtime" },
      graph: {
        systemId: "viz.review.demo",
        entryRoleId: roleId,
        roleCount: 2,
        flowCount: 1,
        nodes: [
          {
            roleId,
            nodeType: "role",
            status: "waiting_review",
            bindingKind: "model",
            activeBranchCount: 0,
            waitingReviewCount: 1,
            loopIteration: 1,
            lastErrorCode: failureCode,
            missingSources: []
          },
          {
            roleId: "qa",
            nodeType: "role",
            status: "idle",
            bindingKind: "profile",
            activeBranchCount: 0,
            waitingReviewCount: 0,
            pendingReviewCount: 0,
            loopIteration: 0,
            lastSelectedEvent: "DONE",
            missingSources: []
          }
        ],
        edges: [
          {
            sourceRoleId: roleId,
            targetRoleId: "qa",
            event: "DONE",
            isErrorFlow: false,
            recentlyActivated: true
          }
        ]
      }
    },
    failure: {
      summary: {
        errorCode: failureCode,
        errorCategory: failureCategory,
        message: failureMessage,
        stage: failureStage,
        roleId,
        branchId,
        retryable: true,
        durationMs
      },
      detail: {
        allowedEvents: ["DONE", "REWORK"],
        inputContext: { prompt: "draft answer", facts: ["law-1"] },
        rawOutput: { answer: "timed out response" },
        schemaPath: `og-roles/${roleId}/output.schema.json`,
        selectedBinding: {
          bindingKind: "model",
          declaredBinding: "model:gpt-5-nano",
          resolvedBinding,
          timeoutMs,
          maxOutputBytes: 16384,
          source: bindingSource
        },
        timeoutMs,
        upstreamRoleIds: ["legal-product-manager"],
        contract: {
          flowKey: `${roleId}->qa:DONE`,
          contractId: "flow.answer.done",
          kind: "flow",
          schemaPath: ".ogs/contracts/flow.answer.done.schema.json"
        }
      }
    },
    readiness: {
      status: readinessStatus,
      canResume,
      reason: readinessReason,
      blockers: [
        {
          kind: readinessBlockerKind,
          severity: "blocking",
          title: "Resume blocked until review lifecycle converges",
          detail: readinessReason
        }
      ],
      driftBySource: {
        contracts: [{ flowKey: `${roleId}->qa:DONE`, contractId: "flow.answer.done" }],
        modelSelection: [{ roleId, resolvedBinding }]
      }
    },
    diagnostics: {
      runId,
      runDir: `/tmp/${runId}`,
      status: "dirty",
      fingerprint: {},
      counts: {},
      checks: [
        {
          id: "review-decisions",
          label: "Review decisions",
          ok: false,
          severity: "warning",
          message: "1 unreconciled decision"
        }
      ],
      recommendations: [
        {
          action: "inspect-resume-readiness",
          label: "Review readiness blockers and drift sources before resume."
        }
      ]
    },
    events: [
      {
        cursor: 0,
        record: {
          type: "human_review_requested",
          at: "2026-04-23T09:15:00.000Z",
          reviewId,
          roleId,
          status: "pending",
          branchId
        }
      },
      {
        cursor: 1,
        record: {
          type: "runtime_error",
          at: "2026-04-23T09:15:30.000Z",
          roleId: "qa",
          errorCode: errorEventCode
        }
      }
    ],
    logMessage: `?run=${runId}`
  };
}

function createBackend(options = {}) {
  const runId = "run-123";
  const secondRunId = "run-456";
  const reviewId = "review-1";
  const decisionPhase = options.decisionPhase;
  const runStatus = options.runStatus ?? "stopped";
  const primaryRun = buildRunFixture({
    runId,
    reviewId,
    runStatus,
    decisionPhase
  });
  const secondaryRun = buildRunFixture({
    runId: secondRunId,
    reviewId: "review-2",
    runStatus: "failed",
    decisionPhase: "recorded",
    roleId: "citation-engineer",
    branchId: "citation-engineer@1#1",
    failureCode: "CONTRACT_VIOLATION",
    failureMessage: "Strict handoff contract missing for citation flow.",
    failureCategory: "contract handoff violation",
    timeoutMs: 90000,
    durationMs: 91234,
    resolvedBinding: "opencode/gpt-5-mini",
    readinessReason: "Contract drift detected against persisted checkpoint.",
    readinessBlockerKind: "fingerprint_drift",
    reviewComment: "needs contract repair",
    errorEventCode: "E_CONTRACT"
  });
  const runFixtures = new Map([[runId, primaryRun]]);
  if (options.includeSecondRun) {
    runFixtures.set(secondRunId, secondaryRun);
  }
  const backend = {
    runId,
    secondRunId,
    reviewId,
    review: cloneJson(primaryRun.review),
    lastProjectLoadBody: null,
    lastReindexBody: null,
    reviewDetail: cloneJson(primaryRun.reviewDetail),
    lastDecisionBody: null,
    decisionDeferred: options.decisionDeferred ?? null,
    fetchCalls: [],
    async handle(url, request = {}) {
      const parsed = new URL(url, "http://visualizer.test");
      const pathname = parsed.pathname;
      const method = request.method ?? "GET";
      this.fetchCalls.push({ method, path: `${pathname}${parsed.search}`, body: request.body ?? null });
      const getRunFixture = (requestedRunId) => runFixtures.get(requestedRunId) ?? null;
      const runMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)$/);
      const runEventsMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/events$/);
      const runGraphMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/graph$/);
      const runReviewsMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/reviews$/);
      const runReviewDetailMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/reviews\/([^/]+)$/);
      const runReviewDecisionMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/reviews\/([^/]+)\/decide$/);
      const runResumeMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/resume$/);
      const runStopMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/stop$/);
      const runLogsMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/logs$/);
      const runFailureMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/failure$/);
      const runReadinessMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/resume-readiness$/);
      const runDiagnosticsMatch = pathname.match(/^\/api\/v1\/runs\/([^/]+)\/resume-diagnostics$/);
      if (pathname === "/api/v1/project") {
        return createResponse({
          project: {
            projectName: "demo",
            projectId: "viz.project.demo",
            systemId: "viz.review.demo",
            systemVersion: "1.0.0",
            entryRoleId: "demo-analyst",
            roleCount: 1,
            roleIds: ["demo-analyst"],
            flowCount: 1,
            reviewedRoleIds: ["demo-analyst"],
            joinRoleIds: [],
            loopRoleIds: [],
            contextMappedRoleIds: [],
            runsDir: ".ogs/runs"
          },
          recentRuns: []
        });
      }
      if (pathname === "/api/v1/project/system") {
        return createResponse({ systemSource: "flowchart TD" });
      }
      if (pathname === "/api/v1/project/system/workbench") {
        return createResponse({
          workdir: "/tmp/demo",
          systemPath: "/tmp/demo/system.mmd",
          systemSource: "flowchart TD\n%% system.id=viz.review.demo\n%% system.version=1.0.0\n%% law.global=law.minimal.base\n%% entry.role=demo-analyst\ninput -->|GO| analyst[Role:demo-analyst]\nanalyst[Role:demo-analyst] -->|DONE| output\n",
          validation: {
            ok: true,
            diagnostics: [],
            structure: {
              systemId: "viz.review.demo",
              systemVersion: "1.0.0",
              entryRoleId: "demo-analyst",
              roleCount: 1,
              flowCount: 1,
              roles: [{ roleId: "demo-analyst", bindingKind: "model", reviewMode: "required" }],
              flows: [{ fromRoleId: "demo-analyst", toRoleId: "output", eventType: "DONE" }]
            }
          }
        });
      }
      if (pathname === "/api/v1/project/system/validate" && method === "POST") {
        const body = JSON.parse(request.body ?? "{}");
        const valid = !String(body.systemSource || "").includes("INVALID");
        return createResponse({
          ok: valid,
          diagnostics: valid
            ? []
            : [{ code: "MERMAID_PARSE_FAILED", message: "bad line", severity: "error", stage: "parse", line: 2 }],
          structure: valid
            ? {
                systemId: "viz.review.demo",
                systemVersion: "1.0.0",
                entryRoleId: "demo-analyst",
                roleCount: 1,
                flowCount: 1,
                roles: [{ roleId: "demo-analyst", bindingKind: "model", reviewMode: "required" }],
                flows: [{ fromRoleId: "demo-analyst", toRoleId: "output", eventType: "DONE" }]
              }
            : null
        });
      }
      if ((pathname === "/api/v1/project/system/save" || pathname === "/api/v1/project/system/save-as") && method === "POST") {
        const body = JSON.parse(request.body ?? "{}");
        const valid = !String(body.systemSource || "").includes("INVALID");
        return createResponse({
          savedPath: body.saveAsPath ? `/tmp/demo/${body.saveAsPath}` : "/tmp/demo/system.mmd",
          validation: {
            ok: valid,
            diagnostics: valid
              ? []
              : [{ code: "MERMAID_PARSE_FAILED", message: "bad line", severity: "error", stage: "parse", line: 2 }],
            structure: valid ? {
              systemId: "viz.review.demo",
              systemVersion: "1.0.0",
              entryRoleId: "demo-analyst",
              roleCount: 1,
              flowCount: 1,
              roles: [{ roleId: "demo-analyst", bindingKind: "model", reviewMode: "required" }],
              flows: [{ fromRoleId: "demo-analyst", toRoleId: "output", eventType: "DONE" }]
            } : null
          },
          followUpActions: [{ action: "refresh-project-summary", label: "Reload project and graph views to reflect the saved system." }]
        });
      }
      if (pathname === "/api/v1/project/studio/bridge" && method === "POST") {
        const body = JSON.parse(request.body ?? "{}");
        this.lastStudioBridgeBody = body;
        return createResponse({
          workdir: "/tmp/demo",
          systemPath: "/tmp/demo/system.mmd",
          systemSource: body.systemSource || "",
          validation: {
            ok: true,
            diagnostics: [],
            structure: {
              systemId: "viz.review.demo",
              systemVersion: "1.0.0",
              entryRoleId: "demo-analyst",
              roleCount: 1,
              flowCount: 1,
              roles: [{ roleId: "demo-analyst", bindingKind: "model", reviewMode: "required" }],
              flows: [{ fromRoleId: "demo-analyst", toRoleId: "output", eventType: "DONE" }]
            }
          },
          authoring: {
            version: 1,
            project: { workdir: "/tmp/demo", systemPath: "/tmp/demo/system.mmd" },
            system: {
              systemId: "viz.review.demo",
              systemVersion: "1.0.0",
              entryRoleId: "demo-analyst",
              lawGlobalRef: "law.minimal.base"
            },
            roles: {
              "demo-analyst": {
                roleId: "demo-analyst",
                bindingKind: "model",
                modelRef: "opencode/gpt-5.4",
                review: { mode: "required", timeoutAction: "pause", reworkTargetRoleId: "demo-analyst", terminateScope: "branch" }
              }
            },
            flows: {
              "1:demo-analyst:DONE:output": {
                flowId: "1:demo-analyst:DONE:output",
                fromRoleId: "demo-analyst",
                toRoleId: "__system_end__",
                eventType: "DONE"
              }
            },
            layout: { nodes: { "demo-analyst": { x: 120, y: 120 } } }
          },
          extracted: {
            systemId: "viz.review.demo",
            systemVersion: "1.0.0",
            entryRoleId: "demo-analyst",
            lawGlobal: "law.minimal.base",
            roles: [{
              roleId: "demo-analyst",
              bindingKind: "model",
              modelRef: "opencode/gpt-5.4",
              review: { mode: "required" },
              incomingFlowCount: 0,
              outgoingFlowCount: 1,
              allowedEvents: ["DONE"],
              badges: ["entry", "M", "R"]
            }],
            flows: [{
              flowId: "1:demo-analyst:DONE:output",
              flowKey: "demo-analyst:DONE:output",
              fromRoleId: "demo-analyst",
              toRoleId: "__system_end__",
              eventType: "DONE",
              runtimeOnlyErrorFlow: false,
              participatesInJoin: false
            }]
          }
        });
      }
      if (pathname === "/api/v1/project/studio/authoring" && method === "POST") {
        this.lastAuthoringSaveBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          workdir: "/tmp/demo",
          draftPath: "/tmp/demo/.ogs/studio/system.authoring.json",
          authoring: this.lastAuthoringSaveBody.authoring,
          validation: { ok: true, diagnostics: [], structure: null }
        });
      }
      if (pathname === "/api/v1/project/studio/authoring/generate-mmd" && method === "POST") {
        this.lastAuthoringGenerateBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          workdir: "/tmp/demo",
          systemPath: "/tmp/demo/system.mmd",
          systemSource: "flowchart TD\n%% system.id=viz.review.demo\n%% system.version=1.0.0\n%% law.global=law.minimal.base\n%% entry.role=demo-analyst\nr1[Role:demo-analyst] -->|DONE| output\n",
          validation: { ok: true, diagnostics: [], structure: null }
        });
      }
      if (pathname === "/api/v1/project/studio/authoring/apply-canvas" && method === "POST") {
        this.lastAuthoringApplyCanvasBody = JSON.parse(request.body ?? "{}");
        const moved = this.lastAuthoringApplyCanvasBody.canvas?.nodes?.find((node) => node.roleId === "demo-analyst");
        return createResponse({
          workdir: "/tmp/demo",
          systemPath: "/tmp/demo/system.mmd",
          authoring: {
            ...this.lastAuthoringApplyCanvasBody.authoring,
            layout: {
              nodes: {
                "demo-analyst": {
                  x: moved?.x ?? 120,
                  y: moved?.y ?? 120,
                  width: moved?.width ?? 180,
                  height: moved?.height ?? 84
                }
              }
            }
          },
          canvas: this.lastAuthoringApplyCanvasBody.canvas,
          systemSource: "flowchart TD\n%% system.id=viz.review.demo\n%% system.version=1.0.0\n%% law.global=law.minimal.base\n%% entry.role=demo-analyst\nr1[Role:demo-analyst] -->|DONE| output\n",
          validation: { ok: true, diagnostics: [], structure: null }
        });
      }
      if (pathname === "/api/v1/project/export" && method === "POST") {
        return createResponse({
          mode: "single-project-v1",
          project: {
            systemPath: "system.mmd",
            systemSource: "flowchart TD",
            runtime: {},
            modelSelection: {},
            modelCatalog: {},
            laws: {},
            userProfile: {},
            project: {}
          }
        });
      }
      if (pathname === "/api/v1/project/load" && method === "POST") {
        const body = JSON.parse(request.body ?? "{}");
        this.lastProjectLoadBody = body;
        return createResponse({
          workdir: body.workdir || "/tmp/other",
          mode: "single-project-v1",
          loadedFiles: ["system.mmd", ".ogs/"],
          validation: {
            ok: true,
            diagnostics: [],
            structure: {
              systemId: "viz.loaded.demo",
              systemVersion: "1.0.0",
              entryRoleId: "demo-analyst",
              roleCount: 1,
              flowCount: 1,
              roles: [{ roleId: "demo-analyst", bindingKind: "model" }],
              flows: [{ fromRoleId: "demo-analyst", toRoleId: "output", eventType: "DONE" }]
            }
          },
          followUpActions: [{ action: "project-rebound", label: "Visualizer workdir rebound." }]
        });
      }
      if (pathname === "/api/v1/project/config") {
        return createResponse({
          modelSelectionWarnings: [],
          modelCatalog: {
            models: [
              { ref: "opencode/gpt-5.4", name: "GPT 5.4", provider: "opencode", model: "gpt-5.4" },
              { ref: "opencode/gpt-5-nano", name: "GPT 5 Nano", provider: "opencode", model: "gpt-5-nano" }
            ]
          },
          profiles: [{ profileId: "profile.review", toolRef: "tool.review" }],
          tools: [{ toolRef: "tool.review", runner: "local_shell" }]
        });
      }
      if (pathname === "/api/v1/project/profiles" && method === "POST") {
        this.lastProfilesUpsertBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          workdir: "/tmp/demo",
          profilesPath: "/tmp/demo/profiles.json",
          profiles: this.lastProfilesUpsertBody.profiles
        });
      }
      if (pathname === "/api/v1/project/bindings") {
        return createResponse({
          roles: [
            {
              roleId: "demo-analyst",
              bindingKind: "model",
              declaredBinding: "model:gpt-5-nano",
              resolvedBinding: "opencode/gpt-5-nano",
              effectiveBinding: "opencode/gpt-5-nano",
              timeoutMs: 120000,
              maxOutputBytes: 16384,
              source: "system.mmd"
            },
            {
              roleId: "qa",
              bindingKind: "profile",
              declaredBinding: "profile:review",
              resolvedBinding: "profile:review",
              effectiveBinding: "profile:review",
              timeoutMs: 60000,
              maxOutputBytes: 8192,
              source: ".ogs/model-selection.json"
            }
          ]
        });
      }
      if (pathname === "/api/v1/project/contracts") {
        return createResponse({
          flows: options.includeMissingAuditContract
            ? [
                {
                  flowKey: "audit model",
                  contractId: null,
                  kind: "audit",
                  schemaPath: null,
                  lastStatus: "missing"
                }
              ]
            : [
                {
                  flowKey: "demo-analyst->qa:DONE",
                  contractId: "flow.answer.done",
                  kind: "flow",
                  schemaPath: ".ogs/contracts/flow.answer.done.schema.json",
                  lastStatus: "covered"
                }
              ],
          uncoveredEdges: [
            {
              flowKey: "qa->output:APPROVE",
              fromRoleId: "qa",
              toRoleId: "output"
            }
          ]
        });
      }
      if (pathname === "/api/v1/project/role-packages") {
        return createResponse({
          rolePackages: [
            {
              roleId: "demo-analyst",
              summary: "primary answer generator",
              outputSchemaPath: "og-roles/demo-analyst/output.schema.json",
              allowedEvents: ["DONE", "REWORK"],
              files: {
                "role.json": true,
                "prompt.md": true,
                "output.schema.json": true,
                "source.json": false
              }
            },
            {
              roleId: "qa",
              summary: "human review gate",
              outputSchemaPath: "og-roles/qa/output.schema.json",
              allowedEvents: ["APPROVE", "REWORK"],
              files: {
                "role.json": true,
                "prompt.md": true,
                "output.schema.json": true,
                "source.json": true
              }
            }
          ]
        });
      }
      if (pathname === "/api/v1/project/roles") {
        return createResponse({ roles: [{ roleId: "demo-analyst", binding: { bindingKind: "model" }, review: {} }] });
      }
      if (pathname === "/api/v1/project/ops-summary") {
        return createResponse({
          summary: {
            recentFailureCount: options.includeSecondRun ? 2 : 1,
            pendingReviewCount: 1,
            pendingReworkCount: 1,
            resumeBlockedRunCount: options.includeSecondRun ? 2 : 1
          },
          recentFailures: [
            {
              runId,
              roleId: "demo-analyst",
              errorCode: "TOOL_EXECUTION_TIMEOUT",
              errorCategory: "timeout",
              message: "Command timeout after 120000ms"
            }
          ],
          failureGroups: {
            byRole: [{ key: "demo-analyst", count: 1 }],
            byErrorCode: [{ key: "TOOL_EXECUTION_TIMEOUT", count: 1 }],
            byErrorCategory: [{ key: "timeout", count: 1 }]
          },
          reviewRework: {
            pendingReviewCount: 1,
            pausedReviewCount: 0,
            pendingReworkCount: 1,
            pendingReviewByRole: [{ key: "demo-analyst", count: 1 }],
            pendingReworkByRole: [{ key: "answer-engineer", count: 1 }]
          },
          resumeReadiness: {
            inspectedRunCount: 1,
            blockedRunCount: 1,
            readyRunCount: 0,
            blockingByCategory: [{ key: "fingerprint drift", count: 1 }],
            driftSources: [{ key: "system.mmd", count: 1 }],
            runs: [{ runId, canResume: false, status: "mismatch", blockingCount: 1 }]
          }
        });
      }
      if (pathname === "/api/v1/project/readiness") {
        return createResponse({
          workdir: "/tmp/ogsystem-visualizer",
          systemId: "viz.review.demo",
          canDryRun: options.readinessCanDryRun === true,
          blockers: options.readinessCanDryRun === true ? [] : [
            {
              code: "READINESS_STRICT_HANDOFF_CONTRACT_MISSING",
              message: "Missing strict handoff contract for qa:APPROVE:output",
              severity: "blocker",
              flowKey: "qa:APPROVE:output"
            }
          ],
          warnings: [],
          missingBindings: [],
          contractCoverage: {
            handoffMode: "strict",
            eligibleFlowCount: 2,
            coveredFlowCount: 1,
            missingFlowCount: 1
          },
          roleRepoHealth: {
            roleRepoRoot: "/tmp/ogsystem-visualizer/og-roles",
            roles: [
              {
                roleId: "demo-analyst",
                status: "ok",
                files: {
                  roleJson: true,
                  promptTemplate: true,
                  outputSchema: true,
                  agent: true,
                  source: false
                },
                missingFiles: []
              }
            ]
          }
        });
      }
      if (pathname === "/api/v1/runs") {
        return createResponse({
          runs: [...runFixtures.values()].map((fixture) => ({
            runId: fixture.runId,
            runDir: `/tmp/${fixture.runId}`,
            status: fixture.detail.header.status,
            transitionCount: 1,
            lastExecutedRoleId: fixture.detail.header.lastExecutedRoleId,
            updatedAt: "2026-04-23T09:15:01.000Z",
            pendingReviewCount: 1,
            hasWaitingHumanReview: true
          }))
        });
      }
      if (pathname === "/api/v1/runs/start" && method === "POST") {
        this.lastStartBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          runId,
          status: "done",
          resultSummary: {
            systemId: "viz.review.demo",
            transitionCount: 1
          },
          followUpActions: [{ action: "open-run-detail", label: "Open run." }]
        });
      }
      if (runMatch) {
        const fixture = getRunFixture(runMatch[1]);
        if (fixture) {
          return createResponse(fixture.detail);
        }
      }
      if (runEventsMatch) {
        const fixture = getRunFixture(runEventsMatch[1]);
        const events = fixture?.events ?? [];
        const filtered = events.filter((entry) => {
          if (parsed.searchParams.get("roleId") && entry.record.roleId !== parsed.searchParams.get("roleId")) {
            return false;
          }
          if (parsed.searchParams.get("branchId") && entry.record.branchId !== parsed.searchParams.get("branchId")) {
            return false;
          }
          if (parsed.searchParams.get("type") && entry.record.type !== parsed.searchParams.get("type")) {
            return false;
          }
          if (parsed.searchParams.get("reviewId") && entry.record.reviewId !== parsed.searchParams.get("reviewId")) {
            return false;
          }
          if (parsed.searchParams.get("status") && entry.record.status !== parsed.searchParams.get("status")) {
            return false;
          }
          if (parsed.searchParams.get("errorCode") && entry.record.errorCode !== parsed.searchParams.get("errorCode")) {
            return false;
          }
          return true;
        });
        return createResponse({
          events: filtered,
          nextCursor: events.length
        });
      }
      if (runGraphMatch) {
        const fixture = getRunFixture(runGraphMatch[1]);
        if (fixture) {
          return createResponse(fixture.graph);
        }
      }
      if (runReviewsMatch) {
        const fixture = getRunFixture(runReviewsMatch[1]);
        if (fixture) {
          return createResponse({
            latestPendingReviewId: fixture.reviewId,
            reviews: [cloneJson(fixture.review)]
          });
        }
      }
      if (runReviewDetailMatch) {
        const fixture = getRunFixture(runReviewDetailMatch[1]);
        if (fixture && runReviewDetailMatch[2] === fixture.reviewId) {
          return createResponse(cloneJson(fixture.reviewDetail));
        }
      }
      if (runFailureMatch) {
        const fixture = getRunFixture(runFailureMatch[1]);
        if (fixture) {
          return createResponse(cloneJson(fixture.failure));
        }
      }
      if (runReadinessMatch) {
        const fixture = getRunFixture(runReadinessMatch[1]);
        if (fixture) {
          return createResponse(cloneJson(fixture.readiness));
        }
      }
      if (runDiagnosticsMatch) {
        const fixture = getRunFixture(runDiagnosticsMatch[1]);
        if (fixture) {
          return createResponse(cloneJson(fixture.diagnostics));
        }
      }
      if (runResumeMatch && method === "POST") {
        this.lastResumeBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          runId: runResumeMatch[1],
          status: "done",
          resultSummary: {
            systemId: "viz.review.demo",
            transitionCount: 2
          },
          followUpActions: [{ action: "open-run-detail", label: "Open run." }]
        });
      }
      if (runStopMatch && method === "POST") {
        this.lastStopBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          runId: runStopMatch[1],
          action: "stop",
          accepted: true,
          detail: {
            requestRecorded: true,
            stopOutcomeApplied: false,
            runStatus: "stopping",
            converged: false
          }
        });
      }
      if (runLogsMatch) {
        const fixture = getRunFixture(runLogsMatch[1]);
        const roleId = parsed.searchParams.get("roleId");
        return createResponse({
          records: [{
            at: "2026-04-23T09:15:00.000Z",
            roleId: roleId || undefined,
            message: parsed.search || fixture?.logMessage || "log"
          }]
        });
      }
      if (pathname === "/api/v1/runs/reindex" && method === "POST") {
        this.lastReindexBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          runs: [...runFixtures.values()].map((fixture) => ({
            runId: fixture.runId,
            runDir: `/tmp/${fixture.runId}`,
            status: fixture.detail.header.status,
            transitionCount: 1,
            lastExecutedRoleId: fixture.detail.header.lastExecutedRoleId,
            updatedAt: "2026-04-23T09:15:01.000Z",
            pendingReviewCount: 1,
            hasWaitingHumanReview: true
          }))
        });
      }
      if (runReviewDecisionMatch && method === "POST") {
        const fixture = getRunFixture(runReviewDecisionMatch[1]);
        if (!fixture || runReviewDecisionMatch[2] !== fixture.reviewId) {
          throw new Error(`Unhandled review decision path: ${pathname}`);
        }
        this.lastDecisionBody = JSON.parse(request.body ?? "{}");
        if (options.failDecision) {
          return createResponse({ error: "boom" }, 500, "Internal Server Error");
        }
        if (this.decisionDeferred) {
          await this.decisionDeferred.promise;
        }
        fixture.review = {
          ...fixture.review,
          decision: this.lastDecisionBody.decision,
          actor: this.lastDecisionBody.actor,
          comment: this.lastDecisionBody.comment,
          decisionPhase: "recorded"
        };
        fixture.reviewDetail = {
          ...fixture.reviewDetail,
          decision: this.lastDecisionBody.decision,
          actor: this.lastDecisionBody.actor,
          comment: this.lastDecisionBody.comment,
          decisionPhase: "recorded",
          decidedAt: "2026-04-23T09:15:05.000Z",
          committedAt: "2026-04-23T09:15:05.000Z",
          decisionSnapshot: {
            decision: this.lastDecisionBody.decision,
            actor: this.lastDecisionBody.actor,
            comment: this.lastDecisionBody.comment,
            decisionPhase: "recorded"
          }
        };
        if (runReviewDecisionMatch[1] === runId) {
          this.review = cloneJson(fixture.review);
          this.reviewDetail = cloneJson(fixture.reviewDetail);
        }
        return createResponse({
          runId: runReviewDecisionMatch[1],
          action: "review:" + this.lastDecisionBody.decision,
          accepted: true,
          semanticStatus: this.lastDecisionBody.decision === "pause" ? "human-review-paused" : "human-review-approved",
          detail: {
            reviewId: fixture.reviewId,
            note: "Decision recorded in the control plane; runtime reconcile may still be pending.",
            lifecycle: {
              decision: {
                reviewId: fixture.reviewId,
                decision: this.lastDecisionBody.decision
              }
            }
          }
        });
      }
      throw new Error(`Unhandled fetch path: ${method} ${pathname}${parsed.search}`);
    }
  };
  return backend;
}

async function settle() {
  for (let index = 0; index < 20; index += 1) {
    await Promise.resolve();
  }
}

async function createClientHarness(options = {}) {
  const document = new FakeDocument();
  const backend = options.backend ?? createBackend(options);
  const storage = new Map(Object.entries(options.storage ?? {}));
  const prompts = [...(options.prompts ?? [])];
  const promptCalls = [];
  const confirmCalls = [];
  const confirmResponses = [...(options.confirms ?? [])];
  const eventSources = [];
  const timers = new Map();
  const intervals = new Map();
  let nextTimerId = 1;
  const windowObject = {
    location: {
      pathname: "/",
      search: options.search ?? "",
      href: "/"
    },
    history: {
      replaceState(_state, _title, url) {
        if (typeof url === "string" && url.startsWith("?")) {
          windowObject.location.search = url;
        } else if (typeof url === "string") {
          windowObject.location.pathname = url;
          windowObject.location.search = "";
        }
      }
    },
    localStorage: {
      getItem(key) {
        return storage.get(key) ?? null;
      },
      setItem(key, value) {
        storage.set(key, String(value));
      },
      removeItem(key) {
        storage.delete(key);
      }
    },
    prompt(label, initialValue) {
      promptCalls.push({ label, initialValue });
      return prompts.length > 0 ? prompts.shift() : initialValue ?? "";
    },
    confirm(message) {
      confirmCalls.push(message);
      return confirmResponses.length > 0 ? confirmResponses.shift() : true;
    }
  };
  const context = vm.createContext({
    window: windowObject,
    document,
    fetch: async (url, request) => backend.handle(url, request),
    EventSource: class extends FakeEventSource {
      constructor(url) {
        super(url);
        eventSources.push(this);
      }
    },
    setTimeout(callback) {
      const id = nextTimerId++;
      timers.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    setInterval(callback) {
      const id = nextTimerId++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    URLSearchParams,
    Date,
    JSON,
    console,
    encodeURIComponent,
    Blob: class FakeBlob {
      constructor(parts, options) {
        this.parts = parts;
        this.type = options?.type ?? "";
      }
    },
    URL: {
      createObjectURL() {
        return "blob:test";
      },
      revokeObjectURL() {}
    }
  });
  vm.runInContext(buildClientAppScript("/api/v1", options.i18n), context);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await settle();
    if (
      document.getElementById("resume-controls").innerHTML.includes("Load diagnostics") &&
      document.getElementById("review-detail").textContent.includes("Decision trail")
    ) {
      break;
    }
  }
  return {
    backend,
    confirmCalls,
    document,
    eventSources,
    window: windowObject,
    promptCalls,
    async flushTimers() {
      while (timers.size > 0) {
        const callbacks = [...timers.values()];
        timers.clear();
        for (const callback of callbacks) {
          await callback();
        }
        await settle();
      }
    }
  };
}

test("visualizer client route helpers round-trip query state", () => {
  const search = buildRouteSearch({
    lifecycle: "operate",
    projectHome: false,
    selectedRunId: "run-123",
    selectedReviewId: "review-1",
    selectedLogRoleId: "alpha",
    logTail: "25",
    logSince: "2026-04-23T10:11"
  });
  assert.equal(
    search,
    "lifecycle=operate&runId=run-123&reviewId=review-1&logRoleId=alpha&tail=25&since=2026-04-23T10%3A11"
  );
  assert.deepEqual(readRouteStateFromSearch(`?${search}`), {
    view: "",
    lifecycle: "operate",
    runId: "run-123",
    reviewId: "review-1",
    logRoleId: "alpha",
    tail: "25",
    since: "2026-04-23T10:11"
  });
  assert.equal(normalizeLifecycleView("build", ""), "build");
  assert.equal(normalizeLifecycleView("", "project"), "project");
  assert.equal(normalizeLifecycleView("", ""), "operate");
});

test("visualizer client stream helpers dedupe timeline entries and cap history", () => {
  const first = appendStreamEntry([{ cursor: 1 }, { cursor: 2 }], { cursor: 2 }, 2);
  assert.deepEqual(first, [{ cursor: 1 }, { cursor: 2 }]);

  const second = appendStreamEntry([{ cursor: 1 }, { cursor: 2 }], { cursor: 3 }, 2);
  assert.deepEqual(second, [{ cursor: 2 }, { cursor: 3 }]);
});

test("visualizer client stream refresh plan keeps review and runtime refreshes targeted", () => {
  assert.deepEqual(getStreamRefreshPlan("human_review_requested"), {
    detailGraph: true,
    reviews: true,
    reviewDetail: true,
    failure: false,
    resumeReadiness: true,
    markDiagnosticsStale: true
  });
  assert.deepEqual(getStreamRefreshPlan("runtime_error"), {
    detailGraph: true,
    reviews: false,
    reviewDetail: false,
    failure: true,
    resumeReadiness: true,
    markDiagnosticsStale: true
  });
  assert.deepEqual(getStreamRefreshPlan("audit"), {
    detailGraph: true,
    reviews: false,
    reviewDetail: false,
    failure: true,
    resumeReadiness: true,
    markDiagnosticsStale: true
  });
});

test("visualizer client formats review decision phase labels", () => {
  assert.equal(formatReviewStatusLabel("pending_reconcile"), "pending reconcile");
  assert.equal(formatReviewStatusLabel("waiting_review"), "waiting review");
  assert.equal(formatReviewStatusLabel("applied"), "applied");
});

test("visualizer client renders zh-CN chrome while preserving runtime identifiers", async () => {
  const harness = await createClientHarness({
    i18n: { locale: "zh-CN" },
    includeMissingAuditContract: true
  });

  assert.match(harness.document.getElementById("console-tabs").textContent, /校验与发布/);
  assert.equal(harness.document.getElementById("action-form-section").hidden, true);
  assert.match(harness.document.getElementById("failure-summary").textContent, /TOOL_EXECUTION_TIMEOUT/);
  assert.match(harness.document.getElementById("failure-summary").textContent, /超时预算耗尽/);
  assert.match(harness.document.getElementById("resume-controls").textContent, /加载诊断/);
  assert.match(harness.document.getElementById("run-list").textContent, /已停止/);
  assert.match(harness.document.getElementById("stats").textContent, /已停止/);
  assert.match(harness.document.getElementById("timeline").textContent, /待处理/);
  assert.match(harness.document.getElementById("project-readiness").textContent, /警告/);
  assert.match(harness.document.getElementById("state").textContent, /执行状态/);
  assert.match(harness.document.getElementById("state").textContent, /总转换次数/);
  assert.match(harness.document.getElementById("state").textContent, /空操作次数/);
  assert.match(harness.document.getElementById("detail").textContent, /指标/);
  assert.match(harness.document.getElementById("detail").textContent, /运行 id/);
  assert.match(harness.document.getElementById("detail").textContent, /系统 id/);
  assert.match(harness.document.getElementById("detail").textContent, /循环迭代/);
  assert.doesNotMatch(harness.document.getElementById("detail").textContent, /metrics\.runId|metrics\.systemId|state\.loopIterations/);

  assert.match(harness.document.getElementById("contract-explain").textContent, /审计/);
  assert.match(harness.document.getElementById("contract-explain").textContent, /schema 不适用 · 状态 缺失/);
  assert.doesNotMatch(harness.document.getElementById("contract-explain").textContent, /schema n\/a|状态 missing/);

  const loadDiagnosticsButton =
    harness.document.getElementById("load-diagnostics") ??
    harness.document.getElementById("resume-controls").children.find((child) => child.id === "load-diagnostics");
  assert.ok(loadDiagnosticsButton);
  await loadDiagnosticsButton.click();
  await settle();
  assert.match(harness.document.getElementById("resume-diagnostics").textContent, /警告/);
  assert.match(harness.document.getElementById("resume-diagnostics").textContent, /需关注/);
  assert.doesNotMatch(harness.document.getElementById("resume-diagnostics").textContent, /\bwarning\b|\battention\b/);
});

test("visualizer client language switch stores locale and refreshes with lang query", async () => {
  const harness = await createClientHarness();

  await harness.document.getElementById("locale-select").change("zh-CN");

  assert.equal(harness.window.localStorage.getItem("ogs.visualizer.lang"), "zh-CN");
  assert.match(harness.window.location.href, /^\//);
  assert.match(harness.window.location.href, /[?&]lang=zh-CN/);
  assert.match(harness.window.location.href, /[?&]runId=run-123/);
});

test("visualizer client redirects stored locale into the URL to keep server shell consistent", async () => {
  const harness = await createClientHarness({
    search: "?view=project",
    storage: {
      "ogs.visualizer.lang": "zh-CN"
    }
  });

  assert.match(harness.window.location.href, /^\//);
  assert.match(harness.window.location.href, /[?&]view=project/);
  assert.match(harness.window.location.href, /[?&]lang=zh-CN/);
});

test("visualizer client keeps diagnostics lazy and renders decision phase detail", async () => {
  const harness = await createClientHarness({
    decisionPhase: "recorded"
  });

  assert.ok(
    harness.document.getElementById("review-detail").textContent.includes("Decision trail")
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-123/failure"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-123/resume-readiness"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-123/resume-diagnostics"),
    false
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path.startsWith("/api/v1/runs/run-123/logs")),
    false
  );
  assert.ok(harness.document.getElementById("graph-view").innerHTML.includes('id="run-graph-root"'));
  assert.match(harness.document.getElementById("failure-summary").textContent, /TOOL_EXECUTION_TIMEOUT/);
  assert.match(harness.document.getElementById("resume-readiness").textContent, /resume blocked/);
  assert.match(harness.document.getElementById("review-detail").textContent, /Decision durability snapshot/);

  const loadDiagnosticsButton =
    harness.document.getElementById("load-diagnostics") ??
    harness.document.getElementById("resume-controls").children.find((child) => child.id === "load-diagnostics");
  assert.ok(loadDiagnosticsButton);
  await loadDiagnosticsButton.click();
  await settle();

  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-123/resume-diagnostics"),
    true
  );
  assert.match(harness.document.getElementById("resume-diagnostics").innerHTML, /Review decisions/);
});

test("visualizer client renders config explain panels and failure next checks", async () => {
  const harness = await createClientHarness();

  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/ops-summary"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/readiness"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/bindings"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/contracts"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/role-packages"),
    true
  );
  assert.match(harness.document.getElementById("binding-explain").textContent, /opencode\/gpt-5-nano/);
  assert.match(harness.document.getElementById("ops-summary").textContent, /TOOL_EXECUTION_TIMEOUT/);
  assert.match(harness.document.getElementById("ops-summary").textContent, /active rework branches/);
  assert.match(harness.document.getElementById("project-readiness").textContent, /dry-run readiness/);
  assert.match(harness.document.getElementById("project-readiness").textContent, /READINESS_STRICT_HANDOFF_CONTRACT_MISSING/);
  assert.match(harness.document.getElementById("role-packages").textContent, /output\.schema\.json/);
  assert.match(harness.document.getElementById("contract-explain").textContent, /flow.answer.done/);
  assert.ok(harness.document.getElementById("failure-check-binding"));
  assert.ok(harness.document.getElementById("failure-check-resume"));
});

test("visualizer client switches lifecycle shell without unloading data and keeps legacy fallback", async () => {
  const harness = await createClientHarness();
  const tabs = harness.document.getElementById("console-tabs").querySelectorAll("[data-console-tab]");
  const operateTab = tabs.find((button) => button.getAttribute("data-console-tab") === "operate");
  const buildTab = tabs.find((button) => button.getAttribute("data-console-tab") === "build");
  const validateTab = tabs.find((button) => button.getAttribute("data-console-tab") === "validate-release");
  const projectTab = tabs.find((button) => button.getAttribute("data-console-tab") === "project");
  const legacyTab = tabs.find((button) => button.getAttribute("data-console-tab") === "legacy");

  assert.ok(operateTab);
  assert.ok(buildTab);
  assert.ok(validateTab);
  assert.ok(projectTab);
  assert.ok(legacyTab);
  assert.equal(harness.document.getElementById("console-panel-debug").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-ops").hidden, false);
  assert.equal(harness.document.body.classList.classes.has("show-run-sidebar"), true);
  assert.equal(harness.document.getElementById("sidebar-toggle").hidden, false);

  await operateTab.click();
  assert.equal(harness.document.getElementById("console-panel-debug").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-ops").hidden, false);
  assert.equal(harness.document.body.classList.classes.has("show-run-sidebar"), true);
  assert.equal(harness.document.getElementById("sidebar-toggle").hidden, false);
  assert.match(harness.document.getElementById("ops-summary").textContent, /TOOL_EXECUTION_TIMEOUT/);

  await buildTab.click();
  assert.equal(harness.document.getElementById("console-panel-build").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-project").hidden, true);
  assert.equal(harness.document.getElementById("console-panel-config").hidden, false);
  assert.equal(harness.document.body.classList.classes.has("show-run-sidebar"), false);
  assert.equal(harness.document.body.classList.classes.has("drawer-open"), false);
  assert.equal(harness.document.getElementById("sidebar-toggle").hidden, true);
  assert.match(harness.document.getElementById("contract-explain").textContent, /flow.answer.done/);

  await validateTab.click();
  assert.equal(harness.document.getElementById("console-panel-validate-release").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-config").hidden, false);
  assert.match(harness.document.getElementById("release-gate").textContent, /release candidate/);

  await projectTab.click();
  assert.equal(harness.document.getElementById("console-panel-config").hidden, true);
  assert.equal(harness.document.getElementById("console-panel-project").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-build").hidden, true);
  assert.equal(harness.document.body.classList.classes.has("show-run-sidebar"), false);
  assert.equal(harness.document.getElementById("sidebar-toggle").hidden, true);
  assert.match(harness.document.getElementById("project-readiness").textContent, /dry-run readiness/);

  await legacyTab.click();
  const legacyButtons = harness.document.getElementById("console-tabs").querySelectorAll("[data-legacy-console-tab]");
  const legacyLogs = legacyButtons.find((button) => button.getAttribute("data-legacy-console-tab") === "logs");
  assert.ok(legacyLogs);
  await legacyLogs.click();
  assert.equal(harness.document.getElementById("console-panel-logs").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-project").hidden, true);
  assert.equal(harness.document.body.classList.classes.has("show-run-sidebar"), true);
  assert.equal(harness.document.getElementById("sidebar-toggle").hidden, false);
});

test("visualizer client keeps build deep links on the project graph workspace", async () => {
  const harness = await createClientHarness({ search: "?lifecycle=build" });

  assert.equal(harness.document.getElementById("console-panel-build").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-project").hidden, true);
  assert.equal(harness.document.getElementById("console-panel-config").hidden, false);
  assert.equal(harness.document.getElementById("console-panel-debug").hidden, true);
  assert.match(harness.window.location.search, /[?&]lifecycle=build/);
  assert.doesNotMatch(harness.window.location.search, /[?&]runId=/);
});

test("visualizer client loads logs on demand and keeps filter changes lazy until loaded", async () => {
  const harness = await createClientHarness();

  const logCallsBefore = harness.backend.fetchCalls.filter((call) => call.path.startsWith("/api/v1/runs/run-123/logs")).length;
  assert.equal(logCallsBefore, 0);
  assert.match(harness.document.getElementById("logs").textContent, /Logs load on demand/);

  await harness.document.getElementById("log-tail").change("25");
  await settle();

  const logCallsAfterFilterOnly = harness.backend.fetchCalls.filter((call) => call.path.startsWith("/api/v1/runs/run-123/logs")).length;
  assert.equal(logCallsAfterFilterOnly, 0);

  const loadLogsButton = harness.document.getElementById("load-logs");
  assert.ok(loadLogsButton);
  await loadLogsButton.click();
  await settle();

  const logCallsAfterLoad = harness.backend.fetchCalls.filter((call) => call.path.startsWith("/api/v1/runs/run-123/logs")).length;
  assert.equal(logCallsAfterLoad, 3);
  assert.ok(
    harness.backend.fetchCalls.some((call) =>
      call.path.startsWith("/api/v1/runs/run-123/logs") && call.path.includes("tail=25")
    )
  );
  assert.match(harness.document.getElementById("logs").textContent, /combined log stream/);
});

test("visualizer client refreshes failure panels when switching runs", async () => {
  const harness = await createClientHarness({
    backend: createBackend({ includeSecondRun: true })
  });

  const runButtons = harness.document.getElementById("run-list").querySelectorAll("[data-run-id]");
  const secondRunButton = runButtons.find((button) => button.getAttribute("data-run-id") === "run-456");
  assert.ok(secondRunButton);

  await secondRunButton.click();
  await settle();

  assert.match(harness.document.getElementById("selected-title").textContent, /run-456/);
  assert.match(harness.document.getElementById("failure-summary").textContent, /CONTRACT_VIOLATION/);
  assert.match(harness.document.getElementById("failure-detail").textContent, /citation-engineer/);
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-456/failure"),
    true
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-456/resume-readiness"),
    true
  );
});

test("visualizer client review action captures audit input, disables controls while busy, and flashes success", async () => {
  const decisionDeferred = createDeferred();
  const harness = await createClientHarness({
    backend: createBackend({ decisionDeferred })
  });

  const approveButton = harness.document
    .getElementById("review-actions")
    .querySelectorAll("[data-review-action]")
    .find((button) => button.getAttribute("data-review-action") === "approve");
  assert.ok(approveButton);

  await approveButton.click();
  await settle();

  const actorInput = harness.document.getElementById("action-review-actor");
  const commentInput = harness.document.getElementById("action-review-comment");
  const submitButton = harness.document.getElementById("action-form-submit");
  assert.ok(actorInput);
  assert.ok(commentInput);
  assert.ok(submitButton);

  await actorInput.input("operator-a");
  await commentInput.input("looks good");

  const pendingClick = submitButton.click();
  await settle();

  assert.equal(harness.document.getElementById("project-home").disabled, true);
  assert.equal(harness.promptCalls.length, 0);
  assert.equal(harness.confirmCalls.length, 0);

  decisionDeferred.resolve();
  await pendingClick;
  await settle();

  assert.deepEqual(harness.backend.lastDecisionBody, {
    decision: "approve",
    actor: "operator-a",
    comment: "looks good"
  });
  assert.equal(
    harness.document.getElementById("flash").textContent,
    "Review action recorded for review-1: human-review-approved. Decision recorded in the control plane; runtime reconcile may still be pending."
  );
  assert.ok(
    harness.document.getElementById("review-detail").textContent.includes("recorded")
  );
});

test("visualizer client action failures stay local and show an error flash", async () => {
  const harness = await createClientHarness({
    backend: createBackend({ failDecision: true })
  });

  const approveButton = harness.document
    .getElementById("review-actions")
    .querySelectorAll("[data-review-action]")
    .find((button) => button.getAttribute("data-review-action") === "approve");
  assert.ok(approveButton);

  await approveButton.click();
  await settle();
  await harness.document.getElementById("action-review-actor").input("operator-a");
  await harness.document.getElementById("action-review-comment").input("retry later");
  await harness.document.getElementById("action-form-submit").click();
  await settle();

  assert.match(harness.document.getElementById("flash").textContent, /500 Internal Server Error/);
  assert.ok(
    harness.document.getElementById("review-detail").textContent.includes("pending")
  );
});

test("visualizer client resumes and stops runs through inline forms", async () => {
  const harness = await createClientHarness({
    backend: createBackend({ runStatus: "running" })
  });

  await harness.document.getElementById("resume-run").click();
  await settle();
  await harness.document.getElementById("action-resume-input").input("resume with operator note");
  await harness.document.getElementById("action-form-submit").click();
  await settle();

  assert.deepEqual(harness.backend.lastResumeBody, {
    systemPath: "system.mmd",
    input: "resume with operator note",
    dryRun: false
  });
  assert.equal(harness.promptCalls.length, 0);
  assert.equal(harness.confirmCalls.length, 0);

  await harness.document.getElementById("stop-run").click();
  await settle();
  await harness.document.getElementById("action-stop-reason").input("operator stop");
  await harness.document.getElementById("action-form-submit").click();
  await settle();

  assert.deepEqual(harness.backend.lastStopBody, {
    reason: "operator stop"
  });
  assert.match(harness.document.getElementById("flash").textContent, /Stop request recorded/);
});

test("visualizer client appends SSE timeline entries and refreshes only targeted panels", async () => {
  const harness = await createClientHarness({
    decisionPhase: "recorded"
  });

  const loadDiagnosticsButton =
    harness.document.getElementById("load-diagnostics") ??
    harness.document.getElementById("resume-controls").children.find((child) => child.id === "load-diagnostics");
  await loadDiagnosticsButton.click();
  await settle();

  const logCallsBefore = harness.backend.fetchCalls.filter((call) => call.path.startsWith("/api/v1/runs/run-123/logs")).length;
  const detailCallsBefore = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123").length;
  const reviewCallsBefore = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123/reviews").length;
  const failureCallsBefore = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123/failure").length;
  const readinessCallsBefore = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123/resume-readiness").length;

  const stream = harness.eventSources.at(-1);
  assert.ok(stream);
  stream.emit({
    cursor: 2,
    record: {
      type: "human_review_requested",
      at: "2026-04-23T09:16:00.000Z",
      reviewId: "review-1",
      roleId: "demo-analyst",
      status: "pending"
    }
  });
  await harness.flushTimers();

  const logCallsAfter = harness.backend.fetchCalls.filter((call) => call.path.startsWith("/api/v1/runs/run-123/logs")).length;
  const detailCallsAfter = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123").length;
  const reviewCallsAfter = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123/reviews").length;
  const failureCallsAfter = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123/failure").length;
  const readinessCallsAfter = harness.backend.fetchCalls.filter((call) => call.path === "/api/v1/runs/run-123/resume-readiness").length;

  assert.ok(harness.document.getElementById("timeline").innerHTML.includes("#2"));
  assert.ok(harness.document.getElementById("resume-controls").textContent.includes("diagnostics stale"));
  assert.ok(harness.document.getElementById("failure-summary").textContent.includes("TOOL_EXECUTION_TIMEOUT"));
  assert.ok(harness.document.getElementById("resume-readiness").textContent.includes("resume blocked"));
  assert.equal(logCallsAfter, logCallsBefore);
  assert.ok(detailCallsAfter > detailCallsBefore);
  assert.ok(reviewCallsAfter > reviewCallsBefore);
  assert.equal(failureCallsAfter, failureCallsBefore);
  assert.ok(readinessCallsAfter > readinessCallsBefore);
});

test("visualizer client keeps the workbench editor visible with source intact during validation", async () => {
  const harness = await createClientHarness();

  const sourceTab = harness.document.getElementById("workbench-tabs")
    .querySelectorAll("[data-workbench-view=\"source\"]")[0];
  assert.ok(sourceTab);
  await sourceTab.click();
  await settle();

  const newDraftButton = harness.document.getElementById("workbench-new-draft");
  assert.ok(newDraftButton);
  await newDraftButton.click();
  await settle();

  const editor = harness.document.getElementById("workbench-editor");
  assert.ok(editor);

  await editor.input(
    [
      "flowchart TD",
      "%% system.id=viz.review.demo",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=demo-analyst",
      "input -->|GO| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|DONE| output",
      ""
    ].join("\n")
  );
  await harness.flushTimers();

  const editorAfter = harness.document.getElementById("workbench-editor");
  assert.ok(editorAfter);
  assert.equal(editorAfter.value, editor.value);
});

test("visualizer client applies timeline filters through the events API", async () => {
  const harness = await createClientHarness();

  const roleSelect = harness.document.getElementById("timeline-role");
  const typeInput = harness.document.getElementById("timeline-type");
  const applyButton = harness.document.getElementById("timeline-apply");

  assert.ok(roleSelect);
  assert.ok(typeInput);
  assert.ok(applyButton);

  await roleSelect.change("demo-analyst");
  await typeInput.input("human_review_requested");
  await applyButton.click();
  await settle();

  assert.ok(
    harness.backend.fetchCalls.some((call) =>
      call.path.includes("/api/v1/runs/run-123/events?") &&
      call.path.includes("roleId=demo-analyst") &&
      call.path.includes("type=human_review_requested")
    )
  );
  assert.ok(harness.document.getElementById("timeline").innerHTML.includes("filtered by"));
  assert.ok(!harness.document.getElementById("timeline").innerHTML.includes("runtime_error"));
});

test("visualizer client edits the Mermaid workbench, saves, and starts a run", async () => {
  const harness = await createClientHarness({ readinessCanDryRun: true });

  const sourceTab = harness.document.getElementById("workbench-tabs")
    .querySelectorAll("[data-workbench-view=\"source\"]")[0];
  assert.ok(sourceTab);
  await sourceTab.click();
  await settle();

  const newDraftButton = harness.document.getElementById("workbench-new-draft");
  assert.ok(newDraftButton);
  await newDraftButton.click();
  await settle();

  const editor = harness.document.getElementById("workbench-editor");
  assert.ok(editor);
  await editor.input(
    [
      "flowchart TD",
      "%% system.id=viz.review.demo",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=demo-analyst",
      "input -->|GO| analyst[Role:demo-analyst]",
      "analyst[Role:demo-analyst] -->|DONE| output",
      ""
    ].join("\n")
  );
  await harness.flushTimers();

  assert.ok(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/system/validate")
  );

  const saveButton = harness.document.getElementById("workbench-save");
  assert.ok(saveButton);
  await saveButton.click();
  await settle();

  assert.ok(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/system/save")
  );

  const startRunButton = harness.document.getElementById("start-run");
  assert.ok(startRunButton);
  await startRunButton.click();
  await settle();
  await harness.document.getElementById("action-start-input").input("ship a smoke test");
  await harness.document.getElementById("action-form-submit").click();
  await settle();

  assert.ok(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/start"));
  assert.equal(harness.backend.lastStartBody.systemPath, "system.mmd");
  assert.equal(harness.backend.lastStartBody.input, "ship a smoke test");
  assert.equal(harness.promptCalls.length, 0);
  assert.equal(harness.document.getElementById("flash").textContent, "Start completed for run-123 (done).");
});

test("visualizer client opens Studio Bridge, saves an authoring draft, and dry-runs into run detail", async () => {
  const harness = await createClientHarness({ readinessCanDryRun: true });
  const mountCalls = [];
  harness.window.OGSVisualizerClient.mountStudioX6Bridge = (root, options) => {
    mountCalls.push({ root, options });
  };
  const latestEditableMount = () =>
    mountCalls.findLast((call) => typeof call.options.onApplyCanvas === "function")?.options;

  const bridgeTab = harness.document.getElementById("workbench-tabs")
    .querySelectorAll("[data-workbench-view=\"bridge\"]")[0];
  assert.ok(bridgeTab);
  await bridgeTab.click();
  await settle();

  assert.ok(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/studio/bridge"));
  assert.match(harness.document.getElementById("workbench-tabs").textContent, /Studio Bridge/);
  assert.doesNotMatch(harness.document.getElementById("workbench-tabs").textContent, /Rendered|Structure/);
  assert.match(harness.document.getElementById("workbench-body").textContent, /demo-analyst/);
  assert.match(harness.document.getElementById("workbench-body").textContent, /role inspector/);
  assert.match(harness.document.getElementById("workbench-body").textContent, /Graph workspace/);
  assert.match(harness.document.getElementById("workbench-body").textContent, /graph index/);
  assert.doesNotMatch(harness.document.getElementById("workbench-body").textContent, /\bX6\b/);
  assert.ok(harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-bridge-filter]").length);
  assert.ok(harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-bridge-list-mode]").length);
  assert.ok(harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-bridge-fullscreen]").length);
  assert.ok(harness.document.getElementById("studio-graph-root"));
  assert.equal(mountCalls.length > 0, true);
  assert.ok(latestEditableMount().rolePackages);
  assert.ok(latestEditableMount().readiness);
  assert.ok(latestEditableMount().bindings);
  assert.ok(latestEditableMount().projectConfig);
  assert.ok(latestEditableMount().commandFormLabels);
  assert.equal(latestEditableMount().defaultAutoLayout, true);
  await settle();
  const fetchCallsAfterOpen = harness.backend.fetchCalls.length;
  mountCalls.at(-1).options.onSelectFlow("demo-analyst:DONE:output");
  await settle();
  assert.equal(harness.backend.fetchCalls.length, fetchCallsAfterOpen);
  mountCalls.at(-1).options.onClearSelection();
  await settle();
  assert.equal(harness.backend.fetchCalls.length, fetchCallsAfterOpen);
  const fullscreenButton = harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-bridge-fullscreen]")[0];
  assert.ok(fullscreenButton);
  await fullscreenButton.click();
  await settle();
  assert.match(harness.document.getElementById("workbench-body").innerHTML, /studio-canvas-shell is-fullscreen/);
  const filterInput = harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-bridge-filter]")[0];
  assert.ok(filterInput);
  await filterInput.input("missing-role");
  await settle();
  assert.match(harness.document.getElementById("workbench-body").textContent, /No matching graph items/);
  for (const oldButtonId of [
    "studio-bridge-add-role",
    "studio-bridge-add-edge",
    "studio-bridge-delete-role",
    "studio-bridge-fit",
    "studio-bridge-nudge-left",
    "studio-bridge-nudge-right",
    "studio-bridge-save-draft",
    "studio-bridge-generate",
    "workbench-save-as"
  ]) {
    assert.equal(harness.document.getElementById(oldButtonId), null);
  }

  mountCalls.length = 0;
  harness.window.OGSVisualizerClient.mountStudioX6Bridge = (root, options) => {
    mountCalls.push({ root, options });
  };
  const operateTab = harness.document.getElementById("console-tabs")
    .querySelectorAll("[data-console-tab]")
    .find((button) => button.getAttribute("data-console-tab") === "operate");
  assert.ok(operateTab);
  await operateTab.click();
  await settle();
  const runButton = harness.document.getElementById("run-list")
    .querySelectorAll("[data-run-id]")
    .find((button) => button.getAttribute("data-run-id") === "run-123");
  assert.ok(runButton);
  await runButton.click();
  await settle();
  const readonlyMount = mountCalls.find((call) => call.root.id === "run-graph-root");
  assert.ok(readonlyMount);
  assert.equal(readonlyMount.options.readOnly, true);
  assert.equal(readonlyMount.options.onApplyCanvas, undefined);
  assert.equal(readonlyMount.options.onApplyCommand, undefined);
  assert.doesNotMatch(harness.document.getElementById("graph-view").textContent, /\bX6\b/);
  await harness.document.getElementById("project-home").click();
  await settle();
  const resetFilterInput = harness.document.getElementById("workbench-body").querySelectorAll("[data-studio-bridge-filter]")[0];
  if (resetFilterInput) {
    await resetFilterInput.input("");
    await settle();
  }
  await bridgeTab.click();
  await settle();

  let latestMount = latestEditableMount();
  assert.ok(latestMount);
  await latestMount.onApplyCanvas({
    ...latestMount.canvas,
    nodes: latestMount.canvas.nodes.map((node) =>
      node.roleId === "demo-analyst" ? { ...node, x: 160 } : node
    )
  });
  await settle();
  assert.ok(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/project/studio/authoring/apply-canvas"));
  assert.equal(harness.backend.lastAuthoringApplyCanvasBody.canvas.nodes[0].x, 160);
  assert.match(harness.document.getElementById("flash").textContent, /Studio canvas layout updated/);

  latestMount = latestEditableMount();
  assert.ok(latestMount);
  const addRoleAuthoring = cloneJson(latestMount.authoring);
  const addRoleCanvas = cloneJson(latestMount.canvas);
  addRoleAuthoring.roles["new-role"] = { roleId: "new-role", title: "New role", bindingKind: "noop" };
  addRoleAuthoring.layout.nodes["new-role"] = { x: 380, y: 120, width: 180, height: 84 };
  addRoleCanvas.nodes.push({
    id: "new-role",
    roleId: "new-role",
    x: 380,
    y: 120,
    width: 180,
    height: 84,
    label: "New role",
    badges: [],
    bindingKind: "noop"
  });
  await latestMount.onApplyCommand({
    authoring: addRoleAuthoring,
    canvas: addRoleCanvas,
    selectedRoleId: "new-role",
    profileDrafts: [{ profileId: "profile.new-role", toolRef: "tool.review", timeoutMs: 30000 }]
  });
  await settle();
  assert.equal(harness.backend.lastProfilesUpsertBody.profiles[0].profileId, "profile.new-role");
  assert.equal(harness.backend.lastAuthoringApplyCanvasBody.authoring.roles["new-role"].bindingKind, "noop");
  assert.equal(
    harness.backend.lastAuthoringApplyCanvasBody.canvas.nodes.some((node) => node.roleId === "new-role"),
    true
  );

  latestMount = latestEditableMount();
  assert.ok(latestMount);
  const addEdgeAuthoring = cloneJson(latestMount.authoring);
  const addEdgeCanvas = cloneJson(latestMount.canvas);
  addEdgeAuthoring.flows["2:new-role:DONE:output"] = {
    flowId: "2:new-role:DONE:output",
    fromRoleId: "new-role",
    toRoleId: "__system_end__",
    eventType: "DONE"
  };
  addEdgeCanvas.edges.push({
    id: "2:new-role:DONE:output",
    source: "new-role",
    target: "__system_end__",
    label: "DONE",
    eventType: "DONE",
    runtimeOnlyErrorFlow: false,
    participatesInJoin: false
  });
  await latestMount.onApplyCommand({
    authoring: addEdgeAuthoring,
    canvas: addEdgeCanvas,
    selectedFlowKey: "new-role:DONE:output"
  });
  await settle();
  assert.equal(
    harness.backend.lastAuthoringApplyCanvasBody.canvas.edges.some((edge) => edge.source === "new-role" && edge.target === "__system_end__"),
    true
  );

  const dryRunButton = harness.document.getElementById("studio-bridge-dry-run");
  assert.ok(dryRunButton);
  await dryRunButton.click();
  await settle();
  await harness.document.getElementById("action-start-input").input("bridge smoke");
  await harness.document.getElementById("action-form-submit").click();
  await settle();

  assert.ok(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/start"));
  assert.equal(harness.backend.lastStartBody.dryRun, true);
  assert.equal(harness.backend.lastStartBody.systemPath, "system.mmd");
  assert.match(harness.document.getElementById("selected-title").textContent, /run-123/);
});

test("visualizer client loads projects and reindexes through inline forms", async () => {
  const harness = await createClientHarness();

  const projectLoadButton = harness.document.getElementById("project-load");
  assert.ok(projectLoadButton);
  await projectLoadButton.click();
  await settle();
  await harness.document.getElementById("action-project-workdir").input("/tmp/other-project");
  await harness.document.getElementById("action-form-submit").click();
  await settle();

  assert.deepEqual(harness.backend.lastProjectLoadBody, { workdir: "/tmp/other-project" });

  const reindexButton = harness.document.getElementById("reindex");
  assert.ok(reindexButton);
  await reindexButton.click();
  await settle();
  await harness.document.getElementById("action-form-submit").click();
  await settle();

  assert.ok(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/reindex"));
  assert.equal(harness.promptCalls.length, 0);
  assert.equal(harness.confirmCalls.length, 0);
});
