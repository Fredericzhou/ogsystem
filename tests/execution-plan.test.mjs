import test from "node:test";
import assert from "node:assert/strict";

import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";

const source = `flowchart TD
%% system.id=plan.demo
%% system.version=1.0.0
%% law.global=law.plan
%% entry.role=dispatch
%% route.order.dispatch=worker_b,worker_a
%% role.mode.dispatch=parallel_split
%% join.mode.review=quorum_of
%% join.sources.review=worker_a,worker_b
%% join.min.review=2
%% context.map.review.summary=source(worker_a).content
%% context.map.review.task=global.task
%% review.mode.review=required
%% review.timeout.review=900
%% review.timeout.action.review=terminate
%% review.rework.target.review=dispatch
%% review.rework.max.review=3
%% review.terminate.scope.review=run
%% loop.max.dispatch=2
%% model.bind.dispatch=model.fast
%% exec.bind.worker_a=profile.a
%% model.bind.worker_b=model.deep
%% model.bind.review=model.deep

input -->|ENTER| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|TO_A| workerA[Role:worker_a]
dispatch[Role:dispatch] -->|TO_B| workerB[Role:worker_b]
workerA[Role:worker_a] -->|A_DONE| review[Role:review]
workerB[Role:worker_b] -->|B_DONE| review[Role:review]
review[Role:review] -->|RETRY| dispatch[Role:dispatch]
review[Role:review] -->|DONE| output
`;

test("execution plan normalizes graph semantics and bindings", () => {
  const system = parseSystemFromMermaidSource(source);
  const plan = createExecutionPlan(system);

  assert.strictEqual(plan.systemId, "plan.demo");
  assert.strictEqual(plan.entryRoleId, "dispatch");
  assert.deepStrictEqual(plan.roleIds, ["dispatch", "worker_a", "worker_b", "review"]);

  const dispatch = plan.nodesByRoleId.get("dispatch");
  const workerA = plan.nodesByRoleId.get("worker_a");
  const workerB = plan.nodesByRoleId.get("worker_b");
  const review = plan.nodesByRoleId.get("review");

  assert.ok(dispatch);
  assert.ok(workerA);
  assert.ok(workerB);
  assert.ok(review);

  assert.strictEqual(dispatch.routingMode, "parallel_split");
  assert.strictEqual(dispatch.loopMax, 2);
  assert.deepStrictEqual(dispatch.joinSources, []);
  assert.deepStrictEqual(
    dispatch.outgoing.map((flow) => flow.toRoleId),
    ["worker_b", "worker_a"]
  );
  assert.deepStrictEqual(dispatch.binding, {
    kind: "model",
    modelRef: "model.fast",
    bindingSource: "system"
  });

  assert.deepStrictEqual(workerA.binding, {
    kind: "profile",
    profileId: "profile.a"
  });
  assert.deepStrictEqual(workerB.binding, {
    kind: "model",
    modelRef: "model.deep",
    bindingSource: "system"
  });

  assert.strictEqual(review.joinMode, "quorum_of");
  assert.deepStrictEqual(review.joinSources, ["worker_a", "worker_b"]);
  assert.strictEqual(review.joinMin, 2);
  assert.deepStrictEqual(review.contextMap, {
    summary: "source(worker_a).content",
    task: "global.task"
  });
  assert.deepStrictEqual(review.review, {
    mode: "required",
    timeoutSeconds: 900,
    timeoutAction: "terminate",
    reworkTargetRoleId: "dispatch",
    reworkMax: 3,
    terminateScope: "run"
  });
  assert.strictEqual(review.isTerminal, false);
});
