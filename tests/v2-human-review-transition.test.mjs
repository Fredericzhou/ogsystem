import test from "node:test";
import assert from "node:assert/strict";

import { createRunConsoleLogger } from "../dist/runtime/console-run-log.js";
import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import { createInitialGraphState } from "../dist/runtime/graph-runtime-state.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import { planHumanReviewDecisionTransition } from "../dist/runtime/transition-planner.js";

test("V2 explicit reject resolves the unique REJECTED edge", () => {
  const system = parseSystemFromMermaidSource(`flowchart TD
%% system.id=v2.review.reject
%% system.version=1.0.0
%% law.global=law.test
%% review.mode.writer=required
start[开始] -->|START| writer[Role:writer]
writer[Role:writer] -->|NEEDS_REWORK| rework[Role:rework]
writer[Role:writer] -->|REJECTED| rejected[Role:rejected]
rework[Role:rework] -->|DONE| end[结束]
rejected[Role:rejected] -->|DONE| end[结束]
`);
  const plan = createExecutionPlan(system, new Map([
    ["writer", { backend: "codex", modelId: "gpt-6-luna", modelRef: "codex/gpt-6-luna", bindingSource: "selection" }],
    ["rework", { backend: "codex", modelId: "gpt-6-luna", modelRef: "codex/gpt-6-luna", bindingSource: "selection" }],
    ["rejected", { backend: "codex", modelId: "gpt-6-luna", modelRef: "codex/gpt-6-luna", bindingSource: "selection" }]
  ]));
  const state = createInitialGraphState({ plan, prompt: "review" });
  const branch = {
    branchId: "writer@0#1",
    roleId: "writer",
    loopIteration: 0,
    branchSequence: 1,
    lineageId: "lineage-writer",
    sessionLineageId: "writer@0#1",
    status: "waiting_review"
  };
  state.branchRecords[branch.branchId] = branch;
  const review = {
    reviewId: "review.writer.r1",
    roleId: "writer",
    branchId: branch.branchId,
    lineageId: branch.lineageId,
    loopIteration: 0,
    executionId: "execution-writer-1",
    draftResult: { roleId: "writer", event: "READY", content: "draft" },
    requestedAt: "2026-11-16T00:00:00.000Z",
    requestedByExecutionId: "execution-writer-1",
    status: "pending",
    round: 1,
    stateVersion: state.stateVersion,
    spec: { mode: "required", timeoutAction: "terminate", reworkTargetRoleId: "rework", terminateScope: "branch" }
  };
  const transition = planHumanReviewDecisionTransition({
    state,
    plan,
    review,
    decision: {
      reviewId: review.reviewId,
      round: review.round,
      lineageId: review.lineageId,
      branchId: review.branchId,
      loopIteration: review.loopIteration,
      stateVersion: state.stateVersion,
      committedAt: "2026-11-16T00:01:00.000Z",
      decidedAt: "2026-11-16T00:01:00.000Z",
      decision: "reject"
    },
    logger: createRunConsoleLogger(false),
    rolePackagesByRoleId: new Map([["writer", { manifest: { authority: { controlActions: ["approve", "rework", "reject"] } } }]])
  });
  const nextBranch = Object.values(transition.update.branchRecords ?? {}).find((item) => item.branchId !== branch.branchId);
  assert.equal(nextBranch?.roleId, "rejected");
  assert.equal(nextBranch?.activatedByEvent, "REJECTED");
  assert.equal(transition.events[0].type, "human_review_rejected");

  assert.throws(
    () => planHumanReviewDecisionTransition({
      state,
      plan,
      review,
      decision: {
        reviewId: review.reviewId,
        round: review.round,
        lineageId: review.lineageId,
        branchId: review.branchId,
        loopIteration: review.loopIteration,
        stateVersion: state.stateVersion,
        committedAt: "2026-11-16T00:01:00.000Z",
        decidedAt: "2026-11-16T00:01:00.000Z",
        decision: "terminate",
        scope: "run"
      },
      logger: createRunConsoleLogger(false),
      rolePackagesByRoleId: new Map([["writer", { manifest: { authority: { controlActions: ["approve", "rework", "reject"] } } }]])
    }),
    /GRAPH_REVIEW_TERMINATE_SCOPE_MISMATCH/
  );

  assert.throws(
    () => planHumanReviewDecisionTransition({
      state,
      plan,
      review: { ...review, spec: { ...review.spec, terminateScope: undefined } },
      decision: {
        reviewId: review.reviewId,
        round: review.round,
        lineageId: review.lineageId,
        branchId: review.branchId,
        loopIteration: review.loopIteration,
        stateVersion: state.stateVersion,
        committedAt: "2026-11-16T00:01:00.000Z",
        decidedAt: "2026-11-16T00:01:00.000Z",
        decision: "terminate"
      },
      logger: createRunConsoleLogger(false),
      rolePackagesByRoleId: new Map([["writer", { manifest: { authority: { controlActions: ["approve", "rework", "reject"] } } }]])
    }),
    /GRAPH_REVIEW_TERMINATE_SCOPE_UNRESOLVED/
  );
});
