import test from "node:test";
import assert from "node:assert/strict";

import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import {
  createInitialState,
  createInitialGraphState,
  findRoleResult,
  listActiveBranches,
  getTargetLoopIteration,
  getActiveRoleIds,
  projectStateSnapshot,
  wouldExceedLoopBudget
} from "../dist/runtime/graph-runtime-state.js";
import {
  applyGraphUpdateToIndexes,
  buildRuntimeIndexes
} from "../dist/runtime/runtime-indexes.js";
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
%% role.mode.dispatch=parallel_split
%% join.mode.review=all_of
%% join.sources.review=worker_a,worker_b
%% loop.max.review=2
%% exec.bind.dispatch=profile.dispatch
%% exec.bind.worker_a=profile.worker
%% exec.bind.worker_b=profile.worker
%% exec.bind.review=profile.review

start[开始] -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|TO_A| workerA[Role:worker_a]
dispatch[Role:dispatch] -->|TO_B| workerB[Role:worker_b]
workerA[Role:worker_a] -->|A_DONE| review[Role:review]
workerB[Role:worker_b] -->|B_DONE| review[Role:review]
review[Role:review] -->|DONE| end[结束]
`;

const quorumSource = `flowchart TD
%% system.id=graph.helpers.quorum
%% system.version=1.0.0
%% law.global=law.test
%% role.mode.dispatch=parallel_split
%% join.mode.review=quorum_of
%% join.sources.review=worker_a,worker_b,worker_c
%% join.min.review=2
%% exec.bind.dispatch=profile.dispatch
%% exec.bind.worker_a=profile.worker
%% exec.bind.worker_b=profile.worker
%% exec.bind.worker_c=profile.worker
%% exec.bind.review=profile.review

start[开始] -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|TO_A| workerA[Role:worker_a]
dispatch[Role:dispatch] -->|TO_B| workerB[Role:worker_b]
dispatch[Role:dispatch] -->|TO_C| workerC[Role:worker_c]
workerA[Role:worker_a] -->|A_DONE| review[Role:review]
workerB[Role:worker_b] -->|B_DONE| review[Role:review]
workerC[Role:worker_c] -->|C_DONE| review[Role:review]
review[Role:review] -->|DONE| end[结束]
`;

const parallelErrorFilterSource = `flowchart TD
%% system.id=graph.helpers.parallel.error.filter
%% system.version=1.0.0
%% law.global=law.test
%% role.mode.dispatch=parallel_split
%% exec.bind.dispatch=profile.dispatch
%% exec.bind.worker_a=profile.worker
%% exec.bind.compensate=profile.comp

start[开始] -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|TO_A| workerA[Role:worker_a]
dispatch[Role:dispatch] -->|TO_A_DUP| workerA[Role:worker_a]
dispatch[Role:dispatch] -->|ERROR| compensate[Role:compensate]
dispatch[Role:dispatch] -->|ERROR.TOOL_EXECUTION_SPAWN| compensate[Role:compensate]
workerA[Role:worker_a] -->|DONE| end[结束]
compensate[Role:compensate] -->|COMP_DONE| end[结束]
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

test("random start dispatch is fixed by Run ID and persisted in initial graph state", () => {
  const randomSystem = parseSystemFromMermaidSource(`flowchart TD
%% system.id=graph.helpers.random-entry
%% system.version=1.0.0
%% law.global=law.test
%% start.dispatch.mode=random_n
%% start.dispatch.count=2
start[开始] -->|START| alpha[Role:alpha]
start[开始] -->|START| beta[Role:beta]
start[开始] -->|START| gamma[Role:gamma]
alpha[Role:alpha] -->|DONE| end[结束]
beta[Role:beta] -->|DONE| end[结束]
gamma[Role:gamma] -->|DONE| end[结束]
`);
  const plan = createExecutionPlan(randomSystem);
  const first = createInitialGraphState({ plan, prompt: "same task", runId: "run-fixed" });
  const resumed = createInitialGraphState({ plan, prompt: "same task", runId: "run-fixed" });
  const anotherRun = createInitialGraphState({ plan, prompt: "same task", runId: "run-other" });

  assert.equal(first.selectedEntryRoleIds.length, 2);
  assert.deepEqual(resumed.selectedEntryRoleIds, first.selectedEntryRoleIds);
  assert.deepEqual(Object.values(first.branchRecords).map((branch) => branch.roleId), first.selectedEntryRoleIds);
  assert.equal(anotherRun.selectedEntryRoleIds.length, 2);
  assert.ok(first.selectedEntryRoleIds.every((roleId) => ["alpha", "beta", "gamma"].includes(roleId)));
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

test("parallel_split routing excludes ERROR* edges and deduplicates target roles", () => {
  const system = parseSystemFromMermaidSource(parallelErrorFilterSource);
  const plan = createExecutionPlan(system);
  const dispatch = plan.nodesByRoleId.get("dispatch");
  assert.ok(dispatch);

  assert.deepStrictEqual(
    selectRoutingTargets({
      node: dispatch,
      mode: "ok"
    }),
    ["worker_a"]
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

test("runtime indexes preserve active branch, result lookup, and join readiness semantics", () => {
  const system = parseSystemFromMermaidSource(source);
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
  state.roleResults[workerBBranch.branchId] = {
    roleId: "worker_b",
    event: "B_DONE",
    content: "b",
    branchId: workerBBranch.branchId,
    lineageId: workerBBranch.lineageId,
    loopIteration: 1
  };

  const indexes = buildRuntimeIndexes(state);
  assert.deepStrictEqual(
    listActiveBranches(state, "worker_a", indexes).map((branch) => branch.branchId),
    ["worker_a@1#2"]
  );
  assert.deepStrictEqual(getActiveRoleIds(state, indexes), getActiveRoleIds(state));
  assert.deepStrictEqual(
    findRoleResult({
      state,
      roleId: "worker_b",
      lineageId: "dispatch@1#1",
      loopIteration: 1,
      indexes
    }),
    state.roleResults[workerBBranch.branchId]
  );
  assert.equal(
    isJoinNodeReady({
      node: review,
      currentBranch: workerBBranch,
      state,
      currentResult: state.roleResults[workerBBranch.branchId],
      indexes
    }),
    true
  );

  applyGraphUpdateToIndexes(indexes, {
    branchRecords: {
      [workerABranch.branchId]: {
        ...workerABranch,
        status: "completed"
      }
    }
  });
  assert.deepStrictEqual(listActiveBranches(state, "worker_a", indexes), []);
});
