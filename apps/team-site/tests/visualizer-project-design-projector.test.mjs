import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createVisualizerProjectDesignProjector } from "../infrastructure/visualizer-project-design-projector.mjs";

test("Visualizer design projector reads source, maps display titles, and applies locale labels", async () => {
  const calls = [];
  const project = { projectId: "project-1", projectDigest: "digest", workdir: "/workspace/project" };
  const authoring = { version: 1 };
  const viewModel = { nodes: [] };
  const projector = createVisualizerProjectDesignProjector({
    read: async (path) => {
      calls.push(["read", path]);
      if (path.endsWith("system.mmd")) return "flowchart TD\n A-->B";
      return JSON.stringify({ seats: { planner: { title: "Planner title" }, empty: { title: " " }, ignored: "not an object" } });
    },
    parseSystem: (source) => calls.push(["parse", source]),
    importAuthoring: (options) => (calls.push(["authoring", options]), authoring),
    toCanvas: (value) => (calls.push(["canvas", value]), { canvas: true }),
    buildViewModel: (options) => (calls.push(["viewModel", options]), viewModel)
  });

  const result = await projector.project(project, "en");
  assert.deepEqual(result, {
    projectId: "project-1",
    projectDigest: "digest",
    systemSource: "flowchart TD\n A-->B",
    authoring,
    canvas: { canvas: true },
    viewModel
  });
  assert.deepEqual(calls[0], ["read", path.join(project.workdir, "system.mmd")]);
  assert.deepEqual(calls[1], ["parse", "flowchart TD\n A-->B"]);
  assert.deepEqual(calls[2][0], "read");
  assert.equal(calls[2][1], path.join(project.workdir, "system.design.json"));
  assert.equal(calls[3][0], "read");
  assert.equal(calls[3][1], path.join(project.workdir, ".ogs", "model-selection.json"));
  assert.equal(calls[4][0], "authoring");
  assert.deepEqual([...calls[4][1].roleDisplayNames], [["planner", "Planner title"]]);
  assert.deepEqual(calls[4][1].modelSelection, { seats: { planner: { title: "Planner title" }, empty: { title: " " }, ignored: "not an object" } });
  assert.deepEqual(calls[5], ["canvas", authoring]);
  assert.deepEqual(calls[6][1].presentation, {
    boundaryLabels: { start: "Start", end: "End" },
    edgeLabels: {}
  });
});

test("Visualizer design projector defaults to Chinese labels and tolerates missing optional design metadata", async () => {
  let graphOptions;
  const projector = createVisualizerProjectDesignProjector({
    read: async (path) => path.endsWith("system.mmd") ? "flowchart TD" : Promise.reject(new Error("optional design missing")),
    parseSystem: () => undefined,
    importAuthoring: ({ roleDisplayNames }) => {
      assert.equal(roleDisplayNames.size, 0);
      return { version: 1 };
    },
    toCanvas: () => ({}),
    buildViewModel: (options) => (graphOptions = options, {})
  });

  await projector.project({ workdir: "/workspace/project" });
  assert.deepEqual(graphOptions.presentation, {
    boundaryLabels: { start: "开始", end: "结束" },
    edgeLabels: {}
  });
});

test("Visualizer design projector uses business flow names or localized event labels", async () => {
  let graphOptions;
  const authoring = { version: 1, flows: {
    named: { flowId: "flow.named", eventType: "APPROVED", label: "方案已确认" },
    localized: { flowId: "flow.localized", eventType: "READY", label: " " }
  } };
  const projector = createVisualizerProjectDesignProjector({
    read: async (file) => file.endsWith("system.mmd") ? "flowchart TD" : "{}",
    parseSystem: () => undefined,
    importAuthoring: () => authoring,
    toCanvas: () => ({}),
    buildViewModel: (options) => (graphOptions = options, {})
  });

  await projector.project({ workdir: "/workspace/project" }, "zh-CN");
  assert.deepEqual(graphOptions.presentation.edgeLabels, {
    "flow.named": "方案已确认",
    "flow.localized": "就绪"
  });
});

test("Visualizer design projector prefers the persisted authoring document for complete round trips", async () => {
  const savedAuthoring = {
    version: 1,
    roles: { planner: { roleId: "planner", bindingKind: "model", backend: "codex", modelId: "gpt-test", contextMap: { brief: "input.content" } } },
    flows: {}
  };
  let imported = false;
  const projector = createVisualizerProjectDesignProjector({
    read: async (path) => path.endsWith("system.mmd") ? "flowchart TD" : "{}",
    parseSystem: () => undefined,
    loadAuthoringDraft: async () => ({ authoring: savedAuthoring }),
    serializeAuthoring: () => "flowchart TD",
    importAuthoring: () => { imported = true; return { version: 1, roles: {}, flows: {} }; },
    toCanvas: (authoring) => ({ authoring }),
    buildViewModel: ({ authoring }) => ({ authoring })
  });

  const result = await projector.project({ workdir: "/workspace/project" });
  assert.equal(result.authoring, savedAuthoring);
  assert.equal(result.canvas.authoring, savedAuthoring);
  assert.equal(imported, true, "the canonical topology must be loaded before a saved draft can be reused");
});

test("Visualizer design projector hydrates executable role bindings from TeamVersion model selection", async () => {
  let importedModelSelection;
  const projector = createVisualizerProjectDesignProjector({
    read: async (file) => {
      if (file.endsWith("system.mmd")) return "flowchart TD";
      if (file.endsWith("model-selection.json")) return JSON.stringify({
        configVersion: "3",
        roles: { analyst: { backend: "opencode", modelId: "big-pickle" } }
      });
      return "{}";
    },
    parseSystem: () => undefined,
    importAuthoring: (options) => {
      importedModelSelection = options.modelSelection;
      return { version: 1, roles: {}, flows: {} };
    },
    toCanvas: () => ({}),
    buildViewModel: () => ({})
  });
  await projector.project({ workdir: "/workspace/project" });
  assert.deepEqual(importedModelSelection.roles.analyst, { backend: "opencode", modelId: "big-pickle" });
});

test("Visualizer design projector ignores a saved authoring draft from another team topology", async () => {
  const savedAuthoring = {
    version: 1,
    system: { lawGlobalRef: "law.project.base" },
    roles: { "demo-analyst": { roleId: "demo-analyst" } },
    flows: {}
  };
  const canonicalAuthoring = {
    version: 1,
    system: { lawGlobalRef: "law.site.software-team" },
    roles: { "delivery-coordinator": { roleId: "delivery-coordinator" } },
    flows: {}
  };
  const projector = createVisualizerProjectDesignProjector({
    read: async (path) => path.endsWith("system.mmd") ? "flowchart TD\n%% law.global=law.site.software-team" : "{}",
    parseSystem: () => undefined,
    loadAuthoringDraft: async () => ({ authoring: savedAuthoring }),
    importAuthoring: () => canonicalAuthoring,
    serializeAuthoring: (authoring) => authoring.system.lawGlobalRef,
    toCanvas: (authoring) => ({ authoring }),
    buildViewModel: ({ authoring }) => ({ authoring })
  });

  const result = await projector.project({ workdir: "/workspace/project" });
  assert.equal(result.authoring, canonicalAuthoring);
  assert.equal(result.authoring.system.lawGlobalRef, "law.site.software-team");
  assert.deepEqual(Object.keys(result.authoring.roles), ["delivery-coordinator"]);
});

test("Visualizer design projector propagates source and Mermaid parse failures", async () => {
  const readFailure = Object.assign(new Error("source missing"), { code: "ENOENT" });
  const readProjector = createVisualizerProjectDesignProjector({ read: async () => { throw readFailure; } });
  await assert.rejects(readProjector.project({ workdir: "/workspace/project" }), /TEAM_DESIGN_UNAVAILABLE: this TeamVersion has no system\.mmd design source\./);

  const parseFailure = new Error("invalid Mermaid");
  const parseProjector = createVisualizerProjectDesignProjector({
    read: async (path) => path.endsWith("system.mmd") ? "invalid" : "{}",
    parseSystem: () => { throw parseFailure; }
  });
  await assert.rejects(parseProjector.project({ workdir: "/workspace/project" }), (error) => error === parseFailure);
});
