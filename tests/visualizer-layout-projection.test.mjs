import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjection,
  createLayoutDigest,
  createStoredLayoutProjection,
  layoutDigest,
  layoutNodeSize,
  STUDIO_EDGE_TERMINAL_STUB_LENGTH,
  STUDIO_NODE_EDGE_CLEARANCE
} from "../src/visualizer/studio-client/semantic-layout-projection.ts";
import { createElkLayoutProjection } from "../src/visualizer/studio-client/elk-layout-adapter.ts";

function node(id, overrides = {}) {
  const boundary = id === "input" || id === "output";
  return {
    id,
    roleId: id,
    kind: boundary ? "boundary" : "roleSeat",
    entityKind: boundary ? "boundary" : "responsibility_seat",
    roleSeat: !boundary,
    executionScope: boundary ? "boundary" : "roleAggregate",
    bindingKind: boundary ? "boundary" : "noop",
    label: id,
    badges: [],
    structure: {},
    layout: { x: 0, y: 0, width: 180, height: 84 },
    editable: !boundary,
    ...overrides
  };
}

function edge(id, source, target, overrides = {}) {
  return {
    id,
    source,
    target,
    eventType: id.toUpperCase(),
    label: id,
    runtimeOnlyErrorFlow: false,
    participatesInJoin: false,
    editable: true,
    ...overrides
  };
}

function graph(nodes, edges) {
  return {
    version: 1,
    mode: "edit",
    nodes,
    edges,
    capabilities: { editable: true, canAddRole: true, canAddEdge: true, canDelete: true },
    validation: { ok: true, diagnostics: [] }
  };
}

function fixture(name) {
  if (name === "fan-out") {
    return graph(
      [node("input"), node("split", { structure: { routingMode: "parallel_split", routeOrder: ["right", "left"] } }), node("left"), node("right"), node("output")],
      [edge("input-split", "input", "split"), edge("split-left", "split", "left"), edge("split-right", "split", "right"), edge("left-output", "left", "output"), edge("right-output", "right", "output")]
    );
  }
  if (name === "join") {
    return graph(
      [node("input"), node("left"), node("right"), node("join", { structure: { joinMode: "all_of", joinSources: ["left", "right"] } }), node("output")],
      [edge("input-left", "input", "left"), edge("input-right", "input", "right"), edge("left-join", "left", "join", { participatesInJoin: true, channel: "join" }), edge("right-join", "right", "join", { participatesInJoin: true, channel: "join" }), edge("join-output", "join", "output")]
    );
  }
  if (name === "cycle") {
    return graph([node("input"), node("a"), node("b"), node("output")], [edge("input-a", "input", "a"), edge("a-b", "a", "b"), edge("b-a", "b", "a", { channel: "loop" }), edge("b-output", "b", "output")]);
  }
  if (name === "error") {
    return graph([node("input"), node("work"), node("output")], [edge("input-work", "input", "work"), edge("work-output", "work", "output", { channel: "error", runtimeOnlyErrorFlow: true })]);
  }
  if (name === "multi-terminal") {
    return graph([node("input"), node("source"), node("target"), node("output")], [
      edge("input-source", "input", "source"),
      edge("source-target-a", "source", "target", { eventType: "A", channel: "normal" }),
      edge("source-target-b", "source", "target", { eventType: "B", channel: "feedback" }),
      edge("target-output", "target", "output")
    ]);
  }
  if (name === "size-variation") {
    return graph([node("input", { layout: { x: 0, y: 0, width: 120, height: 52 } }), node("small", { layout: { x: 0, y: 0, width: 96, height: 42 } }), node("large", { layout: { x: 0, y: 0, width: 300, height: 132 } }), node("output", { layout: { x: 0, y: 0, width: 140, height: 60 } })], [edge("input-small", "input", "small"), edge("small-large", "small", "large"), edge("large-output", "large", "output")]);
  }
  throw new Error(`unknown fixture ${name}`);
}

function diagnosticCodes(projection) {
  return projection.diagnostics.map((diagnostic) => diagnostic.code);
}

function terminalPoint(node, terminal) {
  if (terminal.side === "left") return { x: node.x, y: node.y + node.height / 2 + terminal.offset };
  if (terminal.side === "right") return { x: node.x + node.width, y: node.y + node.height / 2 + terminal.offset };
  if (terminal.side === "top") return { x: node.x + node.width / 2 + terminal.offset, y: node.y };
  return { x: node.x + node.width / 2 + terminal.offset, y: node.y + node.height };
}

function segmentIntersectsNode(start, end, node) {
  const left = node.x;
  const right = node.x + node.width;
  const top = node.y;
  const bottom = node.y + node.height;
  if (start.x === end.x) {
    return start.x >= left && start.x <= right &&
      Math.max(Math.min(start.y, end.y), top) <= Math.min(Math.max(start.y, end.y), bottom);
  }
  if (start.y === end.y) {
    return start.y >= top && start.y <= bottom &&
      Math.max(Math.min(start.x, end.x), left) <= Math.min(Math.max(start.x, end.x), right);
  }
  throw new Error("Expected an orthogonal route");
}

function assertRouteAvoidsOtherNodes(projection, edgeId) {
  const projectedEdge = projection.edges.find((edge) => edge.id === edgeId);
  assert.ok(projectedEdge);
  const sourceNode = projection.nodes.find((node) => node.id === projectedEdge.source);
  const targetNode = projection.nodes.find((node) => node.id === projectedEdge.target);
  const points = [
    terminalPoint(sourceNode, projectedEdge.routing.source),
    ...projectedEdge.routing.routePoints,
    terminalPoint(targetNode, projectedEdge.routing.target)
  ];
  for (let index = 1; index < points.length; index += 1) {
    for (const node of projection.nodes) {
      if (node.id === projectedEdge.source || node.id === projectedEdge.target) continue;
      assert.equal(
        segmentIntersectsNode(points[index - 1], points[index], node),
        false,
        `${edgeId} segment ${index} intersects ${node.id}`
      );
    }
  }
  assert.equal(diagnosticCodes(projection).includes("EDGE_NODE_COLLISION"), false);
}

test("generic ELK fixtures preserve fan-out, Join, cycle, error, and multi-terminal semantics", async () => {
  const fanOut = await createElkLayoutProjection(fixture("fan-out"), "flow");
  assert.equal(fanOut.edges.length, 5);
  assert.ok(diagnosticCodes(fanOut).includes("UNSUPPORTED_CONSTRAINT"));

  const join = await createElkLayoutProjection(fixture("join"), "flow");
  assert.equal(join.edges.filter((edge) => edge.participatesInJoin).length, 2);
  assert.ok(diagnosticCodes(join).includes("UNSUPPORTED_CONSTRAINT"));

  const cycle = await createElkLayoutProjection(fixture("cycle"), "flow");
  assert.equal(diagnosticCodes(cycle).includes("BACK_EDGE_PRESERVED"), false);
  assert.equal(cycle.edges.length, 4);

  const error = await createElkLayoutProjection(fixture("error"), "flow");
  assert.equal(error.edges.find((item) => item.id === "work-output").runtimeOnlyErrorFlow, true);
  assert.equal(error.edges.find((item) => item.id === "work-output").routing.lane.startsWith("error:"), true);

  const multiTerminal = await createElkLayoutProjection(fixture("multi-terminal"), "flow");
  assert.equal(multiTerminal.edges.length, 4);
  assert.equal(diagnosticCodes(multiTerminal).includes("MULTI_EDGE_COLLAPSED_FOR_LAYOUT"), false);
  assert.notEqual(
    multiTerminal.edges.find((item) => item.id === "source-target-a").routing.lane,
    multiTerminal.edges.find((item) => item.id === "source-target-b").routing.lane
  );
});

test("ELK honors node size variation without projected overlap", async () => {
  const projection = await createElkLayoutProjection(fixture("size-variation"), "flow");
  assert.equal(projection.nodes.find((item) => item.id === "large").width, 300);
  assert.equal(projection.nodes.find((item) => item.id === "large").height, 132);
  assert.equal(diagnosticCodes(projection).includes("NODE_OVERLAP"), false);
});

test("ELK follows declared branch order and expands nodes for readable labels", async () => {
  const projection = await createElkLayoutProjection(fixture("fan-out"), "flow");
  const left = projection.nodes.find((item) => item.id === "left");
  const right = projection.nodes.find((item) => item.id === "right");
  assert.ok(right.y < left.y);

  const longNode = node("long", {
    label: "A responsibility with a deliberately long readable title",
    badges: ["waiting_review", "review-required"]
  });
  const size = layoutNodeSize(longNode);
  assert.ok(size.width > longNode.layout.width || size.height > longNode.layout.height);
});

test("stored routing bundles same-direction fan-out and fan-in stubs", () => {
  const view = graph([
    node("source", { layout: { x: 100, y: 120, width: 180, height: 84 } }),
    node("left", { layout: { x: 420, y: 60, width: 180, height: 84 } }),
    node("right", { layout: { x: 420, y: 240, width: 180, height: 84 } }),
    node("join", { layout: { x: 740, y: 150, width: 180, height: 84 } })
  ], [
    edge("source-left", "source", "left"),
    edge("source-right", "source", "right"),
    edge("left-join", "left", "join"),
    edge("right-join", "right", "join")
  ]);
  const projection = createStoredLayoutProjection(view);
  const sourceLeft = projection.edges.find((item) => item.id === "source-left").routing;
  const sourceRight = projection.edges.find((item) => item.id === "source-right").routing;
  const leftJoin = projection.edges.find((item) => item.id === "left-join").routing;
  const rightJoin = projection.edges.find((item) => item.id === "right-join").routing;
  assert.equal(sourceLeft.source.offset, sourceRight.source.offset);
  assert.equal(leftJoin.target.offset, rightJoin.target.offset);
  assert.equal(leftJoin.routePoints[0].x, 600 + STUDIO_NODE_EDGE_CLEARANCE);
  assert.equal(rightJoin.routePoints[0].x, 600 + STUDIO_NODE_EDGE_CLEARANCE);
  assert.equal(sourceLeft.source.port, "out-flow-source-left");
  assert.equal(sourceRight.source.port, "out-flow-source-right");
  assert.equal(leftJoin.target.port, "in-flow-left-join");
  assert.equal(rightJoin.target.port, "in-flow-right-join");
  assert.equal(projection.bundles.length, 2);
  const fanOutBundle = projection.bundles.find((bundle) => bundle.kind === "fan-out");
  const fanInBundle = projection.bundles.find((bundle) => bundle.kind === "fan-in");
  assert.deepEqual(fanOutBundle.edgeIds, ["source-left", "source-right"]);
  assert.deepEqual(fanInBundle.edgeIds, ["left-join", "right-join"]);
  assert.deepEqual(sourceLeft.routePoints[0], fanOutBundle.junction);
  assert.deepEqual(sourceRight.routePoints[0], fanOutBundle.junction);
  assert.equal(fanOutBundle.trunk[0].x, 288);
  assert.equal(fanInBundle.trunk.at(-1).x, 732);
  assert.deepEqual(leftJoin.routePoints.at(-1), fanInBundle.junction);
  assert.deepEqual(rightJoin.routePoints.at(-1), fanInBundle.junction);
});

test("bundled business edges keep a visible terminal segment for their markers", () => {
  const view = graph([
    node("source", { layout: { x: 100, y: 120, width: 180, height: 84 } }),
    node("left", { layout: { x: 420, y: 60, width: 180, height: 84 } }),
    node("right", { layout: { x: 420, y: 240, width: 180, height: 84 } })
  ], [
    edge("source-left", "source", "left"),
    edge("source-right", "source", "right")
  ]);
  const projection = createStoredLayoutProjection(view);
  for (const edgeId of ["source-left", "source-right"]) {
    const projected = projection.edges.find((item) => item.id === edgeId);
    assert.ok(projected);
    const target = projection.nodes.find((item) => item.id === projected.target);
    const lastPoint = projected.routing.routePoints.at(-1);
    assert.ok(target && lastPoint);
    assert.equal(projected.routing.target.side, "left");
    assert.equal(
      target.x - lastPoint.x,
      STUDIO_EDGE_TERMINAL_STUB_LENGTH,
      `expected ${edgeId} to retain a terminal route stub outside the target`
    );
    assert.ok(
      target.x - (lastPoint.x + STUDIO_NODE_EDGE_CLEARANCE) >=
        STUDIO_EDGE_TERMINAL_STUB_LENGTH - STUDIO_NODE_EDGE_CLEARANCE - 1,
      `${edgeId} marker direction segment is too short`
    );
  }
});

test("ELK routing bundles same-direction fan-out and fan-in stubs", async () => {
  const projection = await createElkLayoutProjection(fixture("fan-out"), "flow");
  const fanOutLeft = projection.edges.find((item) => item.id === "split-left").routing;
  const fanOutRight = projection.edges.find((item) => item.id === "split-right").routing;
  const fanInLeft = projection.edges.find((item) => item.id === "left-output").routing;
  const fanInRight = projection.edges.find((item) => item.id === "right-output").routing;
  assert.equal(fanOutLeft.source.offset, fanOutRight.source.offset);
  assert.equal(fanInLeft.target.offset, fanInRight.target.offset);
  for (const routing of [fanOutLeft, fanOutRight, fanInLeft, fanInRight]) {
    assert.ok(routing.routePoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  }
  assert.equal(projection.bundles.filter((bundle) => bundle.kind === "fan-out").length, 1);
  assert.equal(projection.bundles.filter((bundle) => bundle.kind === "fan-in").length, 1);
  assert.deepEqual(fanOutLeft.bundleIds.source, fanOutRight.bundleIds.source);
  assert.deepEqual(fanInLeft.bundleIds.target, fanInRight.bundleIds.target);
  for (const routing of [fanOutLeft, fanOutRight, fanInLeft, fanInRight]) {
    for (let index = 1; index < routing.routePoints.length; index += 1) {
      const previous = routing.routePoints[index - 1];
      const current = routing.routePoints[index];
      assert.equal(previous.x === current.x || previous.y === current.y, true);
    }
  }
});

test("bundle grouping stays inside semantic channels and excludes SCC back edges", () => {
  const view = graph([
    node("source", { layout: { x: 100, y: 120, width: 180, height: 84 } }),
    node("normal-a", { layout: { x: 420, y: 60, width: 180, height: 84 } }),
    node("normal-b", { layout: { x: 420, y: 240, width: 180, height: 84 } }),
    node("error-a", { layout: { x: 740, y: 60, width: 180, height: 84 } }),
    node("error-b", { layout: { x: 740, y: 240, width: 180, height: 84 } }),
    node("back", { layout: { x: -220, y: 120, width: 180, height: 84 } })
  ], [
    edge("source-normal-a", "source", "normal-a", { channel: "normal" }),
    edge("source-normal-b", "source", "normal-b", { channel: "normal" }),
    edge("source-error-a", "source", "error-a", { channel: "error", runtimeOnlyErrorFlow: true }),
    edge("source-error-b", "source", "error-b", { channel: "error", runtimeOnlyErrorFlow: true }),
    edge("source-back", "source", "back", { channel: "loop" })
  ]);
  const projection = createStoredLayoutProjection(view);
  assert.deepEqual(projection.bundles.map((bundle) => bundle.channel).sort(), ["error", "normal"]);
  assert.equal(projection.edges.find((item) => item.id === "source-back").routing.bundleIds, undefined);
  assert.equal(projection.edges.length, 5);
});

test("same-endpoint parallel edges remain separated for label readability", () => {
  const view = graph([
    node("source", { layout: { x: 100, y: 120, width: 180, height: 84 } }),
    node("target", { layout: { x: 420, y: 120, width: 180, height: 84 } })
  ], [
    edge("source-target-a", "source", "target", { eventType: "A" }),
    edge("source-target-b", "source", "target", { eventType: "B" })
  ]);
  const projection = createStoredLayoutProjection(view);
  const first = projection.edges.find((item) => item.id === "source-target-a").routing;
  const second = projection.edges.find((item) => item.id === "source-target-b").routing;
  assert.notEqual(first.source.offset, second.source.offset);
  assert.notEqual(first.target.offset, second.target.offset);
  assert.equal(projection.bundles.length, 0);
});

test("fan-in from opposite sides uses separate nearby input ports", () => {
  const view = graph([
    node("left-source", { layout: { x: 80, y: 120, width: 180, height: 84 } }),
    node("target", { layout: { x: 420, y: 120, width: 180, height: 84 } }),
    node("right-source", { layout: { x: 760, y: 120, width: 180, height: 84 } })
  ], [
    edge("left-target", "left-source", "target"),
    edge("right-target", "right-source", "target")
  ]);
  const projection = createStoredLayoutProjection(view);
  const left = projection.edges.find((item) => item.id === "left-target").routing.target;
  const right = projection.edges.find((item) => item.id === "right-target").routing.target;
  assert.equal(left.side, "left");
  assert.equal(left.port, "in-flow-left-target");
  assert.equal(right.side, "right");
  assert.equal(right.port, "in-flow-right-target");
  assert.equal(projection.bundles.length, 0);
});

test("same-side incoming and outgoing flows use distinct port slots", () => {
  const view = graph([
    node("source", { layout: { x: 80, y: 120, width: 180, height: 84 } }),
    node("center", { layout: { x: 420, y: 120, width: 180, height: 84 } }),
    node("target", { layout: { x: 80, y: 300, width: 180, height: 84 } })
  ], [
    edge("source-center", "source", "center"),
    edge("center-target", "center", "target")
  ]);
  const projection = createStoredLayoutProjection(view);
  const incoming = projection.edges.find((item) => item.id === "source-center").routing.target;
  const outgoing = projection.edges.find((item) => item.id === "center-target").routing.source;
  assert.equal(incoming.side, "left");
  assert.equal(outgoing.side, "left");
  assert.equal(incoming.port, "in-flow-source-center");
  assert.equal(outgoing.port, "out-flow-center-target");
  assert.notEqual(incoming.port, outgoing.port);
});

test("flow endpoint port identities remain stable when layout direction changes", () => {
  const view = graph([
    node("source", { layout: { x: 100, y: 120, width: 180, height: 84 } }),
    node("target", { layout: { x: 440, y: 120, width: 180, height: 84 } })
  ], [edge("source-target", "source", "target")]);
  const forward = createStoredLayoutProjection(view).edges[0].routing;
  view.nodes.find((item) => item.id === "target").layout = { x: 220, y: 360, width: 180, height: 84 };
  const vertical = createStoredLayoutProjection(view).edges[0].routing;
  assert.equal(forward.kind, "forward");
  assert.equal(vertical.kind, "vertical");
  assert.equal(forward.source.port, "out-flow-source-target");
  assert.equal(vertical.source.port, forward.source.port);
  assert.equal(forward.target.port, "in-flow-source-target");
  assert.equal(vertical.target.port, forward.target.port);
  assert.notEqual(forward.source.side, vertical.source.side);
  assert.notEqual(forward.target.side, vertical.target.side);
});

test("moving a node recalculates bundle geometry without changing business edge ids", () => {
  const view = graph([
    node("source", { layout: { x: 100, y: 120, width: 180, height: 84 } }),
    node("left", { layout: { x: 420, y: 60, width: 180, height: 84 } }),
    node("right", { layout: { x: 420, y: 240, width: 180, height: 84 } })
  ], [edge("source-left", "source", "left"), edge("source-right", "source", "right")]);
  const first = createStoredLayoutProjection(view);
  view.nodes.find((item) => item.id === "source").layout.y += 80;
  const second = createStoredLayoutProjection(view);
  assert.deepEqual(second.edges.map((item) => item.id), first.edges.map((item) => item.id));
  assert.notDeepEqual(second.bundles[0].junction, first.bundles[0].junction);
});

test("ELK keeps cyclic role graphs distributed across flow columns", async () => {
  const projection = await createElkLayoutProjection(fixture("cycle"), "flow");
  const roleNodes = projection.nodes.filter((item) => !["input", "output"].includes(item.id));
  assert.ok(new Set(roleNodes.map((item) => item.x)).size > 1);
  assert.equal(diagnosticCodes(projection).includes("NODE_OVERLAP"), false);
});

test("layout digest is stable across repeated layout and input ordering", async () => {
  const original = fixture("fan-out");
  const reordered = graph(original.nodes.slice().reverse(), original.edges.slice().reverse());
  const first = await createElkLayoutProjection(original, "compact");
  const second = await createElkLayoutProjection(reordered, "compact");
  assert.match(first.layoutDigest, /^layout-v1-[0-9a-f]{8}$/);
  assert.equal(first.layoutDigest, second.layoutDigest);
  assert.equal(first.layoutDigest, layoutDigest(first));
  assert.equal(first.layoutDigest, createLayoutDigest(second));
});

test("stored projection detects node overlap and clipped labels", () => {
  const view = graph([
    node("a", { label: "A deliberately long responsibility label", layout: { x: 10, y: 10, width: 72, height: 30 } }),
    node("b", { layout: { x: 60, y: 20, width: 100, height: 50 } })
  ], [edge("a-b", "a", "b")]);
  const projection = createStoredLayoutProjection(view);
  const codes = diagnosticCodes(projection);
  assert.ok(codes.includes("NODE_OVERLAP"));
  assert.ok(codes.includes("LABEL_OVERFLOW"));
});

test("stored projection detects crossings between unrelated routes", () => {
  const view = graph([
    node("a", { layout: { x: 100, y: 80, width: 180, height: 84 } }),
    node("b", { layout: { x: 100, y: 300, width: 180, height: 84 } }),
    node("c", { layout: { x: 500, y: 300, width: 180, height: 84 } }),
    node("d", { layout: { x: 500, y: 80, width: 180, height: 84 } })
  ], [edge("a-c", "a", "c"), edge("b-d", "b", "d")]);
  const projection = createStoredLayoutProjection(view);
  assert.ok(diagnosticCodes(projection).includes("EDGE_CROSSING"));
});

test("layout diagnostics report route loss and unstable ordering", () => {
  const view = graph([node("a"), node("b")], [edge("missing", "a", "missing-node"), edge("missing", "b", "a")]);
  const projection = buildProjection("stored", "flow", [
    { id: "a", x: 0, y: 0, width: 100, height: 50 },
    { id: "a", x: 120, y: 0, width: 100, height: 50 },
    { id: "b", x: 240, y: 0, width: 100, height: 50 }
  ], view);
  assert.ok(diagnosticCodes(projection).includes("ROUTE_LOSS"));
  assert.ok(diagnosticCodes(projection).includes("UNSTABLE_ORDERING"));
});

test("stored loop routes use an independent obstacle-free outer lane", () => {
  const view = graph([
    node("source", { layout: { x: 760, y: 120, width: 180, height: 84 } }),
    node("blocker", { layout: { x: 460, y: 120, width: 180, height: 84 } }),
    node("target", { layout: { x: 140, y: 120, width: 180, height: 84 } })
  ], [edge("source-target-loop", "source", "target", { channel: "loop" })]);
  const projection = createStoredLayoutProjection(view);
  const loop = projection.edges.find((item) => item.id === "source-target-loop");
  assert.equal(loop.routing.router.name, "normal");
  assert.ok(loop.routing.routePoints.length >= 2);
  assert.equal(projection.bundles.length, 0);
  assertRouteAvoidsOtherNodes(projection, "source-target-loop");
});

test("stored self-loop routes leave the role node before turning", () => {
  const view = graph([
    node("role", { layout: { x: 300, y: 200, width: 180, height: 84 } }),
    node("neighbor", { layout: { x: 520, y: 200, width: 180, height: 84 } })
  ], [edge("role-self-loop", "role", "role", { channel: "loop" })]);
  const projection = createStoredLayoutProjection(view);
  const loop = projection.edges.find((item) => item.id === "role-self-loop");
  assert.ok(loop.routing.routePoints.length >= 2);
  assertRouteAvoidsOtherNodes(projection, "role-self-loop");
});

test("ELK loop routes remain obstacle-free after automatic layout", async () => {
  const projection = await createElkLayoutProjection(fixture("cycle"), "flow");
  const loop = projection.edges.find((item) => item.id === "b-a");
  assert.equal(loop.routing.router.name, "normal");
  assertRouteAvoidsOtherNodes(projection, "b-a");
});
