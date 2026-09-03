import test from "node:test";
import assert from "node:assert/strict";

import { projectGraphReadingViewModel } from "../dist/visualizer/graph-view-model.js";

const view = {
  version: 1,
  mode: "edit",
  nodes: ["input", "a", "b", "c", "output"].map((id) => ({
    id,
    roleId: id,
    kind: id === "input" || id === "output" ? "boundary" : "roleSeat",
    entityKind: id === "input" || id === "output" ? "boundary" : "responsibility_seat",
    roleSeat: id !== "input" && id !== "output",
    executionScope: id === "input" || id === "output" ? "boundary" : "roleAggregate",
    label: id,
    badges: [],
    structure: {},
    layout: { x: id.charCodeAt(0), y: 0, width: 100, height: 50 },
    editable: false
  })),
  edges: [
    { id: "ab", source: "a", target: "b", eventType: "NEXT", channel: "normal" },
    { id: "bc", source: "b", target: "c", eventType: "ERROR", channel: "error" },
    { id: "ca", source: "c", target: "a", eventType: "LOOP", channel: "loop" }
  ],
  capabilities: { editable: false, canAddRole: false, canAddEdge: false, canDelete: false },
  validation: { ok: true, diagnostics: [] }
};

test("graph reading projection keeps semantic source and layout immutable", () => {
  const original = JSON.stringify(view);
  const projected = projectGraphReadingViewModel(view, { mode: "upstream", roleId: "c" });
  assert.deepEqual(projected.edges.map((edge) => edge.id), ["ab", "bc", "ca"]);
  assert.equal(projected.nodes.find((node) => node.id === "a")?.layout.x, 97);
  assert.equal(JSON.stringify(view), original);
});

test("graph reading projection supports route and channel filters", () => {
  assert.deepEqual(
    projectGraphReadingViewModel(view, { mode: "route", flowKey: "b:ERROR:c" }).edges.map((edge) => edge.id),
    ["bc"]
  );
  assert.deepEqual(
    projectGraphReadingViewModel(view, { mode: "all", channel: "loop" }).edges.map((edge) => edge.id),
    ["ca"]
  );
});
