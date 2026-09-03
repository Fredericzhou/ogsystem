import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createElkLayoutProjection
} from "../src/visualizer/studio-client/elk-layout-adapter.ts";
import {
  createStoredLayoutProjection,
  layoutDigest
} from "../src/visualizer/studio-client/semantic-layout-projection.ts";

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
  assert.ok(first.diagnostics.some((item) => item.code === "BACK_EDGE_PRESERVED" && item.edgeId === "join-a-loop"));
  assert.ok(first.diagnostics.some((item) => item.code === "MULTI_EDGE_COLLAPSED_FOR_LAYOUT" && item.edgeId === "a-join-alt"));
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
  assert.ok(flowInput.x < flowOutput.x);
  assert.equal(flowInput.y + flowInput.height / 2, flowOutput.y + flowOutput.height / 2);
  assert.ok(stackedInput.y < stackedOutput.y);
  assert.equal(stackedInput.x + stackedInput.width / 2, stackedOutput.x + stackedOutput.width / 2);
});

test("stacked loop routes use vertical terminals and router directions", async () => {
  const projection = await createElkLayoutProjection(graphViewModel(), "stacked");
  const verticalLoop = projection.edges.find((item) => item.id === "join-a-loop");
  assert.equal(verticalLoop.routing.kind, "vertical");
  assert.equal(verticalLoop.routing.router.name, "manhattan");
  assert.deepEqual(verticalLoop.routing.router.args.startDirections, [verticalLoop.routing.source.side]);
  assert.deepEqual(verticalLoop.routing.router.args.endDirections, [verticalLoop.routing.target.side]);
  assert.notDeepEqual(verticalLoop.routing.router.args.startDirections, ["left"]);
});

test("stored projection preserves positions while renderer stays library-independent", async () => {
  const viewModel = graphViewModel();
  const projection = createStoredLayoutProjection(viewModel);
  assert.deepEqual(projection.nodes.find((item) => item.id === "join"), {
    id: "join", x: 660, y: 0, width: 180, height: 84
  });

  const renderer = await readFile(new URL("../src/visualizer/studio-client/studio-graph-render.ts", import.meta.url), "utf8");
  assert.doesNotMatch(renderer, /from ["']elkjs(?:\/|["'])/);
  assert.match(renderer, /renderStudioGraphViewModel\(graph: Graph, viewModel: GraphViewModel, projection: LayoutProjection\)/);
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
