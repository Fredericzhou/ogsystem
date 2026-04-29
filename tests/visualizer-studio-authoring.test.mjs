import test from "node:test";
import assert from "node:assert/strict";

import {
  applyCanvasDocumentToAuthoring,
  authoringToCanvasDocument,
  importMermaidToAuthoring,
  serializeAuthoringToMermaid
} from "../dist/visualizer/studio-authoring.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import {
  createStudioAuthoringFromMermaidDraft,
  createStudioAuthoringFromTemplate,
  listStudioAuthoringTemplates
} from "../dist/visualizer/studio-templates.js";

const source = [
  "flowchart TD",
  "%% system.id=test.studio.authoring",
  "%% system.version=1.0.0",
  "%% law.global=law.minimal.base",
  "%% entry.role=dispatch",
  "%% handoff.mode=strict",
  "%% handoff.contracts=contracts/handoff.json",
  "%% model.bind.dispatch=model.fast",
  "%% exec.bind.review=profile.review",
  "%% role.mode.dispatch=parallel_split",
  "%% route.order.dispatch=worker,review",
  "%% join.mode.review=all_of",
  "%% join.sources.review=worker,dispatch",
  "%% loop.max.worker=2",
  "%% review.mode.review=required",
  "%% review.timeout.action.review=pause",
  "%% review.rework.target.review=worker",
  "%% review.terminate.scope.review=branch",
  "%% context.map.review.summary=source(worker).content",
  "input -->|START| a[Role:dispatch]",
  "a[Role:dispatch] -->|WORK| b[Role:worker]",
  "a[Role:dispatch] -->|REVIEW| c[Role:review]",
  "b[Role:worker] -->|DONE| c[Role:review]",
  "c[Role:review] -->|APPROVED| output",
  ""
].join("\n");

test("Studio authoring import extracts normalized roles, flows, and metadata", () => {
  const authoring = importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: source
  });

  assert.equal(authoring.version, 1);
  assert.equal(authoring.system.systemId, "test.studio.authoring");
  assert.equal(authoring.system.entryRoleId, "dispatch");
  assert.equal(authoring.roles.dispatch.bindingKind, "model");
  assert.equal(authoring.roles.review.bindingKind, "exec");
  assert.equal(authoring.roles.dispatch.routingMode, "parallel_split");
  assert.deepEqual(authoring.roles.review.joinSources, ["worker", "dispatch"]);
  assert.equal(authoring.roles.review.review.mode, "required");
  assert.equal(authoring.roles.review.contextMap.summary, "source(worker).content");
  assert.equal(Object.keys(authoring.flows).length, 4);
});

test("Studio authoring serializer is deterministic and preserves parse semantics", () => {
  const authoring = importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: source
  });
  const first = serializeAuthoringToMermaid(authoring);
  const second = serializeAuthoringToMermaid(authoring);
  assert.equal(first, second);
  assert.match(first, /%% model\.bind\.dispatch=model\.fast/);
  assert.match(first, /%% exec\.bind\.review=profile\.review/);
  assert.match(first, /%% join\.sources\.review=worker,dispatch/);

  const original = parseSystemFromMermaidSource(source);
  const roundTripped = parseSystemFromMermaidSource(first);
  assert.equal(roundTripped.systemId, original.systemId);
  assert.equal(roundTripped.entryRoleId, original.entryRoleId);
  assert.deepEqual(roundTripped.modelBinding, original.modelBinding);
  assert.deepEqual(roundTripped.executionBinding, original.executionBinding);
  assert.deepEqual(roundTripped.graph?.joinSourcesByRoleId, original.graph?.joinSourcesByRoleId);
  assert.equal(roundTripped.flows.length, original.flows.length);
});

test("Studio canvas adapter keeps layout state out of generated Mermaid", () => {
  const authoring = importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: source
  });
  const canvas = authoringToCanvasDocument(authoring);
  assert.equal(canvas.nodes.some((node) => node.roleId === "review" && node.badges.includes("J")), true);
  assert.equal(canvas.edges.some((edge) => edge.eventType === "DONE" && edge.participatesInJoin), true);

  const moved = applyCanvasDocumentToAuthoring({
    authoring,
    canvas: {
      ...canvas,
      viewport: { x: 10, y: 20, zoom: 0.8 },
      nodes: canvas.nodes.map((node) =>
        node.roleId === "review"
          ? { ...node, x: 777, y: 888, width: 222, height: 111 }
          : node
      )
    }
  });
  assert.equal(moved.layout.nodes.review.x, 777);
  assert.equal(moved.layout.viewport.zoom, 0.8);
  const generated = serializeAuthoringToMermaid(moved);
  assert.doesNotMatch(generated, /777|888|viewport|zoom|width|height/);
  assert.equal(parseSystemFromMermaidSource(generated).systemId, "test.studio.authoring");
});

test("Studio canvas apply rebuilds flows from edges and preserves existing role layout", () => {
  const authoring = importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: source
  });
  const canvas = authoringToCanvasDocument(authoring);
  const applied = applyCanvasDocumentToAuthoring({
    authoring,
    canvas: {
      ...canvas,
      nodes: canvas.nodes.map((node) =>
        node.roleId === "worker"
          ? { ...node, x: 333, y: 444, width: 200, height: 90 }
          : node
      ),
      edges: [
        ...canvas.edges.filter((edge) => edge.eventType !== "APPROVED"),
        {
          id: "new-worker-approved-output",
          source: "worker",
          target: "__system_end__",
          label: "APPROVED",
          eventType: "APPROVED",
          runtimeOnlyErrorFlow: false,
          participatesInJoin: false
        }
      ]
    }
  });

  assert.equal(applied.layout.nodes.worker.x, 333);
  assert.equal(applied.flows["new-worker-approved-output"].toRoleId, "__system_end__");
  assert.equal(Object.values(applied.flows).some((flow) => flow.fromRoleId === "review" && flow.eventType === "APPROVED"), false);
  assert.equal(Object.values(applied.flows).some((flow) => flow.eventType === "APPROVED"), true);
  const generated = serializeAuthoringToMermaid(applied);
  assert.equal(parseSystemFromMermaidSource(generated).flows.some((flow) => flow.fromRoleId === "review" && flow.eventType === "APPROVED"), false);
  assert.doesNotMatch(generated, /333|444|viewport|width|height/);
});

test("Studio canvas apply stabilizes missing and duplicate edge ids", () => {
  const authoring = importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: source
  });
  const canvas = authoringToCanvasDocument(authoring);
  const applied = applyCanvasDocumentToAuthoring({
    authoring,
    canvas: {
      ...canvas,
      edges: [
        {
          source: "dispatch",
          target: "worker",
          label: "WORK",
          eventType: "WORK",
          runtimeOnlyErrorFlow: false,
          participatesInJoin: false
        },
        {
          id: "duplicate-edge",
          source: "dispatch",
          target: "review",
          label: "REVIEW",
          eventType: "REVIEW",
          runtimeOnlyErrorFlow: false,
          participatesInJoin: false
        },
        {
          id: "duplicate-edge",
          source: "worker",
          target: "review",
          label: "DONE",
          eventType: "DONE",
          runtimeOnlyErrorFlow: false,
          participatesInJoin: true
        }
      ]
    }
  });

  assert.deepEqual(Object.keys(applied.flows), [
    "1:dispatch:WORK:worker",
    "duplicate-edge",
    "3:worker:DONE:review"
  ]);
  assert.equal(applied.flows["3:worker:DONE:review"].fromRoleId, "worker");
  assert.equal(applied.flows["3:worker:DONE:review"].toRoleId, "review");
  assert.equal(serializeAuthoringToMermaid(applied), serializeAuthoringToMermaid(applied));
});

test("Studio canvas apply ignores edges that reference missing roles", () => {
  const authoring = importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: source
  });
  const canvas = authoringToCanvasDocument(authoring);
  const applied = applyCanvasDocumentToAuthoring({
    authoring,
    canvas: {
      ...canvas,
      edges: [
        ...canvas.edges,
        {
          id: "missing-source",
          source: "missing",
          target: "review",
          label: "BAD",
          eventType: "BAD",
          runtimeOnlyErrorFlow: false,
          participatesInJoin: false
        },
        {
          id: "missing-target",
          source: "dispatch",
          target: "missing",
          label: "BAD",
          eventType: "BAD",
          runtimeOnlyErrorFlow: false,
          participatesInJoin: false
        }
      ]
    }
  });

  assert.equal(Object.hasOwn(applied.flows, "missing-source"), false);
  assert.equal(Object.hasOwn(applied.flows, "missing-target"), false);
  assert.equal(Object.values(applied.flows).length, canvas.edges.length);
});

test("Studio assisted authoring templates and Mermaid drafts produce valid authoring documents", () => {
  const templates = listStudioAuthoringTemplates();
  assert.deepEqual(templates.map((template) => template.id).sort(), ["consultation", "debate", "review"]);
  for (const template of templates) {
    const authoring = createStudioAuthoringFromTemplate({
      templateId: template.id,
      workdir: "/tmp/project",
      systemPath: "/tmp/project/system.mmd"
    });
    const generated = serializeAuthoringToMermaid(authoring);
    assert.equal(parseSystemFromMermaidSource(generated).systemId, authoring.system.systemId);
  }

  const nl2mmdDraft = createStudioAuthoringFromMermaidDraft({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/generated.mmd",
    systemSource: source
  });
  assert.equal(nl2mmdDraft.system.systemId, "test.studio.authoring");
});
