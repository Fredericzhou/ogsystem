import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { inspectRun } from "../../../dist/runtime/project-lifecycle.js";
import { loadRolePackage } from "../../../dist/runtime/role-repo.js";
import { readProjectRunOwner } from "./project-run-evidence-paths.mjs";
import { assertSafeEvidencePath } from "./safe-evidence-path.mjs";

async function assertReviewEvidenceSafe(project, runId, reviewId) {
  const runSegments = [".ogs", "runs", runId];
  const files = [
    [...runSegments, "state.json"],
    [...runSegments, "metrics.json"],
    [...runSegments, "resolved-config.json"],
    [...runSegments, "summary.json"],
    [...runSegments, "events.ndjson"],
    [...runSegments, "events.jsonl"],
    [...runSegments, "control", "stop-request.json"],
    [...runSegments, "control", "stop-outcome.json"]
  ];
  for (const segments of files) {
    try { await assertSafeEvidencePath(project.workdir, segments, { kind: "file", label: "Review Run evidence" }); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
  const reviewRoot = [...runSegments, "control", "reviews"];
  try {
    await assertSafeEvidencePath(project.workdir, reviewRoot, { kind: "directory", label: "Review evidence" });
  } catch (error) {
    if (error?.code === "ENOENT" && !reviewId) return;
    if (error?.code === "ENOENT" && reviewId) throw error;
    throw error;
  }
  const reviewDirectory = resolve(project.workdir, ...reviewRoot);
  const entries = await readdir(reviewDirectory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.name.endsWith(".request.json") && !entry.name.endsWith(".decision.json")) continue;
    const id = entry.name.replace(/\.(?:request|decision)\.json$/, "");
    if (!/^[A-Za-z0-9][A-Za-z0-9._@#-]{0,127}$/.test(id)) throw new Error("RUN_EVIDENCE_PATH_INVALID: Review ID is invalid.");
    await assertSafeEvidencePath(project.workdir, [...reviewRoot, entry.name], { kind: "file", label: "Review evidence" });
  }
  if (reviewId) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._@#-]{0,127}$/.test(String(reviewId))) throw new Error("RUN_EVIDENCE_PATH_INVALID: Review ID is invalid.");
    for (const suffix of ["request", "decision"]) {
      const target = [...reviewRoot, `${reviewId}.${suffix}.json`];
      try { await assertSafeEvidencePath(project.workdir, target, { kind: "file", allowMissingFinal: true, label: "Review evidence" }); }
      catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
  }
}

export function createRuntimeTaskReviewStore({ listHumanReviews, writeHumanReviewDecision, createPrincipal, getProject }) {
  if (typeof listHumanReviews !== "function" || typeof writeHumanReviewDecision !== "function"
    || typeof createPrincipal !== "function" || typeof getProject !== "function") {
    throw new TypeError("Runtime Task review store requires review readers, writers, principal creation, and Project lookup.");
  }
  return Object.freeze({
    async listReviews(project, task) {
      await readProjectRunOwner(project, task, task.currentRunId);
      await assertReviewEvidenceSafe(project, task.currentRunId);
      const result = await listHumanReviews(project.workdir, task.currentRunId);
      const run = await inspectRun(project.workdir, task.currentRunId);
      const roleRepoDir = run.resolvedConfig?.effective?.roleRepoDir;
      if (typeof roleRepoDir !== "string" || !roleRepoDir) return { ...result, reviews: result.reviews.map((review) => ({ ...review, allowedDecisions: [] })) };
      const decisionsByRole = new Map();
      const reviews = await Promise.all((result.reviews || []).map(async (review) => {
        if (!review.roleId) return { ...review, allowedDecisions: [] };
        if (!decisionsByRole.has(review.roleId)) {
          decisionsByRole.set(review.roleId, loadRolePackage({ roleId: review.roleId, roleRootDir: roleRepoDir })
            .then((role) => role.manifest.authority.controlActions)
            .catch(() => []));
        }
        return { ...review, allowedDecisions: await decisionsByRole.get(review.roleId) };
      }));
      return { ...result, reviews };
    },
    async decideReview(project, task, selectedReviewId, decision, comment, terminateScope) {
      await readProjectRunOwner(project, task, task.currentRunId);
      await assertReviewEvidenceSafe(project, task.currentRunId, selectedReviewId);
      return writeHumanReviewDecision({
        workdir: project.workdir,
        runId: task.currentRunId,
        reviewId: selectedReviewId,
        decision,
        comment,
        principal: createPrincipal(),
        ...(decision === "terminate" && (terminateScope === "branch" || terminateScope === "run") ? { scope: terminateScope } : {})
      });
    }
  });
}
