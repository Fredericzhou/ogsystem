import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { createVisualizerProjectDesignValidator } from "../infrastructure/visualizer-project-design-validator.mjs";

test("Visualizer project design validator prefers explicit Mermaid source", async () => {
  const calls = [];
  const validator = createVisualizerProjectDesignValidator({
    serialize: () => assert.fail("authoring must not be serialized"),
    read: async () => assert.fail("stored source must not be read"),
    validate: async (input) => (calls.push(input), { ok: true })
  });
  const project = { workdir: "/workspace/project" };

  assert.deepEqual(await validator.validate(project, { systemSource: "flowchart TD\n A-->B" }), { ok: true });
  assert.deepEqual(calls, [{
    workdir: project.workdir,
    systemSource: "flowchart TD\n A-->B",
    systemPath: path.join(project.workdir, "system.mmd")
  }]);
});

test("Visualizer project design validator serializes authoring when supplied", async () => {
  const authoring = { version: 1 };
  let serialized;
  let validated;
  const validator = createVisualizerProjectDesignValidator({
    serialize: (value) => (serialized = value, "serialized Mermaid"),
    read: async () => assert.fail("stored source must not be read"),
    validate: async (input) => (validated = input, { ok: true })
  });

  await validator.validate({ workdir: "/workspace/project" }, { authoring });
  assert.equal(serialized, authoring);
  assert.equal(validated.systemSource, "serialized Mermaid");
});

test("Visualizer project design validator reads stored Mermaid source by default", async () => {
  const calls = [];
  const validator = createVisualizerProjectDesignValidator({
    serialize: () => assert.fail("authoring was not supplied"),
    read: async (...args) => (calls.push(["read", ...args]), "stored Mermaid"),
    validate: async (input) => (calls.push(["validate", input]), { ok: true })
  });

  await validator.validate({ workdir: "/workspace/project" });
  assert.deepEqual(calls, [
    ["read", path.join("/workspace/project", "system.mmd"), "utf8"],
    ["validate", {
      workdir: "/workspace/project",
      systemSource: "stored Mermaid",
      systemPath: path.join("/workspace/project", "system.mmd")
    }]
  ]);
});

test("Studio design validation receives the current shared Platform model catalog", async () => {
  const modelCatalogModels = [{ backend: "codex", modelId: "gpt-6-luna", runnable: true }];
  const calls = [];
  const validator = createVisualizerProjectDesignValidator({
    getRuntimeModelConfig: async () => ({ modelCatalogModels, modelCatalogGeneratedAt: "2026-10-22T00:00:00.000Z" }),
    validate: async (input) => (calls.push(input), { ok: true })
  });

  await validator.validate({ workdir: "/teams/team-v1" }, { systemSource: "flowchart TD" });
  assert.deepEqual(calls[0], {
    workdir: "/teams/team-v1",
    systemSource: "flowchart TD",
    systemPath: path.join("/teams/team-v1", "system.mmd"),
    modelCatalogModels,
    modelCatalogGeneratedAt: "2026-10-22T00:00:00.000Z"
  });
});
