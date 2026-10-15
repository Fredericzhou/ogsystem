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
import { formatStudioEdgeLabel } from "../src/visualizer/studio-edge-semantics.ts";
import { studioRoleMarkerVisible, studioRoleMonogram } from "../src/visualizer/studio-client/studio-role-marker.ts";
import { studioSccGroupGeometry } from "../src/visualizer/studio-client/studio-graph-render.ts";
import { buildGraphViewModel } from "../src/visualizer/graph-view-model.ts";

test("SCC frames keep compact padding clear of neighboring role and boundary nodes", () => {
  const geometry = studioSccGroupGeometry({
    members: [
      { id: "cycle-a", x: 100, y: 100, width: 180, height: 84 },
      { id: "cycle-b", x: 320, y: 100, width: 180, height: 84 }
    ],
    obstacles: [
      { id: "input", x: 20, y: 100, width: 70, height: 70 },
      { id: "ordinary-role", x: 505, y: 100, width: 180, height: 84 },
      { id: "output", x: 750, y: 100, width: 70, height: 70 }
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
  assert.equal(studioRoleMarkerVisible({ roleSeat: true, editable: false }), false);
  assert.equal(studioRoleMarkerVisible({ roleSeat: false, editable: true }), false);
});

test("Mini Program factory stored layout keeps its feedback loop clear of nodes and labels", async () => {
  const authoringPath = new URL("../examples/wechat-miniprogram-factory/.ogs/studio/system.authoring.json", import.meta.url);
  const authoring = JSON.parse(await readFile(authoringPath, "utf8"));
  const viewModel = buildGraphViewModel({ authoring, mode: "edit" });
  const projection = createStoredLayoutProjection(viewModel);
  const feedback = projection.edges.find((item) => item.id === "4:testing:TEST_FAIL:coding");

  assert.ok(feedback);
  assert.ok(feedback.routing.routePoints.length >= 2);
  assert.equal(projection.diagnostics.some((item) => item.code === "EDGE_NODE_COLLISION"), false);
  assert.equal(projection.diagnostics.some((item) => item.code === "LABEL_COLLISION"), false, JSON.stringify(projection.diagnostics));
  assert.deepEqual(
    projection.nodes.filter((item) => ["coding", "testing"].includes(item.id)).map(({ id, x, y }) => ({ id, x, y })),
    [{ id: "coding", x: 330, y: 376 }, { id: "testing", x: 610, y: 376 }]
  );
});

test("Mini Program factory stacked feedback route leaves both role borders normally", async () => {
  const authoringPath = new URL("../examples/wechat-miniprogram-factory/.ogs/studio/system.authoring.json", import.meta.url);
  const authoring = JSON.parse(await readFile(authoringPath, "utf8"));
  const viewModel = buildGraphViewModel({ authoring, mode: "edit" });
  const projection = await createElkLayoutProjection(viewModel, "stacked");
  const edge = projection.edges.find((item) => item.id === "4:testing:TEST_FAIL:coding");
  assert.ok(edge);
  const nodes = new Map(projection.nodes.map((item) => [item.id, item]));
  const source = nodes.get(edge.source);
  const target = nodes.get(edge.target);
  const sourcePortX = source.x + source.width / 2 + edge.routing.source.offset;
  const targetPortX = target.x + target.width / 2 + edge.routing.target.offset;
  const first = edge.routing.routePoints[0];
  const last = edge.routing.routePoints.at(-1);

  assert.equal(edge.routing.source.side, "top");
  assert.equal(edge.routing.target.side, "top");
  assert.equal(first.x, sourcePortX);
  assert.ok(first.y <= source.y - 24);
  assert.equal(last.x, targetPortX);
  assert.ok(last.y <= target.y - 24);
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
  const boundary = id === "input" || id === "output";
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
    editable: source !== "input" && target !== "output"
  };
}

function graphViewModel() {
  return {
    version: 1,
    mode: "edit",
    nodes: [
      node("input", 0, 0),
      node("a", 220, 0, { routingMode: "parallel_split" }),
      node("b", 440, -120),
      node("join", 660, 0, { joinMode: "all_of", joinSources: ["a", "b"] }),
      node("output", 900, 0)
    ],
    edges: [
      edge("entry", "input", "a", { channel: "normal" }),
      edge("a-b", "a", "b", { channel: "normal" }),
      edge("a-join", "a", "join", { channel: "join", participatesInJoin: true }),
      edge("b-join", "b", "join", { channel: "join", participatesInJoin: true }),
      edge("join-output", "join", "output", { channel: "normal" }),
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
  viewModel.nodes = [node("input", 0, 0), node("source", 0, 0), node("target", 0, 0), node("output", 0, 0)];
  viewModel.edges = [
    edge("input-source", "input", "source", { label: "GO" }),
    edge("input-target", "input", "target", { label: "GO" }),
    edge("source-output", "source", "output", { label: "DONE" }),
    edge("target-output", "target", "output", { label: "DONE" })
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
  viewModel.nodes = viewModel.nodes.filter((node) => node.id === "input" || node.id === "output");
  viewModel.edges = [];
  const flow = await createElkLayoutProjection(viewModel, "flow");
  const stacked = await createElkLayoutProjection(viewModel, "stacked");
  const flowInput = flow.nodes.find((node) => node.id === "input");
  const flowOutput = flow.nodes.find((node) => node.id === "output");
  const stackedInput = stacked.nodes.find((node) => node.id === "input");
  const stackedOutput = stacked.nodes.find((node) => node.id === "output");
  assert.equal(flowInput.x + flowInput.width <= flowOutput.x || flowOutput.x + flowOutput.width <= flowInput.x || flowInput.y + flowInput.height <= flowOutput.y || flowOutput.y + flowOutput.height <= flowInput.y, true);
  assert.equal(stackedInput.x + stackedInput.width <= stackedOutput.x || stackedOutput.x + stackedOutput.width <= stackedInput.x || stackedInput.y + stackedInput.height <= stackedOutput.y || stackedOutput.y + stackedOutput.height <= stackedInput.y, true);
});

test("ELK reserves exclusive terminal layers for input and output", async () => {
  const viewModel = graphViewModel();
  for (const [mode, axis] of [["flow", "x"], ["stacked", "y"]]) {
    const projection = await createElkLayoutProjection(viewModel, mode);
    const input = projection.nodes.find((item) => item.id === "input");
    const output = projection.nodes.find((item) => item.id === "output");
    const business = projection.nodes.filter((item) => item.id !== "input" && item.id !== "output");
    const inputEnd = axis === "x" ? input.x + input.width : input.y + input.height;
    const outputStart = axis === "x" ? output.x : output.y;
    assert.ok(business.every((item) => (axis === "x" ? item.x : item.y) > inputEnd));
    assert.ok(business.every((item) => (axis === "x" ? item.x + item.width : item.y + item.height) < outputStart));
  }
});

test("SCC topology separates independent cycles and merges mutually reachable nested cycles", () => {
  const nodes = ["input", "a", "b", "c", "d", "e", "output"].map((id) => node(id, 0, 0));
  const makeEdge = (source, target) => edge(`${source}-${target}`, source, target);
  const independent = topologyComponentIds({
    nodes,
    edges: [makeEdge("a", "b"), makeEdge("b", "a"), makeEdge("c", "d"), makeEdge("d", "c")]
  });
  assert.equal(independent.get("a"), "SCC-1");
  assert.equal(independent.get("b"), "SCC-1");
  assert.equal(independent.get("c"), "SCC-2");
  assert.equal(independent.get("d"), "SCC-2");
  assert.equal(independent.has("input"), false);
  assert.equal(independent.has("output"), false);

  const nested = topologyComponentIds({
    nodes,
    edges: [makeEdge("a", "b"), makeEdge("b", "a"), makeEdge("b", "c"), makeEdge("c", "b")]
  });
  assert.equal(nested.get("a"), nested.get("b"));
  assert.equal(nested.get("b"), nested.get("c"));
});

test("topology flow order is globally unique and places cycles after forward handoffs", () => {
  const nodes = ["input", "a", "b", "c", "output"].map((id) => node(id, 0, 0));
  const edges = [
    edge("entry", "input", "a"),
    edge("a-b", "a", "b"),
    edge("a-c", "a", "c"),
    edge("b-output", "b", "output"),
    edge("c-self", "c", "c", { channel: "loop" })
  ];
  const ordered = addTopologyFlowOrder({ nodes, edges, entryRoleId: "input" });
  const orderById = new Map(ordered.map((item) => [item.id, item.topologyOrder]));
  assert.equal(orderById.get("entry"), "1");
  assert.equal(orderById.get("a-b"), "2");
  assert.equal(orderById.get("a-c"), "3");
  assert.equal(orderById.get("b-output"), "4");
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
    nodes: [node("input", 0, 0), node("source", 520, 0), node("target", 180, 0), node("output", 900, 0)],
    edges: [edge("source-target", "source", "target", { channel: "loop" })]
  });
  const loop = projection.edges.find((item) => item.id === "source-target");
  assert.ok(loop.routing.routePoints.length >= 2);
  assert.equal(loop.routing.router.name, "normal");
});

test("backward feedback edges use a distinct obstacle-aware channel from the forward handoff", () => {
  const viewModel = {
    ...graphViewModel(),
    nodes: [node("input", 0, 0), node("proposer", 180, 0), node("judge", 520, 0), node("output", 900, 0)],
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
      node("input", 0, 0),
      node("proposer", 180, 0),
      node("critic", 340, -84),
      node("judge", 520, 0),
      node("output", 900, 0)
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
      node("input", 0, 0),
      node("proposer", 0, 0, { routingMode: "parallel_split" }),
      node("critic-a", 0, 0),
      node("critic-b", 0, 0),
      node("judge", 0, 0, { joinMode: "all_of", joinSources: ["proposer", "critic-a", "critic-b"] }),
      node("output", 0, 0)
    ],
    edges: [
      edge("research-request", "input", "proposer"),
      edge("critique-a", "critic-a", "judge"),
      edge("critique-b", "critic-b", "judge"),
      edge("decision-ready", "judge", "output"),
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
