import assert from "node:assert/strict";
import test from "node:test";
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
    systemPath: "/workspace/project/system.mmd"
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
    ["read", "/workspace/project/system.mmd", "utf8"],
    ["validate", {
      workdir: "/workspace/project",
      systemSource: "stored Mermaid",
      systemPath: "/workspace/project/system.mmd"
    }]
  ]);
});
