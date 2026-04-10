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

test("graph runtime helpers cover loop budget, join readiness, and state projection", () => {
  const system = parseSystemFromMermaidSource(source);
  const plan = createExecutionPlan(system);
  const state = createInitialState(plan, "demo");

  assert.deepStrictEqual(listSupportedRoutingModes(), ["parallel_split"]);
  assert.deepStrictEqual(listSupportedJoinModes(), ["all_of"]);
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

  state.roleResults.worker_a = {
    roleId: "worker_a",
    event: "A_DONE",
    content: "a",
    loopIteration: 1
  };
  assert.equal(
    isJoinNodeReady({
      node: review,
      currentRoleId: "worker_a",
      loopIteration: 1,
      state
    }),
    false
  );

  state.roleResults.worker_b = {
    roleId: "worker_b",
    event: "B_DONE",
    content: "b",
    loopIteration: 1
  };
  assert.equal(
    isJoinNodeReady({
      node: review,
      currentRoleId: "worker_b",
      loopIteration: 1,
      state
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
