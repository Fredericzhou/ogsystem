import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { compileTeamIr, teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { createRuntimeTeamIrProjectRunExecutor } from "../infrastructure/runtime-team-ir-project-run-executor.mjs";
import { createFileRunQueryStore } from "../infrastructure/file-run-query-store.mjs";
import { createFileRunResultStore } from "../infrastructure/file-run-result-store.mjs";
import { createRunQueryUseCases } from "../application/run-query-use-cases.mjs";

const fixturePath = new URL("../../../examples/team-ir-v2/classic-software-team.json", import.meta.url);
const closure = {
  complete: true,
  packageDigests: Object.fromEntries(["planner", "implementer", "tester", "lead"].map((id) => [`role:software-${id}@1`, "a".repeat(64)])),
  bindingDigests: Object.fromEntries(["planner", "implementer", "tester", "lead"].map((id) => [`binding:${id}`, "b".repeat(64)])),
  adapterVersions: { model: "team-runtime-test/1" },
  schemaDigests: {}
};

async function makeHarness(t, { transformTeamIr = (value) => value, resolveBindings: resolveBindingsOverride } = {}) {
  const root = await mkdtemp(resolve(tmpdir(), "ogs-team-ir-project-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = resolve(root, "project-1");
  const runRoot = resolve(projectRoot, ".ogs", "runs", "run-1");
  await mkdir(resolve(projectRoot, ".site"), { recursive: true });
  await mkdir(runRoot, { recursive: true });
  const teamIR = transformTeamIr(JSON.parse(await readFile(fixturePath, "utf8")));
  const plan = compileTeamIr(teamIR, closure);
  const semanticDigest = teamIRSemanticDigest(teamIR);
  const team = {
    projectId: "team-v1", teamVersionId: "team-v1", teamVersionStatus: "released", workdir: "/immutable/team-v1",
    teamIrSemanticDigest: semanticDigest, compiledPlanDigest: plan.compiledPlanDigest
  };
  const project = { projectId: "project-1", workdir: projectRoot, teamVersionId: "team-v1" };
  const task = {
    taskId: "task-1", taskNumber: 1, currentRunId: "run-1", runIds: ["run-1"], teamVersionId: "team-v1",
    teamIrSemanticDigest: team.teamIrSemanticDigest, compiledPlanDigest: team.compiledPlanDigest
  };
  await writeFile(resolve(projectRoot, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [task] }));
  await writeFile(resolve(runRoot, "run-owner.json"), JSON.stringify({
    version: 1, runKind: "project_task", projectId: "project-1", taskId: "task-1", taskNumber: 1,
    runId: "run-1", attemptNumber: 1, teamVersionId: "team-v1", teamIrSemanticDigest: team.teamIrSemanticDigest,
    compiledPlanDigest: team.compiledPlanDigest
  }));
  const outputs = {
    planner: { event: "PLAN", data: { plan: "implement" } },
    implementer: { event: "IMPLEMENTED", data: { changes: "done" } },
    tester: { event: "TESTED", data: { tests: "passed" } },
    lead: { event: "DELIVERED", data: { summary: "completed" } }
  };
  const executor = createRuntimeTeamIrProjectRunExecutor({
    teamStore: { async getTeamVersion() { return team; } },
    teamIrStore: { async read() { return { teamIR, semanticDigest: team.teamIrSemanticDigest }; } },
    resolveReleaseClosure: async () => closure,
    resolveBindings: resolveBindingsOverride ?? (async () => Object.fromEntries(Object.entries(outputs).map(([agentId, output]) => [`binding:${agentId}`, {
      async invoke() { return { kind: "completed", output }; }
    }])))
  });
  return { root, project, task, team, plan, executor };
}

test("Team IR Project Run executor verifies frozen digests and persists a full Run under Project evidence", async (t) => {
  const h = await makeHarness(t);
  const result = await h.executor.execute(h.project, {
    runId: "run-1", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-v1", mode: "sandbox",
    prompt: "Add a greeting endpoint", teamIrSemanticDigest: h.team.teamIrSemanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest
  });
  assert.equal(result.state.status, "completed");
  assert.deepEqual(result.result, { teamResult: { summary: "completed" } });
  assert.equal(result.teamRun.events.filter((event) => event.type === "run.result.written").length, 1);
  const persisted = JSON.parse(await readFile(resolve(h.project.workdir, ".ogs/runs/run-1/team-ir-v2-state/run-1.json"), "utf8"));
  assert.equal(persisted.status, "completed");
  assert.equal(persisted.compiledPlanDigest, h.plan.compiledPlanDigest);
});

test("Team IR Project Run query exposes an owner-scoped input-required request and no successful result", async (t) => {
  let siblingReject;
  let siblingCancelCount = 0;
  const h = await makeHarness(t, {
    transformTeamIr(teamIR) {
      teamIR.bindings.find((binding) => binding.id === "binding:implementer").kind = "a2a";
      teamIR.bindings.find((binding) => binding.id === "binding:implementer").agentCardRef = "https://agents.example/implementer/card.json";
      return teamIR;
    },
    resolveBindings: async () => ({
      "binding:planner": { async invoke() { return { kind: "completed", output: { event: "PLAN", data: { plan: "Implement" } } }; } },
      "binding:implementer": {
        async invoke() {
          while (!siblingReject) await new Promise((resolve) => setTimeout(resolve, 0));
          return { kind: "input-required", remoteTaskId: "remote-need-input", messageParts: [{ text: "Which API version?" }], requestedInputSchema: { type: "object", required: ["apiVersion"] } };
        },
        async cancel() { return true; }
      },
      "binding:tester": {
        invoke() { return new Promise((_resolve, reject) => { siblingReject = reject; }); },
        async cancel() { siblingCancelCount += 1; siblingReject(new Error("canceled after input required")); return true; }
      },
      "binding:lead": { async invoke() { throw new Error("Join target must not run before both branches arrive"); } }
    })
  });
  const result = await h.executor.execute(h.project, {
    runId: "run-1", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-v1", mode: "sandbox",
    prompt: "Add a greeting endpoint", teamIrSemanticDigest: h.team.teamIrSemanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest
  });
  assert.equal(result.state.status, "paused_input_required");
  assert.equal(result.teamRun.pendingInput.remoteTaskId, "remote-need-input");
  assert.deepEqual(result.teamRun.events.find((event) => event.type === "run.paused_input_required").data, {
    handoffId: "planner-to-implementer", remoteTaskId: "remote-need-input"
  });
  assert.equal(siblingCancelCount, 1);
  assert.equal(result.teamRun.invocations["run-1:planner-to-tester"].status, "cancelled");
  assert.equal(result.result, null);

  const projectWithTask = { ...h.project, projectType: "collaboration", taskRecords: [{
    taskId: "task-1", taskNumber: 1, currentRunId: "run-1", runIds: ["run-1"], teamVersionId: "team-v1",
    teamIrSemanticDigest: h.team.teamIrSemanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest
  }] };
  const query = createRunQueryUseCases({
    getProject: async () => projectWithTask,
    waitForActiveTaskWorker: async () => undefined,
    runQueryStore: createFileRunQueryStore({ projectsRoot: h.root })
  });
  const visible = await query.getProjectRun("project-1", "task-1", "run-1");
  assert.equal(visible.state.status, "paused_input_required");
  assert.deepEqual(visible.state.pendingInput, result.teamRun.pendingInput);
  const hiddenResult = await createFileRunResultStore({ projectsRoot: h.root }).readFinalOutputs({
    owner: { kind: "project_task", projectId: "project-1" }, taskId: "task-1", runId: "run-1"
  });
  assert.equal(hiddenResult, undefined);
});

test("Team IR Project Run executor rejects incomplete closures and compiled digest drift before invoking Bindings", async (t) => {
  const h = await makeHarness(t);
  let calls = 0;
  const invalid = createRuntimeTeamIrProjectRunExecutor({
    teamStore: { async getTeamVersion() { return h.team; } },
    teamIrStore: { async read() { return { teamIR: JSON.parse(await readFile(fixturePath, "utf8")), semanticDigest: h.team.teamIrSemanticDigest }; } },
    resolveReleaseClosure: async () => ({ complete: false }),
    resolveBindings: async () => { calls += 1; return {}; }
  });
  await assert.rejects(invalid.execute(h.project, {
    runId: "run-1", taskId: "task-1", teamVersionId: "team-v1", prompt: "task", mode: "sandbox",
    teamIrSemanticDigest: h.team.teamIrSemanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest
  }), /TEAM_IR_RELEASE_CLOSURE_INCOMPLETE/);
  assert.equal(calls, 0);
  const drift = createRuntimeTeamIrProjectRunExecutor({
    teamStore: { async getTeamVersion() { return h.team; } },
    teamIrStore: { async read() { return { teamIR: JSON.parse(await readFile(fixturePath, "utf8")), semanticDigest: h.team.teamIrSemanticDigest }; } },
    resolveReleaseClosure: async () => ({ ...closure, bindingDigests: { ...closure.bindingDigests, "binding:lead": "d".repeat(64) } }),
    resolveBindings: async () => { calls += 1; return {}; }
  });
  await assert.rejects(drift.execute(h.project, {
    runId: "run-1", taskId: "task-1", teamVersionId: "team-v1", prompt: "task", mode: "sandbox",
    teamIrSemanticDigest: h.team.teamIrSemanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest
  }), /TEAM_IR_COMPILED_DIGEST_MISMATCH/);
  assert.equal(calls, 0);
});

test("Project Run queries and results read Team IR v2 state after constructing a new query store", async (t) => {
  const h = await makeHarness(t);
  await h.executor.execute(h.project, {
    runId: "run-1", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-v1", mode: "sandbox",
    prompt: "Add a greeting endpoint", teamIrSemanticDigest: h.team.teamIrSemanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest
  });
  const queryStoreAfterRestart = createFileRunQueryStore({ projectsRoot: h.root });
  const state = await queryStoreAfterRestart.readRunState("project-1", "task-1", "run-1");
  const plan = await queryStoreAfterRestart.readRunPlan("project-1", "task-1", "run-1");
  const events = await queryStoreAfterRestart.readRunEvents("project-1", "task-1", "run-1");
  assert.equal(state.status, "completed");
  assert.equal(plan.compiledPlanDigest, h.plan.compiledPlanDigest);
  assert.ok(events.events.some((event) => event.type === "run.result.written"));
  const outputs = await createFileRunResultStore({ projectsRoot: h.root }).readFinalOutputs({
    owner: { kind: "project_task", projectId: "project-1" }, taskId: "task-1", runId: "run-1"
  });
  assert.deepEqual(outputs, { teamResult: { summary: "completed" } });
});

test("Team IR Project Run executor fails closed without production closure and Binding resolvers", async (t) => {
  const h = await makeHarness(t);
  const unavailable = createRuntimeTeamIrProjectRunExecutor({
    teamStore: { async getTeamVersion() { return h.team; } },
    teamIrStore: { async read() { return { teamIR: JSON.parse(await readFile(fixturePath, "utf8")), semanticDigest: h.team.teamIrSemanticDigest }; } }
  });
  await assert.rejects(unavailable.execute(h.project, {
    runId: "run-1", taskId: "task-1", teamVersionId: "team-v1", prompt: "task", mode: "sandbox",
    teamIrSemanticDigest: h.team.teamIrSemanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest
  }), /TEAM_IR_V2_EXECUTOR_UNAVAILABLE/);
});

test("Team IR Project Run executor rejects unsupported Task input contracts before Binding resolution", async (t) => {
  const h = await makeHarness(t);
  const teamIR = JSON.parse(await readFile(fixturePath, "utf8"));
  teamIR.runInput.dataSchema.required.push("another_required_field");
  const semanticDigest = teamIRSemanticDigest(teamIR);
  const plan = compileTeamIr(teamIR, closure);
  const team = { ...h.team, teamIrSemanticDigest: semanticDigest, compiledPlanDigest: plan.compiledPlanDigest };
  let bindingResolutionCalls = 0;
  const unsupported = createRuntimeTeamIrProjectRunExecutor({
    teamStore: { async getTeamVersion() { return team; } },
    teamIrStore: { async read() { return { teamIR, semanticDigest }; } },
    resolveReleaseClosure: async () => closure,
    resolveBindings: async () => { bindingResolutionCalls += 1; return {}; }
  });
  await assert.rejects(unsupported.execute(h.project, {
    runId: "run-1", taskId: "task-1", teamVersionId: "team-v1", prompt: "task", mode: "sandbox",
    teamIrSemanticDigest: semanticDigest, compiledPlanDigest: plan.compiledPlanDigest
  }), /TEAM_IR_TASK_INPUT_UNSUPPORTED/);
  assert.equal(bindingResolutionCalls, 0);
});

test("Team IR Project Run executor rejects a symlinked Team Run state directory", async (t) => {
  const h = await makeHarness(t);
  const outside = resolve(h.root, "outside");
  await mkdir(outside);
  await symlink(outside, resolve(h.project.workdir, ".ogs/runs/run-1/team-ir-v2-state"), "dir");
  await assert.rejects(h.executor.execute(h.project, {
    runId: "run-1", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-v1", mode: "sandbox",
    prompt: "Add a greeting endpoint", teamIrSemanticDigest: h.team.teamIrSemanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest
  }), /Team IR v2 Run state|TEAM_IR_PATH_UNSAFE/);
  assert.deepEqual(await (await import("node:fs/promises")).readdir(outside), []);
});
