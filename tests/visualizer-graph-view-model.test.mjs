import test from "node:test";
import assert from "node:assert/strict";

import { buildGraphViewModel } from "../dist/visualizer/graph-view-model.js";
import { importMermaidToAuthoring } from "../dist/visualizer/studio-authoring.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import {
  formatStudioEdgeLabel
} from "../dist/visualizer/studio-edge-semantics.js";

const source = [
  "flowchart TD",
  "%% system.id=test.graph.view.model",
  "%% system.version=1.0.0",
  "%% law.global=law.minimal.base",
  "%% entry.role=dispatch",
  "%% model.bind.dispatch=model.fast",
  "%% exec.bind.review=profile.review",
  "%% role.mode.dispatch=parallel_split",
  "%% route.order.dispatch=worker,review",
  "%% join.mode.review=all_of",
  "%% join.sources.review=worker,dispatch",
  "%% loop.max.worker=3",
  "%% review.mode.review=required",
  "input -->|START| a[Role:dispatch]",
  "a[Role:dispatch] -->|WORK| b[Role:worker]",
  "a[Role:dispatch] -->|REVIEW| c[Role:review]",
  "b[Role:worker] -->|DONE| c[Role:review]",
  "c[Role:review] -->|APPROVED| output",
  ""
].join("\n");

function buildAuthoringFixture() {
  return importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: source
  });
}

test("GraphViewModel edit mode inherits authoring.layout and exposes full capabilities", () => {
  const authoring = buildAuthoringFixture();
  authoring.layout.nodes.dispatch = { x: 42, y: 17, width: 200, height: 96 };
  authoring.layout.viewport = { x: 10, y: 20, zoom: 1.25 };

  const view = buildGraphViewModel({ authoring, mode: "edit" });

  assert.equal(view.mode, "edit");
  assert.equal(view.version, 1);
  assert.deepEqual(view.capabilities, {
    editable: true,
    canAddRole: true,
    canAddEdge: true,
    canDelete: true
  });
  assert.deepEqual(view.viewport, { x: 10, y: 20, zoom: 1.25 });

  const dispatch = view.nodes.find((node) => node.roleId === "dispatch");
  assert.ok(dispatch);
  assert.deepEqual(dispatch.layout, { x: 42, y: 17, width: 200, height: 96 });
  assert.equal(dispatch.bindingKind, "model");
  assert.equal(dispatch.entityKind, "responsibility_seat");
  assert.equal(dispatch.roleSeat, true);
  assert.equal(dispatch.executionScope, "roleAggregate");
  assert.equal(dispatch.structure.routingMode, "parallel_split");
  assert.equal(dispatch.runtime, undefined, "edit mode keeps runtime layer empty");
  assert.ok(dispatch.badges.includes("entry"));

  const worker = view.nodes.find((node) => node.roleId === "worker");
  assert.ok(worker);
  assert.equal(worker.structure.loopMax, 3);
  // Fallback layout applies when authoring does not pin the role
  assert.equal(typeof worker.layout.x, "number");
  assert.equal(worker.layout.width, 180);
  assert.equal(worker.layout.height, 84);
});

test("GraphViewModel synthesizes input/output boundaries and entry edge", () => {
  const authoring = buildAuthoringFixture();
  const view = buildGraphViewModel({ authoring, mode: "edit" });

  const input = view.nodes.find((node) => node.id === "input");
  const output = view.nodes.find((node) => node.id === "output");
  assert.ok(input && output);
  assert.equal(input.kind, "boundary");
  assert.equal(output.kind, "boundary");
  assert.equal(input.roleSeat, false);
  assert.equal(input.executionScope, "boundary");
  assert.equal(input.editable, false);
  assert.equal(output.editable, false);
  assert.equal(input.runtime, undefined);
  assert.equal(output.runtime, undefined);
  assert.equal(input.diagnostic, undefined);

  const entryEdge = view.edges.find((edge) => edge.id === "__boundary__:input:entry");
  assert.ok(entryEdge);
  assert.equal(entryEdge.source, "input");
  assert.equal(entryEdge.target, "dispatch");
  assert.equal(entryEdge.editable, false);
  assert.equal(entryEdge.eventType, "START");
});

test("GraphViewModel projects Semantic IR modes, loop scopes, and edge routing metadata", () => {
  const authoring = buildAuthoringFixture();
  const semanticIR = {
    seats: [
      { roleId: "dispatch", modes: { default: {}, fast: {} }, defaultMode: "default" },
      { roleId: "worker", modes: { default: {} }, defaultMode: "default" },
      { roleId: "review", modes: { default: {} }, defaultMode: "default" }
    ],
    loops: [{ loopId: "delivery", members: ["worker"], boundaryRoleId: "worker", maxRounds: 3, onExhausted: "review" }],
    transitions: [{ flowId: "dispatch:WORK:worker", priority: 4, channel: "normal", condition: { op: "exists", args: [{ kind: "path", root: "state", path: ["task"] }] } }]
  };
  const view = buildGraphViewModel({ authoring, semanticIR, mode: "edit" });
  const dispatch = view.nodes.find((node) => node.roleId === "dispatch");
  const worker = view.nodes.find((node) => node.roleId === "worker");
  const work = view.edges.find((edge) => edge.source === "dispatch" && edge.target === "worker");
  assert.deepEqual(dispatch.structure.modes, ["default", "fast"]);
  assert.deepEqual(worker.structure.loopScope, { loopId: "delivery", boundaryRoleId: "worker", maxRounds: 3, onExhausted: "review" });
  assert.equal(work.priority, 4);
  assert.equal(work.conditionSummary, "exists");
  assert.equal(work.channel, "normal");
  assert.equal(dispatch.entityKind, "responsibility_seat");
});

test("X6 edge metadata renders semantic labels", () => {
  const edge = {
    id: "loop",
    source: "b",
    target: "a",
    label: "CONTINUE",
    eventType: "CONTINUE",
    runtimeOnlyErrorFlow: false,
    participatesInJoin: false,
    editable: false,
    channel: "loop",
    priority: 2,
    conditionSummary: "exists"
  };
  assert.equal(formatStudioEdgeLabel(edge), "CONTINUE  [loop p2 when:exists]");
});

test("GraphViewModel maps diagnostics onto matching roles and flows", () => {
  const authoring = buildAuthoringFixture();
  const reviewFlow = Object.values(authoring.flows).find((flow) => flow.fromRoleId === "worker" && flow.toRoleId === "review");
  assert.ok(reviewFlow);

  const validation = {
    ok: false,
    diagnostics: [
      { source: "server-validation", severity: "error", roleId: "worker", code: "ROLE_BROKEN", message: "missing binding" },
      {
        source: "server-validation",
        severity: "warning",
        flowKey: `worker:${reviewFlow.eventType}:review`,
        code: "FLOW_WARN",
        message: "flow warn"
      }
    ]
  };

  const view = buildGraphViewModel({ authoring, validation, mode: "edit" });

  const worker = view.nodes.find((node) => node.roleId === "worker");
  assert.deepEqual(worker.diagnostic, { severity: "error", code: "ROLE_BROKEN", message: "missing binding" });

  const flowEdge = view.edges.find((edge) => edge.source === "worker" && edge.target === "review");
  assert.ok(flowEdge);
  assert.deepEqual(flowEdge.diagnostic, { severity: "warning", code: "FLOW_WARN", message: "flow warn" });

  assert.equal(view.validation.ok, false);
  assert.equal(view.validation.diagnostics.length, 2);
});

test("GraphViewModel run mode derives runtime layer and disables capabilities", () => {
  const authoring = buildAuthoringFixture();
  const system = parseSystemFromMermaidSource(source);

  const graphState = {
    userPrompt: "",
    status: "running",
    error: "",
    transitionCount: 0,
    recentAudits: [],
    auditSummary: { perRole: {}, totalTransitions: 0 },
    roleMetricsByRoleId: {},
    roleResults: {},
    pendingReviewsById: {
      "review-1": {
        reviewId: "review-1",
        roleId: "review",
        branchId: "b3",
        lineageId: "L0",
        loopIteration: 0,
        executionId: "exec-1",
        draftResult: { roleId: "review", branchId: "b3", lineageId: "L0", loopIteration: 0 },
        requestedAt: "2026-05-12T00:00:00.000Z",
        requestedByExecutionId: "exec-1",
        status: "pending",
        round: 1,
        spec: { mode: "required" }
      }
    },
    reviewHistoryByBranchId: {},
    humanReviewContextByBranchId: {},
    reviewRoundByRoleLineageKey: {},
    branchRecords: {
      b1: {
        branchId: "b1",
        roleId: "worker",
        loopIteration: 0,
        branchSequence: 1,
        lineageId: "L0",
        sessionLineageId: "S0",
        activatedByRoleId: "dispatch",
        activatedByEvent: "WORK",
        status: "active"
      },
      b2: {
        branchId: "b2",
        roleId: "review",
        loopIteration: 0,
        branchSequence: 2,
        lineageId: "L0",
        sessionLineageId: "S0",
        activatedByRoleId: "dispatch",
        activatedByEvent: "REVIEW",
        status: "active"
      },
      b3: {
        branchId: "b3",
        roleId: "review",
        loopIteration: 0,
        branchSequence: 3,
        lineageId: "L0",
        sessionLineageId: "S0",
        activatedByRoleId: "worker",
        activatedByEvent: "DONE",
        status: "waiting_review"
      }
    },
    loopIterations: { worker: 2 },
    selectedEventByBranchId: {},
    finalOutput: "",
    finalRoleId: "",
    lastExecutedRoleId: "worker",
    nextBranchSequence: 4,
    lastCheckpointSequence: 0
  };

  const view = buildGraphViewModel({ authoring, system, state: graphState, mode: "run" });

  assert.equal(view.mode, "run");
  assert.deepEqual(view.capabilities, {
    editable: false,
    canAddRole: false,
    canAddEdge: false,
    canDelete: false
  });

  const worker = view.nodes.find((node) => node.roleId === "worker");
  assert.ok(worker?.runtime);
  assert.equal(worker.runtime.status, "active");
  assert.equal(worker.runtime.activeBranchCount, 1);
  assert.equal(worker.runtime.loopIteration, 2);
  assert.equal(worker.runtime.joinWaitingSummary, null);
  assert.equal(worker.editable, false);

  const review = view.nodes.find((node) => node.roleId === "review");
  assert.ok(review?.runtime);
  assert.equal(review.runtime.waitingReviewCount, 1);
  assert.equal(review.runtime.pendingReviewCount, 1);
  assert.equal(review.runtime.status, "waiting_review");
  assert.deepEqual(review.runtime.expectedSources, ["worker", "dispatch"]);
  assert.deepEqual(review.runtime.readySources, ["dispatch", "worker"]);
  assert.deepEqual(review.runtime.missingSources, []);
  assert.deepEqual(review.runtime.joinWaitingSummary, { expectedCount: 2, readyCount: 2, missingCount: 0 });

  const activatedEdge = view.edges.find((edge) => edge.source === "worker" && edge.target === "review");
  assert.ok(activatedEdge?.runtime);
  assert.equal(activatedEdge.runtime.recentlyActivated, true);

  const idleEdge = view.edges.find((edge) => edge.source === "review" && edge.target === "output");
  assert.ok(idleEdge?.runtime);
  assert.equal(idleEdge.runtime.recentlyActivated, false);
});

test("GraphViewModel returns empty model when authoring is missing", () => {
  const view = buildGraphViewModel({ authoring: null, mode: "edit" });
  assert.equal(view.nodes.length, 0);
  assert.equal(view.edges.length, 0);
  assert.equal(view.capabilities.editable, false);
  assert.equal(view.validation.ok, false);
});
