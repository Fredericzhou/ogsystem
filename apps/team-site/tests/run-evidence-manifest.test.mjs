import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { digestRecord } from "../../../dist/runtime/workspace-contracts.js";
import { handleRunRoutes } from "../api/run-routes.mjs";
import { createFileRunQueryStore } from "../infrastructure/file-run-query-store.mjs";

test("Project Run manifest route reads the owning Run's Evidence manifest", async () => {
  const sent = [];
  const handled = await handleRunRoutes({
    request: { method: "GET" },
    response: {},
    url: new URL("http://localhost/api/v2/projects/project-1/tasks/task-1/runs/run-1/manifest"),
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus: () => 500,
    useCases: { async getProjectRunEvidenceManifest(projectId, taskId, runId) { return { projectId, taskId, runId, evidenceManifest: { manifestId: "run-1:evidence" } }; } }
  });
  assert.equal(handled, true);
  assert.deepEqual(sent, [{ status: 200, payload: { projectId: "project-1", taskId: "task-1", runId: "run-1", evidenceManifest: { manifestId: "run-1:evidence" } } }]);
});

test("Project Run cleanup route returns the contract cleanup result", async () => {
  const sent = [];
  const calls = [];
  const handled = await handleRunRoutes({
    request: { method: "POST" },
    response: {},
    url: new URL("http://localhost/api/v2/projects/project-1/tasks/task-1/runs/run-1/cleanup"),
    readBody: async () => ({ workspaceId: "workspace-1", expectedCanonicalHead: "a".repeat(40) }),
    sendJson: (_response, status, payload) => sent.push({ status, payload }),
    errorStatus: () => 500,
    useCases: {
      async cleanupProjectRunWorkspace(projectId, taskId, runId, request) {
        calls.push([projectId, taskId, runId, request]);
        return { projectId, taskId, runId, workspaceId: request.workspaceId, removedWorktrees: ["/private/project/.ogs/worktrees/run-1/role"], removedBranches: ["refs/heads/ogs/run-1/role"] };
      }
    }
  });
  assert.equal(handled, true);
  assert.deepEqual(calls, [["project-1", "task-1", "run-1", { workspaceId: "workspace-1", expectedCanonicalHead: "a".repeat(40) }]]);
  assert.deepEqual(sent, [{
    status: 200,
    payload: {
      projectId: "project-1",
      taskId: "task-1",
      runId: "run-1",
      workspaceId: "workspace-1",
      removedWorktreeCount: 1,
      removedBranchCount: 1
    }
  }]);
});

test("Project Run Evidence manifest verifies owner, digest, and every contained reference", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-run-evidence-manifest-"));
  const projectId = "project-evidence";
  const taskId = "task-evidence";
  const runId = "run-evidence";
  const projectRoot = join(projectsRoot, projectId);
  const runRoot = join(projectRoot, ".ogs", "runs", runId);
  try {
    await mkdir(join(projectRoot, ".site"), { recursive: true });
    const projectMetadata = {
      projectType: "collaboration",
      workspaceId: "workspace-evidence",
      workspaceBackend: "git-lfs",
      taskRecords: [{ taskId, taskNumber: 1, teamVersionId: "team-evidence", runIds: [runId] }]
    };
    await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify(projectMetadata));
    await mkdir(join(runRoot, "checkpoints"), { recursive: true });
    await mkdir(join(runRoot, "provenance"), { recursive: true });
    await mkdir(join(runRoot, "control", "reviews"), { recursive: true });
    await writeFile(join(runRoot, "run-owner.json"), JSON.stringify({
      version: 1,
      runKind: "project_task",
      projectId,
      taskId,
      runId,
      taskNumber: 1,
      attemptNumber: 1,
      teamVersionId: "team-evidence"
    }));
    await writeFile(join(runRoot, "events.ndjson"), `${JSON.stringify({ eventId: "event#1", runId })}\n`);
    await writeFile(join(runRoot, "checkpoints", "checkpoint-1.json"), "{}\n");
    await writeFile(join(runRoot, "provenance", "commit-1.json"), "{}\n");
    await writeFile(join(runRoot, "control", "reviews", "review-1.request.json"), "{}\n");

    const manifestBase = {
      ogsContractVersion: 2,
      schemaVersion: 1,
      manifestId: `${runId}:evidence`,
      runId,
      eventRefs: ["events.ndjson#event%231"],
      checkpointRefs: ["checkpoints/checkpoint-1.json"],
      provenanceRefs: ["provenance/commit-1.json"],
      reviewRefs: ["control/reviews/review-1.request.json"]
    };
    await writeFile(join(runRoot, "evidence-manifest.json"), JSON.stringify({ ...manifestBase, digest: digestRecord(manifestBase) }));
    const store = createFileRunQueryStore({ projectsRoot });
    const manifest = await store.readRunEvidenceManifest(projectId, taskId, runId);
    assert.deepEqual(manifest, { ...manifestBase, digest: digestRecord(manifestBase) });

    for (const invalidBinding of [
      { ...projectMetadata, workspaceId: "" },
      { ...projectMetadata, workspaceBackend: "filesystem" }
    ]) {
      await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify(invalidBinding));
      await assert.rejects(() => store.readRunEvidenceManifest(projectId, taskId, runId), /Git LFS Workspace binding/);
    }
    await writeFile(join(projectRoot, ".site", "project.json"), JSON.stringify(projectMetadata));

    const unsafeBase = { ...manifestBase, checkpointRefs: ["../outside.json"] };
    await writeFile(join(runRoot, "evidence-manifest.json"), JSON.stringify({ ...unsafeBase, digest: digestRecord(unsafeBase) }));
    await assert.rejects(() => store.readRunEvidenceManifest(projectId, taskId, runId), /reference path is unsafe/);

    const missingEventBase = { ...manifestBase, eventRefs: ["events.ndjson#missing"] };
    await writeFile(join(runRoot, "evidence-manifest.json"), JSON.stringify({ ...missingEventBase, digest: digestRecord(missingEventBase) }));
    await assert.rejects(() => store.readRunEvidenceManifest(projectId, taskId, runId), /Event reference does not resolve/);
  } finally {
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
