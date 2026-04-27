import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

import {
  appendStreamEntry,
  buildClientAppScript,
  buildRouteSearch,
  formatReviewStatusLabel,
  getStreamRefreshPlan,
  readRouteStateFromSearch
} from "../dist/visualizer/client-app.js";

const PAGE_ELEMENT_IDS = [
  "run-list",
  "search",
  "flash",
  "selected-title",
  "selected-subtitle",
  "workdir",
  "workbench-meta",
  "workbench-status",
  "workbench-actions",
  "workbench-tabs",
  "workbench-body",
  "project-summary",
  "stats",
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
  "resume-diagnostics",
  "resume-controls",
  "logs-filters",
  "logs",
  "detail",
  "live",
  "log-role",
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
  "refresh"
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
  if (selector === "[data-run-id]") {
    return Object.hasOwn(element.attributes, "data-run-id");
  }
  if (selector === "[data-review-id]") {
    return Object.hasOwn(element.attributes, "data-review-id");
  }
  if (selector === "[data-review-action]") {
    return Object.hasOwn(element.attributes, "data-review-action");
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
    const matcher = /<(button|input|select|option|textarea)\b([^>]*)>/g;
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

function createBackend(options = {}) {
  const runId = "run-123";
  const reviewId = "review-1";
  const decisionPhase = options.decisionPhase;
  const reviewBase = {
    reviewId,
    currentStatus: "pending",
    decisionPhase,
    roleId: "demo-analyst",
    branchId: "demo-analyst@1#1",
    branchStatus: "waiting_review",
    round: 1,
    requestedAt: "2026-04-23T09:15:00.000Z",
    decision: decisionPhase ? "approve" : undefined,
    actor: decisionPhase ? "qa" : undefined,
    comment: decisionPhase ? "ship it" : undefined,
    scope: "branch",
    decidedAt: decisionPhase ? "2026-04-23T09:15:01.000Z" : undefined,
    committedAt: decisionPhase ? "2026-04-23T09:15:01.000Z" : undefined,
    checkpointSequence: decisionPhase === "pending_reconcile" || decisionPhase === "applied" ? 7 : undefined,
    appliedAt:
      decisionPhase === "pending_reconcile" || decisionPhase === "applied"
        ? "2026-04-23T09:15:02.000Z"
        : undefined,
    reconciledAt: decisionPhase === "applied" ? "2026-04-23T09:15:03.000Z" : undefined
  };
  const detail = {
    runId,
    runDir: `/tmp/${runId}`,
    header: {
      runId,
      runDir: `/tmp/${runId}`,
      status: "stopped",
      transitionCount: 1,
      finalRoleId: "",
      lastExecutedRoleId: "demo-analyst",
      updatedAt: "2026-04-23T09:15:01.000Z",
      activeBranches: 0,
      pendingReviewCount: 1,
      hasWaitingHumanReview: true,
      recentAudits: 1,
      systemSource: null,
      isSimulation: false,
      runMode: "runtime"
    },
    state: { status: "stopped" },
    metrics: null,
    resolvedConfig: null,
    stopRequest: null,
    stopOutcome: null,
    summary: null,
    systemSource: "flowchart TD"
  };
  const graph = {
    simulation: { mode: "runtime" },
    graph: {
      systemId: "viz.review.demo",
      entryRoleId: "demo-analyst",
      roleCount: 1,
      flowCount: 1,
      nodes: [
        {
          roleId: "demo-analyst",
          nodeType: "role",
          status: "waiting_review",
          bindingKind: "model",
          activeBranchCount: 0,
          waitingReviewCount: 1,
          loopIteration: 1,
          lastErrorCode: "",
          missingSources: []
        }
      ],
      edges: []
    }
  };
  const backend = {
    runId,
    reviewId,
    review: cloneJson(reviewBase),
    reviewDetail: {
      ...cloneJson(reviewBase),
      runId,
      runDir: `/tmp/${runId}`,
      executionId: "exec-1",
      requestedByExecutionId: "exec-1",
      selectedEvent: "DONE",
      spec: { terminateScope: "branch" },
      history: [],
      humanReviewContext: { comment: "ship it" }
    },
    lastDecisionBody: null,
    decisionDeferred: options.decisionDeferred ?? null,
    fetchCalls: [],
    async handle(url, request = {}) {
      const parsed = new URL(url, "http://visualizer.test");
      const pathname = parsed.pathname;
      const method = request.method ?? "GET";
      this.fetchCalls.push({ method, path: `${pathname}${parsed.search}`, body: request.body ?? null });
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
        return createResponse({
          savedPath: body.saveAsPath ? `/tmp/demo/${body.saveAsPath}` : "/tmp/demo/system.mmd",
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
          followUpActions: [{ action: "refresh-project-summary", label: "Reload project and graph views to reflect the saved system." }]
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
        return createResponse({ modelSelectionWarnings: [] });
      }
      if (pathname === "/api/v1/project/roles") {
        return createResponse({ roles: [{ roleId: "demo-analyst", binding: { bindingKind: "model" }, review: {} }] });
      }
      if (pathname === "/api/v1/runs") {
        return createResponse({
          runs: [
            {
              runId,
              runDir: `/tmp/${runId}`,
              status: "stopped",
              transitionCount: 1,
              lastExecutedRoleId: "demo-analyst",
              updatedAt: "2026-04-23T09:15:01.000Z",
              pendingReviewCount: 1,
              hasWaitingHumanReview: true
            }
          ]
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
      if (pathname === `/api/v1/runs/${runId}`) {
        return createResponse(detail);
      }
      if (pathname === `/api/v1/runs/${runId}/events`) {
        const events = [
          {
            cursor: 0,
            record: {
              type: "human_review_requested",
              at: "2026-04-23T09:15:00.000Z",
              reviewId,
              roleId: "demo-analyst",
              status: "pending",
              branchId: "demo-analyst@1#1"
            }
          },
          {
            cursor: 1,
            record: {
              type: "runtime_error",
              at: "2026-04-23T09:15:30.000Z",
              roleId: "qa",
              errorCode: "E_DEMO"
            }
          }
        ];
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
      if (pathname === `/api/v1/runs/${runId}/graph`) {
        return createResponse(graph);
      }
      if (pathname === `/api/v1/runs/${runId}/reviews`) {
        return createResponse({
          latestPendingReviewId: reviewId,
          reviews: [cloneJson(this.review)]
        });
      }
      if (pathname === `/api/v1/runs/${runId}/reviews/${reviewId}`) {
        return createResponse(cloneJson(this.reviewDetail));
      }
      if (pathname === `/api/v1/runs/${runId}/resume-diagnostics`) {
        return createResponse({
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
          recommendations: []
        });
      }
      if (pathname === `/api/v1/runs/${runId}/resume` && method === "POST") {
        this.lastResumeBody = JSON.parse(request.body ?? "{}");
        return createResponse({
          runId,
          status: "done",
          resultSummary: {
            systemId: "viz.review.demo",
            transitionCount: 2
          },
          followUpActions: [{ action: "open-run-detail", label: "Open run." }]
        });
      }
      if (pathname === `/api/v1/runs/${runId}/logs`) {
        return createResponse({
          records: [{ at: "2026-04-23T09:15:00.000Z", message: parsed.search || "log" }]
        });
      }
      if (pathname === `/api/v1/runs/${runId}/reviews/${reviewId}/decide` && method === "POST") {
        this.lastDecisionBody = JSON.parse(request.body ?? "{}");
        if (options.failDecision) {
          return createResponse({ error: "boom" }, 500, "Internal Server Error");
        }
        if (this.decisionDeferred) {
          await this.decisionDeferred.promise;
        }
        this.review = {
          ...this.review,
          decision: this.lastDecisionBody.decision,
          actor: this.lastDecisionBody.actor,
          comment: this.lastDecisionBody.comment,
          decisionPhase: "recorded"
        };
        this.reviewDetail = {
          ...this.reviewDetail,
          decision: this.lastDecisionBody.decision,
          actor: this.lastDecisionBody.actor,
          comment: this.lastDecisionBody.comment,
          decisionPhase: "recorded",
          decidedAt: "2026-04-23T09:15:05.000Z",
          committedAt: "2026-04-23T09:15:05.000Z"
        };
        return createResponse({
          runId,
          action: "review:" + this.lastDecisionBody.decision,
          accepted: true,
          semanticStatus: this.lastDecisionBody.decision === "pause" ? "human-review-paused" : "human-review-approved",
          detail: {
            reviewId,
            note: "Decision recorded in the control plane; runtime reconcile may still be pending.",
            lifecycle: {
              decision: {
                reviewId,
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
  const storage = new Map();
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
      search: options.search ?? ""
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
  vm.runInContext(buildClientAppScript("/api/v1"), context);
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await settle();
    if (
      document.getElementById("resume-controls").innerHTML.includes("Load diagnostics") &&
      document.getElementById("review-detail").textContent.includes("decisionPhase:")
    ) {
      break;
    }
  }
  return {
    backend,
    confirmCalls,
    document,
    eventSources,
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
    projectHome: false,
    selectedRunId: "run-123",
    selectedReviewId: "review-1",
    selectedLogRoleId: "alpha",
    logTail: "25",
    logSince: "2026-04-23T10:11"
  });
  assert.equal(
    search,
    "runId=run-123&reviewId=review-1&logRoleId=alpha&tail=25&since=2026-04-23T10%3A11"
  );
  assert.deepEqual(readRouteStateFromSearch(`?${search}`), {
    view: "",
    runId: "run-123",
    reviewId: "review-1",
    logRoleId: "alpha",
    tail: "25",
    since: "2026-04-23T10:11"
  });
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
    markDiagnosticsStale: true
  });
  assert.deepEqual(getStreamRefreshPlan("runtime_error"), {
    detailGraph: true,
    reviews: false,
    reviewDetail: false,
    markDiagnosticsStale: true
  });
  assert.deepEqual(getStreamRefreshPlan("audit"), {
    detailGraph: true,
    reviews: false,
    reviewDetail: false,
    markDiagnosticsStale: true
  });
});

test("visualizer client formats review decision phase labels", () => {
  assert.equal(formatReviewStatusLabel("pending_reconcile"), "pending reconcile");
  assert.equal(formatReviewStatusLabel("waiting_review"), "waiting review");
  assert.equal(formatReviewStatusLabel("applied"), "applied");
});

test("visualizer client keeps diagnostics lazy and renders decision phase detail", async () => {
  const harness = await createClientHarness({
    decisionPhase: "recorded"
  });

  assert.ok(
    harness.document.getElementById("review-detail").textContent.includes("decisionPhase: recorded")
  );
  assert.equal(
    harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/run-123/resume-diagnostics"),
    false
  );

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

test("visualizer client review action captures audit input, disables controls while busy, and flashes success", async () => {
  const decisionDeferred = createDeferred();
  const harness = await createClientHarness({
    backend: createBackend({ decisionDeferred }),
    prompts: ["operator-a", "looks good"],
    confirms: [true]
  });

  const approveButton = harness.document
    .getElementById("review-actions")
    .querySelectorAll("[data-review-action]")
    .find((button) => button.getAttribute("data-review-action") === "approve");
  assert.ok(approveButton);

  const pendingClick = approveButton.click();
  await settle();

  assert.equal(approveButton.disabled, true);
  assert.equal(harness.document.getElementById("project-home").disabled, true);
  assert.deepEqual(harness.promptCalls.map((call) => call.label), ["Actor", "Comment"]);
  assert.equal(harness.confirmCalls[0], 'Record review decision "approve" for review-1?');

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
    harness.document.getElementById("review-detail").textContent.includes("decisionPhase: recorded")
  );
});

test("visualizer client action failures stay local and show an error flash", async () => {
  const harness = await createClientHarness({
    backend: createBackend({ failDecision: true }),
    prompts: ["operator-a", "retry later"],
    confirms: [true]
  });

  const approveButton = harness.document
    .getElementById("review-actions")
    .querySelectorAll("[data-review-action]")
    .find((button) => button.getAttribute("data-review-action") === "approve");
  assert.ok(approveButton);

  await approveButton.click();
  await settle();

  assert.match(harness.document.getElementById("flash").textContent, /500 Internal Server Error/);
  assert.ok(
    harness.document.getElementById("review-detail").textContent.includes("decisionPhase: none")
  );
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

  assert.ok(harness.document.getElementById("timeline").innerHTML.includes("#2"));
  assert.ok(harness.document.getElementById("resume-controls").textContent.includes("diagnostics stale"));
  assert.equal(logCallsAfter, logCallsBefore);
  assert.ok(detailCallsAfter > detailCallsBefore);
  assert.ok(reviewCallsAfter > reviewCallsBefore);
});

test("visualizer client keeps the workbench editor visible with source intact during validation", async () => {
  const harness = await createClientHarness();

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
  const harness = await createClientHarness({
    prompts: ["system.mmd", "ship a smoke test", "yes", "", "", ""]
  });

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

  assert.ok(harness.backend.fetchCalls.some((call) => call.path === "/api/v1/runs/start"));
  assert.equal(harness.backend.lastStartBody.systemPath, "system.mmd");
  assert.equal(harness.backend.lastStartBody.input, "ship a smoke test");
  assert.equal(harness.document.getElementById("flash").textContent, "Start completed for run-123 (done).");
});
