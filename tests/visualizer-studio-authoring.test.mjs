import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import {
  applyCanvasDocumentToAuthoring,
  authoringToCanvasDocument,
  inspectStudioBridgeDraft,
  importMermaidToAuthoring,
  loadStudioAuthoringDraft,
  serializeAuthoringToMermaid
} from "../dist/visualizer/studio-authoring.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import {
  createStudioAuthoringFromMermaidDraft,
  createStudioAuthoringFromTemplate,
  listStudioAuthoringTemplates
} from "../dist/visualizer/studio-templates.js";
import { applyStudioAuthoringCommand } from "../dist/visualizer/studio-graph-commands.js";
import {
  commandFromStudioCommandFormState,
  createDefaultStudioCommandFormState,
  renderStudioCommandForm
} from "../dist/visualizer/studio-graph-command-forms.js";

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

test("Studio canvas apply keeps duplicate edge fallback ids finite and unique", () => {
  const authoring = importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: source
  });
  const canvas = authoringToCanvasDocument(authoring);
  const duplicateEdges = Array.from({ length: 12 }, (_item, index) => ({
    id: "duplicate-edge",
    source: index % 2 === 0 ? "dispatch" : "worker",
    target: "review",
    label: index % 2 === 0 ? "REVIEW" : "DONE",
    eventType: index % 2 === 0 ? "REVIEW" : "DONE",
    runtimeOnlyErrorFlow: false,
    participatesInJoin: index % 2 !== 0
  }));
  const applied = applyCanvasDocumentToAuthoring({
    authoring,
    canvas: {
      ...canvas,
      edges: duplicateEdges
    }
  });

  assert.equal(Object.keys(applied.flows).length, 12);
  assert.equal(new Set(Object.keys(applied.flows)).size, 12);
  assert.equal(applied.flows["duplicate-edge"].flowId, "duplicate-edge");
  assert.equal(applied.flows["2:worker:DONE:review"].flowId, "2:worker:DONE:review");
  assert.equal(applied.flows["12:worker:DONE:review"].flowId, "12:worker:DONE:review");
});

test("Studio flow labels round-trip through authoring and canvas without changing runtime ids", () => {
  const authoring = importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: source
  });
  authoring.roles.dispatch.title = "需求分发";
  authoring.flows["1:dispatch:WORK:worker"].label = "需求已完成";

  const canvas = authoringToCanvasDocument(authoring);
  const labeledEdge = canvas.edges.find((edge) => edge.eventType === "WORK");
  assert.equal(labeledEdge.label, "需求已完成");

  const applied = applyCanvasDocumentToAuthoring({
    authoring,
    canvas: {
      ...canvas,
      edges: canvas.edges.map((edge) =>
        edge.eventType === "WORK"
          ? { ...edge, eventType: "WORK_READY" }
          : edge
      )
    }
  });
  const editedFlow = Object.values(applied.flows).find((flow) => flow.eventType === "WORK_READY");
  assert.equal(editedFlow.label, "需求已完成");
  assert.equal(editedFlow.fromRoleId, "dispatch");
  assert.equal(editedFlow.toRoleId, "worker");

  const generated = serializeAuthoringToMermaid(applied);
  assert.match(generated, /\|WORK_READY\|/);
  assert.doesNotMatch(generated, /需求已完成|需求分发|flow\.label|role\.title/);
  const reimported = importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: generated
  });
  assert.equal(Object.values(reimported.flows).some((flow) => flow.label === "需求已完成"), false);
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

test("Studio authoring draft load only suppresses missing draft files", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-studio-draft-load-"));
  const missing = await loadStudioAuthoringDraft(workdir);
  assert.equal(missing.authoring, null);

  const draftDir = path.resolve(workdir, ".ogs", "studio");
  await mkdir(draftDir, { recursive: true });
  await writeFile(path.resolve(draftDir, "system.authoring.json"), "{invalid", "utf8");
  await assert.rejects(
    () => loadStudioAuthoringDraft(workdir),
    /Invalid JSON/
  );
});

test("Studio bridge inspection exposes authoring parse failures through validation diagnostics", async () => {
  const invalidSource = ["flowchart TD", "%% system.id=test.studio.authoring", "invalid"].join("\n");
  const bridge = await inspectStudioBridgeDraft({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: invalidSource,
    validateSystemSource: async () => ({
      ok: false,
      diagnostics: [
        {
          source: "parser",
          severity: "error",
          message: "Mermaid parse failed."
        }
      ]
    })
  });

  assert.equal(bridge.authoring, null);
  assert.equal(bridge.extracted, null);
  assert.equal(bridge.validation.ok, false);
  assert.equal(Array.isArray(bridge.validation.diagnostics), true);
  assert.equal(
    bridge.validation.diagnostics.some((diagnostic) =>
      diagnostic &&
      diagnostic.source === "studio-bridge" &&
      /Failed to extract Studio Bridge graph/.test(String(diagnostic.message))
    ),
    true
  );
});

test("Studio authoring commands create validated roles and edges from command forms", () => {
  const authoring = importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: source
  });
  const canvas = authoringToCanvasDocument(authoring);

  const addedRole = applyStudioAuthoringCommand({
    authoring,
    canvas,
    command: {
      type: "add-role",
      roleId: "qa_gate",
      title: "QA Gate",
      bindingKind: "model",
      modelRef: "opencode/gpt-5.4",
      x: 440,
      y: 180
    }
  });

  assert.equal(addedRole.blockedCode, undefined);
  assert.equal(addedRole.authoring.roles.qa_gate.title, "QA Gate");
  assert.equal(addedRole.authoring.roles.qa_gate.bindingKind, "model");
  assert.equal(addedRole.authoring.roles.qa_gate.modelRef, "opencode/gpt-5.4");
  assert.equal(addedRole.canvas.nodes.some((node) => node.roleId === "qa_gate" && node.label === "QA Gate"), true);

  const duplicateRole = applyStudioAuthoringCommand({
    authoring: addedRole.authoring,
    canvas: addedRole.canvas,
    command: { type: "add-role", roleId: "qa_gate", bindingKind: "noop" }
  });
  assert.equal(duplicateRole.blockedCode, "duplicate-role-id");

  const invalidRole = applyStudioAuthoringCommand({
    authoring: addedRole.authoring,
    canvas: addedRole.canvas,
    command: { type: "add-role", roleId: "output", bindingKind: "noop" }
  });
  assert.equal(invalidRole.blockedCode, "invalid-role-id");

  const addedEdge = applyStudioAuthoringCommand({
    authoring: addedRole.authoring,
    canvas: addedRole.canvas,
    command: {
      type: "add-edge",
      sourceRoleId: "qa_gate",
      targetRoleId: "output",
      eventType: "ERROR_TIMEOUT",
      label: "超时处理",
      runtimeOnlyErrorFlow: true
    }
  });

  assert.equal(addedEdge.blockedCode, undefined);
  const edge = Object.values(addedEdge.authoring.flows).find((flow) => flow.fromRoleId === "qa_gate");
  assert.equal(edge.toRoleId, "__system_end__");
  assert.equal(edge.eventType, "ERROR_TIMEOUT");
  assert.equal(edge.label, "超时处理");
  assert.equal(edge.runtimeOnlyErrorFlow, true);

  const updatedEdge = applyStudioAuthoringCommand({
    authoring: addedEdge.authoring,
    canvas: addedEdge.canvas,
    command: {
      type: "update-edge",
      flowId: edge.flowId,
      originalSourceRoleId: "qa_gate",
      originalTargetRoleId: "output",
      originalEventType: "ERROR_TIMEOUT",
      sourceRoleId: "qa_gate",
      targetRoleId: "output",
      eventType: "ERROR_RETRY",
      label: "超时处理",
      runtimeOnlyErrorFlow: true
    }
  });
  const retryEdge = Object.values(updatedEdge.authoring.flows).find((flow) => flow.fromRoleId === "qa_gate");
  assert.equal(retryEdge.eventType, "ERROR_RETRY");
  assert.equal(retryEdge.label, "超时处理");
  assert.equal(updatedEdge.selectedFlowKey, "qa_gate:ERROR_RETRY:output");

  const duplicateEdge = applyStudioAuthoringCommand({
    authoring: updatedEdge.authoring,
    canvas: updatedEdge.canvas,
    command: {
      type: "add-edge",
      sourceRoleId: "qa_gate",
      targetRoleId: "output",
      eventType: "ERROR_RETRY",
      label: "另一个显示名"
    }
  });
  assert.equal(duplicateEdge.blockedCode, "duplicate-edge");
});

test("Studio command forms expose visual role package, model, and profile choices", () => {
  const authoring = importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: source
  });
  const context = {
    authoring,
    rolePackages: {
      rolePackages: [{ roleId: "writer", name: "Writer", status: "ok", files: { "role.json": true } }]
    },
    projectConfig: {
      modelCatalog: {
        models: [{ ref: "opencode/gpt-5.4", name: "GPT 5.4", provider: "opencode", model: "gpt-5.4" }]
      },
      profiles: [{ profileId: "profile.review", toolRef: "tool.review" }],
      tools: [{ toolRef: "tool.review", runner: "local_shell" }]
    }
  };

  const repositoryState = createDefaultStudioCommandFormState({ kind: "add-role", context });
  const repositoryHtml = renderStudioCommandForm({ state: repositoryState, context });
  assert.match(repositoryHtml, /Role package/);
  assert.match(repositoryHtml, /From this project&#39;s role repository/);

  const customState = {
    ...repositoryState,
    fields: { ...repositoryState.fields, mode: "custom", roleId: "custom_role", title: "Custom", bindingKind: "model", modelRef: "opencode/gpt-5.4" },
    validation: { ok: true, diagnostics: [] }
  };
  const customHtml = renderStudioCommandForm({ state: customState, context });
  assert.doesNotMatch(customHtml, /Role package/);
  assert.match(customHtml, /<select name="modelRef">/);
  assert.match(customHtml, /opencode\/gpt-5\.4/);
  assert.doesNotMatch(customHtml, /name="profileId"/);
  const modelCommand = commandFromStudioCommandFormState(customState);
  assert.equal(modelCommand.modelRef, "opencode/gpt-5.4");

  const existingProfileState = {
    ...repositoryState,
    fields: { ...repositoryState.fields, mode: "custom", roleId: "exec_role", title: "Exec", bindingKind: "exec", profileMode: "existing", profileId: "profile.review" },
    validation: { ok: true, diagnostics: [] }
  };
  const existingProfileHtml = renderStudioCommandForm({ state: existingProfileState, context });
  assert.match(existingProfileHtml, /name="profileMode" value="existing" checked/);
  assert.match(existingProfileHtml, /profile\.review/);
  assert.equal(commandFromStudioCommandFormState(existingProfileState).profileId, "profile.review");

  const createProfileState = {
    ...repositoryState,
    fields: {
      ...repositoryState.fields,
      mode: "custom",
      roleId: "exec_role",
      title: "Exec",
      bindingKind: "exec",
      profileMode: "create",
      profileId: "profile.exec_role",
      newProfileId: "profile.exec_role",
      newProfileToolRef: "tool.review",
      newProfileTimeoutMs: "30000",
      newProfileMaxOutputBytes: "4096"
    },
    validation: { ok: true, diagnostics: [] }
  };
  const createProfileHtml = renderStudioCommandForm({ state: createProfileState, context });
  assert.match(createProfileHtml, /Generated profile id/);
  assert.match(createProfileHtml, /readonly/);
  const createProfileCommand = commandFromStudioCommandFormState(createProfileState);
  assert.equal(createProfileCommand.profileId, "profile.exec_role");
  assert.deepEqual(createProfileCommand.profileDraft, {
    profileId: "profile.exec_role",
    toolRef: "tool.review",
    timeoutMs: 30000,
    maxOutputBytes: 4096
  });
});

test("Studio edge command forms keep display labels distinct from event types", () => {
  const authoring = importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: source
  });
  const context = { authoring };
  const state = createDefaultStudioCommandFormState({
    kind: "edit-edge",
    context,
    flowId: "1:dispatch:WORK:worker",
    sourceRoleId: "dispatch",
    targetRoleId: "worker",
    eventType: "WORK",
    label: "需求已完成"
  });

  const html = renderStudioCommandForm({ state, context });
  assert.match(html, /Display name/);
  assert.match(html, /name="label" value="需求已完成"/);

  const command = commandFromStudioCommandFormState(state);
  assert.equal(command.type, "update-edge");
  assert.equal(command.eventType, "WORK");
  assert.equal(command.label, "需求已完成");
});

test("Studio command form helpers keep trim and HTML escape semantics after consolidation", () => {
  const authoring = importMermaidToAuthoring({
    workdir: "/tmp/project",
    systemPath: "/tmp/project/system.mmd",
    systemSource: source
  });
  const context = {
    authoring,
    rolePackages: {
      rolePackages: [
        {
          roleId: " writer ",
          name: " Writer <unsafe> ",
          status: " ok ",
          files: { "role.json": true }
        }
      ]
    },
    projectConfig: {
      modelCatalog: {
        models: [{ ref: " model.fast ", name: " GPT <5> ", provider: " openai ", model: " gpt-5 " }]
      }
    }
  };

  const state = createDefaultStudioCommandFormState({ kind: "add-role", context });
  assert.equal(state.fields.repositoryRoleId, "writer");
  assert.equal(state.fields.roleId, "writer");
  assert.equal(state.fields.title, "Writer <unsafe>");

  const html = renderStudioCommandForm({
    state: {
      ...state,
      fields: {
        ...state.fields,
        bindingKind: "model",
        modelRef: "model.fast"
      },
      validation: {
        ok: false,
        diagnostics: [{ severity: "error", code: 'bad"><tag', message: 'bad"><tag' }]
      }
    },
    context
  });
  assert.match(html, /Writer &lt;unsafe&gt;/);
  assert.match(html, /GPT &lt;5&gt; - openai\/gpt-5/);
  assert.match(html, /bad&quot;&gt;&lt;tag/);
  assert.doesNotMatch(html, /bad"><tag/);
});
