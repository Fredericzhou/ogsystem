import assert from "node:assert/strict";
import test from "node:test";
import { createProjectDesignValidationUseCases } from "../application/project-design-validation-use-cases.mjs";

test("Project design validation loads the project and delegates the request", async () => {
  const calls = [];
  const result = { ok: true, diagnostics: [] };
  const useCases = createProjectDesignValidationUseCases({
    getProject: async (projectId) => (calls.push(["project", projectId]), { workdir: "/project" }),
    designValidator: { validate: async (...args) => (calls.push(["validate", ...args]), result) }
  });
  const body = { authoring: { version: 1 } };

  assert.equal(await useCases.validateProjectDesign("project-1", body), result);
  assert.deepEqual(calls, [
    ["project", "project-1"],
    ["validate", { workdir: "/project" }, body]
  ]);
});

test("Project design validation preserves project query and adapter failures", async () => {
  const projectFailure = new Error("Project not found.");
  const projectUseCases = createProjectDesignValidationUseCases({
    getProject: async () => { throw projectFailure; },
    designValidator: { validate: async () => assert.fail("validator must not run") }
  });
  await assert.rejects(projectUseCases.validateProjectDesign("missing"), (error) => error === projectFailure);

  const validationFailure = new Error("invalid design");
  const validationUseCases = createProjectDesignValidationUseCases({
    getProject: async () => ({ workdir: "/project" }),
    designValidator: { validate: async () => { throw validationFailure; } }
  });
  await assert.rejects(validationUseCases.validateProjectDesign("project-1"), (error) => error === validationFailure);
});

test("Project design validation requires its Project query and validator ports", () => {
  assert.throws(() => createProjectDesignValidationUseCases({}), /requires a Project query/);
  assert.throws(() => createProjectDesignValidationUseCases({ getProject: async () => ({}) }), /requires a design validator/);
});
