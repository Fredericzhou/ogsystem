import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parseSystemFromMermaidSource } from "../src/runtime/parse-mermaid.ts";
import { importSystemToAuthoring } from "../src/visualizer/studio-authoring.ts";
import {
  createElkLayoutProjection
} from "../src/visualizer/studio-client/elk-layout-adapter.ts";
import {
  createStoredLayoutProjection,
  layoutDigest,
  layoutNodeSize
} from "../src/visualizer/studio-client/semantic-layout-projection.ts";
import { addTopologyFlowOrder, topologyComponentIds } from "../src/visualizer/topology-order.ts";
import { formatStudioEdgeLabel, studioEdgeGlyph, studioEdgeSemanticColor, studioEdgeSemanticBg } from "../src/visualizer/studio-edge-semantics.ts";
import { studioRoleMarkerVisible, studioRoleMonogram } from "../src/visualizer/studio-client/studio-role-marker.ts";
import { studioSccGroupGeometry } from "../src/visualizer/studio-client/studio-graph-render.ts";
import { buildGraphViewModel } from "../src/visualizer/graph-view-model.ts";
import { deriveStudioRuntimeVisualState } from "../src/visualizer/studio-client/studio-graph-runtime.ts";

test("Studio runtime progress marks boundary and role flow states across concurrent branches", () => {
  const source = [
    "flowchart TD",
    "%% system.id=test.runtime.progress",
    "%% system.version=1.0.0",
    "%% law.global=law.minimal.base",
    "start[开始] -->|START| dispatch[Role:dispatch]",
    "dispatch[Role:dispatch] -->|READY| worker[Role:worker]",
    "worker[Role:worker] -->|READY| end[结束]",
    ""
  ].join("\n");
  const system = parseSystemFromMermaidSource(source);
  const authoring = importSystemToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    system,
    systemSource: source
  });
  const viewModel = buildGraphViewModel({ authoring, mode: "edit" });
  const entryFlow = viewModel.edges.find((edge) => edge.source === "__system_start__" && edge.target === "dispatch");
  const workFlow = viewModel.edges.find((edge) => edge.source === "dispatch" && edge.target === "worker");
  assert.ok(entryFlow && workFlow);

  const state = deriveStudioRuntimeVisualState({
    authoring,
    viewModel,
    progressEvents: [
      { type: "flow.activated", fromRoleId: "__system_start__", toRoleId: "dispatch", eventType: "START", branchId: "entry-1" },
      { type: "role.started", roleId: "dispatch", branchId: "entry-1", executionId: "dispatch-1" },
      { type: "flow.activated", fromRoleId: "dispatch", toRoleId: "worker", eventType: "READY", edgeId: workFlow.id, branchId: "worker-1" },
      { type: "flow.activated", fromRoleId: "dispatch", toRoleId: "worker", eventType: "READY", branchId: "worker-2" },
      { type: "human_review_requested", roleId: "dispatch", branchId: "entry-1" },
      { type: "flow.activated", fromRoleId: "worker", toRoleId: "__system_end__", eventType: "READY", branchId: "worker-1" },
      { type: "role.completed", roleId: "worker", branchId: "worker-1", executionId: "worker-1" },
      { type: "role.started", roleId: "worker", branchId: "worker-2", executionId: "worker-2" }
    ]
  });

  assert.equal(state.nodeStates.get("dispatch").active, false, "review waits are static node states");
  assert.equal(state.nodeStates.get("dispatch").status, "waiting_review");
  assert.equal(state.nodeStates.get("dispatch").waitingReview, true);
  assert.equal(state.nodeStates.get("worker").active, true);
  assert.equal(state.edgeStates.get(entryFlow.id).waiting, true, "review wait uses a static waiting edge state");
  assert.equal(state.edgeStates.get(workFlow.id).active, true, "one still-running branch keeps its shared flow highlighted");
  assert.equal(state.edgeStates.get(workFlow.id).handoffCount, 2, "shared flow reports both concurrent handoffs");
  assert.equal(state.edgeStates.get(workFlow.id).activeHandoffCount, 1, "shared flow reports the active handoff count");
  assert.equal(state.edgeStates.get(workFlow.id).waitingHandoffCount, 0, "shared flow reports no waiting handoffs after the active branch starts");
  assert.equal(state.nodeStates.get("__system_end__").status, "running", "End remains active while aggregation is pending");
  assert.equal(state.nodeStates.get("__system_end__").active, true);
  assert.equal(state.activeNodeCount, 2);

  const replayed = deriveStudioRuntimeVisualState({
    authoring,
    viewModel,
    progressEvents: [
      { type: "flow.activated", handoffId: "retry-flow", fromRoleId: "dispatch", toRoleId: "worker", eventType: "READY", branchId: "retry-branch" },
      { type: "role.started", roleId: "worker", branchId: "retry-branch", executionId: "attempt-1", attempt: 1 },
      { type: "role.failed", roleId: "worker", branchId: "retry-branch", executionId: "attempt-1", attempt: 1 },
      { type: "role_retry_scheduled", roleId: "worker", branchId: "retry-branch", executionId: "attempt-1", attempt: 1 },
      { type: "role.started", roleId: "worker", branchId: "retry-branch", executionId: "attempt-2", attempt: 2 },
      { type: "role.failed", roleId: "worker", branchId: "retry-branch", executionId: "attempt-1", attempt: 1 },
      { type: "role.completed", roleId: "worker", branchId: "retry-branch", executionId: "attempt-2", attempt: 2 },
      { type: "role.completed", roleId: "worker", branchId: "retry-branch", executionId: "attempt-2", attempt: 2 }
    ]
  });
  assert.equal(replayed.handoffStatesById.get("retry-flow").status, "completed", "stale failures and duplicate replay cannot override the latest attempt");

  const stopped = deriveStudioRuntimeVisualState({
    authoring,
    viewModel,
    progressEvents: [
      { type: "flow.activated", handoffId: "stop-flow", fromRoleId: "dispatch", toRoleId: "worker", eventType: "READY", branchId: "stop-branch" },
      { type: "role.started", roleId: "worker", branchId: "stop-branch", executionId: "stop-execution", attempt: 1 },
      { type: "run_stopped" },
      { type: "role.started", roleId: "worker", branchId: "stop-branch", executionId: "late-execution", attempt: 2 }
    ]
  });
  assert.equal(stopped.handoffStatesById.get("stop-flow").status, "stopped", "stop freezes flow state and clears active animation");
  assert.equal(stopped.edgeStates.get(workFlow.id).active, false);
  assert.equal(stopped.nodeStates.get("worker").status, "stopped", "the active role keeps a stopped marker after a run is stopped");
  assert.equal(stopped.nodeStates.get("worker").status, "stopped", "stopping marks the active role as stopped");

  const mixedBranches = deriveStudioRuntimeVisualState({
    authoring,
    viewModel,
    progressEvents: [
      { type: "flow.activated", handoffId: "failed-branch", edgeId: workFlow.id, fromRoleId: "dispatch", toRoleId: "worker", eventType: "READY", branchId: "failed-branch" },
      { type: "role.started", roleId: "worker", branchId: "failed-branch", executionId: "failed-execution", attempt: 1 },
      { type: "role.failed", roleId: "worker", branchId: "failed-branch", executionId: "failed-execution", attempt: 1, errorEnvelope: { errorCode: "MODEL_TIMEOUT", message: "Primary model timed out" } },
      { type: "flow.activated", handoffId: "active-branch", edgeId: workFlow.id, fromRoleId: "dispatch", toRoleId: "worker", eventType: "READY", branchId: "active-branch" },
      { type: "role.started", roleId: "worker", branchId: "active-branch", executionId: "active-execution", attempt: 1 }
    ]
  });
  assert.equal(mixedBranches.edgeStates.get(workFlow.id).active, true, "an active branch keeps shared-edge animation despite a failed sibling");
  assert.equal(mixedBranches.edgeStates.get(workFlow.id).errorCode, "MODEL_TIMEOUT");
  assert.equal(mixedBranches.edgeStates.get(workFlow.id).handoffCount, 2, "shared flows expose the number of handoffs");
  assert.equal(mixedBranches.edgeStates.get(workFlow.id).activeHandoffCount, 1, "shared flows expose active handoffs separately");
  assert.equal(mixedBranches.nodeStates.get("worker").active, true);
  assert.equal(mixedBranches.nodeStates.get("worker").errorCode, "MODEL_TIMEOUT");

  const technicalWait = deriveStudioRuntimeVisualState({
    authoring,
    viewModel,
    progressEvents: [
      { type: "role.started", roleId: "dispatch", branchId: "waiting-branch", executionId: "waiting-execution", attempt: 1 },
      { type: "role_waiting", roleId: "dispatch", branchId: "waiting-branch", executionId: "waiting-execution", attempt: 1, waitKind: "technical", stage: "model_provider" },
      { type: "role.started", roleId: "dispatch", branchId: "active-branch", executionId: "active-execution", attempt: 1 }
    ]
  });
  assert.equal(technicalWait.nodeStates.get("dispatch").status, "running", "another branch keeps the shared role active while one waits");
  assert.equal(technicalWait.nodeStates.get("dispatch").active, true);
  assert.equal(technicalWait.nodeStates.get("dispatch").technicalWaiting, true, "a technical wait remains visible while another branch is active");

  const isolatedTechnicalWait = deriveStudioRuntimeVisualState({
    authoring,
    viewModel,
    progressEvents: [
      { type: "flow.activated", handoffId: "technical-flow", edgeId: entryFlow.id, fromRoleId: "__system_start__", toRoleId: "dispatch", eventType: "START", branchId: "technical-branch" },
      { type: "role.started", roleId: "dispatch", branchId: "technical-branch", executionId: "technical-execution", attempt: 1 },
      { type: "role_waiting", roleId: "dispatch", branchId: "technical-branch", executionId: "technical-execution", attempt: 1, waitKind: "technical", stage: "model_provider" }
    ]
  });
  assert.equal(isolatedTechnicalWait.nodeStates.get("dispatch").status, "running", "technical waiting remains a running role state");
  assert.equal(isolatedTechnicalWait.nodeStates.get("dispatch").active, true);
  assert.equal(isolatedTechnicalWait.nodeStates.get("dispatch").technicalWaiting, true);
  assert.equal(isolatedTechnicalWait.nodeStates.get("dispatch").technicalWaitingStage, "model_provider");
  assert.equal(isolatedTechnicalWait.edgeStates.get(entryFlow.id).active, true, "technical waiting keeps the incoming flow active");

  const isolatedReview = deriveStudioRuntimeVisualState({
    authoring,
    viewModel,
    progressEvents: [
      { type: "role.started", roleId: "dispatch", branchId: "review-branch", executionId: "review-execution", attempt: 1 },
      { type: "human_review_requested", roleId: "dispatch", branchId: "review-branch", executionId: "review-execution", attempt: 1 },
      { type: "role.started", roleId: "dispatch", branchId: "parallel-branch", executionId: "parallel-execution", attempt: 1 },
      { type: "human_review_approved", roleId: "dispatch", branchId: "parallel-branch", executionId: "parallel-execution", attempt: 1 },
      { type: "role.completed", roleId: "dispatch", branchId: "parallel-branch", executionId: "parallel-execution", attempt: 1 }
    ]
  });
  assert.equal(isolatedReview.nodeStates.get("dispatch").status, "waiting_review", "another branch cannot clear the waiting branch's review state");
  assert.equal(isolatedReview.nodeStates.get("dispatch").waitingReview, true);
  assert.equal(isolatedReview.nodeStates.get("dispatch").active, false);
});

test("SCC frames keep compact padding clear of neighboring role and boundary nodes", () => {
  const geometry = studioSccGroupGeometry({
    members: [
      { id: "cycle-a", x: 100, y: 100, width: 180, height: 84 },
      { id: "cycle-b", x: 320, y: 100, width: 180, height: 84 }
    ],
    obstacles: [
      { id: "__system_start__", x: 20, y: 100, width: 70, height: 70 },
      { id: "ordinary-role", x: 505, y: 100, width: 180, height: 84 },
      { id: "__system_end__", x: 750, y: 100, width: 70, height: 70 }
    ]
  });

  assert.ok(geometry);
  assert.equal(geometry.paddingX, 5);
  assert.equal(geometry.paddingY, 64);
  const frame = { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
  for (const obstacle of [
    { x: 20, y: 100, width: 70, height: 70 },
    { x: 505, y: 100, width: 180, height: 84 },
    { x: 750, y: 100, width: 70, height: 70 }
  ]) {
    assert.equal(
      frame.x < obstacle.x + obstacle.width && obstacle.x < frame.x + frame.width &&
      frame.y < obstacle.y + obstacle.height && obstacle.y < frame.y + frame.height,
      false
    );
  }
  assert.equal(frame.width, 410);
  assert.equal(frame.height, 212);
});

test("Studio role markers derive readable monograms", () => {
  assert.equal(studioRoleMonogram("Debate Reviewer", "debate-reviewer"), "DR");
  assert.equal(studioRoleMonogram("Multi Agent Analyst", "multi-agent-analyst"), "MA");
  assert.equal(studioRoleMonogram("Multi Agent Reviewer", "multi-agent-reviewer"), "MR");
  assert.equal(studioRoleMonogram("风险审查", "risk-review"), "风险");
  assert.equal(studioRoleMonogram("", "test-operator"), "TO");
  assert.equal(studioRoleMarkerVisible({ roleSeat: true, editable: true }), true);
  assert.equal(studioRoleMarkerVisible({ roleSeat: true, editable: false }), true);
  assert.equal(studioRoleMarkerVisible({ roleSeat: false, editable: true }), false);
});

test("Mini Program factory stored layout keeps its feedback loop clear of nodes and labels", async () => {
  const authoringPath = new URL("../examples/wechat-miniprogram-factory/.ogs/studio/system.authoring.json", import.meta.url);
  const authoring = JSON.parse(await readFile(authoringPath, "utf8"));
  const viewModel = buildGraphViewModel({ authoring, mode: "edit" });
  const projection = createStoredLayoutProjection(viewModel);
  const feedback = projection.edges.find((item) => item.id === "4:testing:REJECTED:coding");

  assert.ok(feedback);
  assert.ok(feedback.routing.routePoints.length >= 2);
  assert.equal(projection.diagnostics.some((item) => item.code === "EDGE_NODE_COLLISION"), false);
  assert.equal(projection.diagnostics.some((item) => item.code === "LABEL_COLLISION"), false, JSON.stringify(projection.diagnostics));
  const storedNodes = authoring.layout.nodes;
  assert.deepEqual(
    projection.nodes.filter((item) => ["coding", "testing"].includes(item.id)).map(({ id, x, y }) => ({ id, x, y })),
    ["coding", "testing"].map((id) => ({ id, x: storedNodes[id].x, y: storedNodes[id].y }))
  );
});

test("Mini Program factory stacked feedback route leaves both role borders normally", async () => {
  const authoringPath = new URL("../examples/wechat-miniprogram-factory/.ogs/studio/system.authoring.json", import.meta.url);
  const authoring = JSON.parse(await readFile(authoringPath, "utf8"));
  const viewModel = buildGraphViewModel({ authoring, mode: "edit" });
  const projection = await createElkLayoutProjection(viewModel, "stacked");
  const edge = projection.edges.find((item) => item.id === "4:testing:REJECTED:coding");
  assert.ok(edge);
  const nodes = new Map(projection.nodes.map((item) => [item.id, item]));
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  const sourcePortX = source.x + source.width / 2 + edge.routing.source.offset;
  const targetPortX = target.x + target.width / 2 + edge.routing.target.offset;
  const first = edge.routing.routePoints[0];
  const last = edge.routing.routePoints.at(-1);

  assert.ok(["top", "bottom"].includes(edge.routing.source.side));
  assert.ok(["top", "bottom"].includes(edge.routing.target.side));
  assert.equal(first.x, sourcePortX);
  assert.ok(edge.routing.source.side === "top"
    ? first.y <= source.y - 24
    : first.y >= source.y + source.height + 24);
  assert.equal(last.x, targetPortX);
  assert.ok(edge.routing.target.side === "top"
    ? last.y <= target.y - 24
    : last.y >= target.y + target.height + 24);
  assert.equal(projection.diagnostics.some((item) => item.code === "EDGE_NODE_COLLISION"), false);
});

test("Chinese role names stay readable in compact graph cards", () => {
  const role = node("review", 0, 0);
  role.label = "风险分析与投资价值评估审查角色".repeat(5);
  const size = layoutNodeSize(role);
  assert.equal(studioRoleMonogram(role.label, role.roleId), "风险");
  assert.ok(size.width <= 220);
  assert.ok(size.height > 84);
});

test("both shipped example graphs keep bounded roles and complete routes in automatic layouts", async () => {
  const examples = ["wechat-miniprogram-factory", "mulit-debate-ogs"];
  for (const example of examples) {
    const systemPath = new URL(`../examples/${example}/system.mmd`, import.meta.url);
    const source = await readFile(systemPath, "utf8");
    const system = parseSystemFromMermaidSource(source);
    const authoring = importSystemToAuthoring({
      workdir: `examples/${example}`,
      systemPath: `examples/${example}/system.mmd`,
      system,
      systemSource: source
    });
    const viewModel = buildGraphViewModel({ authoring, mode: "edit" });
    const layouts = [
      ["flow", await createElkLayoutProjection(viewModel, "flow")],
      ["compact", await createElkLayoutProjection(viewModel, "compact")],
      ["stacked", await createElkLayoutProjection(viewModel, "stacked")]
    ];
    const expectedNodeIds = new Set(viewModel.nodes.map((node) => node.id));
    const expectedEdgeIds = new Set(viewModel.edges.map((edge) => edge.id));

    for (const [layout, projection] of layouts) {
      const context = `${example}/${layout}`;
      assert.deepEqual(new Set(projection.nodes.map((node) => node.id)), expectedNodeIds, context);
      assert.deepEqual(new Set(projection.edges.map((edge) => edge.id)), expectedEdgeIds, context);
      assert.ok(projection.nodes.filter((node) => viewModel.nodes.find((item) => item.id === node.id)?.roleSeat)
        .every((node) => node.width >= 180 && node.width <= 220), context);
      assert.equal(projection.diagnostics.some((item) =>
        ["NODE_OVERLAP", "EDGE_NODE_COLLISION", "ROUTE_LOSS"].includes(item.code)
      ), false, `${context}: ${JSON.stringify(projection.diagnostics)}`);
      assert.ok(projection.edges.every((edge) =>
        expectedNodeIds.has(edge.source) && expectedNodeIds.has(edge.target) &&
        [edge.routing.source, edge.routing.target].every((terminal) =>
          ["top", "right", "bottom", "left"].includes(terminal.side) && Number.isFinite(terminal.offset)
        ) && edge.routing.routePoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      ), context);
    }
  }
});

function node(id, x, y, structure = {}) {
  const boundary = id === "__system_start__" || id === "__system_end__";
  return {
    id,
    roleId: boundary ? id : id,
    kind: boundary ? "boundary" : "roleSeat",
    entityKind: boundary ? "boundary" : "responsibility_seat",
    roleSeat: !boundary,
    executionScope: boundary ? "boundary" : "roleAggregate",
    label: boundary ? id : `Role ${id}`,
    badges: [],
    bindingKind: boundary ? "boundary" : "model",
    structure,
    layout: { x, y, width: 180, height: 84 },
    editable: !boundary
  };
}

function edge(id, source, target, options = {}) {
  return {
    id,
    source,
    target,
    eventType: options.eventType || id.toUpperCase(),
    label: options.label || id,
    runtimeOnlyErrorFlow: options.runtimeOnlyErrorFlow === true,
    participatesInJoin: options.participatesInJoin === true,
    channel: options.channel,
    editable: source !== "__system_start__" && target !== "__system_end__"
  };
}

function graphViewModel() {
  return {
    version: 1,
    mode: "edit",
    nodes: [
      node("__system_start__", 0, 0),
      node("a", 220, 0, { routingMode: "parallel_split" }),
      node("b", 440, -120),
      node("join", 660, 0, { joinMode: "all_of", joinSources: ["a", "b"] }),
      node("__system_end__", 900, 0)
    ],
    edges: [
      edge("entry", "__system_start__", "a", { channel: "normal" }),
      edge("a-b", "a", "b", { channel: "normal" }),
      edge("a-join", "a", "join", { channel: "join", participatesInJoin: true }),
      edge("b-join", "b", "join", { channel: "join", participatesInJoin: true }),
      edge("join-end", "join", "__system_end__", { channel: "normal" }),
      edge("join-a-loop", "join", "a", { channel: "loop" }),
      edge("a-error", "a", "join", { channel: "error", runtimeOnlyErrorFlow: true }),
      edge("a-join-alt", "a", "join", { channel: "normal" })
    ],
    capabilities: { editable: true, canAddRole: true, canAddEdge: true, canDelete: true },
    validation: { ok: true, diagnostics: [] }
  };
}

test("ELK layout projection is deterministic and keeps every semantic edge", async () => {
  const viewModel = graphViewModel();
  const first = await createElkLayoutProjection(viewModel, "flow");
  const second = await createElkLayoutProjection(viewModel, "flow");

  assert.deepEqual(first, second);
  assert.equal(first.adapter, "elk");
  assert.equal(first.layoutDigest, layoutDigest(first));
  assert.deepEqual(first.edges.map((item) => item.id).sort(), viewModel.edges.map((item) => item.id).sort());
  assert.equal(first.diagnostics.some((item) => item.code === "BACK_EDGE_PRESERVED"), false);
  assert.equal(first.diagnostics.some((item) => item.code === "MULTI_EDGE_COLLAPSED_FOR_LAYOUT"), false);
  const loopRouting = first.edges.find((item) => item.id === "join-a-loop").routing;
  assert.ok(["backward", "vertical"].includes(loopRouting.kind));
  if (loopRouting.kind === "backward") {
    assert.ok(loopRouting.routePoints.length >= 2);
  } else {
    assert.deepEqual(loopRouting.router.args.startDirections, [loopRouting.source.side]);
    assert.deepEqual(loopRouting.router.args.endDirections, [loopRouting.target.side]);
  }
});

test("Start and End roles align with their connected role groups", () => {
  const authoring = {
    version: 1,
    project: { workdir: "/tmp/team", systemPath: "/tmp/team/system.mmd" },
    system: { systemId: "team.boundaries", systemVersion: "1.0.0", startDispatch: { mode: "all" }, lawGlobalRef: "law.test" },
    roles: Object.fromEntries(["entry-a", "entry-b", "middle", "end-a", "end-b"].map((roleId) => [roleId, { roleId, title: roleId, bindingKind: "noop" }])),
    flows: {
      startA: { flowId: "start-a", fromRoleId: "__system_start__", toRoleId: "entry-a", eventType: "START" },
      startB: { flowId: "start-b", fromRoleId: "__system_start__", toRoleId: "entry-b", eventType: "START" },
      a: { flowId: "a", fromRoleId: "entry-a", toRoleId: "middle", eventType: "READY" },
      b: { flowId: "b", fromRoleId: "entry-b", toRoleId: "middle", eventType: "READY" },
      c: { flowId: "c", fromRoleId: "middle", toRoleId: "end-a", eventType: "READY" },
      d: { flowId: "d", fromRoleId: "middle", toRoleId: "end-b", eventType: "READY" },
      e: { flowId: "e", fromRoleId: "end-a", toRoleId: "__system_end__", eventType: "READY" },
      f: { flowId: "f", fromRoleId: "end-b", toRoleId: "__system_end__", eventType: "READY" }
    },
    layout: { nodes: {
      "entry-a": { x: 100, y: 20 },
      "entry-b": { x: 100, y: 300 },
      middle: { x: 400, y: 150 },
      "end-a": { x: 700, y: 80 },
      "end-b": { x: 700, y: 340 }
    } }
  };
  const viewModel = buildGraphViewModel({ authoring, mode: "edit" });
  const nodes = new Map(viewModel.nodes.map((item) => [item.id, item]));
  const start = nodes.get("__system_start__");
  const end = nodes.get("__system_end__");
  assert.ok(start.layout.y > 100 && start.layout.y < 200);
  assert.ok(end.layout.y > 150 && end.layout.y < 300);
  assert.deepEqual(viewModel.edges.filter((item) => item.source === "__system_start__").map((item) => item.target).sort(), ["entry-a", "entry-b"]);
  assert.deepEqual(viewModel.edges.filter((item) => item.target === "__system_end__").map((item) => item.source).sort(), ["end-a", "end-b"]);
});

test("ELK projection keeps channels, Join metadata, and distinct parallel lanes", async () => {
  const projection = await createElkLayoutProjection(graphViewModel(), "compact");
  const joinEdges = projection.edges.filter((item) => item.id === "a-join" || item.id === "b-join");
  const parallelEdges = projection.edges.filter((item) => ["a-join", "a-error", "a-join-alt"].includes(item.id));

  assert.equal(projection.profile, "compact");
  assert.equal(joinEdges.every((item) => item.participatesInJoin), true);
  assert.equal(projection.edges.find((item) => item.id === "a-error").runtimeOnlyErrorFlow, true);
  assert.equal(new Set(parallelEdges.map((item) => item.routing.lane)).size, parallelEdges.length);
});

test("ELK expands flow spacing for longer handoff labels", async () => {
  const viewModel = graphViewModel();
  viewModel.nodes = [node("source", 0, 0), node("target", 0, 0)];
  viewModel.edges = [edge("handoff", "source", "target", { label: "GO" })];
  const compactLabel = await createElkLayoutProjection(viewModel, "flow");
  viewModel.edges[0].label = "ANALYSIS_COMPLETE_WITH_REVIEW_AND_VALIDATION";
  const longLabel = await createElkLayoutProjection(viewModel, "flow");
  const gapFor = (projection) => {
    const source = projection.nodes.find((item) => item.id === "source");
    const target = projection.nodes.find((item) => item.id === "target");
    return target.x - source.x - source.width;
  };

  assert.ok(gapFor(longLabel) > gapFor(compactLabel));
});

test("ELK expands stacked columns for long handoff labels", async () => {
  const viewModel = graphViewModel();
  viewModel.nodes = [node("__system_start__", 0, 0), node("source", 0, 0), node("target", 0, 0), node("__system_end__", 0, 0)];
  viewModel.edges = [
    edge("start-source", "__system_start__", "source", { label: "GO" }),
    edge("start-target", "__system_start__", "target", { label: "GO" }),
    edge("source-end", "source", "__system_end__", { label: "READY" }),
    edge("target-end", "target", "__system_end__", { label: "READY" })
  ];
  const compactLabel = await createElkLayoutProjection(viewModel, "stacked");
  viewModel.edges[0].label = "PROPOSAL_READY_WITH_REVIEW_AND_VALIDATION";
  const longLabel = await createElkLayoutProjection(viewModel, "stacked");
  const siblingGap = (projection) => {
    const source = projection.nodes.find((item) => item.id === "source");
    const target = projection.nodes.find((item) => item.id === "target");
    return Math.abs(source.x - target.x) - Math.max(source.width, target.width);
  };

  assert.ok(siblingGap(longLabel) > siblingGap(compactLabel));
});

test("ELK places disconnected boundaries along the selected orientation without role seats", async () => {
  const viewModel = graphViewModel();
  viewModel.nodes = viewModel.nodes.filter((node) => node.id === "__system_start__" || node.id === "__system_end__");
  viewModel.edges = [];
  const flow = await createElkLayoutProjection(viewModel, "flow");
  const stacked = await createElkLayoutProjection(viewModel, "stacked");
  const flowInput = flow.nodes.find((node) => node.id === "__system_start__");
  const flowOutput = flow.nodes.find((node) => node.id === "__system_end__");
  const stackedInput = stacked.nodes.find((node) => node.id === "__system_start__");
  const stackedOutput = stacked.nodes.find((node) => node.id === "__system_end__");
  assert.equal(flowInput.x + flowInput.width <= flowOutput.x || flowOutput.x + flowOutput.width <= flowInput.x || flowInput.y + flowInput.height <= flowOutput.y || flowOutput.y + flowOutput.height <= flowInput.y, true);
  assert.equal(stackedInput.x + stackedInput.width <= stackedOutput.x || stackedOutput.x + stackedOutput.width <= stackedInput.x || stackedInput.y + stackedInput.height <= stackedOutput.y || stackedOutput.y + stackedOutput.height <= stackedInput.y, true);
});

test("ELK reserves exclusive terminal layers for Start and End", async () => {
  const viewModel = graphViewModel();
  for (const [mode, axis] of [["flow", "x"], ["stacked", "y"]]) {
    const projection = await createElkLayoutProjection(viewModel, mode);
    const start = projection.nodes.find((item) => item.id === "__system_start__");
    const end = projection.nodes.find((item) => item.id === "__system_end__");
    const business = projection.nodes.filter((item) => item.id !== "__system_start__" && item.id !== "__system_end__");
    const startEnd = axis === "x" ? start.x + start.width : start.y + start.height;
    const endStart = axis === "x" ? end.x : end.y;
    assert.ok(business.every((item) => (axis === "x" ? item.x : item.y) > startEnd));
    assert.ok(business.every((item) => (axis === "x" ? item.x + item.width : item.y + item.height) < endStart));
  }
});

test("SCC topology separates independent cycles and merges mutually reachable nested cycles", () => {
  const nodes = ["__system_start__", "a", "b", "c", "d", "e", "__system_end__"].map((id) => node(id, 0, 0));
  const makeEdge = (source, target) => edge(`${source}-${target}`, source, target);
  const independent = topologyComponentIds({
    nodes,
    edges: [makeEdge("a", "b"), makeEdge("b", "a"), makeEdge("c", "d"), makeEdge("d", "c")]
  });
  assert.ok(independent.get("a"));
  assert.equal(independent.get("a"), independent.get("b"));
  assert.ok(independent.get("c"));
  assert.equal(independent.get("c"), independent.get("d"));
  assert.notEqual(independent.get("a"), independent.get("c"));
  assert.equal(independent.has("__system_start__"), false);
  assert.equal(independent.has("__system_end__"), false);

  const nested = topologyComponentIds({
    nodes,
    edges: [makeEdge("a", "b"), makeEdge("b", "a"), makeEdge("b", "c"), makeEdge("c", "b")]
  });
  assert.equal(nested.get("a"), nested.get("b"));
  assert.equal(nested.get("b"), nested.get("c"));
});

test("topology flow order is globally unique and places cycles after forward handoffs", () => {
  const nodes = ["__system_start__", "a", "b", "c", "__system_end__"].map((id) => node(id, 0, 0));
  const edges = [
    edge("entry", "__system_start__", "a"),
    edge("a-b", "a", "b"),
    edge("a-c", "a", "c"),
    edge("b-end", "b", "__system_end__"),
    edge("c-self", "c", "c", { channel: "loop" })
  ];
  const ordered = addTopologyFlowOrder({ nodes, edges, entryNodeId: "__system_start__" });
  const orderById = new Map(ordered.map((item) => [item.id, item.topologyOrder]));
  assert.equal(orderById.get("entry"), "1");
  assert.equal(orderById.get("a-b"), "2");
  assert.equal(orderById.get("a-c"), "3");
  assert.equal(orderById.get("b-end"), "4");
  assert.equal(orderById.get("c-self"), "5L");
  assert.equal(new Set(orderById.values()).size, edges.length);
  assert.match(formatStudioEdgeLabel({ ...edges[1], topologyOrder: orderById.get("a-b") }), /#2/);
});

test("stacked loop routes use ELK's vertical geometry without a second router", async () => {
  const projection = await createElkLayoutProjection(graphViewModel(), "stacked");
  const verticalLoop = projection.edges.find((item) => item.id === "join-a-loop");
  assert.equal(verticalLoop.routing.kind, "vertical");
  assert.equal(verticalLoop.routing.router.name, "normal");
  assert.ok(verticalLoop.routing.routePoints.length >= 1);
});

test("stored back edges use their explicit lane instead of a second X6 route", () => {
  const projection = createStoredLayoutProjection({
    ...graphViewModel(),
    nodes: [node("__system_start__", 0, 0), node("source", 520, 0), node("target", 180, 0), node("__system_end__", 900, 0)],
    edges: [edge("source-target", "source", "target", { channel: "loop" })]
  });
  const loop = projection.edges.find((item) => item.id === "source-target");
  assert.ok(loop.routing.routePoints.length >= 2);
  assert.equal(loop.routing.router.name, "normal");
});

test("backward feedback edges use a distinct obstacle-aware channel from the forward handoff", () => {
  const viewModel = {
    ...graphViewModel(),
    nodes: [node("__system_start__", 0, 0), node("proposer", 180, 0), node("judge", 520, 0), node("__system_end__", 900, 0)],
    edges: [
      edge("proposal-ready", "proposer", "judge"),
      edge("rework", "judge", "proposer")
    ]
  };
  const projection = createStoredLayoutProjection(viewModel);
  const rework = projection.edges.find((item) => item.id === "rework").routing;
  const proposer = projection.nodes.find((item) => item.id === "proposer");
  const judge = projection.nodes.find((item) => item.id === "judge");

  assert.ok(["top", "bottom"].includes(rework.source.side));
  assert.equal(rework.source.side, rework.target.side);
  assert.ok(rework.routePoints.length >= 3);
  assert.ok(rework.routePoints.some((point) =>
    point.y < Math.min(proposer.y, judge.y) ||
    point.y > Math.max(proposer.y + proposer.height, judge.y + judge.height)
  ));
  const sourcePoint = rework.routePoints[0];
  const targetPoint = rework.routePoints.at(-1);
  const sourcePortX = judge.x + judge.width / 2 + rework.source.offset;
  const targetPortX = proposer.x + proposer.width / 2 + rework.target.offset;
  if (rework.source.side === "top") {
    assert.equal(sourcePoint.x, sourcePortX);
    assert.ok(sourcePoint.y <= judge.y - 24);
  } else {
    assert.equal(sourcePoint.x, sourcePortX);
    assert.ok(sourcePoint.y >= judge.y + judge.height + 24);
  }
  if (rework.target.side === "top") {
    assert.equal(targetPoint.x, targetPortX);
    assert.ok(targetPoint.y <= proposer.y - 24);
  } else {
    assert.equal(targetPoint.x, targetPortX);
    assert.ok(targetPoint.y >= proposer.y + proposer.height + 24);
  }
});

test("backward feedback routes move around obstructing nodes without crossing their clearance", () => {
  const viewModel = {
    ...graphViewModel(),
    nodes: [
      node("__system_start__", 0, 0),
      node("proposer", 180, 0),
      node("critic", 340, -84),
      node("judge", 520, 0),
      node("__system_end__", 900, 0)
    ],
    edges: [
      edge("proposal-ready", "proposer", "judge"),
      edge("rework", "judge", "proposer")
    ]
  };
  const projection = createStoredLayoutProjection(viewModel);
  const route = projection.edges.find((item) => item.id === "rework").routing;
  const sourceNode = projection.nodes.find((item) => item.id === "judge");
  const targetNode = projection.nodes.find((item) => item.id === "proposer");
  const nodes = projection.nodes.filter((item) => !["proposer", "judge"].includes(item.id));
  const path = [
    {
      x: sourceNode.x + sourceNode.width / 2 + route.source.offset,
      y: route.source.side === "top" ? sourceNode.y : sourceNode.y + sourceNode.height
    },
    ...route.routePoints,
    {
      x: targetNode.x + targetNode.width / 2 + route.target.offset,
      y: route.target.side === "top" ? targetNode.y : targetNode.y + targetNode.height
    }
  ];
  const segmentBlocked = (start, end, obstacle) => {
    const left = obstacle.x - 40;
    const right = obstacle.x + obstacle.width + 40;
    const top = obstacle.y - 40;
    const bottom = obstacle.y + obstacle.height + 40;
    if (start.y === end.y) {
      return start.y > top && start.y < bottom &&
        Math.max(Math.min(start.x, end.x), left) < Math.min(Math.max(start.x, end.x), right);
    }
    return start.x > left && start.x < right &&
      Math.max(Math.min(start.y, end.y), top) < Math.min(Math.max(start.y, end.y), bottom);
  };

  assert.ok(path.slice(1).every((point, index) =>
    nodes.every((obstacle) => !segmentBlocked(path[index], point, obstacle))
  ));
});

test("ELK feedback edges keep a separate orthogonal return path", async () => {
  const viewModel = {
    ...graphViewModel(),
    nodes: [
      node("__system_start__", 0, 0),
      node("proposer", 0, 0, { routingMode: "parallel_split" }),
      node("critic-a", 0, 0),
      node("critic-b", 0, 0),
      node("judge", 0, 0, { joinMode: "all_of", joinSources: ["proposer", "critic-a", "critic-b"] }),
      node("__system_end__", 0, 0)
    ],
    edges: [
      edge("research-request", "__system_start__", "proposer"),
      edge("critique-a", "critic-a", "judge"),
      edge("critique-b", "critic-b", "judge"),
      edge("decision-ready", "judge", "__system_end__"),
      edge("send-critique-a", "proposer", "critic-a"),
      edge("send-critique-b", "proposer", "critic-b"),
      edge("proposal-ready", "proposer", "judge"),
      edge("rework", "judge", "proposer")
    ]
  };
  const projection = await createElkLayoutProjection(viewModel, "flow");
  const rework = projection.edges.find((item) => item.id === "rework").routing;
  assert.equal(rework.source.side, rework.target.side);
  assert.ok(["top", "bottom"].includes(rework.source.side));
  assert.ok(rework.routePoints.length >= 3);
});

test("stored projection preserves positions while renderer stays library-independent", async () => {
  const viewModel = graphViewModel();
  const projection = createStoredLayoutProjection(viewModel);
  assert.deepEqual(projection.nodes.find((item) => item.id === "join"), {
    id: "join", x: 660, y: 0, width: 180, height: 84
  });

  const renderer = await readFile(new URL("../src/visualizer/studio-client/studio-graph-render.ts", import.meta.url), "utf8");
  const labelProjection = await readFile(new URL("../src/visualizer/studio-client/semantic-layout-projection.ts", import.meta.url), "utf8");
  assert.doesNotMatch(renderer, /from ["']elkjs(?:\/|["'])/);
  assert.match(renderer, /renderStudioGraphViewModel\([\s\S]*?projection: LayoutProjection,[\s\S]*?showTechnicalDetails\?: boolean/);
  assert.doesNotMatch(labelProjection, /Role:/);
  assert.match(labelProjection, /STUDIO_EDGE_CONNECTOR_RADIUS = 4/);
  assert.match(renderer, /name: "boundary",\r?\n\s+args: \{ offset: 0 \}/);
  const styles = await readFile(new URL("../src/visualizer/studio-client/styles.ts", import.meta.url), "utf8");
  assert.match(styles, /\.studio-graph-canvas \.x6-edge-label \{\r?\n\s+pointer-events: none;/);
  assert.match(renderer, /routing\.routePoints\.length > 0/);
  assert.match(renderer, /router: routing\.routePoints\.length > 0/);
  assert.match(renderer, /Retain stale ports until all edge terminals have been rebound/);
  assert.ok(renderer.indexOf("for (const edge of viewModel.edges)") < renderer.indexOf("finalizeStudioNodePorts"));
  assert.match(renderer, /studioSccGroup: \{\r?\n\s+memberIds: group\.memberIds/);
  assert.match(renderer, /interacting: true/);
  assert.match(renderer, /export function alignStudioSccGroups\(graph: Graph\)/);
  assert.match(renderer, /formatStudioEdgeTopologyLabel\(edge\)/);
  assert.match(renderer, /text: renderedSummaryLabel,[\s\S]*?fontSize: 10/);
  assert.match(renderer, /labels\.push\(\{\s+markup: \[\s+\{ tagName: "rect", selector: "body", className: "studio-edge-label-body" \},\s+\{ tagName: "text", selector: "label" \}\s+\],\s+position: \{\s+distance: summaryPosition\.distance/s);
  assert.match(renderer, /inlineTopologyLabel = hasWrappedSummaryLabel \? formatStudioEdgeTopologyLabel\(edge\) : ""/);
  assert.match(renderer, /offset: positions\?\.topology\?\.offset \?\? -topologyLabelOffset/);
  assert.match(renderer, /textWrap: \{\r?\n\s+width: STUDIO_EDGE_SUMMARY_LABEL_MAX_WIDTH,[\s\S]*?ellipsis: false/);
  assert.doesNotMatch(renderer, /hasLongSummaryLabel/);
  assert.match(renderer, /name: "block",\r?\n\s+width: loopEdge \? 14 : 12,\r?\n\s+height: loopEdge \? 10 : 9/);
  assert.match(renderer, /function isLoopEdge\(edge: GraphViewModelEdge\)/);
  assert.match(renderer, /strokeDasharray: loopEdge \? "7 5"/);
  assert.match(renderer, /width: loopEdge \? 14 : 12/);
  assert.match(renderer, /targetMarker: \{[\s\S]*?fill: stroke,[\s\S]*?stroke,[\s\S]*?strokeWidth: 1/);
});

test("ELK is the only automatic layout engine", async () => {
  const adapter = await readFile(new URL("../src/visualizer/studio-client/elk-layout-adapter.ts", import.meta.url), "utf8");
  assert.match(adapter, /from ["']elkjs\/lib\/elk\.bundled\.js["']/);
});

test("Studio graph disposal invalidates pending asynchronous layouts", async () => {
  const studioGraph = await readFile(new URL("../src/visualizer/studio-client/studio-graph.ts", import.meta.url), "utf8");
  const disposeStart = studioGraph.indexOf("dispose(): void {");
  assert.notEqual(disposeStart, -1);
  assert.match(studioGraph.slice(disposeStart, disposeStart + 160), /this\.updateGeneration \+= 1/);
});

test("Studio edge semantics map glyphs, colors, and backgrounds into semantic categories", () => {
  const baseEdge = {
    id: "e1",
    source: "a",
    target: "b",
    label: "",
    eventType: "",
    runtimeOnlyErrorFlow: false,
    participatesInJoin: false,
    editable: true
  };

  // 1. Glyphs
  assert.equal(studioEdgeGlyph({ ...baseEdge, eventType: "START" }), "▶");
  assert.equal(studioEdgeGlyph({ ...baseEdge, target: "__system_end__" }), "🏁");
  assert.equal(studioEdgeGlyph({ ...baseEdge, eventType: "ERROR" }), "⚡");
  assert.equal(studioEdgeGlyph({ ...baseEdge, runtimeOnlyErrorFlow: true }), "⚡");
  assert.equal(studioEdgeGlyph({ ...baseEdge, eventType: "BLOCKED" }), "⛔");
  assert.equal(studioEdgeGlyph({ ...baseEdge, eventType: "NEEDS_REWORK" }), "↺");
  assert.equal(studioEdgeGlyph({ ...baseEdge, eventType: "REJECTED" }), "✗");
  assert.equal(studioEdgeGlyph({ ...baseEdge, eventType: "APPROVED" }), "✓");
  assert.equal(studioEdgeGlyph({ ...baseEdge, eventType: "READY" }), "✓");

  // 2. Semantic Colors (Red group)
  assert.equal(studioEdgeSemanticColor({ ...baseEdge, eventType: "ERROR" }, false), "#dc2626");
  assert.equal(studioEdgeSemanticColor({ ...baseEdge, eventType: "REJECTED" }, false), "#e11d48");
  assert.equal(studioEdgeSemanticColor({ ...baseEdge, eventType: "BLOCKED" }, false), "#ea580c");

  // Semantic Colors (Yellow group)
  assert.equal(studioEdgeSemanticColor({ ...baseEdge, eventType: "START" }, false), "#d97706");
  assert.equal(studioEdgeSemanticColor({ ...baseEdge, eventType: "NEEDS_REWORK" }, false), "#b45309");

  // Semantic Colors (Green group)
  assert.equal(studioEdgeSemanticColor({ ...baseEdge, eventType: "APPROVED" }, false), "#059669");
  assert.equal(studioEdgeSemanticColor({ ...baseEdge, eventType: "READY" }, false), "#059669");
  assert.equal(studioEdgeSemanticColor({ ...baseEdge, target: "__system_end__" }, false), "#059669");

  // 3. Semantic Backgrounds
  assert.equal(studioEdgeSemanticBg({ ...baseEdge, eventType: "ERROR" }, false), "#fef2f2");
  assert.equal(studioEdgeSemanticBg({ ...baseEdge, eventType: "REJECTED" }, false), "#fff1f2");
  assert.equal(studioEdgeSemanticBg({ ...baseEdge, eventType: "APPROVED" }, false), "#f0fdf4");
});
