import test from "node:test";
import assert from "node:assert/strict";

import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import {
  createInitialState,
  getTargetLoopIteration,
  getActiveRoleIds,
  projectStateSnapshot,
  wouldExceedLoopBudget
} from "../dist/runtime/graph-runtime-state.js";
import {
  isJoinNodeReady,
  listSupportedJoinModes,
  listSupportedRoutingModes,
  selectRoutingTargets
} from "../dist/runtime/graph-mode-registry.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";

const source = `flowchart TD
%% system.id=graph.helpers
%% system.version=1.0.0
%% law.global=law.test
%% entry.role=dispatch
%% role.mode.dispatch=parallel_split
%% join.mode.review=all_of
%% join.sources.review=worker_a,worker_b
%% loop.max.review=2
%% exec.bind.dispatch=profile.dispatch
%% exec.bind.worker_a=profile.worker
%% exec.bind.worker_b=profile.worker
%% exec.bind.review=profile.review

input -->|ENTER| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|TO_A| workerA[Role:worker_a]
dispatch[Role:dispatch] -->|TO_B| workerB[Role:worker_b]
workerA[Role:worker_a] -->|A_DONE| review[Role:review]
workerB[Role:worker_b] -->|B_DONE| review[Role:review]
review[Role:review] -->|DONE| output
`;

const quorumSource = `flowchart TD
%% system.id=graph.helpers.quorum
%% system.version=1.0.0
%% law.global=law.test
%% entry.role=dispatch
%% role.mode.dispatch=parallel_split
%% join.mode.review=quorum_of
%% join.sources.review=worker_a,worker_b,worker_c
%% join.min.review=2
%% exec.bind.dispatch=profile.dispatch
%% exec.bind.worker_a=profile.worker
%% exec.bind.worker_b=profile.worker
%% exec.bind.worker_c=profile.worker
%% exec.bind.review=profile.review

input -->|ENTER| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|TO_A| workerA[Role:worker_a]
dispatch[Role:dispatch] -->|TO_B| workerB[Role:worker_b]
dispatch[Role:dispatch] -->|TO_C| workerC[Role:worker_c]
workerA[Role:worker_a] -->|A_DONE| review[Role:review]
workerB[Role:worker_b] -->|B_DONE| review[Role:review]
workerC[Role:worker_c] -->|C_DONE| review[Role:review]
review[Role:review] -->|DONE| output
`;

test("graph runtime helpers cover loop budget, join readiness, and state projection", () => {
  const system = parseSystemFromMermaidSource(source);
  const plan = createExecutionPlan(system);
  const state = createInitialState(plan, "demo");

  assert.deepStrictEqual(listSupportedRoutingModes(), ["parallel_split"]);
  assert.deepStrictEqual(listSupportedJoinModes(), ["all_of", "quorum_of"]);
  assert.deepStrictEqual(getActiveRoleIds(state), ["dispatch"]);

  const dispatch = plan.nodesByRoleId.get("dispatch");
  const review = plan.nodesByRoleId.get("review");
  assert.ok(dispatch);
  assert.ok(review);

  assert.deepStrictEqual(
    selectRoutingTargets({
      node: dispatch,
      mode: "ok"
    }),
    ["worker_a", "worker_b"]
  );

  const workerABranch = {
    branchId: "worker_a@1#2",
    roleId: "worker_a",
    loopIteration: 1,
    branchSequence: 2,
    lineageId: "dispatch@1#1",
    sessionLineageId: "worker_a@1#2",
    parentBranchId: "dispatch@1#1",
    activatedByRoleId: "dispatch",
    activatedByEvent: "TO_A",
    status: "active"
  };
  const workerBBranch = {
    branchId: "worker_b@1#3",
    roleId: "worker_b",
    loopIteration: 1,
    branchSequence: 3,
    lineageId: "dispatch@1#1",
    sessionLineageId: "worker_b@1#3",
    parentBranchId: "dispatch@1#1",
    activatedByRoleId: "dispatch",
    activatedByEvent: "TO_B",
    status: "active"
  };
  state.branchRecords[workerABranch.branchId] = workerABranch;
  state.branchRecords[workerBBranch.branchId] = workerBBranch;

  state.roleResults[workerABranch.branchId] = {
    roleId: "worker_a",
    event: "A_DONE",
    content: "a",
    branchId: workerABranch.branchId,
    lineageId: workerABranch.lineageId,
    loopIteration: 1
  };
  assert.equal(
    isJoinNodeReady({
      node: review,
      currentBranch: workerABranch,
      state,
      currentResult: state.roleResults[workerABranch.branchId]
    }),
    false
  );

  state.roleResults[workerBBranch.branchId] = {
    roleId: "worker_b",
    event: "B_DONE",
    content: "b",
    branchId: workerBBranch.branchId,
    lineageId: workerBBranch.lineageId,
    loopIteration: 1
  };
  assert.equal(
    isJoinNodeReady({
      node: review,
      currentBranch: workerBBranch,
      state,
      currentResult: state.roleResults[workerBBranch.branchId]
    }),
    true
  );

  state.loopIterations.review = 2;
  assert.equal(
    getTargetLoopIteration({
      targetRoleId: "review",
      currentLoopIteration: 1,
      state,
      plan
    }),
    3
  );
  assert.equal(
    wouldExceedLoopBudget({
      targetRoleId: "review",
      currentLoopIteration: 1,
      state,
      plan
    }),
    true
  );

  const snapshot = projectStateSnapshot({ state, plan });
  assert.equal(snapshot.status, "running");
  assert.ok(Array.isArray(snapshot.activeBranches));
});

test("graph runtime helpers evaluate quorum_of readiness by unique completed sources", () => {
  const system = parseSystemFromMermaidSource(quorumSource);
  const plan = createExecutionPlan(system);
  const state = createInitialState(plan, "demo");
  const review = plan.nodesByRoleId.get("review");
  assert.ok(review);

  const workerABranch = {
    branchId: "worker_a@1#2",
    roleId: "worker_a",
    loopIteration: 1,
    branchSequence: 2,
    lineageId: "dispatch@1#1",
    sessionLineageId: "worker_a@1#2",
    parentBranchId: "dispatch@1#1",
    activatedByRoleId: "dispatch",
    activatedByEvent: "TO_A",
    status: "active"
  };
  const workerBBranch = {
    branchId: "worker_b@1#3",
    roleId: "worker_b",
    loopIteration: 1,
    branchSequence: 3,
    lineageId: "dispatch@1#1",
    sessionLineageId: "worker_b@1#3",
    parentBranchId: "dispatch@1#1",
    activatedByRoleId: "dispatch",
    activatedByEvent: "TO_B",
    status: "active"
  };
  state.branchRecords[workerABranch.branchId] = workerABranch;
  state.branchRecords[workerBBranch.branchId] = workerBBranch;

  state.roleResults[workerABranch.branchId] = {
    roleId: "worker_a",
    event: "A_DONE",
    content: "a",
    branchId: workerABranch.branchId,
    lineageId: workerABranch.lineageId,
    loopIteration: 1
  };
  assert.equal(
    isJoinNodeReady({
      node: review,
      currentBranch: workerABranch,
      state,
      currentResult: state.roleResults[workerABranch.branchId]
    }),
    false
  );

  state.roleResults[workerBBranch.branchId] = {
    roleId: "worker_b",
    event: "B_DONE",
    content: "b",
    branchId: workerBBranch.branchId,
    lineageId: workerBBranch.lineageId,
    loopIteration: 1
  };
  assert.equal(
    isJoinNodeReady({
      node: review,
      currentBranch: workerBBranch,
      state,
      currentResult: state.roleResults[workerBBranch.branchId]
    }),
    true
  );
});

test("graph runtime helpers keep quorum_of readiness isolated by lineageId", () => {
  const system = parseSystemFromMermaidSource(quorumSource);
  const plan = createExecutionPlan(system);
  const state = createInitialState(plan, "demo");
  const review = plan.nodesByRoleId.get("review");
  assert.ok(review);

  const currentLineageWorkerB = {
    branchId: "worker_b@1#3",
    roleId: "worker_b",
    loopIteration: 1,
    branchSequence: 3,
    lineageId: "dispatch@1#1",
    sessionLineageId: "worker_b@1#3",
    parentBranchId: "dispatch@1#1",
    activatedByRoleId: "dispatch",
    activatedByEvent: "TO_B",
    status: "active"
  };
  const otherLineageWorkerA = {
    branchId: "worker_a@1#8",
    roleId: "worker_a",
    loopIteration: 1,
    branchSequence: 8,
    lineageId: "dispatch@1#7",
    sessionLineageId: "worker_a@1#8",
    parentBranchId: "dispatch@1#7",
    activatedByRoleId: "dispatch",
    activatedByEvent: "TO_A",
    status: "completed"
  };
  state.branchRecords[currentLineageWorkerB.branchId] = currentLineageWorkerB;
  state.branchRecords[otherLineageWorkerA.branchId] = otherLineageWorkerA;

  state.roleResults[currentLineageWorkerB.branchId] = {
    roleId: "worker_b",
    event: "B_DONE",
    content: "b",
    branchId: currentLineageWorkerB.branchId,
    lineageId: currentLineageWorkerB.lineageId,
    loopIteration: 1
  };
  state.roleResults[otherLineageWorkerA.branchId] = {
    roleId: "worker_a",
    event: "A_DONE",
    content: "a",
    branchId: otherLineageWorkerA.branchId,
    lineageId: otherLineageWorkerA.lineageId,
    loopIteration: 1
  };

  assert.equal(
    isJoinNodeReady({
      node: review,
      currentBranch: currentLineageWorkerB,
      state,
      currentResult: state.roleResults[currentLineageWorkerB.branchId]
    }),
    false
  );
});
