import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";

import { validateRuntimeConfig } from "../dist/runtime/config.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import {
  buildHumanReviewDecisionPath,
  buildHumanReviewRequestPath,
  initializeRunContext,
  loadHumanReviewDecisions,
  loadHumanReviewRequests,
  markHumanReviewDecisionApplied,
  markHumanReviewDecisionReconciled,
  persistHumanReviewDecision,
  persistHumanReviewRequest
} from "../dist/runtime/run-artifacts.js";

async function createRunContext() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-human-review-artifacts-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const runtimeConfigPath = path.resolve(tempRoot, "runtime.json");
  const system = parseSystemFromMermaidSource(`flowchart TD
%% system.id=test.human.review.artifacts
%% system.version=1.0.0
%% law.global=law.test
%% entry.role=writer
%% exec.bind.writer=profile.writer
input -->|GO| writer[Role:writer]
writer[Role:writer] -->|DONE| output
`);
  await writeFile(systemPath, `flowchart TD
%% system.id=test.human.review.artifacts
%% system.version=1.0.0
%% law.global=law.test
%% entry.role=writer
%% exec.bind.writer=profile.writer
input -->|GO| writer[Role:writer]
writer[Role:writer] -->|DONE| output
`, "utf8");
  await writeFile(runtimeConfigPath, JSON.stringify({ executor: "opencode", roleRepo: "./og-roles" }), "utf8");

  return initializeRunContext({
    system,
    systemPath,
    prompt: "persist review artifacts",
    workdir: tempRoot,
    runtimeConfig: validateRuntimeConfig(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        runsDir: ".ogs/runs"
      },
      runtimeConfigPath
    )
  });
}

test("human review request and decision artifacts persist, reload, and track apply markers", async () => {
  const context = await createRunContext();
  const requestedAt = "2026-04-22T08:00:00.000Z";

  await persistHumanReviewRequest({
    context,
    review: {
      reviewId: "review.writer@1#1.r1",
      roleId: "writer",
      branchId: "writer@1#1",
      lineageId: "writer@1#1",
      loopIteration: 1,
      executionId: "exec-writer-1",
      selectedEvent: "DONE",
      draftResult: {
        roleId: "writer",
        event: "DONE",
        content: "draft",
        branchId: "writer@1#1",
        lineageId: "writer@1#1",
        loopIteration: 1
      },
      requestedAt,
      requestedByExecutionId: "exec-writer-1",
      status: "pending",
      round: 1,
      spec: {
        mode: "required",
        timeoutSeconds: 120,
        timeoutAction: "pause",
        reworkTargetRoleId: "writer",
        reworkMax: 2,
        terminateScope: "branch"
      }
    }
  });
  await persistHumanReviewDecision({
    context,
    decision: {
      reviewId: "review.writer@1#1.r1",
      committedAt: "2026-04-22T08:01:00.000Z",
      decidedAt: "2026-04-22T08:00:30.000Z",
      decision: "approve",
      actor: "tester",
      comment: "ship it"
    }
  });

  const requests = await loadHumanReviewRequests({ context });
  const unresolvedBeforeApply = await loadHumanReviewDecisions({ context, unresolvedOnly: true });

  assert.strictEqual(requests.length, 1);
  assert.strictEqual(unresolvedBeforeApply.length, 1);
  assert.equal(
    JSON.parse(await readFile(buildHumanReviewRequestPath(context, "review.writer@1#1.r1"), "utf8")).status,
    "pending"
  );
  assert.equal(
    JSON.parse(await readFile(buildHumanReviewDecisionPath(context, "review.writer@1#1.r1"), "utf8")).decision,
    "approve"
  );

  const applied = await markHumanReviewDecisionApplied({
    context,
    reviewId: "review.writer@1#1.r1",
    checkpointSequence: 7,
    appliedAt: "2026-04-22T08:01:05.000Z"
  });
  assert.equal(applied.checkpointSequence, 7);
  assert.equal(applied.appliedAt, "2026-04-22T08:01:05.000Z");
  assert.equal(applied.reconciledAt, undefined);

  const reconciled = await markHumanReviewDecisionReconciled({
    context,
    reviewId: "review.writer@1#1.r1",
    reconciledAt: "2026-04-22T08:01:06.000Z"
  });
  assert.equal(reconciled.checkpointSequence, 7);
  assert.equal(reconciled.appliedAt, "2026-04-22T08:01:05.000Z");
  assert.equal(reconciled.reconciledAt, "2026-04-22T08:01:06.000Z");

  const unresolvedAfterReconcile = await loadHumanReviewDecisions({ context, unresolvedOnly: true });
  assert.deepStrictEqual(unresolvedAfterReconcile, []);
});
