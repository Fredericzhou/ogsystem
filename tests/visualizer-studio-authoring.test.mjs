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
