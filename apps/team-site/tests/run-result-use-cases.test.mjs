import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRunResultUseCases } from "../application/run-result-use-cases.mjs";
import { createFileRunResultStore } from "../infrastructure/file-run-result-store.mjs";

test("Run result use case returns role-grouped outputs and stays unavailable when absent", async () => {
  const runs = new Map([
    ["run-1", { runKind: "project_task", owner: { kind: "project_task", projectId: "collaboration-1", taskId: "task-1", teamVersionId: "team-1", attemptNumber: 2 }, teamVersionId: "team-1", taskId: "task-1", runId: "run-1", attemptNumber: 2 }],
    ["run-2", { runKind: "project_task", owner: { kind: "project_task", projectId: "collaboration-1", taskId: "task-1", teamVersionId: "team-1", attemptNumber: 3 }, teamVersionId: "team-1", taskId: "task-1", runId: "run-2", attemptNumber: 3 }]
  ]);
  const grouped = { finalOutputsByRoleId: { analyst: [{ content: "complete output" }] }, finalOutputRoleOrder: ["analyst"] };
  const runResultStore = { readFinalOutputs: async (run) => run.runId === "run-1" ? grouped : undefined };
  const useCases = createRunResultUseCases({ getRun: async (_projectId, _taskId, runId) => runs.get(runId), runResultStore });

  const first = await useCases.getProjectRunResult("collaboration-1", "task-1", "run-1");
  assert.equal(first.runKind, "project_task");
  assert.deepEqual(first.owner, { kind: "project_task", projectId: "collaboration-1", taskId: "task-1", taskNumber: undefined, attemptNumber: 2, teamVersionId: "team-1" });
  assert.equal(first.runId, "run-1");
  assert.equal(first.available, true);
  assert.deepEqual(first.result, grouped);
  const second = await useCases.getProjectRunResult("collaboration-1", "task-1", "run-2");
  assert.equal(second.runKind, "project_task");
  assert.equal(second.owner.projectId, "collaboration-1");
  assert.equal(second.available, false);
  assert.equal(second.result, null);
});

test("file Run result store reads grouped graph outputs and redacts credentials", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-result-"));
  const statePath = join(root, "project-1", ".ogs", "runs", "run-1", "state.json");
  try {
    await mkdir(join(root, "project-1", ".site"), { recursive: true });
    await mkdir(join(root, "project-1", ".ogs", "runs", "run-1"), { recursive: true });
    await mkdir(join(root, "project-1", ".ogs", "runs", "missing"), { recursive: true });
    const task = { taskId: "task-1", taskNumber: 1, currentRunId: "run-1", runIds: ["run-1", "missing"], teamVersionId: "team-1" };
    await writeFile(join(root, "project-1", ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [task] }), "utf8");
    for (const runId of ["run-1", "missing"]) {
      await writeFile(join(root, "project-1", ".ogs", "runs", runId, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: "project-1", taskId: "task-1", taskNumber: 1, attemptNumber: runId === "run-1" ? 1 : 2, teamVersionId: "team-1", runId }), "utf8");
    }
    await writeFile(statePath, JSON.stringify({
      graphState: { status: "done", resultCommit: { status: "committed", resultId: "result:run-1" }, finalOutputsByRoleId: { reviewer: [{ content: "Authorization: Bearer abcdefghijklmnop" }] }, finalOutputRoleOrder: ["reviewer"] },
      privateRuntimeField: "must not escape"
    }), "utf8");
    const store = createFileRunResultStore({ projectsRoot: root });
    const owner = { kind: "project_task", projectId: "project-1", taskId: "task-1" };
    const result = await store.readFinalOutputs({ owner, taskId: "task-1", runId: "run-1" });
    assert.match(result.finalOutputsByRoleId.reviewer[0].content, /\[REDACTED\]/);
    assert.equal(await store.readFinalOutputs({ owner, taskId: "task-1", runId: "missing" }), undefined);
    await assert.rejects(store.readFinalOutputs({ owner: { ...owner, projectId: "../outside" }, taskId: "task-1", runId: "run-1" }), /projectId is invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file Run result store exposes only hashed sealed artifact files for promotion", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-artifact-bundle-"));
  try {
    const projectRoot = join(root, "project-1");
    const runDir = join(projectRoot, ".ogs", "runs", "run-1");
    const artifactDir = join(runDir, "shared", "artifact");
    await mkdir(artifactDir, { recursive: true });
    await mkdir(join(projectRoot, ".site"), { recursive: true });
    await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [{ taskId: "task-1", taskNumber: 1, runIds: ["run-1"], teamVersionId: "team-1" }] }));
    await writeFile(join(runDir, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: "project-1", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-1", runId: "run-1" }));
    await writeFile(join(runDir, "state.json"), JSON.stringify({ graphState: { status: "done", resultCommit: { status: "committed" }, finalOutputsByRoleId: { writer: [{ content: "done" }] }, finalOutputRoleOrder: ["writer"] } }));
    const bytes = Buffer.from("sealed report");
    await writeFile(join(artifactDir, "report.txt"), bytes);
    const verifiedUnsigned = { version: 1, status: "verified", artifactId: "artifact:run-1:exec-1", runId: "run-1", producerRoleId: "writer", executionId: "exec-1", generatedAt: "2026-11-10T00:00:00.000Z", files: [{ path: "report.txt", sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.byteLength, mediaType: "text/plain" }], totalBytes: bytes.byteLength };
    const verifiedManifest = { ...verifiedUnsigned, manifestSha256: createHash("sha256").update(`${JSON.stringify(verifiedUnsigned, null, 2)}\n`).digest("hex") };
    await writeFile(join(runDir, "shared", "artifact-manifest.json"), `${JSON.stringify(verifiedManifest, null, 2)}\n`);
    await writeFile(join(runDir, "shared", "seal-manifest.json"), JSON.stringify({ status: "sealed", artifact: "artifact", testReport: "verification.json", manifestSha256: verifiedManifest.manifestSha256, files: [{ path: "report.txt", sha256: verifiedManifest.files[0].sha256, mediaType: "text/plain" }] }));
    const store = createFileRunResultStore({ projectsRoot: root });
    const bundle = await store.readSealedArtifactBundle({ owner: { kind: "project_task", projectId: "project-1" }, taskId: "task-1", runId: "run-1" });
    assert.equal(bundle.files.length, 1);
    assert.deepEqual(bundle.files[0].content, bytes);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file Run result store keeps outputs private before durable completion", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-result-pending-"));
  try {
    const projectRoot = join(root, "project-1");
    const runDir = join(projectRoot, ".ogs", "runs", "run-1");
    await mkdir(join(projectRoot, ".site"), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [{ taskId: "task-1", taskNumber: 1, runIds: ["run-1"], teamVersionId: "team-1" }] }));
    await writeFile(join(runDir, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: "project-1", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-1", runId: "run-1" }));
    await writeFile(join(runDir, "state.json"), JSON.stringify({ graphState: { status: "running", finalOutputsByRoleId: { reviewer: [{ content: "draft" }] } } }), "utf8");
    const result = await createFileRunResultStore({ projectsRoot: root }).readFinalOutputs({ owner: { kind: "project_task", projectId: "project-1", taskId: "task-1" }, taskId: "task-1", runId: "run-1" });
    assert.equal(result, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file Run result store rejects snapshots without durable result commit", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-result-legacy-"));
  try {
    const projectRoot = join(root, "project-1");
    const runDir = join(projectRoot, ".ogs", "runs", "run-1");
    await mkdir(join(projectRoot, ".site"), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [{ taskId: "task-1", taskNumber: 1, runIds: ["run-1"], teamVersionId: "team-1" }] }));
    await writeFile(join(runDir, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: "project-1", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-1", runId: "run-1" }));
    await writeFile(join(runDir, "state.json"), JSON.stringify({ graphState: { finalOutputsByRoleId: { reviewer: [{ content: "legacy" }] }, finalOutputRoleOrder: ["reviewer"] } }), "utf8");
    const result = await createFileRunResultStore({ projectsRoot: root }).readFinalOutputs({ owner: { kind: "project_task", projectId: "project-1", taskId: "task-1" }, taskId: "task-1", runId: "run-1" });
    assert.equal(result, undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("file Run result store rejects linked final-output evidence", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ogs-run-result-link-"));
  try {
    const projectRoot = join(root, "project-1");
    const runDir = join(projectRoot, ".ogs", "runs", "run-1");
    await mkdir(join(projectRoot, ".site"), { recursive: true });
    await mkdir(runDir, { recursive: true });
    await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify({ projectType: "collaboration", taskRecords: [{ taskId: "task-1", taskNumber: 1, runIds: ["run-1"], teamVersionId: "team-1" }] }));
    await writeFile(join(runDir, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: "project-1", taskId: "task-1", taskNumber: 1, attemptNumber: 1, teamVersionId: "team-1", runId: "run-1" }));
    const outside = join(root, "outside.json");
    await writeFile(outside, JSON.stringify({ graphState: { finalOutputsByRoleId: { role: [{ content: "outside secret" }] } } }));
    try {
      await symlink(outside, join(runDir, "state.json"), "file");
    } catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) return t.skip(`file links unavailable: ${error.code}`);
      throw error;
    }
      await assert.rejects(createFileRunResultStore({ projectsRoot: root }).readFinalOutputs({ owner: { kind: "project_task", projectId: "project-1", taskId: "task-1" }, taskId: "task-1", runId: "run-1" }), /RUN_EVIDENCE_LINK_NOT_ALLOWED/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
