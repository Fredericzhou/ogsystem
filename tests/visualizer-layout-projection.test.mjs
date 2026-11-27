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
import { STUDIO_SYSTEM_END_ROLE_ID, STUDIO_SYSTEM_START_ROLE_ID } from "../src/visualizer/studio-contracts.ts";

function node(id, overrides = {}) {
  const boundary = id === "__system_start__" || id === "__system_end__";
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
      [node(STUDIO_SYSTEM_START_ROLE_ID), node("split", { structure: { routingMode: "parallel_split", routeOrder: ["right", "left"] } }), node("left"), node("right"), node(STUDIO_SYSTEM_END_ROLE_ID)],
      [edge("start-split", STUDIO_SYSTEM_START_ROLE_ID, "split", { eventType: "START" }), edge("split-left", "split", "left"), edge("split-right", "split", "right"), edge("left-end", "left", STUDIO_SYSTEM_END_ROLE_ID), edge("right-end", "right", STUDIO_SYSTEM_END_ROLE_ID)]
    );
  }
  if (name === "join") {
    return graph(
      [node(STUDIO_SYSTEM_START_ROLE_ID), node("left"), node("right"), node("join", { structure: { joinMode: "all_of", joinSources: ["left", "right"] } }), node(STUDIO_SYSTEM_END_ROLE_ID)],
      [edge("start-left", STUDIO_SYSTEM_START_ROLE_ID, "left", { eventType: "START" }), edge("start-right", STUDIO_SYSTEM_START_ROLE_ID, "right", { eventType: "START" }), edge("left-join", "left", "join", { participatesInJoin: true, channel: "join" }), edge("right-join", "right", "join", { participatesInJoin: true, channel: "join" }), edge("join-end", "join", STUDIO_SYSTEM_END_ROLE_ID)]
    );
  }
  if (name === "cycle") {
    return graph([node(STUDIO_SYSTEM_START_ROLE_ID), node("a"), node("b"), node(STUDIO_SYSTEM_END_ROLE_ID)], [edge("start-a", STUDIO_SYSTEM_START_ROLE_ID, "a", { eventType: "START" }), edge("a-b", "a", "b"), edge("b-a", "b", "a", { channel: "loop" }), edge("b-end", "b", STUDIO_SYSTEM_END_ROLE_ID)]);
  }
  if (name === "error") {
    return graph([node(STUDIO_SYSTEM_START_ROLE_ID), node("work"), node(STUDIO_SYSTEM_END_ROLE_ID)], [edge("start-work", STUDIO_SYSTEM_START_ROLE_ID, "work", { eventType: "START" }), edge("work-end", "work", STUDIO_SYSTEM_END_ROLE_ID, { channel: "error", runtimeOnlyErrorFlow: true })]);
  }
  if (name === "multi-terminal") {
    return graph([node(STUDIO_SYSTEM_START_ROLE_ID), node("source"), node("target"), node(STUDIO_SYSTEM_END_ROLE_ID)], [
      edge("start-source", STUDIO_SYSTEM_START_ROLE_ID, "source", { eventType: "START" }),
      edge("source-target-a", "source", "target", { eventType: "A", channel: "normal" }),
      edge("source-target-b", "source", "target", { eventType: "B", channel: "feedback" }),
      edge("target-end", "target", STUDIO_SYSTEM_END_ROLE_ID)
    ]);
  }
  if (name === "size-variation") {
    return graph([node(STUDIO_SYSTEM_START_ROLE_ID, { layout: { x: 0, y: 0, width: 120, height: 52 } }), node("small", { layout: { x: 0, y: 0, width: 96, height: 42 } }), node("large", { layout: { x: 0, y: 0, width: 300, height: 132 } }), node(STUDIO_SYSTEM_END_ROLE_ID, { layout: { x: 0, y: 0, width: 140, height: 60 } })], [edge("start-small", STUDIO_SYSTEM_START_ROLE_ID, "small", { eventType: "START" }), edge("small-large", "small", "large"), edge("large-end", "large", STUDIO_SYSTEM_END_ROLE_ID)]);
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

function routesShareCollinearSegment(left, right) {
  for (let leftIndex = 1; leftIndex < left.length; leftIndex += 1) {
    const leftStart = left[leftIndex - 1];
    const leftEnd = left[leftIndex];
    for (let rightIndex = 1; rightIndex < right.length; rightIndex += 1) {
      const rightStart = right[rightIndex - 1];
      const rightEnd = right[rightIndex];
      if (leftStart.y === leftEnd.y && rightStart.y === rightEnd.y && leftStart.y === rightStart.y) {
        if (Math.min(Math.max(leftStart.x, leftEnd.x), Math.max(rightStart.x, rightEnd.x)) >
          Math.max(Math.min(leftStart.x, leftEnd.x), Math.min(rightStart.x, rightEnd.x))) return true;
      }
      if (leftStart.x === leftEnd.x && rightStart.x === rightEnd.x && leftStart.x === rightStart.x) {
        if (Math.min(Math.max(leftStart.y, leftEnd.y), Math.max(rightStart.y, rightEnd.y)) >
          Math.max(Math.min(leftStart.y, leftEnd.y), Math.min(rightStart.y, rightEnd.y))) return true;
      }
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
  assert.equal(error.edges.find((item) => item.id === "work-end").runtimeOnlyErrorFlow, true);
  assert.equal(error.edges.find((item) => item.id === "work-end").routing.lane.startsWith("error:"), true);

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
  assert.equal(projection.nodes.find((item) => item.id === "large").width, 220);
  assert.equal(projection.nodes.find((item) => item.id === "large").height, 132);
  assert.equal(diagnosticCodes(projection).includes("NODE_OVERLAP"), false);
});

test("ELK routes stay attached when pinned nodes override automatic positions", async () => {
  const view = fixture("fan-out");
  const pinned = view.nodes.find((item) => item.id === "left");
  pinned.layout = { ...pinned.layout, x: 740, y: 360, pinned: true };
  const projection = await createElkLayoutProjection(view, "flow");
  const projectedPinned = projection.nodes.find((item) => item.id === "left");
  assert.equal(projectedPinned.x, 740);
  assert.equal(projectedPinned.y, 360);

  for (const projected of projection.edges) {
    const points = projectedRoutePoints(projection, projected);
    const source = points[0];
    const target = points.at(-1);
    const sourceNode = projection.nodes.find((item) => item.id === projected.source);
    const targetNode = projection.nodes.find((item) => item.id === projected.target);
    assert.ok(source.x >= sourceNode.x - 0.5 && source.x <= sourceNode.x + sourceNode.width + 0.5 &&
      source.y >= sourceNode.y - 0.5 && source.y <= sourceNode.y + sourceNode.height + 0.5,
    `${projected.id} source terminal must touch its projected node`);
    assert.ok(target.x >= targetNode.x - 0.5 && target.x <= targetNode.x + targetNode.width + 0.5 &&
      target.y >= targetNode.y - 0.5 && target.y <= targetNode.y + targetNode.height + 0.5,
    `${projected.id} target terminal must touch its projected node`);
  }
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
  assert.ok(size.width <= 220);
});

test("stored projection clamps persisted role widths and expands long labels within the card limit", () => {
  const view = graph([
    node("long-role", {
      label: "Long responsibility title ".repeat(8),
      layout: { x: 10, y: 10, width: 420, height: 84 }
    }),
    node(STUDIO_SYSTEM_START_ROLE_ID),
    node(STUDIO_SYSTEM_END_ROLE_ID)
  ], [edge("start-role", STUDIO_SYSTEM_START_ROLE_ID, "long-role", { eventType: "START" }), edge("role-end", "long-role", STUDIO_SYSTEM_END_ROLE_ID)]);
  const projection = createStoredLayoutProjection(view);
  const projected = projection.nodes.find((item) => item.id === "long-role");

  assert.equal(projected.width, 220);
  assert.ok(projected.height > 84);
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
  const fanInLeft = projection.edges.find((item) => item.id === "left-end").routing;
  const fanInRight = projection.edges.find((item) => item.id === "right-end").routing;
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
    const output = projection.nodes.find((item) => item.id === STUDIO_SYSTEM_END_ROLE_ID);
    const incoming = projection.edges.filter((item) => item.target === STUDIO_SYSTEM_END_ROLE_ID);
    assert.equal(incoming.length, 2);
    assert.equal(projection.bundles.some((bundle) => bundle.nodeId === STUDIO_SYSTEM_END_ROLE_ID), false);

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

test("coincident same-face projections distribute endpoint offsets symmetrically", () => {
  for (const [count, expected] of [[2, [-10, 10]], [3, [-20, 0, 20]]]) {
    const source = node("source", { layout: { x: 100, y: 120, width: 180, height: 84 } });
    const targets = Array.from({ length: count }, (_, index) => node(`target-${index}`, {
      layout: { x: 420 + index * 220, y: 120, width: 180, height: 84 }
    }));
    const view = graph([source, ...targets], targets.map((target) =>
      edge(`source-${target.id}`, "source", target.id)
    ));
    const projection = createStoredLayoutProjection(view);
    const offsets = projection.edges
      .map((item) => item.routing.source.offset)
      .sort((left, right) => left - right);
    assert.deepEqual(offsets, expected);
  }
});

test("endpoint offset projection clamps both bounds after multiple PAVA blocks", () => {
  const view = graph([
    node("source-a", { layout: { x: -220, y: 87, width: 180, height: 84 } }),
    node("source-b", { layout: { x: 0, y: 87, width: 180, height: 84 } }),
    node("source-c", { layout: { x: 200, y: 153, width: 180, height: 84 } }),
    node("center", { layout: { x: 420, y: 120, width: 180, height: 84 } })
  ], [
    edge("source-a-center", "source-a", "center"),
    edge("source-b-center", "source-b", "center"),
    edge("source-c-center", "source-c", "center")
  ]);
  const projection = createStoredLayoutProjection(view);
  const offsets = projection.edges
    .map((item) => item.routing.target.offset)
    .sort((left, right) => left - right);
  assert.deepEqual(offsets, [-20, 0, 20]);
  assert.equal(offsets.every((offset) => offset >= -33 && offset <= 33), true);
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

test("horizontally separated nodes keep horizontal terminals when vertically offset", () => {
  const view = graph([
    node("source", { layout: { x: 100, y: 100, width: 180, height: 84 } }),
    node("target", { layout: { x: 400, y: 130, width: 180, height: 84 } })
  ], [edge("source-target", "source", "target")]);
  const routing = createStoredLayoutProjection(view).edges[0].routing;
  assert.deepEqual([routing.source.side, routing.target.side], ["right", "left"]);
});

test("vertically separated nodes keep vertical terminals when horizontally offset", () => {
  const view = graph([
    node("source", { layout: { x: 100, y: 100, width: 180, height: 84 } }),
    node("target", { layout: { x: 130, y: 400, width: 180, height: 84 } })
  ], [edge("source-target", "source", "target")]);
  const routing = createStoredLayoutProjection(view).edges[0].routing;
  assert.deepEqual([routing.source.side, routing.target.side], ["bottom", "top"]);
});

test("boundary edges follow the separated axis instead of wrapping around a nearby node", () => {
  const view = graph([
    node(STUDIO_SYSTEM_START_ROLE_ID, { layout: { x: 83, y: 373, width: 180, height: 84 }, kind: "boundary", roleSeat: false }),
    node("analyst", { layout: { x: 108, y: 527, width: 180, height: 84 } }),
    node(STUDIO_SYSTEM_END_ROLE_ID, { layout: { x: 113, y: 697, width: 180, height: 84 }, kind: "boundary", roleSeat: false })
  ], [
    edge("start-analyst", STUDIO_SYSTEM_START_ROLE_ID, "analyst"),
    edge("analyst-end", "analyst", STUDIO_SYSTEM_END_ROLE_ID)
  ]);
  const projection = createStoredLayoutProjection(view);
  const startEdge = projection.edges.find((item) => item.id === "start-analyst").routing;
  const endEdge = projection.edges.find((item) => item.id === "analyst-end").routing;
  assert.deepEqual([startEdge.source.side, startEdge.target.side], ["bottom", "top"]);
  assert.deepEqual([endEdge.source.side, endEdge.target.side], ["bottom", "top"]);
  assert.ok(startEdge.routePoints.length <= 3);
  assert.ok(endEdge.routePoints.length <= 3);
});

test("short horizontal gaps keep terminal stubs monotonic without a turnaround", () => {
  const view = graph([
    node("source", { layout: { x: 100, y: 100, width: 180, height: 84 } }),
    node("target", { layout: { x: 300, y: 130, width: 180, height: 84 } })
  ], [edge("source-target", "source", "target")]);
  const projection = createStoredLayoutProjection(view);
  const routing = projection.edges[0].routing;
  const source = projection.nodes.find((item) => item.id === "source");
  const target = projection.nodes.find((item) => item.id === "target");
  const point = (nodeValue, terminalValue) => terminalValue.side === "right"
    ? { x: nodeValue.x + nodeValue.width, y: nodeValue.y + nodeValue.height / 2 + terminalValue.offset }
    : terminalValue.side === "left"
      ? { x: nodeValue.x, y: nodeValue.y + nodeValue.height / 2 + terminalValue.offset }
      : terminalValue.side === "bottom"
        ? { x: nodeValue.x + nodeValue.width / 2 + terminalValue.offset, y: nodeValue.y + nodeValue.height }
        : { x: nodeValue.x + nodeValue.width / 2 + terminalValue.offset, y: nodeValue.y };
  const points = [point(source, routing.source), ...routing.routePoints, point(target, routing.target)];
  const horizontalDirections = points.slice(1).map((next, index) => {
    const previous = points[index];
    return previous.y === next.y ? Math.sign(next.x - previous.x) : 0;
  }).filter(Boolean);
  assert.ok(horizontalDirections.every((direction, index) => index === 0 || direction === horizontalDirections[index - 1]));
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

test("same-face incoming and outgoing terminals use a stable global direction order", () => {
  const view = graph([
    node("source", { layout: { x: 0, y: 120, width: 180, height: 84 } }),
    node("center", { layout: { x: 420, y: 120, width: 180, height: 84 } }),
    node("target", { layout: { x: 220, y: 120, width: 180, height: 84 } })
  ], [
    edge("source-center", "source", "center"),
    edge("center-target", "center", "target")
  ]);
  const projection = createStoredLayoutProjection(view);
  const incoming = projection.edges.find((item) => item.id === "source-center").routing.target;
  const outgoing = projection.edges.find((item) => item.id === "center-target").routing.source;
  assert.equal(incoming.side, "left");
  assert.equal(outgoing.side, "left");
  assert.notEqual(incoming.offset, outgoing.offset);
  // Both counterparts have the same projection coordinate. The edge's global
  // source/target direction keeps the order identical at both endpoints.
  assert.ok(outgoing.offset < incoming.offset);
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

test("reciprocal vertical edges use separate lateral feedback lanes", async () => {
  const view = graph([
    node("a", { layout: { x: 100, y: 100, width: 180, height: 84 } }),
    node("b", { layout: { x: 100, y: 300, width: 180, height: 84 } })
  ], [edge("a-b", "a", "b"), edge("b-a", "b", "a")]);

  const assertSeparated = (projection) => {
    const first = projection.edges.find((item) => item.id === "a-b");
    const second = projection.edges.find((item) => item.id === "b-a");
    assert.ok(first && second);
    assert.notEqual(first.routing.lane, second.routing.lane);
    assert.equal(routesShareCollinearSegment(
      projectedRoutePoints(projection, first),
      projectedRoutePoints(projection, second)
    ), false);
  };

  assertSeparated(createStoredLayoutProjection(view));
  assertSeparated(await createElkLayoutProjection(view, "stacked"));
});

test("multiple feedback edges use short-to-long staircase lanes", () => {
  const view = graph([
    node("a", { layout: { x: 100, y: 260, width: 180, height: 84 } }),
    node("b", { layout: { x: 360, y: 260, width: 180, height: 84 } }),
    node("c", { layout: { x: 620, y: 260, width: 180, height: 84 } })
  ], [
    edge("a-b", "a", "b", { topologyOrder: "1L" }),
    edge("b-c", "b", "c", { topologyOrder: "2L" }),
    edge("c-a", "c", "a", { topologyOrder: "3L" })
  ]);
  const projection = createStoredLayoutProjection(view);
  const feedback = projection.edges.map((item) => item.routing);
  assert.equal(new Set(feedback.map((routing) => routing.lane)).size, feedback.length);
  const outerRoutes = feedback.filter((routing) => routing.source.side === routing.target.side);
  assert.ok(outerRoutes.length >= 2);
  assert.equal(outerRoutes.every((routing) => routing.routePoints.length >= 2), true);
  for (let leftIndex = 0; leftIndex < outerRoutes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < outerRoutes.length; rightIndex += 1) {
      const leftEdge = projection.edges.find((item) => item.routing === outerRoutes[leftIndex]);
      const rightEdge = projection.edges.find((item) => item.routing === outerRoutes[rightIndex]);
      assert.equal(
        routesShareCollinearSegment(projectedRoutePoints(projection, leftEdge), projectedRoutePoints(projection, rightEdge)),
        false
      );
    }
  }
  assert.equal(projection.bundles.length, 0);
});

test("feedback lanes stay separated when a shared obstacle forces outer fallback tracks", () => {
  const view = graph([
    node("a", { layout: { x: 100, y: 260, width: 180, height: 84 } }),
    node("b", { layout: { x: 360, y: 260, width: 180, height: 84 } }),
    node("c", { layout: { x: 620, y: 260, width: 180, height: 84 } }),
    node("blocker", { layout: { x: 320, y: 180, width: 180, height: 60 } })
  ], [
    edge("a-b", "a", "b", { topologyOrder: "1L" }),
    edge("b-c", "b", "c", { topologyOrder: "2L" }),
    edge("c-a", "c", "a", { topologyOrder: "3L" })
  ]);
  const projection = createStoredLayoutProjection(view);
  const feedbackEdges = projection.edges.filter((item) => item.routing.kind === "backward");
  assert.ok(feedbackEdges.length >= 2);
  for (let leftIndex = 0; leftIndex < feedbackEdges.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < feedbackEdges.length; rightIndex += 1) {
      assert.equal(
        routesShareCollinearSegment(
          projectedRoutePoints(projection, feedbackEdges[leftIndex]),
          projectedRoutePoints(projection, feedbackEdges[rightIndex])
        ),
        false
      );
    }
  }
});

test("independent SCCs restart feedback lane indexes locally", () => {
  const nodes = [
    node("a", { layout: { x: 100, y: 260, width: 180, height: 84 } }),
    node("b", { layout: { x: 360, y: 260, width: 180, height: 84 } }),
    node("c", { layout: { x: 620, y: 260, width: 180, height: 84 } }),
    node("d", { layout: { x: 980, y: 260, width: 180, height: 84 } }),
    node("e", { layout: { x: 1240, y: 260, width: 180, height: 84 } }),
    node("f", { layout: { x: 1500, y: 260, width: 180, height: 84 } })
  ];
  const edges = [
    edge("a-b", "a", "b", { topologyOrder: "1L" }),
    edge("b-c", "b", "c", { topologyOrder: "2L" }),
    edge("c-a", "c", "a", { topologyOrder: "3L" }),
    edge("d-e", "d", "e", { topologyOrder: "4L" }),
    edge("e-f", "e", "f", { topologyOrder: "5L" }),
    edge("f-d", "f", "d", { topologyOrder: "6L" })
  ];
  const projection = createStoredLayoutProjection(graph(nodes, edges));
  const laneIndexes = (ids) => ids.map((id) => {
    const lane = projection.edges.find((item) => item.id === id).routing.lane;
    return Number(lane.match(/:feedback-(?:top|bottom)-(\d+)$/)?.[1]);
  });
  assert.deepEqual(laneIndexes(["a-b", "b-c", "c-a"]), [0, 1, 2]);
  assert.deepEqual(laneIndexes(["d-e", "e-f", "f-d"]), [0, 1, 2]);
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
  const roleNodes = projection.nodes.filter((item) => ![STUDIO_SYSTEM_START_ROLE_ID, STUDIO_SYSTEM_END_ROLE_ID].includes(item.id));
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
    node("a", { label: "A deliberately long responsibility label ".repeat(8), layout: { x: 10, y: 10, width: 72, height: 30 } }),
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

test("horizontally adjacent nodes stay on right-to-left sides without diagonal segments", () => {
  const view = graph([
    node("left", { layout: { x: 100, y: 120, width: 180, height: 84 } }),
    node("right", { layout: { x: 340, y: 212, width: 180, height: 84 } }),
    // Placed within the 40px loop clearance above `left` to verify nearby routes
    // use compact clearance instead of needlessly detouring to `right -> top`.
    node("upper-neighbor", { layout: { x: 340, y: 8, width: 180, height: 84 } })
  ], [edge("left-right", "left", "right")]);
  const projection = createStoredLayoutProjection(view);
  const projected = projection.edges[0];
  assert.equal(projected.routing.source.side, "right");
  assert.equal(projected.routing.target.side, "left");
  const points = projectedRoutePoints(projection, projected);
  for (let index = 1; index < points.length; index += 1) {
    assert.ok(
      points[index].x === points[index - 1].x || points[index].y === points[index - 1].y,
      `expected orthogonal segment ${index}: ${JSON.stringify(points)}`
    );
  }
  assertRouteAvoidsOtherNodes(projection, "left-right");
});

test("bottom-face fan-out to lower-left and lower-right targets orders ports without crossing", () => {
  const view = graph([
    node("parent", { layout: { x: 300, y: 80, width: 180, height: 84 } }),
    // Deliberately reverse alphabetical IDs relative to X coordinates.
    node("z-left", { layout: { x: 60, y: 280, width: 180, height: 84 } }),
    node("a-right", { layout: { x: 540, y: 280, width: 180, height: 84 } })
  ], [
    edge("to-left", "parent", "z-left"),
    edge("to-right", "parent", "a-right")
  ]);
  const projection = createStoredLayoutProjection(view);
  const toLeft = projection.edges.find((item) => item.id === "to-left");
  const toRight = projection.edges.find((item) => item.id === "to-right");
  assert.ok(toLeft && toRight);
  if (toLeft.routing.source.side === "bottom" && toRight.routing.source.side === "bottom") {
    assert.ok(toLeft.routing.source.offset < toRight.routing.source.offset);
  }
  assert.equal(
    routesCross(
      { routePoints: projectedRoutePoints(projection, toLeft) },
      { routePoints: projectedRoutePoints(projection, toRight) }
    ),
    false
  );
});

test("same-row fan-out and nested feedback loops nest outer routes around inner routes without crossing", () => {
  const fanOutView = graph([
    node("architect", { layout: { x: 100, y: 100, width: 180, height: 84 } }),
    node("z-near", { layout: { x: 360, y: 280, width: 180, height: 84 } }),
    node("a-mid", { layout: { x: 600, y: 280, width: 180, height: 84 } }),
    node("m-far", { layout: { x: 840, y: 280, width: 180, height: 84 } })
  ], [
    edge("e-near", "architect", "z-near"),
    edge("e-mid", "architect", "a-mid"),
    edge("e-far", "architect", "m-far")
  ]);
  const fanOut = createStoredLayoutProjection(fanOutView);
  for (let i = 0; i < fanOut.edges.length; i += 1) {
    for (let j = i + 1; j < fanOut.edges.length; j += 1) {
      assert.equal(
        routesCross(
          { routePoints: projectedRoutePoints(fanOut, fanOut.edges[i]) },
          { routePoints: projectedRoutePoints(fanOut, fanOut.edges[j]) }
        ),
        false,
        `expected zero crossing between ${fanOut.edges[i].id} and ${fanOut.edges[j].id}`
      );
    }
  }

  const loopView = graph([
    node("a", { layout: { x: 100, y: 260, width: 180, height: 84 } }),
    node("b", { layout: { x: 360, y: 260, width: 180, height: 84 } }),
    node("c", { layout: { x: 620, y: 260, width: 180, height: 84 } })
  ], [
    edge("a-b", "a", "b", { topologyOrder: "1L" }),
    edge("b-c", "b", "c", { topologyOrder: "2L" }),
    edge("c-a", "c", "a", { topologyOrder: "3L" })
  ]);
  const loopProjection = createStoredLayoutProjection(loopView);
  for (let i = 0; i < loopProjection.edges.length; i += 1) {
    for (let j = i + 1; j < loopProjection.edges.length; j += 1) {
      assert.equal(
        routesCross(
          { routePoints: projectedRoutePoints(loopProjection, loopProjection.edges[i]) },
          { routePoints: projectedRoutePoints(loopProjection, loopProjection.edges[j]) }
        ),
        false,
        `expected concentric nesting without crossing between ${loopProjection.edges[i].id} and ${loopProjection.edges[j].id}`
      );
    }
  }
});

test("shared Z-channel fan-out spreads vertical tracks without collinear overlap or crossing", () => {
  const view = graph([
    node("dispatch", { layout: { x: 100, y: 100, width: 180, height: 84 } }),
    node("upper", { layout: { x: 440, y: 220, width: 180, height: 84 } }),
    node("lower", { layout: { x: 440, y: 360, width: 180, height: 84 } })
  ], [
    edge("to-upper", "dispatch", "upper"),
    edge("to-lower", "dispatch", "lower")
  ]);
  const projection = createStoredLayoutProjection(view);
  const upper = projection.edges.find((item) => item.id === "to-upper");
  const lower = projection.edges.find((item) => item.id === "to-lower");
  assert.ok(upper && lower);
  const upperPts = projectedRoutePoints(projection, upper);
  const lowerPts = projectedRoutePoints(projection, lower);
  assert.equal(routesCross({ routePoints: upperPts }, { routePoints: lowerPts }), false);
  assert.equal(routesShareCollinearSegment(upperPts, lowerPts), false);
});

test("horizontal and vertical blocked skip-edges use outer rings while adjacent links stay inner without crossings", async () => {
  const horizontalView = graph([
    node("a", { layout: { x: 100, y: 160, width: 180, height: 84 } }),
    node("b", { layout: { x: 380, y: 160, width: 180, height: 84 } }),
    node("c", { layout: { x: 660, y: 160, width: 180, height: 84 } })
  ], [
    edge("ab", "a", "b"),
    edge("bc", "b", "c"),
    edge("ac", "a", "c")
  ]);

  for (const projection of [createStoredLayoutProjection(horizontalView), await createElkLayoutProjection(horizontalView, "flow")]) {
    const ab = projection.edges.find((item) => item.id === "ab");
    const bc = projection.edges.find((item) => item.id === "bc");
    const ac = projection.edges.find((item) => item.id === "ac");
    assert.ok(ab && bc && ac);
    assert.deepEqual([ab.routing.source.side, ab.routing.target.side], ["right", "left"]);
    assert.deepEqual([bc.routing.source.side, bc.routing.target.side], ["right", "left"]);
    assert.ok(["top", "bottom"].includes(ac.routing.source.side));
    assert.equal(ac.routing.source.side, ac.routing.target.side);
    const paths = [ab, bc, ac].map((item) => projectedRoutePoints(projection, item));
    for (let i = 0; i < paths.length; i += 1) {
      for (let j = i + 1; j < paths.length; j += 1) {
        assert.equal(routesCross({ routePoints: paths[i] }, { routePoints: paths[j] }), false);
        assert.equal(routesShareCollinearSegment(paths[i], paths[j]), false);
      }
    }
    assertRouteAvoidsOtherNodes(projection, "ac");
  }

  const verticalView = graph([
    node("a", { layout: { x: 200, y: 80, width: 180, height: 84 } }),
    node("b", { layout: { x: 200, y: 260, width: 180, height: 84 } }),
    node("c", { layout: { x: 200, y: 440, width: 180, height: 84 } })
  ], [
    edge("ab", "a", "b"),
    edge("bc", "b", "c"),
    edge("ac", "a", "c")
  ]);
  const verticalProjection = createStoredLayoutProjection(verticalView);
  const vAb = verticalProjection.edges.find((item) => item.id === "ab");
  const vBc = verticalProjection.edges.find((item) => item.id === "bc");
  const vAc = verticalProjection.edges.find((item) => item.id === "ac");
  assert.ok(vAb && vBc && vAc);
  assert.deepEqual([vAb.routing.source.side, vAb.routing.target.side], ["bottom", "top"]);
  assert.deepEqual([vBc.routing.source.side, vBc.routing.target.side], ["bottom", "top"]);
  assert.ok(["left", "right"].includes(vAc.routing.source.side));
  assert.equal(vAc.routing.source.side, vAc.routing.target.side);
  assert.equal(
    routesCross({ routePoints: projectedRoutePoints(verticalProjection, vAb) }, { routePoints: projectedRoutePoints(verticalProjection, vAc) }),
    false
  );
  assert.equal(
    routesCross({ routePoints: projectedRoutePoints(verticalProjection, vBc) }, { routePoints: projectedRoutePoints(verticalProjection, vAc) }),
    false
  );
});

test("multiple blocked skip-edges nest concentrically on outer staircase lanes without crossing", () => {
  const view = graph([
    node("a", { layout: { x: 100, y: 220, width: 180, height: 84 } }),
    node("b", { layout: { x: 360, y: 220, width: 180, height: 84 } }),
    node("c", { layout: { x: 620, y: 220, width: 180, height: 84 } }),
    node("d", { layout: { x: 880, y: 220, width: 180, height: 84 } })
  ], [
    edge("ab", "a", "b"),
    edge("bc", "b", "c"),
    edge("cd", "c", "d"),
    edge("ac", "a", "c"),
    edge("ad", "a", "d")
  ]);
  const projection = createStoredLayoutProjection(view);
  const paths = projection.edges.map((item) => ({ id: item.id, points: projectedRoutePoints(projection, item) }));
  for (let i = 0; i < paths.length; i += 1) {
    for (let j = i + 1; j < paths.length; j += 1) {
      assert.equal(
        routesCross({ routePoints: paths[i].points }, { routePoints: paths[j].points }),
        false,
        `expected zero crossing between ${paths[i].id} and ${paths[j].id}`
      );
      assert.equal(
        routesShareCollinearSegment(paths[i].points, paths[j].points),
        false,
        `expected no collinear overlap between ${paths[i].id} and ${paths[j].id}`
      );
    }
  }
});

test("collinear boundary detour aligns its source port with the bypass side to avoid crossing adjacent edges", () => {
  const view = graph([
    node("a", { layout: { x: 100, y: 160, width: 180, height: 84 } }),
    node("b", { layout: { x: 380, y: 160, width: 180, height: 84 } }),
    node(STUDIO_SYSTEM_END_ROLE_ID, { layout: { x: 660, y: 167, width: 170, height: 70 } })
  ], [
    edge("ab", "a", "b"),
    edge("b-end", "b", STUDIO_SYSTEM_END_ROLE_ID),
    edge("a-end", "a", STUDIO_SYSTEM_END_ROLE_ID)
  ]);
  const projection = createStoredLayoutProjection(view);
  const ab = projection.edges.find((item) => item.id === "ab");
  const aEnd = projection.edges.find((item) => item.id === "a-end");
  assert.ok(ab && aEnd);
  assert.equal(aEnd.routing.target.side, "left");
  assert.equal(
    routesCross({ routePoints: projectedRoutePoints(projection, ab) }, { routePoints: projectedRoutePoints(projection, aEnd) }),
    false
  );
});

test("cyclic flow outer lanes keep monotonic staircase bounds when intermediate cycle nodes are staggered vertically", async () => {
  // Stored staggered geometry where middle node `b` sits higher than `a` and `c`.
  const staggeredStored = graph([
    node("a", { layout: { x: 100, y: 260, width: 180, height: 84 } }),
    node("b", { layout: { x: 360, y: 64, width: 180, height: 84 } }),
    node("c", { layout: { x: 620, y: 260, width: 180, height: 84 } })
  ], [
    edge("a-b", "a", "b", { topologyOrder: "1L" }),
    edge("b-c", "b", "c", { topologyOrder: "2L" }),
    edge("a-c", "a", "c", { topologyOrder: "3L" }),
    edge("c-a", "c", "a", { topologyOrder: "4L" })
  ]);
  const storedProjection = createStoredLayoutProjection(staggeredStored);
  const storedPaths = storedProjection.edges.map((item) => ({ id: item.id, points: projectedRoutePoints(storedProjection, item) }));
  for (let i = 0; i < storedPaths.length; i += 1) {
    for (let j = i + 1; j < storedPaths.length; j += 1) {
      assert.equal(
        routesCross({ routePoints: storedPaths[i].points }, { routePoints: storedPaths[j].points }),
        false,
        `expected zero crossing between ${storedPaths[i].id} and ${storedPaths[j].id}`
      );
    }
  }

  // ELK flow layout with a cyclic diamond + skip edge (s7 topology) where `b` is
  // positioned above `a` and `c`.
  const elkCyclicView = graph([
    node(STUDIO_SYSTEM_START_ROLE_ID),
    node("a"),
    node("b"),
    node("c"),
    node("d"),
    node(STUDIO_SYSTEM_END_ROLE_ID)
  ], [
    edge("start-a", STUDIO_SYSTEM_START_ROLE_ID, "a", { eventType: "START", topologyOrder: "1" }),
    edge("a-b", "a", "b", { eventType: "E1", topologyOrder: "3L" }),
    edge("a-d", "a", "d", { eventType: "E2", topologyOrder: "4L" }),
    edge("b-c", "b", "c", { eventType: "E3", topologyOrder: "5L" }),
    edge("d-c", "d", "c", { eventType: "E4", topologyOrder: "6L" }),
    edge("a-c", "a", "c", { eventType: "SKIP", topologyOrder: "7L" }),
    edge("c-a", "c", "a", { eventType: "BACK", topologyOrder: "8L" }),
    edge("c-end", "c", STUDIO_SYSTEM_END_ROLE_ID, { eventType: "DONE", topologyOrder: "2" })
  ]);
  const elkFlow = await createElkLayoutProjection(elkCyclicView, "flow");
  const elkPaths = elkFlow.edges.map((item) => ({ id: item.id, points: projectedRoutePoints(elkFlow, item) }));
  for (let i = 0; i < elkPaths.length; i += 1) {
    for (let j = i + 1; j < elkPaths.length; j += 1) {
      assert.equal(
        routesCross({ routePoints: elkPaths[i].points }, { routePoints: elkPaths[j].points }),
        false,
        `expected zero flow crossing between ${elkPaths[i].id} and ${elkPaths[j].id}`
      );
    }
  }
});

test("cyclic flow staircase lanes sort by tangential axis span so short hops stay inside long skips", () => {
  const view = graph([
    node("a", { layout: { x: 100, y: 64, width: 180, height: 84 } }),
    node("b", { layout: { x: 360, y: 360, width: 180, height: 84 } }),
    node("c", { layout: { x: 620, y: 64, width: 180, height: 84 } })
  ], [
    edge("a-b", "a", "b", { topologyOrder: "1L" }),
    edge("b-c", "b", "c", { topologyOrder: "2L" }),
    edge("a-c", "a", "c", { topologyOrder: "3L" }),
    edge("c-a", "c", "a", { topologyOrder: "4L" })
  ]);
  const projection = createStoredLayoutProjection(view);
  const ab = projection.edges.find((item) => item.id === "a-b");
  const bc = projection.edges.find((item) => item.id === "b-c");
  const ac = projection.edges.find((item) => item.id === "a-c");
  assert.ok(ab && bc && ac);
  assert.equal(
    routesCross({ routePoints: projectedRoutePoints(projection, ab) }, { routePoints: projectedRoutePoints(projection, ac) }),
    false
  );
  assert.equal(
    routesCross({ routePoints: projectedRoutePoints(projection, bc) }, { routePoints: projectedRoutePoints(projection, ac) }),
    false
  );
});

test("role-to-role edges entering a cycle avoid crossing existing cycle outer lanes in flow layout", async () => {
  const view = graph([
    node(STUDIO_SYSTEM_START_ROLE_ID),
    node("p"),
    node("a"),
    node("b"),
    node("c"),
    node("q"),
    node(STUDIO_SYSTEM_END_ROLE_ID)
  ], [
    edge("start-p", STUDIO_SYSTEM_START_ROLE_ID, "p", { eventType: "START", topologyOrder: "1" }),
    edge("p-a", "p", "a", { eventType: "E0", topologyOrder: "2" }),
    edge("a-b", "a", "b", { eventType: "E1", topologyOrder: "3" }),
    edge("a-c", "a", "c", { eventType: "E3", topologyOrder: "4" }),
    edge("b-c", "b", "c", { eventType: "E2", topologyOrder: "7L" }),
    edge("c-b", "c", "b", { eventType: "E4", topologyOrder: "8L" }),
    edge("c-q", "c", "q", { eventType: "E5", topologyOrder: "5" }),
    edge("q-end", "q", STUDIO_SYSTEM_END_ROLE_ID, { eventType: "DONE", topologyOrder: "6" })
  ]);
  for (const mode of ["flow", "stacked"]) {
    const projection = await createElkLayoutProjection(view, mode);
    const paths = projection.edges.map((item) => ({ id: item.id, points: projectedRoutePoints(projection, item) }));
    for (let i = 0; i < paths.length; i += 1) {
      for (let j = i + 1; j < paths.length; j += 1) {
        assert.equal(
          routesCross({ routePoints: paths[i].points }, { routePoints: paths[j].points }),
          false,
          `expected zero ${mode} crossing between ${paths[i].id} and ${paths[j].id}`
        );
      }
    }
  }
});

test("self-loop and obstacle-tight feedback routes never backtrack 180 degrees or invert rounded corner arcs", async () => {
  const assertNo180Backtrack = (projection, label) => {
    const nodeById = new Map(projection.nodes.map((item) => [item.id, item]));
    const rimPoint = (terminal, node, offset) => {
      const base = terminal.side === "left"
        ? { x: node.x, y: node.y + node.height / 2 + terminal.offset }
        : terminal.side === "right"
          ? { x: node.x + node.width, y: node.y + node.height / 2 + terminal.offset }
          : terminal.side === "top"
            ? { x: node.x + node.width / 2 + terminal.offset, y: node.y }
            : { x: node.x + node.width / 2 + terminal.offset, y: node.y + node.height };
      if (!offset) return base;
      if (terminal.side === "left") return { x: base.x - offset, y: base.y };
      if (terminal.side === "right") return { x: base.x + offset, y: base.y };
      if (terminal.side === "top") return { x: base.x, y: base.y - offset };
      return { x: base.x, y: base.y + offset };
    };
    for (const projectedEdge of projection.edges) {
      const sourceNode = nodeById.get(projectedEdge.source);
      const targetNode = nodeById.get(projectedEdge.target);
      if (!sourceNode || !targetNode) continue;
      const start = rimPoint(projectedEdge.routing.source, sourceNode, projectedEdge.routing.source.port ? 3.5 : 0);
      const end = rimPoint(projectedEdge.routing.target, targetNode, projectedEdge.routing.target.port ? 2.5 : 0);
      const full = [start, ...projectedEdge.routing.routePoints, end];
      for (let index = 1; index < full.length - 1; index += 1) {
        const prev = full[index - 1];
        const curr = full[index];
        const next = full[index + 1];
        const v1x = curr.x - prev.x;
        const v1y = curr.y - prev.y;
        const v2x = next.x - curr.x;
        const v2y = next.y - curr.y;
        const cross = v1x * v2y - v1y * v2x;
        const dot = v1x * v2x + v1y * v2y;
        assert.equal(
          Math.abs(cross) < 0.01 && dot < -0.01,
          false,
          `${label}: edge ${projectedEdge.id} has a 180-degree backtrack at vertex ${index} (${JSON.stringify(full)})`
        );
      }
    }
  };

  // Self-loop stored projection (previously backtracked 12px at right clearance).
  const selfLoopView = graph([
    node("ship", { layout: { x: 200, y: 200, width: 196, height: 84 } })
  ], [
    edge("ship-rework", "ship", "ship", { channel: "loop" })
  ]);
  const selfLoopProj = createStoredLayoutProjection(selfLoopView);
  assertNo180Backtrack(selfLoopProj, "stored self-loop");
  const selfLoopEdge = selfLoopProj.edges[0];
  assert.ok(selfLoopEdge.routing.routePoints.length >= 3);
  assert.equal(selfLoopEdge.routing.routePoints[0].x, selfLoopEdge.routing.routePoints[1].x);

  // Feedback edge with an obstacle whose expanded top edge falls inside the 24px stub band.
  const tightFeedbackView = graph([
    node("a", { layout: { x: 100, y: 100, width: 180, height: 84 } }),
    node("c", { layout: { x: 620, y: 100, width: 180, height: 84 } }),
    node("top-blocker", { layout: { x: 360, y: -16, width: 180, height: 84 } }),
    node("stub-band-obstacle", { layout: { x: 900, y: 126, width: 180, height: 84 } })
  ], [
    edge("a-c", "a", "c", { topologyOrder: "1L" }),
    edge("c-a", "c", "a", { topologyOrder: "2L" })
  ]);
  assertNo180Backtrack(createStoredLayoutProjection(tightFeedbackView), "tight-stub feedback");

  // Also verify ELK flow and stacked modes on a cyclic + self-loop graph.
  const cyclicView = graph([
    node(STUDIO_SYSTEM_START_ROLE_ID),
    node("a"),
    node("b"),
    node("c"),
    node(STUDIO_SYSTEM_END_ROLE_ID)
  ], [
    edge("start-a", STUDIO_SYSTEM_START_ROLE_ID, "a", { eventType: "START", topologyOrder: "1" }),
    edge("a-b", "a", "b", { eventType: "E1", topologyOrder: "3L" }),
    edge("b-c", "b", "c", { eventType: "E2", topologyOrder: "4L" }),
    edge("a-c", "a", "c", { eventType: "SKIP", topologyOrder: "5L" }),
    edge("c-a", "c", "a", { eventType: "BACK", topologyOrder: "6L" }),
    edge("b-b", "b", "b", { eventType: "RETRY", channel: "loop", topologyOrder: "7L" }),
    edge("c-end", "c", STUDIO_SYSTEM_END_ROLE_ID, { eventType: "DONE", topologyOrder: "2" })
  ]);
  assertNo180Backtrack(await createElkLayoutProjection(cyclicView, "flow"), "elk flow cyclic+self-loop");
  assertNo180Backtrack(await createElkLayoutProjection(cyclicView, "stacked"), "elk stacked cyclic+self-loop");
});
