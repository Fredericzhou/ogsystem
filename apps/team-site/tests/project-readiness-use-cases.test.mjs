import assert from "node:assert/strict";
import test from "node:test";
import { createProjectReadinessUseCases } from "../application/project-readiness-use-cases.mjs";

test("Project Readiness maps Runtime issues into the stable public projection", async () => {
  const calls = [];
  const useCases = createProjectReadinessUseCases({
    getProject: async (id) => (calls.push(["project", id]), { workdir: "/private/project", projectStatus: "confirmed", projectDigest: "digest", confirmedAt: "now" }),
    readinessInspector: { inspect: async (workdir) => {
      calls.push(["inspect", workdir]);
      return {
        canDryRun: false,
        blockers: [
          { code: "READINESS_MODEL_CATALOG_INVALID", severity: "blocker", message: "internal detail" },
          { code: "READINESS_ROLE_PACKAGE_INVALID", severity: "blocker", roleId: "planner", message: "internal detail" }
        ],
        warnings: [{ code: "CUSTOM_WARNING", severity: "warning", message: "visible detail" }],
        missingBindings: ["planner"]
      };
    } }
  });
  const result = await useCases.getProjectReadiness("project-1");
  assert.deepEqual(calls, [["project", "project-1"], ["inspect", "/private/project"]]);
  assert.deepEqual(result, {
    projectId: "project-1",
    projectStatus: "confirmed",
    projectDigest: "digest",
    confirmedAt: "now",
    canDryRun: false,
    blockers: [
      { code: "READINESS_MODEL_CATALOG_INVALID", severity: "blocker", message: "Model catalog is invalid. Repair .ogs/model-catalog.json." },
      { code: "READINESS_ROLE_PACKAGE_INVALID", severity: "blocker", roleId: "planner", message: 'Role package "planner" is invalid. Check role.json and its referenced package files.' }
    ],
    warnings: [{ code: "CUSTOM_WARNING", severity: "warning", message: "visible detail" }],
    missingBindings: ["planner"]
  });
  assert.equal(Object.hasOwn(result, "workdir"), false);
});

test("Project Readiness preserves missing project and Runtime inspection failures", async () => {
  const failure = new Error("inspection failed");
  const useCases = createProjectReadinessUseCases({
    getProject: async () => { throw new Error("Project not found."); },
    readinessInspector: { inspect: async () => { throw failure; } }
  });
  await assert.rejects(useCases.getProjectReadiness("missing"), /Project not found/);
  const inspectUseCases = createProjectReadinessUseCases({
    getProject: async () => ({ workdir: "/project" }),
    readinessInspector: { inspect: async () => { throw failure; } }
  });
  await assert.rejects(inspectUseCases.getProjectReadiness("project"), (error) => error === failure);
});
