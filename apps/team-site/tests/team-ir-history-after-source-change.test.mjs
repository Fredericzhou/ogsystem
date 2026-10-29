import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { compileTeamIr, FileTeamArtifactStore, teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { createRunQueryUseCases } from "../application/run-query-use-cases.mjs";
import { createRuntimeTeamIrProjectRunExecutor } from "../infrastructure/runtime-team-ir-project-run-executor.mjs";
import { createFileRunQueryStore } from "../infrastructure/file-run-query-store.mjs";
import { createFileRunResultStore } from "../infrastructure/file-run-result-store.mjs";
import { createFileTeamIrStore } from "../infrastructure/file-team-ir-store.mjs";
import { createTeamIrArtifactUseCases } from "../application/team-ir-artifact-use-cases.mjs";
import { handleTeamIrArtifactRoutes } from "../api/team-ir-artifact-routes.mjs";
import { handleRunRoutes } from "../api/run-routes.mjs";
import { errorStatus } from "../api/error-status.mjs";

const fixtureUrl = new URL("../../../examples/team-ir-v2/classic-artifact-evidence.json", import.meta.url);

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

async function invokeArtifactApi(useCases, path, body) {
  const sent = [];
  const handled = await handleTeamIrArtifactRoutes({
    request: { method: "POST", socket: { remoteAddress: "127.0.0.1" }, headers: { host: "site.test", origin: "http://site.test" } },
    response: {},
    url: new URL(`http://site.test${path}`),
    readBody: async () => body,
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
  const taskId = "task-artifact-evidence";
  const runId = "run-artifact-evidence-v2";
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
  const bindings = {
    "binding:evidence-analyst": { async invoke() { return { kind: "completed", output: {
      event: "A_DONE", data: { analysis: "Historical facts and assumptions were separated." },
      artifacts: { draft: { mediaType: "text/markdown", content: Buffer.from("# Historical draft\n\nFacts are separated from assumptions.") } }
    } }; } },
    "binding:evidence-editor": { async invoke() { return { kind: "completed", output: {
      event: "B_DONE", data: { summary: "Historical evidence report." },
      artifacts: { report: { mediaType: "text/markdown", content: Buffer.from("# Historical report\n\nThe supplied evidence remains unchanged.") } }
    } }; } }
  };
  const project = {
    projectId,
    projectType: "collaboration",
    workdir: projectRoot,
    mountedTeams: [{ teamVersionId, teamIrSemanticDigest: saved.semanticDigest, compiledPlanDigest: plan.compiledPlanDigest }]
  };
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
    artifactStoreFactory: async () => new FileTeamArtifactStore(join(projectRoot, ".ogs", "team-artifacts")),
    clock: { now: () => 100, sleep: async () => {} }
  });
  const artifactStore = new FileTeamArtifactStore(join(projectRoot, ".ogs", "team-artifacts"));
  const artifactUseCases = createTeamIrArtifactUseCases({
    getProject: async (id) => id === projectId ? project : undefined,
    getTeamVersion: async (id) => id === teamVersionId ? teamRecord : undefined,
    teamIrStore,
    artifactStoreFactory: async () => new FileTeamArtifactStore(join(projectRoot, ".ogs", "team-artifacts"))
  });
  const inputUpload = await invokeArtifactApi(artifactUseCases, `/api/v1/projects/${projectId}/artifacts/run-input`, {
    teamVersionId,
    slotId: "brief",
    mediaType: "text/markdown",
    contentBase64: Buffer.from("# Source brief\n\nThe original source evidence.").toString("base64")
  });
  assert.equal(inputUpload.status, 201, JSON.stringify(inputUpload.payload));
  const inputReference = inputUpload.payload;
  const execution = await executor.execute(project, {
    runId,
    taskId,
    taskNumber: 1,
    attemptNumber: 1,
    teamVersionId,
    mode: "sandbox",
    prompt: "Prepare an evidence report from the supplied brief.",
    attachments: { brief: inputReference },
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

  const createQueryUseCases = () => {
    const resultStore = createFileRunResultStore({ projectsRoot: root });
    const queryUseCases = createRunQueryUseCases({
      getProject: async (id) => id === projectId ? await readJson(projectMetadataPath) : undefined,
      waitForActiveTaskWorker: async () => false,
      runQueryStore: createFileRunQueryStore({ projectsRoot: root })
    });
    return {
      ...queryUseCases,
      async getProjectRunResult(id, requestedTaskId, requestedRunId) {
        const detail = await queryUseCases.getProjectRun(id, requestedTaskId, requestedRunId);
        const result = await resultStore.readFinalOutputs({ owner: detail.owner, taskId: requestedTaskId, runId: requestedRunId });
        return { runId: requestedRunId, result: result ?? null };
      }
    };
  };
  const detailPath = `/api/v1/projects/${projectId}/tasks/${taskId}/runs/${runId}`;
  const eventsPath = `${detailPath}/events`;
  const resultPath = `${detailPath}/result`;
  const assertHistoricalEvidenceAfterRestart = async () => {
    const restartedUseCases = createQueryUseCases();
    const [detail, events, result] = await Promise.all([
      invokeRunApi(restartedUseCases, detailPath),
      invokeRunApi(restartedUseCases, eventsPath),
      invokeRunApi(restartedUseCases, resultPath)
    ]);
    assert.equal(detail.status, 200, JSON.stringify(detail.payload));
    assert.equal(events.status, 200, JSON.stringify(events.payload));
    assert.equal(result.status, 200, JSON.stringify(result.payload));
    assert.equal(detail.payload.owner.teamIrSemanticDigest, saved.semanticDigest);
    assert.equal(detail.payload.owner.compiledPlanDigest, execution.state.compiledPlanDigest);
    assert.equal(detail.payload.plan.compiledPlanDigest, execution.state.compiledPlanDigest);
    assert.equal(detail.payload.state.compiledPlanDigest, execution.state.compiledPlanDigest);
    assert.equal(events.payload.events.some((event) => event.type === "run.result.written"), true);
    assert.deepEqual(result.payload.result, { teamResult: {
      data: { summary: "Historical evidence report." },
      artifacts: { report: { artifactId: execution.result.teamResult.artifacts.report.artifactId, mediaType: "text/markdown" } }
    } });
    const runArtifactStore = new FileTeamArtifactStore(join(projectRoot, ".ogs", "team-artifacts"));
    const reportReference = await runArtifactStore.validateReference({
      team: teamIR,
      owner: { projectId, runId },
      kind: "run-result",
      slotId: "report",
      reference: result.payload.result.teamResult.artifacts.report
    });
    const reader = await runArtifactStore.createInvocationResolver({
      owner: { projectId, runId },
      allowedArtifacts: [reportReference]
    });
    assert.equal(Buffer.from(await reader.read(reportReference.artifactId)).toString("utf8"),
      "# Historical report\n\nThe supplied evidence remains unchanged.");
  };

  const modifiedTeamIR = structuredClone(teamIR);
  modifiedTeamIR.agents.find((agent) => agent.id === "evidence-analyst").packageRef = "role:artifact-evidence-analyst@2";
  const modified = await teamIrStore.save({ workdir: teamRoot, teamIR: modifiedTeamIR });
  assert.notEqual(modified.semanticDigest, saved.semanticDigest);
  await assertHistoricalEvidenceAfterRestart();

  await rm(join(teamRoot, ".ogs", "team.ir.json"));
  assert.deepEqual(await teamIrStore.read({ workdir: teamRoot }), { teamIR: null, semanticDigest: null });
  await assertHistoricalEvidenceAfterRestart();

  const runEvidenceAfterQuery = await readJson(join(runDirectory, "team-ir-v2-state", `${runId}.json`));
  assert.equal(runEvidenceAfterQuery.compiledPlanDigest, execution.state.compiledPlanDigest);
  const ownerAfterQuery = await readJson(join(runDirectory, "run-owner.json"));
  assert.equal(ownerAfterQuery.teamIrSemanticDigest, saved.semanticDigest);
  assert.equal(ownerAfterQuery.compiledPlanDigest, execution.state.compiledPlanDigest);
  assert.equal(teamIRSemanticDigest(teamIR), saved.semanticDigest);
});
