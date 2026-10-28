import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileTeamIr, teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { createRunQueryUseCases } from "../application/run-query-use-cases.mjs";
import { createRuntimeTeamIrProjectRunExecutor } from "../infrastructure/runtime-team-ir-project-run-executor.mjs";
import { createFileRunQueryStore } from "../infrastructure/file-run-query-store.mjs";
import { createFileRunResultStore } from "../infrastructure/file-run-result-store.mjs";
import { createFileTeamIrStore } from "../infrastructure/file-team-ir-store.mjs";
import { handleRunRoutes } from "../api/run-routes.mjs";
import { errorStatus } from "../api/error-status.mjs";

const fixtureUrl = new URL("../../../examples/team-ir-v2/classic-expert-consultation.json", import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function invokeRunApi(useCases, path) {
  const sent = [];
  const handled = await handleRunRoutes({
    request: { method: "GET" },
    response: {},
    url: new URL(`http://site.test${path}`),
    readBody: async () => ({}),
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus,
    useCases
  });
  assert.equal(handled, true);
  return sent[0];
}

test("historical Team IR v2 Run detail, events, and result remain queryable after its Team IR is changed and deleted", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ogs-team-ir-history-frozen-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const teamVersionId = "classic-expert-consultation-v2";
  const projectId = "history-project";
  const taskId = "task-consultation";
  const runId = "run-consultation-v2";
  const teamRoot = join(root, "teams", teamVersionId);
  const projectRoot = join(root, projectId);
  await mkdir(join(projectRoot, ".site"), { recursive: true });
  await mkdir(join(projectRoot, ".ogs", "runs", runId), { recursive: true });
  const teamIrStore = createFileTeamIrStore();
  const teamIR = await readJson(fixtureUrl);
  const saved = await teamIrStore.save({ workdir: teamRoot, teamIR });
  const closure = {
    complete: true,
    packageDigests: Object.fromEntries(teamIR.agents.map((agent) => [agent.packageRef, "a".repeat(64)])),
    bindingDigests: Object.fromEntries(teamIR.bindings.map((binding) => [binding.id, "b".repeat(64)])),
    adapterVersions: { model: "history-test/1" },
    schemaDigests: {}
  };
  const plan = compileTeamIr(teamIR, closure);
  const teamRecord = {
    projectId: teamVersionId,
    teamVersionId,
    teamVersionStatus: "released",
    workdir: teamRoot,
    teamIrSemanticDigest: saved.semanticDigest,
    compiledPlanDigest: plan.compiledPlanDigest
  };
  const teamStore = { async getTeamVersion() { return teamRecord; } };
  const outputs = {
    dispatcher: { event: "BRIEF", data: { brief: "shared brief" } },
    cardiology: { event: "REVIEW", data: { review: "cardiology review" } },
    neurology: { event: "REVIEW", data: { review: "neurology review" } },
    imaging: { event: "REVIEW", data: { review: "imaging review" } },
    "chief-reviewer": { event: "CONSULTATION", data: { summary: "historical consultation summary" } }
  };
  const bindings = Object.fromEntries(Object.entries(outputs).map(([agentId, output]) => [
    `binding:${agentId}`,
    { async invoke() { return { kind: "completed", output }; } }
  ]));
  const project = { projectId, projectType: "collaboration", workdir: projectRoot };
  const task = {
    taskId,
    taskNumber: 1,
    currentRunId: runId,
    runIds: [runId],
    teamVersionId,
    teamIrSemanticDigest: saved.semanticDigest,
    compiledPlanDigest: plan.compiledPlanDigest
  };
  const projectMetadataPath = join(projectRoot, ".site", "project.json");
  await writeFile(projectMetadataPath, JSON.stringify({ ...project, taskRecords: [task] }));
  await writeFile(join(projectRoot, ".ogs", "runs", runId, "run-owner.json"), JSON.stringify({
    version: 1,
    runKind: "project_task",
    projectId,
    taskId,
    taskNumber: task.taskNumber,
    attemptNumber: 1,
    teamVersionId,
    teamIrSemanticDigest: saved.semanticDigest,
    compiledPlanDigest: plan.compiledPlanDigest,
    runId
  }));

  const executor = createRuntimeTeamIrProjectRunExecutor({
    teamStore,
    teamIrStore,
    resolveReleaseClosure: async () => closure,
    resolveBindings: async () => bindings,
    clock: { now: () => 100, sleep: async () => {} }
  });
  const execution = await executor.execute(project, {
    runId,
    taskId,
    taskNumber: 1,
    attemptNumber: 1,
    teamVersionId,
    mode: "sandbox",
    prompt: "Review a synthetic consultation case.",
    teamIrSemanticDigest: saved.semanticDigest,
    compiledPlanDigest: plan.compiledPlanDigest
  });
  assert.equal(execution.state.status, "completed");

  const runDirectory = join(projectRoot, ".ogs", "runs", runId);
  const persistedOwner = await readJson(join(runDirectory, "run-owner.json"));
  const persistedRun = await readJson(join(runDirectory, "team-ir-v2-state", `${runId}.json`));
  assert.equal(persistedOwner.teamIrSemanticDigest, saved.semanticDigest);
  assert.equal(persistedOwner.compiledPlanDigest, execution.state.compiledPlanDigest);
  assert.equal(persistedRun.compiledPlanDigest, execution.state.compiledPlanDigest);

  const queryStore = createFileRunQueryStore({ projectsRoot: root });
  const resultStore = createFileRunResultStore({ projectsRoot: root });
  const queryUseCases = createRunQueryUseCases({
    getProject: async (id) => id === projectId ? await readJson(projectMetadataPath) : undefined,
    waitForActiveTaskWorker: async () => false,
    runQueryStore: queryStore
  });
  const useCases = {
    ...queryUseCases,
    async getProjectRunResult(id, requestedTaskId, requestedRunId) {
      const detail = await queryUseCases.getProjectRun(id, requestedTaskId, requestedRunId);
      const result = await resultStore.readFinalOutputs({ owner: detail.owner, taskId: requestedTaskId, runId: requestedRunId });
      return { runId: requestedRunId, result: result ?? null };
    }
  };
  const detailPath = `/api/v1/projects/${projectId}/tasks/${taskId}/runs/${runId}`;
  const eventsPath = `${detailPath}/events`;
  const resultPath = `${detailPath}/result`;
  const assertHistoricalEvidence = async () => {
    const [detail, events, result] = await Promise.all([
      invokeRunApi(useCases, detailPath),
      invokeRunApi(useCases, eventsPath),
      invokeRunApi(useCases, resultPath)
    ]);
    assert.equal(detail.status, 200, JSON.stringify(detail.payload));
    assert.equal(events.status, 200, JSON.stringify(events.payload));
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    assert.equal(detail.payload.owner.teamIrSemanticDigest, saved.semanticDigest);
    assert.equal(detail.payload.owner.compiledPlanDigest, execution.state.compiledPlanDigest);
    assert.equal(detail.payload.plan.compiledPlanDigest, execution.state.compiledPlanDigest);
    assert.equal(detail.payload.state.compiledPlanDigest, execution.state.compiledPlanDigest);
    assert.equal(events.payload.events.some((event) => event.type === "run.result.written"), true);
    assert.deepEqual(result.payload.result, { teamResult: { summary: "historical consultation summary" } });
  };

  const modifiedTeamIR = structuredClone(teamIR);
  modifiedTeamIR.agents.find((agent) => agent.id === "dispatcher").packageRef = "role:consultation-dispatcher@2";
  const modified = await teamIrStore.save({ workdir: teamRoot, teamIR: modifiedTeamIR });
  assert.notEqual(modified.semanticDigest, saved.semanticDigest);
  await assertHistoricalEvidence();

  await rm(join(teamRoot, ".ogs", "team.ir.json"));
  assert.deepEqual(await teamIrStore.read({ workdir: teamRoot }), { teamIR: null, semanticDigest: null });
  await assertHistoricalEvidence();

  const runEvidenceAfterQuery = await readJson(join(runDirectory, "team-ir-v2-state", `${runId}.json`));
  assert.equal(runEvidenceAfterQuery.compiledPlanDigest, execution.state.compiledPlanDigest);
  const ownerAfterQuery = await readJson(join(runDirectory, "run-owner.json"));
  assert.equal(ownerAfterQuery.teamIrSemanticDigest, saved.semanticDigest);
  assert.equal(ownerAfterQuery.compiledPlanDigest, execution.state.compiledPlanDigest);
  assert.equal(teamIRSemanticDigest(teamIR), saved.semanticDigest);
});
