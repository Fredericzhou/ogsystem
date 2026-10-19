import assert from "node:assert/strict";
import test from "node:test";
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
  assert.deepEqual(calls[0], ["read", "/workspace/project/system.mmd"]);
  assert.deepEqual(calls[1], ["parse", "flowchart TD\n A-->B"]);
  assert.deepEqual(calls[2][0], "read");
  assert.equal(calls[2][1], "/workspace/project/system.design.json");
  assert.equal(calls[3][0], "authoring");
  assert.deepEqual([...calls[3][1].roleDisplayNames], [["planner", "Planner title"]]);
  assert.deepEqual(calls[4], ["canvas", authoring]);
  assert.deepEqual(calls[5][1].presentation.boundaryLabels, { input: "Task", output: "Outcome" });
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
  assert.deepEqual(graphOptions.presentation.boundaryLabels, { input: "任务", output: "结果" });
});

test("Visualizer design projector propagates source and Mermaid parse failures", async () => {
  const readFailure = new Error("source missing");
  const readProjector = createVisualizerProjectDesignProjector({ read: async () => { throw readFailure; } });
  await assert.rejects(readProjector.project({ workdir: "/workspace/project" }), (error) => error === readFailure);

  const parseFailure = new Error("invalid Mermaid");
  const parseProjector = createVisualizerProjectDesignProjector({
    read: async (path) => path.endsWith("system.mmd") ? "invalid" : "{}",
    parseSystem: () => { throw parseFailure; }
  });
  await assert.rejects(parseProjector.project({ workdir: "/workspace/project" }), (error) => error === parseFailure);
});
