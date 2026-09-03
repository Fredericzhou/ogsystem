import test from "node:test";
import assert from "node:assert/strict";

import {
  buildProjection,
  createLayoutDigest,
  createStoredLayoutProjection,
  layoutDigest
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
      [node("input"), node("split", { structure: { routingMode: "parallel_split" } }), node("left"), node("right"), node("output")],
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

test("generic ELK fixtures preserve fan-out, Join, cycle, error, and multi-terminal semantics", async () => {
  const fanOut = await createElkLayoutProjection(fixture("fan-out"), "flow");
  assert.equal(fanOut.edges.length, 5);
  assert.ok(diagnosticCodes(fanOut).includes("UNSUPPORTED_CONSTRAINT"));

  const join = await createElkLayoutProjection(fixture("join"), "flow");
  assert.equal(join.edges.filter((edge) => edge.participatesInJoin).length, 2);
  assert.ok(diagnosticCodes(join).includes("UNSUPPORTED_CONSTRAINT"));

  const cycle = await createElkLayoutProjection(fixture("cycle"), "flow");
  assert.ok(diagnosticCodes(cycle).includes("BACK_EDGE_PRESERVED"));
  assert.equal(cycle.edges.length, 4);

  const error = await createElkLayoutProjection(fixture("error"), "flow");
  assert.equal(error.edges.find((item) => item.id === "work-output").runtimeOnlyErrorFlow, true);
  assert.equal(error.edges.find((item) => item.id === "work-output").routing.lane.startsWith("error:"), true);

  const multiTerminal = await createElkLayoutProjection(fixture("multi-terminal"), "flow");
  assert.equal(multiTerminal.edges.length, 4);
  assert.ok(diagnosticCodes(multiTerminal).includes("MULTI_EDGE_COLLAPSED_FOR_LAYOUT"));
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
