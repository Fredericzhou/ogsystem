import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createRuntimeTaskReviewStore } from "../infrastructure/runtime-task-review-store.mjs";

test("Review reads reject linked Run and Review evidence before invoking Runtime readers", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ogs-review-evidence-safe-"));
  const runDir = join(root, ".ogs", "runs", "run-1");
  const task = { taskId: "task-1", taskNumber: 1, currentRunId: "run-1", runIds: ["run-1"], teamVersionId: "team-1", teamCoreDigest: "a".repeat(64) };
  const project = { projectId: "project-1", workdir: root, projectType: "collaboration", taskRecords: [task] };
  let runtimeReads = 0;
  const store = createRuntimeTaskReviewStore({
    async listHumanReviews() { runtimeReads += 1; return { reviews: [] }; },
    async writeHumanReviewDecision() { runtimeReads += 1; return {}; },
    createPrincipal() { return { id: "tester" }; },
    async getProject() { return project; }
  });
  try {
    await mkdir(join(runDir, "control", "reviews"), { recursive: true });
    await writeFile(join(runDir, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: project.projectId, taskId: task.taskId, taskNumber: task.taskNumber, attemptNumber: 1, teamVersionId: task.teamVersionId, teamCoreDigest: task.teamCoreDigest, runId: task.currentRunId }));
    await writeFile(join(runDir, "state.json"), JSON.stringify({ status: "waiting_review" }));
    await writeFile(join(runDir, "control", "reviews", "review-1.request.json"), "{}");
    const outside = join(root, "outside.json");
    await writeFile(outside, JSON.stringify({ reviewId: "review-1" }));
    await rm(join(runDir, "control", "reviews", "review-1.request.json"));
    try { await symlink(outside, join(runDir, "control", "reviews", "review-1.request.json"), "file"); }
    catch (error) {
      if (["EPERM", "EACCES", "ENOTSUP", "ENOSYS"].includes(error?.code)) return t.skip("file links are unavailable on this host");
      throw error;
    }
    await assert.rejects(store.listReviews(project, task), /symlinks or junctions/);
    assert.equal(runtimeReads, 0);
    await assert.rejects(store.decideReview(project, task, "review-1", "approve"), /symlinks or junctions/);
    assert.equal(runtimeReads, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Review decisions accept Runtime review IDs with branch and checkpoint markers", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-review-evidence-id-"));
  const runDir = join(root, ".ogs", "runs", "run-1");
  const reviewId = "review.quality-planner@1#4.r1";
  const task = { taskId: "task-1", taskNumber: 1, currentRunId: "run-1", runIds: ["run-1"], teamVersionId: "team-1", teamCoreDigest: "a".repeat(64) };
  const project = { projectId: "project-1", workdir: root, projectType: "collaboration", taskRecords: [task] };
  let written;
  const store = createRuntimeTaskReviewStore({
    async listHumanReviews() { return { reviews: [] }; },
    async writeHumanReviewDecision(input) { written = input; return { reviewId: input.reviewId }; },
    createPrincipal() { return { id: "tester" }; },
    async getProject() { return project; }
  });
  try {
    await mkdir(join(runDir, "control", "reviews"), { recursive: true });
    await writeFile(join(runDir, "run-owner.json"), JSON.stringify({ version: 1, runKind: "project_task", projectId: project.projectId, taskId: task.taskId, taskNumber: task.taskNumber, attemptNumber: 1, teamVersionId: task.teamVersionId, teamCoreDigest: task.teamCoreDigest, runId: task.currentRunId }));
    await writeFile(join(runDir, "control", "reviews", `${reviewId}.request.json`), JSON.stringify({ reviewId }));
    const result = await store.decideReview(project, task, reviewId, "approve", "verified");
    assert.equal(result.reviewId, reviewId);
    assert.equal(written.reviewId, reviewId);
  } finally { await rm(root, { recursive: true, force: true }); }
});
