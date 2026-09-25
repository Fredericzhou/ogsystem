import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjection,
  createLayoutDigest,
  createStoredLayoutProjection,
  formatStudioNodeLabel,
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

function projectedRoutePoints(projection, projectedEdge) {
  const source = projection.nodes.find((node) => node.id === projectedEdge.source);
  const target = projection.nodes.find((node) => node.id === projectedEdge.target);
  return [
    terminalPoint(source, projectedEdge.routing.source),
    ...projectedEdge.routing.routePoints,
    terminalPoint(target, projectedEdge.routing.target)
  ];
}

function routesCross(left, right) {
  const leftPoints = left.routePoints;
  const rightPoints = right.routePoints;
  for (let leftIndex = 1; leftIndex < leftPoints.length; leftIndex += 1) {
    const leftStart = leftPoints[leftIndex - 1];
    const leftEnd = leftPoints[leftIndex];
    for (let rightIndex = 1; rightIndex < rightPoints.length; rightIndex += 1) {
      const rightStart = rightPoints[rightIndex - 1];
      const rightEnd = rightPoints[rightIndex];
      const leftHorizontal = leftStart.y === leftEnd.y;
      const rightHorizontal = rightStart.y === rightEnd.y;
      if (leftHorizontal === rightHorizontal) continue;
      const horizontalStart = leftHorizontal ? leftStart : rightStart;
      const horizontalEnd = leftHorizontal ? leftEnd : rightEnd;
      const verticalStart = leftHorizontal ? rightStart : leftStart;
      const verticalEnd = leftHorizontal ? rightEnd : leftEnd;
      const crossingX = verticalStart.x;
      const crossingY = horizontalStart.y;
      if (
        crossingX > Math.min(horizontalStart.x, horizontalEnd.x) &&
        crossingX < Math.max(horizontalStart.x, horizontalEnd.x) &&
        crossingY > Math.min(verticalStart.y, verticalEnd.y) &&
        crossingY < Math.max(verticalStart.y, verticalEnd.y)
      ) return true;
    }
  }
  return false;
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

test("role labels omit the redundant type prefix without forcing oversized nodes", () => {
  const role = node("reviewer", {
    label: "Debate Reviewer",
    structure: { loopScope: { loopId: "debate-loop" }, review: true },
    badges: ["waiting_review"]
  });
  const label = formatStudioNodeLabel(role);
  const size = layoutNodeSize(role);

  assert.match(label, /^Debate Reviewer/);
  assert.doesNotMatch(label, /^Role:/);
  assert.doesNotMatch(label, /Role \/ Agent:/);
  assert.ok(size.width <= 260);
});

test("stored routing keeps diagonal fan-in on its nearby sides", () => {
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
  assert.ok(["right", "top"].includes(sourceLeft.source.side));
  assert.ok(["right", "bottom"].includes(sourceRight.source.side));
  assert.ok(["left", "top", "bottom"].includes(leftJoin.target.side));
  assert.ok(["left", "top", "bottom"].includes(rightJoin.target.side));
  assert.equal(sourceLeft.source.port, "out-flow-source-left");
  assert.equal(sourceRight.source.port, "out-flow-source-right");
  assert.equal(leftJoin.target.port, "in-flow-left-join");
  assert.equal(rightJoin.target.port, "in-flow-right-join");
  assert.equal(projection.bundles.every((bundle) => bundle.edgeIds.every((edgeId) =>
    projection.edges.some((item) => item.id === edgeId)
  )), true);
});

test("bundled business edges keep a visible terminal segment for their markers", () => {
  const view = graph([
    node("source", { layout: { x: 100, y: 120, width: 180, height: 84 } }),
    node("left", { layout: { x: 420, y: 120, width: 180, height: 84 } }),
    node("right", { layout: { x: 640, y: 120, width: 180, height: 84 } })
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

test("ELK routes branch links from nearby ports and keeps output boundaries directional", async () => {
  const projection = await createElkLayoutProjection(fixture("fan-out"), "flow");
  const fanOutLeft = projection.edges.find((item) => item.id === "split-left").routing;
  const fanOutRight = projection.edges.find((item) => item.id === "split-right").routing;
  const fanInLeft = projection.edges.find((item) => item.id === "left-output").routing;
  const fanInRight = projection.edges.find((item) => item.id === "right-output").routing;
  for (const routing of [fanOutLeft, fanOutRight, fanInLeft, fanInRight]) {
    assert.ok(routing.routePoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  }
  assert.equal(projection.bundles.some((bundle) => bundle.kind === "fan-out"), false);
  assert.ok(["right", "top", "bottom"].includes(fanOutLeft.source.side));
  assert.ok(["right", "top", "bottom"].includes(fanOutRight.source.side));
  assert.equal(fanInLeft.target.side, "left");
  assert.equal(fanInRight.target.side, "left");
  for (const routing of [fanOutLeft, fanOutRight, fanInLeft, fanInRight]) {
    for (let index = 1; index < routing.routePoints.length; index += 1) {
      const previous = routing.routePoints[index - 1];
      const current = routing.routePoints[index];
      assert.equal(previous.x === current.x || previous.y === current.y, true);
    }
  }
});

test("ELK keeps converging output flows outside the output node in every layout", async () => {
  const viewModel = fixture("fan-out");
  for (const [mode, expectedSide] of [["flow", "left"], ["compact", "left"], ["stacked", "top"]]) {
    const projection = await createElkLayoutProjection(viewModel, mode);
    const output = projection.nodes.find((item) => item.id === "output");
    const incoming = projection.edges.filter((item) => item.target === "output");
    assert.equal(incoming.length, 2);
    assert.equal(projection.bundles.some((bundle) => bundle.nodeId === "output"), false);

    const connectionAxis = expectedSide === "left" || expectedSide === "right" ? "y" : "x";
    const sourceCoordinate = (edge) => {
      const source = projection.nodes.find((item) => item.id === edge.source);
      return source[connectionAxis] + (connectionAxis === "y" ? source.height : source.width) / 2;
    };
    const orderedBySource = incoming.slice().sort((left, right) => sourceCoordinate(left) - sourceCoordinate(right));
    assert.ok(
      orderedBySource[0].routing.target.offset < orderedBySource[1].routing.target.offset,
      `${mode}: output terminals must preserve upstream order along their shared face`
    );
    const routes = incoming.map((edge) => ({ edge, routePoints: projectedRoutePoints(projection, edge) }));
    assert.equal(routesCross(routes[0], routes[1]), false, `${mode}: converging output flows must not cross`);

    for (const edge of incoming) {
      assert.equal(edge.routing.target.side, expectedSide, `${mode}: ${edge.id} should enter output from its upstream side`);
      const target = expectedSide === "left"
        ? { x: output.x, y: output.y + output.height / 2 + edge.routing.target.offset }
        : { x: output.x + output.width / 2 + edge.routing.target.offset, y: output.y };
      const points = [...edge.routing.routePoints, target];
      const terminalBend = edge.routing.routePoints.at(-2);
      const terminalStub = edge.routing.routePoints.at(-1);
      assert.ok(terminalBend && terminalStub, `${mode}: ${edge.id} needs a clear final approach`);
      const boundaryDistance = Math.abs(terminalStub.x - target.x) + Math.abs(terminalStub.y - target.y);
      assert.ok(
        boundaryDistance >= STUDIO_EDGE_TERMINAL_STUB_LENGTH - 1,
        `${mode}: ${edge.id} needs a full end stub`
      );
      const beforeBend = edge.routing.routePoints.at(-3) ?? projectedRoutePoints(projection, edge)[0];
      const turnsAtTerminalBend = (beforeBend.x === terminalBend.x) !== (terminalBend.x === terminalStub.x);
      if (turnsAtTerminalBend) {
        assert.ok(
          Math.abs(terminalBend.x - terminalStub.x) + Math.abs(terminalBend.y - terminalStub.y) >= 20,
          `${mode}: ${edge.id} turns too close to the end node`
        );
      }
      for (const point of edge.routing.routePoints) {
        assert.equal(
          point.x > output.x && point.x < output.x + output.width &&
            point.y > output.y && point.y < output.y + output.height,
          false,
          `${mode}: ${edge.id} has a route point inside output`
        );
      }
      for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        const crossesOutput = previous.y === current.y
          ? previous.y > output.y && previous.y < output.y + output.height &&
            Math.max(Math.min(previous.x, current.x), output.x) < Math.min(Math.max(previous.x, current.x), output.x + output.width)
          : previous.x === current.x && previous.x > output.x && previous.x < output.x + output.width &&
            Math.max(Math.min(previous.y, current.y), output.y) < Math.min(Math.max(previous.y, current.y), output.y + output.height);
        assert.equal(crossesOutput, false, `${mode}: ${edge.id} crosses through output`);
      }
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
  assert.equal(projection.bundles.every((bundle) => {
    const channels = new Set(bundle.edgeIds.map((edgeId) => {
      const edge = view.edges.find((item) => item.id === edgeId);
      return edge.channel ?? (edge.runtimeOnlyErrorFlow ? "error" : "normal");
    }));
    return channels.size === 1 && !bundle.edgeIds.includes("source-back");
  }), true);
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

test("same-side flow ports stay centered and within the node face", () => {
  const channels = ["normal", "join", "feedback", "error", "loop", "custom"];
  const targets = channels.map((channel, index) => node(`target-${index}`, {
    layout: { x: 600, y: 250, width: 180, height: 84 }
  }));
  const view = graph(
    [node("source", { layout: { x: 100, y: 250, width: 180, height: 84 } }), ...targets],
    channels.map((channel, index) => edge(`source-${index}`, "source", `target-${index}`, { channel }))
  );
  const projection = createStoredLayoutProjection(view);
  const offsets = projection.edges.map((item) => {
    assert.equal(item.routing.source.side, "right");
    return item.routing.source.offset;
  }).sort((left, right) => left - right);

  assert.deepEqual(offsets, [-33, -20, -7, 7, 20, 33]);
  assert.equal(offsets.reduce((total, offset) => total + offset, 0), 0);
  assert.ok(offsets.every((offset) => Math.abs(offset) <= 180 / 2 - 9));
});

test("diagonal links choose a short route from one of the two nearby sides", () => {
  const view = graph([
    node("source", { layout: { x: 100, y: 80, width: 180, height: 84 } }),
    node("target", { layout: { x: 360, y: 220, width: 180, height: 84 } })
  ], [edge("source-target", "source", "target")]);
  const projection = createStoredLayoutProjection(view);
  const projected = projection.edges[0];
  const source = projection.nodes.find((item) => item.id === "source");
  const target = projection.nodes.find((item) => item.id === "target");
  const points = [terminalPoint(source, projected.routing.source), ...projected.routing.routePoints, terminalPoint(target, projected.routing.target)];
  const length = points.slice(1).reduce((total, point, index) =>
    total + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
  assert.ok(["right", "bottom"].includes(projected.routing.source.side));
  assert.ok(["left", "top"].includes(projected.routing.target.side));
  assert.ok(length < 240, `expected a nearby route, received ${length}px: ${JSON.stringify(projected.routing)}`);
  assert.equal(projected.routing.routePoints.every((point, index, routePoints) =>
    index === 0 || point.x === routePoints[index - 1].x || point.y === routePoints[index - 1].y
  ), true);
  const first = projected.routing.routePoints[0];
  const last = projected.routing.routePoints.at(-1);
  const sourceSide = projected.routing.source.side;
  const targetSide = projected.routing.target.side;
  assert.equal(
    sourceSide === "left" || sourceSide === "right" ? first.y === terminalPoint(source, projected.routing.source).y : first.x === terminalPoint(source, projected.routing.source).x,
    true,
    "source arrow segment must leave perpendicular to its node face"
  );
  assert.equal(
    targetSide === "left" || targetSide === "right" ? last.y === terminalPoint(target, projected.routing.target).y : last.x === terminalPoint(target, projected.routing.target).x,
    true,
    "target arrow segment must enter perpendicular to its node face"
  );
});

test("all nearby terminal sides keep a normal arrow segment at both ends", () => {
  const view = graph([
    node("a", { layout: { x: 100, y: 100, width: 180, height: 84 } }),
    node("b", { layout: { x: 420, y: 250, width: 180, height: 84 } })
  ], [edge("a-b", "a", "b")]);
  const projection = createStoredLayoutProjection(view);
  const projected = projection.edges[0];
  const source = projection.nodes.find((item) => item.id === "a");
  const target = projection.nodes.find((item) => item.id === "b");
  const first = projected.routing.routePoints[0];
  const last = projected.routing.routePoints.at(-1);
  const sourceAnchor = terminalPoint(source, projected.routing.source);
  const targetAnchor = terminalPoint(target, projected.routing.target);
  assert.ok(first && last && sourceAnchor && targetAnchor);
  assert.equal(projected.routing.source.side === "left" || projected.routing.source.side === "right" ? first.y : first.x,
    projected.routing.source.side === "left" || projected.routing.source.side === "right" ? sourceAnchor.y : sourceAnchor.x);
  assert.equal(projected.routing.target.side === "left" || projected.routing.target.side === "right" ? last.y : last.x,
    projected.routing.target.side === "left" || projected.routing.target.side === "right" ? targetAnchor.y : targetAnchor.x);
});

test("stored routes do not fold back inside the normal stub on any terminal face", () => {
  const scenarios = [
    { source: { x: 100, y: 100 }, target: { x: 500, y: 100 } },
    { source: { x: 500, y: 100 }, target: { x: 100, y: 100 } },
    { source: { x: 100, y: 100 }, target: { x: 100, y: 400 } },
    { source: { x: 100, y: 400 }, target: { x: 100, y: 100 } }
  ];
  const outside = (point, side, distance) => {
    if (side === "left") return { x: point.x - distance, y: point.y };
    if (side === "right") return { x: point.x + distance, y: point.y };
    if (side === "top") return { x: point.x, y: point.y - distance };
    return { x: point.x, y: point.y + distance };
  };
  const remainsOutside = (point, stub, side) => {
    if (side === "left") return point.x <= stub.x;
    if (side === "right") return point.x >= stub.x;
    if (side === "top") return point.y <= stub.y;
    return point.y >= stub.y;
  };

  for (const [index, scenario] of scenarios.entries()) {
    const sourceLayout = { ...scenario.source, width: 180, height: 84 };
    const targetLayout = { ...scenario.target, width: 180, height: 84 };
    const view = graph([
      node("source", { layout: sourceLayout }),
      node("target", { layout: targetLayout })
    ], [edge(`edge-${index}`, "source", "target")]);
    const initial = createStoredLayoutProjection(view).edges[0].routing;
    const sourcePoint = terminalPoint(sourceLayout, initial.source);
    const targetPoint = terminalPoint(targetLayout, initial.target);
    const sourceClearance = outside(sourcePoint, initial.source.side, STUDIO_NODE_EDGE_CLEARANCE);
    const targetClearance = outside(targetPoint, initial.target.side, STUDIO_NODE_EDGE_CLEARANCE);
    const sourceNearTurn = initial.source.side === "left" || initial.source.side === "right"
      ? { x: sourceClearance.x, y: sourceClearance.y + 18 }
      : { x: sourceClearance.x + 18, y: sourceClearance.y };
    const targetNearTurn = initial.target.side === "left" || initial.target.side === "right"
      ? { x: targetClearance.x, y: targetClearance.y + 18 }
      : { x: targetClearance.x + 18, y: targetClearance.y };
    const middle = {
      x: Math.round((sourcePoint.x + targetPoint.x) / 2),
      y: Math.round((sourcePoint.y + targetPoint.y) / 2 + 36)
    };
    const nodes = [
      { id: "source", ...sourceLayout },
      { id: "target", ...targetLayout }
    ];
    const projection = buildProjection(
      "stored",
      "flow",
      nodes,
      view,
      [],
      new Map([[`edge-${index}`, [sourceClearance, sourceNearTurn, middle, targetNearTurn, targetClearance]]])
    );
    const routing = projection.edges[0].routing;
    const sourceStub = outside(sourcePoint, routing.source.side, STUDIO_EDGE_TERMINAL_STUB_LENGTH);
    const targetStub = outside(targetPoint, routing.target.side, STUDIO_EDGE_TERMINAL_STUB_LENGTH);
    const points = routing.routePoints;

    assert.deepEqual(points[0], sourceStub);
    assert.deepEqual(points.at(-1), targetStub);
    assert.ok(points.length >= 2);
    assert.ok(remainsOutside(points[1], sourceStub, routing.source.side));
    assert.ok(remainsOutside(points.at(-2), targetStub, routing.target.side));
  }
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

test("flow endpoint identities stay stable while nearby sides follow layout direction", () => {
  const view = graph([
    node("source", { layout: { x: 100, y: 120, width: 180, height: 84 } }),
    node("target", { layout: { x: 440, y: 120, width: 180, height: 84 } })
  ], [edge("source-target", "source", "target")]);
  const forward = createStoredLayoutProjection(view).edges[0].routing;
  view.nodes.find((item) => item.id === "target").layout = { x: 100, y: 360, width: 180, height: 84 };
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

test("moving a node recalculates independent flow routes without changing business edge ids", () => {
  const view = graph([
    node("source", { layout: { x: 100, y: 120, width: 180, height: 84 } }),
    node("left", { layout: { x: 420, y: 120, width: 180, height: 84 } }),
    node("right", { layout: { x: 640, y: 120, width: 180, height: 84 } })
  ], [edge("source-left", "source", "left"), edge("source-right", "source", "right")]);
  const first = createStoredLayoutProjection(view);
  view.nodes.find((item) => item.id === "source").layout.x += 80;
  const second = createStoredLayoutProjection(view);
  assert.deepEqual(second.edges.map((item) => item.id), first.edges.map((item) => item.id));
  assert.equal(first.bundles.length, 0);
  assert.equal(second.bundles.length, 0);
  assert.notDeepEqual(
    second.edges.map((item) => item.routing.routePoints),
    first.edges.map((item) => item.routing.routePoints)
  );
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
  assert.equal(diagnosticCodes(projection).includes("EDGE_CROSSING"), false);
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
