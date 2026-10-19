import assert from "node:assert/strict";
import test from "node:test";
import { createProjectDesignProjectionUseCases } from "../application/project-design-projection-use-cases.mjs";

function setup() {
  const calls = [];
  const project = { projectId: "project-1", workdir: "/workspace/project", projectStatus: "draft", projectDigest: "digest-1", confirmedAt: null };
  const graph = { projectId: project.projectId, systemSource: "flowchart TD", authoring: { version: 1 } };
  const useCases = createProjectDesignProjectionUseCases({
    getProject: async (...args) => (calls.push(["get", ...args]), project),
    withProjectWriteLock: async (...args) => (calls.push(["lock", ...args.slice(0, 2)]), args[2]()),
    designStore: { saveSystemSource: async (...args) => (calls.push(["save", ...args]), { validation: { ok: args[0].systemSource !== "invalid" } }) },
    designProjector: { project: async (...args) => (calls.push(["project", ...args]), graph) },
    designSerializer: { serialize: (...args) => (calls.push(["serialize", ...args]), "serialized source") }
  });
  return { calls, graph, project, useCases };
}

test("Project graph and design projections preserve locale and project status", async () => {
  const { calls, graph, project, useCases } = setup();
  assert.equal(await useCases.getProjectGraph(project.projectId, "en"), graph);
  assert.deepEqual(await useCases.getProjectDesign(project.projectId), {
    ...graph,
    projectStatus: "draft",
    confirmedAt: null
  });
  assert.deepEqual(calls, [
    ["get", "project-1"],
    ["project", project, "en"],
    ["get", "project-1"],
    ["project", project, "zh-CN"]
  ]);
});

test("Project design save validates normalized input and returns the refreshed projection", async () => {
  const { calls, graph, project, useCases } = setup();
  const body = { authoring: { version: 1 }, expectedProjectDigest: "digest-1" };
  assert.deepEqual(await useCases.saveProjectDesign(project.projectId, body), {
    ...graph,
    projectStatus: "draft",
    confirmedAt: null
  });
  assert.deepEqual(calls, [
    ["serialize", body.authoring],
    ["lock", "project-1", "design-save"],
    ["get", "project-1"],
    ["save", { workdir: project.workdir, systemSource: "serialized source" }],
    ["get", "project-1"],
    ["project", project, "zh-CN"]
  ]);
});

test("Project design save rejects stale digest, missing source, and invalid designs before persistence", async () => {
  const { calls, project, useCases } = setup();
  await assert.rejects(
    useCases.saveProjectDesign(project.projectId, { systemSource: "flowchart TD", expectedProjectDigest: "stale" }),
    /PROJECT_DIGEST_CONFLICT/
  );
  await assert.rejects(useCases.saveProjectDesign(project.projectId, {}), /SYSTEM_SOURCE_REQUIRED/);
  await assert.rejects(
    useCases.saveProjectDesign(project.projectId, { systemSource: "invalid" }),
    /PROJECT_DESIGN_INVALID/
  );
  assert.equal(calls.filter(([name]) => name === "save").length, 1);
  assert.equal(calls.filter(([name]) => name === "lock").length, 2);
});

test("Project design projection preserves query and projection failures", async () => {
  const failure = new Error("query failed");
  const useCases = createProjectDesignProjectionUseCases({
    getProject: async () => { throw failure; },
    withProjectWriteLock: async () => assert.fail("lock must not run"),
    designStore: { saveSystemSource: async () => assert.fail("save must not run") },
    designProjector: { project: async () => assert.fail("projection must not run") },
    designSerializer: { serialize: () => assert.fail("serialization must not run") },
  });
  await assert.rejects(useCases.getProjectDesign("missing"), (error) => error === failure);
  const project = { workdir: "/project" };
  const projectionFailure = new Error("projection failed");
  const projectorUseCases = createProjectDesignProjectionUseCases({
    getProject: async () => project,
    withProjectWriteLock: async (_id, _operation, action) => action(),
    designStore: { saveSystemSource: async () => ({ validation: { ok: true } }) },
    designProjector: { project: async () => { throw projectionFailure; } },
    designSerializer: { serialize: () => "source" },
  });
  await assert.rejects(projectorUseCases.getProjectGraph("project-1"), (error) => error === projectionFailure);
});

test("Project design projection requires query, save, and projection ports", () => {
  assert.throws(() => createProjectDesignProjectionUseCases({}), /requires a Project query/);
  assert.throws(() => createProjectDesignProjectionUseCases({ getProject: async () => ({}) }), /requires a Project write lock/);
  assert.throws(() => createProjectDesignProjectionUseCases({ getProject: async () => ({}), withProjectWriteLock: async () => {}, designStore: {} }), /requires a design store/);
  const base = { getProject: async () => ({}), withProjectWriteLock: async () => {}, designStore: { saveSystemSource: async () => ({}) }, designProjector: { project: async () => ({}) } };
  assert.throws(() => createProjectDesignProjectionUseCases(base), /requires a design serializer/);
  assert.doesNotThrow(() => createProjectDesignProjectionUseCases({ ...base, designSerializer: { serialize: () => "" } }));
});
