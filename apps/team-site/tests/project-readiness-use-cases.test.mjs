import assert from "node:assert/strict";
import test from "node:test";
import { createProjectReadinessUseCases } from "../application/project-readiness-use-cases.mjs";

test("Project Readiness maps Runtime issues into the stable public projection", async () => {
  const calls = [];
  const useCases = createProjectReadinessUseCases({
    getProject: async (id) => (calls.push(["project", id]), id === "project-1"
      ? { workdir: "/private/project", projectType: "collaboration", projectStatus: "confirmed", mountedTeams: [{ teamId: "team-1", teamVersionId: "version-1" }] }
      : { workdir: "/private/version", projectType: "team", teamId: "team-1", teamRootId: "team-1", teamVersionId: "version-1", teamVersionStatus: "released" }),
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
  assert.deepEqual(calls, [["project", "project-1"], ["project", "version-1"], ["inspect", "/private/version"]]);
  assert.deepEqual(result, {
    projectId: "project-1",
    scope: "static_configuration",
    externalConnectivityChecked: false,
    projectStatus: "confirmed",
    canDryRun: false,
    mountedTeamVersionIds: ["version-1"],
    blockers: [
      { code: "READINESS_MODEL_CATALOG_INVALID", severity: "blocker", message: "Model catalog is invalid. Repair .ogs/model-catalog.json.", teamVersionId: "version-1" },
      { code: "READINESS_ROLE_PACKAGE_INVALID", severity: "blocker", roleId: "planner", message: 'Role package "planner" is invalid. Check role.json and its referenced package files.', teamVersionId: "version-1" }
    ],
    warnings: [{ code: "CUSTOM_WARNING", severity: "warning", message: "visible detail", teamVersionId: "version-1" }],
    teams: [{ teamId: "team-1", teamVersionId: "version-1", versionStatus: "released", scope: "static_configuration", externalConnectivityChecked: false, canDryRun: false, blockers: [
      { code: "READINESS_MODEL_CATALOG_INVALID", severity: "blocker", message: "Model catalog is invalid. Repair .ogs/model-catalog.json." },
      { code: "READINESS_ROLE_PACKAGE_INVALID", severity: "blocker", roleId: "planner", message: 'Role package "planner" is invalid. Check role.json and its referenced package files.' }
    ], warnings: [{ code: "CUSTOM_WARNING", severity: "warning", message: "visible detail" }], missingBindings: ["planner"] }]
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
    getProject: async (id) => id === "project"
      ? ({ workdir: "/project", projectType: "collaboration", mountedTeams: [{ teamId: "team", teamVersionId: "version" }] })
      : ({ workdir: "/version", projectType: "team", teamId: "team", teamVersionId: "version", teamVersionStatus: "released" }),
    readinessInspector: { inspect: async () => { throw failure; } }
  });
  const projectReadiness = await inspectUseCases.getProjectReadiness("project");
  assert.equal(projectReadiness.canDryRun, false);
  assert.equal(projectReadiness.blockers[0].code, "PROJECT_TEAM_VERSION_UNAVAILABLE");
  await assert.rejects(inspectUseCases.getTeamVersionReadiness("team", "version"), (error) => error === failure);
});
