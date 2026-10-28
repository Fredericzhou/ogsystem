import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { compileTeamIr, FileTeamArtifactStore, teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
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

async function makeHarness(t, { transformTeamIr = (value) => value, resolveBindings: resolveBindingsOverride, authorizeTeamIrReviewer } = {}) {
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
    authorizeTeamIrReviewer,
    resolveBindings: resolveBindingsOverride ?? (async () => Object.fromEntries(Object.entries(outputs).map(([agentId, output]) => [`binding:${agentId}`, {
      async invoke() { return { kind: "completed", output }; }
    }])))
  });
  return { root, project, task, team, teamIR, plan, executor };
}

function withSingleAgentReview(value) {
  const planner = value.agents.find((agent) => agent.id === "planner");
  value.agents = [planner];
  value.handoffs = [
    value.handoffs.find((handoff) => handoff.id === "run-to-planner"),
    {
      id: "planner-to-result",
      from: { kind: "agent", agentId: "planner", outputPort: "PLAN" },
      to: { kind: "result" },
      map: { data: { summary: { $ref: "$.output.data.plan" } } }
    }
  ];
  value.bindings = [value.bindings.find((binding) => binding.id === "binding:planner")];
  value.orchestration.routes = [];
  value.orchestration.joins = [];
  value.orchestration.loops = [];
  value.orchestration.reviews = [{
    id: "planner-review",
    at: { kind: "agentOutput", agentId: "planner", outputPort: "PLAN" },
    feedbackSchema: { type: "object", properties: { comments: { type: "string" } }, required: [], additionalProperties: false },
    timeoutMs: 60000,
    onTimeout: "fail"
  }];
  return value;
}

test("Project Task Review persists activation and resumes the same Run and attempt after approval", async (t) => {
  const h = await makeHarness(t, {
    transformTeamIr: withSingleAgentReview,
    authorizeTeamIrReviewer: async ({ reviewerId, principal }) => reviewerId === principal.id && reviewerId === "reviewer-1"
  });
  const options = {
    runId: "run-1", teamVersionId: "team-v1", taskId: "task-1", taskNumber: 1, attemptNumber: 1,
    teamIrSemanticDigest: h.team.teamIrSemanticDigest, compiledPlanDigest: h.team.compiledPlanDigest,
    mode: "sandbox", prompt: "Implement the feature."
  };
  const waiting = await h.executor.execute(h.project, options);
  assert.equal(waiting.state.status, "waiting_human_review");
  const queryState = await createFileRunQueryStore({ projectsRoot: h.root }).readRunState("project-1", "task-1", "run-1");
  assert.deepEqual(queryState.waitingReview, { reviewId: "planner-review", lineage: "run" });
  const principal = { id: "reviewer-1", issuer: "test" };
  const context = await h.executor.getReviewContext({ project: h.project, task: h.task, runId: "run-1", reviewId: "planner-review", principal });
  const review = await context.runtime.getReview("run-1", "planner-review", context.lineage, context.loopRound);
  const decided = await context.runtime.decideReview({
    runId: "run-1", reviewId: "planner-review", lineage: context.lineage, loopRound: context.loopRound,
    revisionToken: review.revisionToken, idempotencyKey: "approve-lead", reviewerId: principal.id,
    decision: "approve", plan: context.plan
  });
  assert.equal(decided.status, "approved");
  const [resumed, replayed] = await Promise.all([
    context.resumeTeamIrRun({ dispatchId: "run-1:team-review:planner-review:run:run" }),
    context.resumeTeamIrRun({ dispatchId: "run-1:team-review:planner-review:run:run" })
  ]);
  assert.equal(resumed.state.status, "completed");
  assert.equal(replayed.state.status, "completed");
  assert.equal(resumed.state.status, resumed.teamRun.status);
  assert.equal(replayed.state.status, replayed.teamRun.status);
  assert.equal(resumed.state.runId, "run-1");
  assert.equal(resumed.owner.attemptNumber, 1);
  assert.equal(Object.keys(resumed.teamRun.invocations).length, 1, "the completed agent call is not repeated during same-Run review recovery");
  assert.deepEqual(resumed.result.teamResult, { summary: "implement" });
  assert.equal(Object.keys(replayed.teamRun.invocations).length, 1, "replaying the committed dispatch reads the same terminal Run");
  assert.throws(() => context.resumeTeamIrRun({ dispatchId: "forged-dispatch" }), /TEAM_REVIEW_DISPATCH_ID_INVALID/);
});

test("Project Task Review recovery rejects a principal without trusted reviewer authorization", async (t) => {
  const h = await makeHarness(t, {
    transformTeamIr: withSingleAgentReview
  });
  await h.executor.execute(h.project, {
    runId: "run-1", teamVersionId: "team-v1", taskId: "task-1", taskNumber: 1, attemptNumber: 1,
    teamIrSemanticDigest: h.team.teamIrSemanticDigest, compiledPlanDigest: h.team.compiledPlanDigest,
    mode: "sandbox", prompt: "Implement the feature."
  });
  const context = await h.executor.getReviewContext({
    project: h.project, task: h.task, runId: "run-1", reviewId: "planner-review",
    principal: { id: "unauthorized", issuer: "test" }
  });
  const review = await context.runtime.getReview("run-1", "planner-review", context.lineage, context.loopRound);
  await assert.rejects(context.runtime.decideReview({
    runId: "run-1", reviewId: "planner-review", lineage: context.lineage, loopRound: context.loopRound,
    revisionToken: review.revisionToken, idempotencyKey: "unauthorized-approve", reviewerId: "unauthorized",
    decision: "approve", plan: context.plan
  }), (error) => error.code === "REVIEW_UNAUTHORIZED");
});

test("Team IR Project Run executor verifies frozen digests and persists a full Run under Project evidence", async (t) => {
  const h = await makeHarness(t);
  const result = await h.executor.execute(h.project, {
    runId: "run-1", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-v1", mode: "sandbox",
    prompt: "Add a greeting endpoint", teamIrSemanticDigest: h.team.teamIrSemanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest
  });
  assert.equal(result.state.status, "completed");
  assert.equal(result.teamRun.status, "completed", "executor returns the persisted terminal checkpoint");
  assert.deepEqual(result.result, { teamResult: { summary: "completed" } });
  assert.equal(result.teamRun.events.filter((event) => event.type === "run.result.written").length, 1);
  const persisted = JSON.parse(await readFile(resolve(h.project.workdir, ".ogs/runs/run-1/team-ir-v2-state/run-1.json"), "utf8"));
  assert.equal(persisted.status, "completed");
  assert.equal(persisted.compiledPlanDigest, h.plan.compiledPlanDigest);
});

test("Team IR Project Run executor rejects controls without a v2 runtime contract", async (t) => {
  const h = await makeHarness(t);
  await assert.rejects(
    h.executor.control(h.project, { runId: "run-1" }, "pause"),
    /TEAM_IR_TASK_CONTROL_UNSUPPORTED/
  );
});

test("Team IR Project Run query exposes an owner-scoped input-required request and no successful result", async (t) => {
  let siblingReject;
  let siblingCancelCount = 0;
  const h = await makeHarness(t, {
    transformTeamIr(teamIR) {
      const binding = teamIR.bindings.find((item) => item.id === "binding:implementer");
      binding.kind = "a2a";
      delete binding.modelRef;
      binding.agentCardRef = "https://agents.example/implementer/card.json";
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

test("Project Task rejects missing required Run input Artifacts before resolving any Binding", async (t) => {
  const h = await makeHarness(t, { transformTeamIr(teamIR) {
    teamIR.runInput.artifactSlots.brief = { required: true, acceptedMediaTypes: ["text/markdown"], cardinality: "single" };
    return teamIR;
  } });
  let bindingResolutionCalls = 0;
  const unavailable = createRuntimeTeamIrProjectRunExecutor({
    teamStore: { async getTeamVersion() { return h.team; } },
    teamIrStore: { async read() { return { teamIR: h.teamIR, semanticDigest: h.team.teamIrSemanticDigest }; } },
    resolveReleaseClosure: async () => closure,
    resolveBindings: async () => { bindingResolutionCalls += 1; return {}; }
  });
  await assert.rejects(unavailable.execute(h.project, {
    runId: "run-1", taskId: "task-1", teamVersionId: "team-v1", prompt: "task", mode: "sandbox",
    teamIrSemanticDigest: h.team.teamIrSemanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest
  }), (error) => error.code === "RUN_INPUT_ARTIFACT_REQUIRED");
  assert.equal(bindingResolutionCalls, 0);
});

test("Project Task freezes registered Artifact inputs and exposes only the declared invocation allowlist", async (t) => {
  const h = await makeHarness(t, { transformTeamIr(teamIR) {
    teamIR.runInput.artifactSlots.brief = { required: true, acceptedMediaTypes: ["text/plain"], cardinality: "single" };
    const planner = teamIR.agents.find((agent) => agent.id === "planner");
    planner.inputPorts.default.artifactSlots = { sources: { required: true, acceptedMediaTypes: ["text/plain"], cardinality: "single" } };
    teamIR.handoffs.find((handoff) => handoff.id === "run-to-planner").map.artifacts = {
      sources: { $ref: "$.run.attachments.brief" }
    };
    return teamIR;
  } });
  const artifactStore = new FileTeamArtifactStore(resolve(h.project.workdir, ".ogs", "team-artifacts"));
  const reference = await artifactStore.registerRunInput({
    team: h.teamIR, projectId: h.project.projectId, slotId: "brief", mediaType: "text/plain", content: Buffer.from("Project-owned input"), authorizeUpload: () => true
  });
  let plannerRead = false;
  const outputByAgent = {
    planner: { event: "PLAN", data: { plan: "Use the approved source." } },
    implementer: { event: "IMPLEMENTED", data: { changes: "done" } },
    tester: { event: "TESTED", data: { tests: "passed" } },
    lead: { event: "DELIVERED", data: { summary: "completed" } }
  };
  const executor = createRuntimeTeamIrProjectRunExecutor({
    teamStore: { async getTeamVersion() { return h.team; } },
    teamIrStore: { async read() { return { teamIR: h.teamIR, semanticDigest: h.team.teamIrSemanticDigest }; } },
    resolveReleaseClosure: async () => closure,
    resolveBindings: async () => Object.fromEntries(Object.entries(outputByAgent).map(([agentId, output]) => [`binding:${agentId}`, {
      async invoke(invocation) {
        if (agentId === "planner") {
          assert.deepEqual(invocation.input.artifacts.sources, reference);
          assert.equal(Buffer.from(await invocation.artifactResolver.read(reference.artifactId)).toString(), "Project-owned input");
          await assert.rejects(invocation.artifactResolver.read(`art_${"f".repeat(36)}`), /Allowed Artifact Set/);
          plannerRead = true;
        }
        return { kind: "completed", output };
      }
    }]))
  });
  const result = await executor.execute(h.project, {
    runId: "run-1", taskId: "task-1", teamVersionId: "team-v1", prompt: "Use the source", mode: "sandbox",
    teamIrSemanticDigest: h.team.teamIrSemanticDigest, compiledPlanDigest: h.plan.compiledPlanDigest,
    attachments: { brief: reference }
  });
  assert.equal(result.state.status, "completed");
  assert.equal(plannerRead, true);
  assert.deepEqual(result.teamRun.runInput.attachments, { brief: reference });
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
