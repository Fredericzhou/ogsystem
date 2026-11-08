import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  StateVersionConflictError,
  VersionedStateStore,
  buildJoinDisplayId,
  buildJoinScopeKey,
  buildLoopScopeKey,
  compileSemanticIR,
  applyStateReducer,
  evaluateCondition,
  loadOgsSpecification,
  selectSemanticRoute,
  validateEventCandidate,
  resolveJoinPolicy,
  buildRolePromptInput,
  getTargetLoopIteration,
  semanticIRDigest,
  validateConditionAst,
  validateSemanticIR
} from "../dist/runtime/adapter.js";
import { buildJoinSourceStatus, mergeJoinSourceStatus } from "../dist/runtime/graph-mode-registry.js";
import { buildArtifactReference, createArtifactResolver } from "../dist/runtime/artifact-access.js";
import { validateSemanticRoleContracts } from "../dist/runtime/adapter.js";
import { loadSystemFromMermaid } from "../dist/runtime/parse-mermaid.js";
import {
  applySemanticBusinessState,
  replayPendingRuntimeCheckpoints
} from "../dist/runtime/graph-runner.js";
import { createInitialGraphState } from "../dist/runtime/graph-runtime-state.js";
import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import { planTransition, planHumanReviewDecisionTransition } from "../dist/runtime/transition-planner.js";
import { createRunConsoleLogger } from "../dist/runtime/console-run-log.js";

function validIr() {
  return {
    version: 1,
    system: { systemId: "test", systemVersion: "1" },
    seats: [
      { roleId: "a", binding: {}, modes: { default: {} }, defaultMode: "default" },
      { roleId: "b", binding: {}, modes: { default: {} }, defaultMode: "default" }
    ],
    transitions: [{ flowId: "a-b", fromRoleId: "a", toRoleId: "b", eventType: "READY", channel: "normal", priority: 0 }],
    stateSchema: { schemaVersion: 1, ref: "state.json" },
    loops: [],
    joins: [],
    contracts: [],
    capabilities: { maxTransitionsPerRun: 10, allowedToolsByRoleId: {} },
    defaults: { routePriority: 0, loopIteration: 0, joinDuplicateArrival: "ignore" }
  };
}

test("execution role mode is explicit and filters declared events", () => {
  const input = buildRolePromptInput({
    roleId: "reviewer",
    node: {
      roleId: "reviewer",
      incoming: [],
      outgoing: [
        { fromRoleId: "reviewer", toRoleId: "approve", eventType: "APPROVE" },
        { fromRoleId: "reviewer", toRoleId: "rework", eventType: "NEEDS_REWORK" }
      ],
      joinSources: [],
      executionMode: "judge_feedback",
      modeAllowedEvents: ["NEEDS_REWORK"],
      binding: { kind: "noop" },
      isTerminal: false
    },
    branch: { branchId: "b", roleId: "reviewer", loopIteration: 0, branchSequence: 1, lineageId: "l", sessionLineageId: "l", status: "active" },
    state: {
      stateVersion: 0, userPrompt: "task", status: "running", error: "", transitionCount: 0,
      recentAudits: [], auditSummary: {}, roleMetricsByRoleId: {}, roleResults: {}, pendingReviewsById: {},
      reviewHistoryByBranchId: {}, humanReviewContextByBranchId: {}, reviewRoundByRoleLineageKey: {},
      branchRecords: {}, loopIterations: {}, selectedEventByBranchId: {}, finalOutputsByRoleId: {}, finalOutputRoleOrder: [], finalRoleIds: [],
      lastExecutedRoleId: "", nextBranchSequence: 2, lastCheckpointSequence: 0
    }
  });
  assert.equal(input.role_id, "reviewer");
  assert.equal(input.mode, "judge_feedback");
  assert.deepEqual(JSON.parse(input.allowed_events), ["NEEDS_REWORK"]);
});

test("semantic IR digest is stable across object key order", () => {
  const left = validIr();
  const right = { ...left, system: { systemVersion: "1", systemId: "test" } };
  assert.equal(semanticIRDigest(left), semanticIRDigest(right));
  assert.deepEqual(validateSemanticIR(left), []);
});

test("Join scope key separates lineages while display id remains deterministic", () => {
  const first = { runId: "r", joinRoleId: "j", lineageId: "l1", loopIteration: 1 };
  const second = { ...first, lineageId: "l2" };
  assert.notEqual(buildJoinScopeKey(first), buildJoinScopeKey(second));
  assert.equal(buildJoinDisplayId(first), "j#l1#1");
});

test("Join source status keeps skipped and failed distinct", () => {
  assert.deepEqual(buildJoinSourceStatus({
    declaredSources: ["finance", "legal", "security"],
    completedSourceRoleIds: ["finance"],
    skippedSourceRoleIds: ["security"],
    failedSourceRoleIds: ["legal"]
  }), {
    finance: "arrived",
    legal: "failed",
    security: "skipped"
  });
});

test("versioned state store linearizes CAS and duplicate commits", () => {
  const store = new VersionedStateStore({
    schemaVersion: 1,
    stateVersion: 0,
    lastCheckpointSequence: 0,
    state: { count: 0 },
    irDigest: "ir",
    runtimeDigest: "runtime"
  });
  const accepted = store.commit({
    expectedStateVersion: 0,
    eventId: "e1",
    idempotencyKey: "k1",
    update: (state) => ({ count: state.count + 1 })
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(store.commit({
    expectedStateVersion: 999,
    eventId: "e1-replayed",
    idempotencyKey: "k1",
    update: () => ({ count: 999 })
  }).status, "duplicate");
  assert.throws(
    () => store.commit({ expectedStateVersion: 0, eventId: "e2", idempotencyKey: "k2", update: (state) => state }),
    StateVersionConflictError
  );
  assert.equal(store.load().state.count, 1);
});

test("checkpoint recovery does not replay a WAL record already included in versioned state", async () => {
  const plan = { entryRoleIds: ["a"], startDispatch: { mode: "all" } };
  const initial = createInitialGraphState({ plan, prompt: "recover" });
  const committedSnapshotState = {
    ...initial,
    stateVersion: 1,
    lastEventId: "event-1",
    transitionCount: 1,
    // Simulate the historical crash window where the state update was committed before the
    // projected checkpoint sequence was persisted.
    lastCheckpointSequence: 0
  };
  const checkpoint = {
    checkpointSequence: 1,
    eventId: "event-1",
    expectedStateVersion: 0,
    resultingStateVersion: 1,
    idempotencyKey: "event-1",
    roleId: "a",
    branchId: "a@1#1",
    loopIteration: 1,
    executionId: "exec-1",
    update: { transitionCount: 1, lastCheckpointSequence: 1 }
  };
  const replay = await replayPendingRuntimeCheckpoints({
    state: committedSnapshotState,
    runContext: { runId: "run-1" },
    runtimeServices: {
      stateStore: {},
      checkpointStore: { list: async () => [checkpoint] },
      audit: {}
    }
  });
  assert.equal(replay.state.transitionCount, 1);
  assert.equal(replay.state.stateVersion, 1);
  assert.equal(replay.state.lastCheckpointSequence, 0);
});

test("restricted conditions evaluate only allowlisted paths", () => {
  const context = { state: { score: 3 }, loop: {}, event: { type: "READY" }, role: {} };
  assert.equal(evaluateCondition({ op: "greater_than", args: [
    { kind: "path", root: "state", path: ["score"] },
    { kind: "literal", value: 2 }
  ] }, context), true);
  assert.deepEqual(validateConditionAst({ op: "call", args: [] }), ["condition.op is not allowed"]);
  assert.match(validateConditionAst({ op: "not", args: [], ignored: true })[0], /unsupported field/);
  assert.match(validateConditionAst({ op: "not", args: [{ op: "exists", args: [{ kind: "path", root: "state", path: ["score"] }] }, { op: "exists", args: [{ kind: "path", root: "state", path: ["other"] }] }] })[0], /contain 1 item/);
  assert.match(validateConditionAst({ op: "equals", args: [{ kind: "literal", value: { nested: true } }, { kind: "literal", value: 1 }] })[0], /invalid literal/);
  assert.match(validateConditionAst({ op: "equals", args: [{ kind: "literal", value: 1, extra: true }, { kind: "literal", value: 1 }] })[0], /invalid literal/);
  assert.match(validateConditionAst({ op: "exists", args: [{ kind: "path", root: "state", path: ["score"], extra: true }] })[0], /invalid value reference/);
  assert.throws(() => evaluateCondition({ op: "equals", args: [
    { kind: "path", root: "state", path: ["bad-key"] },
    { kind: "literal", value: 1 }
  ] }, context), /Invalid condition path segment/);
  assert.equal(evaluateCondition({ op: "exists", args: [
    { kind: "path", root: "state", path: ["nullable"] }
  ] }, { ...context, state: { nullable: null } }), true);
  assert.equal(evaluateCondition({ op: "equals", args: [
    { kind: "path", root: "state", path: ["nullable"] },
    { kind: "literal", value: null }
  ] }, { ...context, state: { nullable: null } }), true);
  assert.throws(
    () => evaluateCondition({ op: "in", args: [
      { kind: "literal", value: "ready" },
      { kind: "literal", value: "not-an-array" }
    ] }, context), /array right operand/);
  assert.throws(
    () => selectSemanticRoute({
      transitions: [{ flowId: "missing", eventType: "READY", toRoleId: "b", priority: 1, condition: {
        op: "equals",
        args: [{ kind: "path", root: "state", path: ["absent"] }, { kind: "literal", value: true }]
      } }],
      eventType: "READY",
      context: { state: {}, loop: {}, event: {}, role: {} }
    }),
    (error) => error.code === "IR_ROUTE_CONDITION_INPUT_MISSING"
  );
  assert.throws(
    () => selectSemanticRoute({
      transitions: [{ flowId: "typed", eventType: "READY", toRoleId: "b", priority: 1, condition: {
        op: "greater_than",
        args: [{ kind: "path", root: "state", path: ["value"] }, { kind: "literal", value: 1 }]
      } }],
      eventType: "READY",
      context: { state: { value: "one" }, loop: {}, event: {}, role: {} }
    }),
    (error) => error.code === "IR_ROUTE_CONDITION_TYPE_INVALID"
  );
});

test("semantic route selection is priority based and fail-closed on ambiguity", () => {
  const transitions = [
    { flowId: "fallback", eventType: "READY", toRoleId: "b", priority: 0 },
    { flowId: "conditional", eventType: "READY", toRoleId: "c", priority: 1, condition: { op: "equals", args: [{ kind: "path", root: "state", path: ["ok"] }, { kind: "literal", value: true }] } }
  ];
  assert.equal(selectSemanticRoute({ transitions, eventType: "READY", context: { state: { ok: true }, loop: {}, event: {}, role: {} } }).toRoleId, "c");
  assert.throws(
    () => selectSemanticRoute({ transitions: [], eventType: "READY", context: { state: {}, loop: {}, event: {}, role: {} } }),
    (error) => error.code === "IR_ROUTE_NO_CANDIDATE"
  );
  assert.throws(() => selectSemanticRoute({ transitions: transitions.slice(1), eventType: "READY", context: { state: { ok: false }, loop: {}, event: {}, role: {} } }), /No condition matched/);
  assert.throws(() => selectSemanticRoute({ transitions: [transitions[0], { ...transitions[0], flowId: "other", toRoleId: "c" }], eventType: "READY", context: { state: {}, loop: {}, event: {}, role: {} } }), /Ambiguous routes/);
});

test("state reducers produce the route-visible state for the same transition", () => {
  const state = {
    businessState: { approved: false }
  };
  const plan = {
    semanticIR: {
      stateSchema: {
        reducers: { approved: "replace" },
        writableRolesByField: { approved: ["writer"] }
      }
    }
  };
  const routedState = applySemanticBusinessState({
    state,
    plan,
    roleId: "writer",
    data: { approved: true }
  });
  const route = selectSemanticRoute({
    transitions: [
      { flowId: "fallback", eventType: "READY", toRoleId: "retry", priority: 0 },
      { flowId: "approved", eventType: "READY", toRoleId: "publish", priority: 1, condition: { op: "equals", args: [{ kind: "path", root: "state", path: ["approved"] }, { kind: "literal", value: true }] } }
    ],
    eventType: "READY",
    context: { state: routedState, loop: {}, event: {}, role: {} }
  });
  assert.equal(route.toRoleId, "publish");
});

test("Loop Scope increments only at its declared boundary", () => {
  const plan = {
    roleIds: ["a", "b"],
    nodesByRoleId: new Map([
      ["a", { roleId: "a", loopMax: undefined }],
      ["b", { roleId: "b", loopMax: undefined }]
    ]),
    semanticIR: {
      loops: [{ loopId: "debate", members: ["a", "b"], boundaryRoleId: "b", counterField: "round", maxRounds: 3, onExhausted: "end" }]
    }
  };
  const state = { loopCountersByScope: { "lineage::debate": 1 }, loopIterations: {} };
  assert.equal(getTargetLoopIteration({ targetRoleId: "a", currentLoopIteration: 1, state, plan, lineageId: "lineage" }), 1);
  assert.equal(getTargetLoopIteration({ targetRoleId: "b", currentLoopIteration: 1, state, plan, lineageId: "lineage" }), 2);
});

test("Loop Scope parks a boundary transition for budget review at max rounds", () => {
  const system = {
    systemId: "loop-exhaustion",
    systemVersion: "1",
    entryRoleIds: ["boundary"],
    startDispatch: { mode: "all" },
    roleIds: ["boundary", "summary"],
    flows: [
      { fromRoleId: "boundary", toRoleId: "boundary", eventType: "REBUTTAL" },
      { fromRoleId: "boundary", toRoleId: "summary", eventType: "SUMMARY" },
      { fromRoleId: "summary", toRoleId: "__system_end__", eventType: "READY" }
    ],
    lawBinding: { globalLawRef: "law.test" },
    executionBinding: {},
    modelBinding: {}
  };
  const plan = createExecutionPlan(system);
  plan.semanticIR = {
    stateSchema: { defaults: {} },
    transitions: [],
    capabilities: { maxRoleActivationsByRoleId: {} },
    loops: [{
      loopId: "debate",
      members: ["boundary"],
      boundaryRoleId: "boundary",
      counterField: "round",
      maxRounds: 1,
      onExhausted: "summary"
    }]
  };
  const state = createInitialGraphState({ plan, prompt: "loop exhaustion" });
  const branch = state.branchRecords["boundary@1#1"];
  state.loopCountersByScope["boundary@1#1::debate"] = 1;
  const transition = planTransition({
    runId: "run-loop-exhaustion",
    state,
    plan,
    logger: createRunConsoleLogger(false),
    errorFlowRoutingEnabled: false,
    outcome: {
      version: 1,
      executionId: "exec-boundary-1",
      roleId: "boundary",
      branchId: branch.branchId,
      loopIteration: 1,
      sessionKey: "boundary:boundary@1#1",
      branch,
      committedAt: "2026-09-02T00:00:00.000Z",
      status: "ok",
      selectedEvent: "REBUTTAL",
      storedResult: {
        roleId: "boundary",
        event: "REBUTTAL",
        content: "continue",
        data: {},
        branchId: branch.branchId,
        lineageId: branch.lineageId,
        loopIteration: 1
      },
      audit: {
        at: "2026-09-02T00:00:00.000Z",
        roleId: "boundary",
        branchId: branch.branchId,
        loopIteration: 1,
        exitCode: 0,
        durationMs: 1,
        selectedEvent: "REBUTTAL",
        status: "ok"
      }
    }
  });

  assert.equal(transition.update.status, "waiting_review");
  assert.equal(transition.update.branchRecords?.[branch.branchId]?.status, "waiting_review");
  const review = Object.values(transition.update.pendingReviewsById ?? {})[0];
  assert.equal(review?.kind, "loop_budget");
  assert.deepEqual(transition.events, [{
    type: "loop_exhausted",
    eventId: `loop_exhausted:${review?.reviewId}`,
    at: transition.events[0].at,
    loopId: "debate",
    roleId: "boundary",
    lineageId: branch.lineageId,
    loopIteration: 1,
    maxRounds: 1,
    onExhausted: "summary",
    reviewId: review?.reviewId
  }]);

  const reviewState = {
    ...state,
    stateVersion: 1,
    pendingReviewsById: transition.update.pendingReviewsById,
    reviewRoundByRoleLineageKey: transition.update.reviewRoundByRoleLineageKey,
    branchRecords: transition.update.branchRecords,
    lastWaitingReviewId: transition.update.lastWaitingReviewId
  };
  const decision = planHumanReviewDecisionTransition({
    runId: "run-loop-exhaustion",
    state: reviewState,
    plan,
    review,
    decision: {
      reviewId: review.reviewId,
      round: review.round,
      lineageId: review.lineageId,
      branchId: review.branchId,
      loopIteration: review.loopIteration,
      stateVersion: 1,
      committedAt: "2026-09-02T00:01:00.000Z",
      decidedAt: "2026-09-02T00:01:00.000Z",
      decision: "continue",
      targetRoleId: "boundary",
      additionalBudget: 1
    },
    rolePackagesByRoleId: new Map(),
    logger: createRunConsoleLogger(false)
  });
  assert.equal(decision.update.pendingReviewsById?.[review.reviewId]?.status, "resolved");
  assert.equal(decision.update.loopBudgetAuthorizationsByScope?.[`${branch.lineageId}::debate`], 0);
  assert.equal(decision.update.branchRecords?.["boundary@2#2"]?.status, "active");
});

test("conditional route transition persists a value-free decision trace", async () => {
  const system = {
    systemId: "conditional-route-audit",
    systemVersion: "1",
    entryRoleIds: ["dispatch"],
    startDispatch: { mode: "all" },
    roleIds: ["dispatch", "approved", "fallback"],
    flows: [
      { fromRoleId: "dispatch", toRoleId: "approved", eventType: "READY" },
      { fromRoleId: "dispatch", toRoleId: "fallback", eventType: "READY" }
    ],
    lawBinding: { globalLawRef: "law.test" },
    executionBinding: {},
    modelBinding: {}
  };
  const plan = createExecutionPlan(system);
  plan.semanticIR = {
    transitions: [
      { flowId: "approved-route", fromRoleId: "dispatch", toRoleId: "approved", eventType: "READY", priority: 2, channel: "normal", condition: { op: "equals", args: [{ kind: "path", root: "event", path: ["approved"] }, { kind: "literal", value: true }] } },
      { flowId: "fallback-route", fromRoleId: "dispatch", toRoleId: "fallback", eventType: "READY", priority: 1, channel: "normal", condition: { op: "equals", args: [{ kind: "path", root: "event", path: ["approved"] }, { kind: "literal", value: false }] } }
    ],
    stateSchema: { defaults: {} },
    loops: [],
    joins: [],
    capabilities: { maxRoleActivationsByRoleId: {} }
  };
  const state = createInitialGraphState({ plan, prompt: "route trace" });
  const branch = Object.values(state.branchRecords)[0];
  const args = {
    runId: "run-route-audit",
    state,
    plan,
    logger: createRunConsoleLogger(false),
    errorFlowRoutingEnabled: false,
    outcome: {
      version: 1,
      executionId: "exec-dispatch-1",
      roleId: "dispatch",
      branchId: branch.branchId,
      loopIteration: 0,
      sessionKey: "dispatch:dispatch@0#1",
      branch,
      committedAt: "2026-09-02T00:00:00.000Z",
      status: "ok",
      selectedEvent: "READY",
      storedResult: {
        roleId: "dispatch",
        event: "READY",
        content: "approved=true",
        data: { approved: true, token: "must-not-be-recorded" },
        branchId: branch.branchId,
        lineageId: branch.lineageId,
        loopIteration: 0
      },
      audit: { at: "2026-09-02T00:00:00.000Z", roleId: "dispatch", branchId: branch.branchId, loopIteration: 0, exitCode: 0, durationMs: 1, selectedEvent: "READY", status: "ok" }
    }
  };
  const transition = planTransition(args);
  const decision = transition.events.find((event) => event.type === "route_decision");
  const { at: _at, roleId: _roleId, branchId: _branchId, lineageId: _lineageId, loopIteration: _loopIteration, type: _type, ...decisionGolden } = decision;
  assert.deepEqual(decisionGolden, JSON.parse(await readFile(resolve(process.cwd(), "tests/fixtures/semantic-route-decision.golden.json"), "utf8")));
  assert.deepEqual({
    status: decision.status,
    event: decision.event,
    candidates: decision.candidates,
    selectedFlowId: decision.selectedFlowId,
    targetRoleId: decision.targetRoleId
  }, JSON.parse(await readFile(resolve(process.cwd(), "tests/fixtures/semantic-route-decision.golden.json"), "utf8")));
  assert.doesNotMatch(JSON.stringify(decision), /must-not-be-recorded|approved=true/);

  plan.semanticIR.transitions = plan.semanticIR.transitions.map((route) => ({
    ...route,
    condition: { ...route.condition, args: [route.condition.args[0], { kind: "literal", value: false }] }
  }));
  const noMatch = planTransition(args);
  assert.equal(noMatch.update.status, "failed");
  assert.equal(noMatch.events[0].type, "route_decision");
  assert.equal(noMatch.events[0].status, "failed");
  assert.equal(noMatch.events[0].errorCode, "IR_ROUTE_NO_MATCH");
  assert.deepEqual(noMatch.events[0].candidates.map((candidate) => candidate.matched), [false, false]);

  plan.semanticIR.transitions = plan.semanticIR.transitions.map((route) => ({
    ...route,
    priority: 2,
    condition: { ...route.condition, args: [route.condition.args[0], { kind: "literal", value: true }] }
  }));
  const ambiguous = planTransition(args);
  assert.equal(ambiguous.update.status, "failed");
  assert.equal(ambiguous.events[0].errorCode, "IR_ROUTE_AMBIGUOUS");
  assert.deepEqual(ambiguous.events[0].candidates.map((candidate) => candidate.matched), [true, true]);

  plan.semanticIR.transitions = [{
    ...plan.semanticIR.transitions[0],
    condition: { op: "greater_than", args: [plan.semanticIR.transitions[0].condition.args[0], { kind: "literal", value: 1 }] }
  }];
  const evaluationFailure = planTransition(args);
  assert.equal(evaluationFailure.update.status, "failed");
  assert.equal(evaluationFailure.events[0].errorCode, "IR_ROUTE_CONDITION_TYPE_INVALID");
  assert.equal(evaluationFailure.events[0].candidates[0].matched, undefined);
});

test("debate example compiles its business state and event contracts", async () => {
  const exampleRoot = resolve(process.cwd(), "examples", "langgraph-debate-current");
  const specification = await loadOgsSpecification(exampleRoot);
  const system = await loadSystemFromMermaid(join(exampleRoot, "system.mmd"));
  const compiled = compileSemanticIR({ system, specification, maxTransitionsPerRun: 12 });

  assert.equal(compiled.ir.system.systemId, "architecture.debate.current");
  assert.deepEqual(compiled.ir.stateSchema.reducers, {
    consensus_reached: "replace",
    decision: "replace",
    debate_round: "max",
    objections: "append",
    positions: "merge",
    summary: "replace"
  });
  assert.equal(compiled.ir.joins[0].mode, "all_of");
  assert.equal(compiled.ir.joins[0].timeoutSeconds, 3600);
  assert.equal(compiled.ir.loops[0].onExhausted, "debate-summary");
  assert.equal(compiled.ir.events?.READY?.kind, "handoff");
  assert.equal(compiled.ir.events?.NEEDS_REWORK?.kind, "correction");
  assert.ok(compiled.digest.length > 0);
});

test("event contracts validate declaration, payload shape, and writable fields", () => {
  const result = validateEventCandidate({
    roleId: "worker",
    mode: "default",
    eventType: "READY",
    payload: { answer: "ok" },
    contracts: { READY: { eventType: "READY", payloadSchema: { type: "object", required: ["answer"] }, writableStateFields: ["answer"] } },
    stateUpdateFields: ["answer"]
  });
  assert.equal(result.eventType, "READY");
  assert.match(result.payloadDigest, /^[a-f0-9]{64}$/);
  assert.throws(() => validateEventCandidate({ roleId: "worker", mode: "default", eventType: "UNKNOWN", payload: {}, contracts: {} }), /not declared/);
  assert.throws(() => validateEventCandidate({ roleId: "worker", mode: "default", eventType: "READY", payload: {}, contracts: { READY: { eventType: "READY", payloadSchema: { type: "object", required: ["answer"] } } } }), /schema mismatch/);
});

test("Join policy waits before timeout and fails closed when quorum is not met", () => {
  const base = { mode: "quorum_of", sources: ["a", "b", "c"], readySources: ["a"], min: 2, timeoutSeconds: 10, startedAt: 0, onTimeout: "quorum_continue" };
  assert.equal(resolveJoinPolicy({ ...base, now: 9999 }).action, "wait");
  assert.equal(resolveJoinPolicy({ ...base, now: 10000 }).action, "fail");
  assert.equal(resolveJoinPolicy({ ...base, readySources: ["a", "b"], now: 10000 }).action, "activate");
  assert.throws(() => resolveJoinPolicy({ ...base, mode: "all_of", now: 10000 }), /requires quorum_of/);
});

test("Join policy consumes source failure policy and keeps terminate distinct", () => {
  const base = {
    mode: "all_of",
    sources: ["a", "b"],
    readySources: ["a"],
    min: 2,
    timeoutSeconds: 60,
    startedAt: 0,
    now: 1,
    onTimeout: "terminate"
  };
  assert.equal(resolveJoinPolicy({ ...base, failurePolicy: "wait", sourceFailure: true }).action, "wait");
  assert.equal(resolveJoinPolicy({ ...base, failurePolicy: "fail", sourceFailure: true }).action, "fail");
  assert.equal(resolveJoinPolicy({ ...base, failurePolicy: "quorum_continue", sourceFailure: true }).action, "fail");
  assert.equal(resolveJoinPolicy({ ...base, readySources: ["a", "b"], failurePolicy: "fail", sourceFailure: true }).action, "activate");
  assert.equal(resolveJoinPolicy({ ...base, now: 60000 }).action, "terminate");
  assert.equal(resolveJoinPolicy({ ...base, onTimeout: "fail", now: 60000 }).action, "fail");
  assert.equal(resolveJoinPolicy({ ...base, onTimeout: "pause", now: 60000 }).action, "pause");
  assert.equal(resolveJoinPolicy({ ...base, onTimeout: "terminate", now: 60000 }).action, "terminate");
  assert.throws(() => resolveJoinPolicy({ ...base, mode: "all_of", onTimeout: "quorum_continue", now: 60000 }), /requires quorum_of/);
});

test("Join policy distinguishes required skipped from real failed sources", () => {
  const base = { mode: "all_of", sources: ["finance", "legal"], readySources: ["finance"], min: 2, timeoutSeconds: 10, startedAt: 0, now: 1, onTimeout: "fail" };
  assert.equal(resolveJoinPolicy({ ...base, sourceStatusByRoleId: { finance: "arrived", legal: "skipped" } }).reason, "required source skipped");
  assert.equal(resolveJoinPolicy({ ...base, sourceStatusByRoleId: { finance: "arrived", legal: "failed" }, failurePolicy: "fail" }).reason, "required source failed");
  assert.equal(resolveJoinPolicy({ ...base, sourceStatusByRoleId: { finance: "arrived", legal: "pending" } }).action, "wait");
});

test("Join source outcomes are monotonic and never regress terminal status to pending", () => {
  assert.equal(mergeJoinSourceStatus("skipped", "pending"), "skipped");
  assert.equal(mergeJoinSourceStatus("arrived", "skipped"), "arrived");
  assert.equal(mergeJoinSourceStatus("failed", "arrived"), "failed");
});

test("Artifact resolver enforces invocation allowed-set", () => {
  const result = { roleId: "producer", branchId: "b", lineageId: "l", loopIteration: 0, artifactRef: buildArtifactReference({ runId: "run-1", executionId: "exec-1", mediaType: "application/json" }), provenance: { runId: "run-1", producerRoleId: "producer", branchId: "b", lineageId: "l", loopIteration: 0, mediaType: "application/json" } };
  const resolver = createArtifactResolver([result]);
  assert.equal(resolver.resolve(result.artifactRef, { consumerRoleId: "consumer", allowedArtifactIds: new Set([result.artifactRef.artifactId]) }).provenance.producerRoleId, "producer");
  assert.throws(() => resolver.resolve(result.artifactRef, { consumerRoleId: "consumer", allowedArtifactIds: new Set() }), /ARTIFACT_ACCESS_DENIED/);
  assert.throws(() => resolver.resolve({ ...result.artifactRef, mediaType: "text/plain" }, { consumerRoleId: "consumer", allowedArtifactIds: new Set([result.artifactRef.artifactId]) }), /ARTIFACT_MEDIA_TYPE_MISMATCH/);
  const badProvenance = { ...result, provenance: { ...result.provenance, mediaType: "text/plain" } };
  assert.throws(() => createArtifactResolver([badProvenance]).resolve(badProvenance.artifactRef, { consumerRoleId: "consumer", allowedArtifactIds: new Set([badProvenance.artifactRef.artifactId]) }), /ARTIFACT_MEDIA_TYPE_MISMATCH/);
});

test("Semantic IR rejects unresolved loop exhausted targets and invalid seat budgets", () => {
  const unknownTarget = validIr();
  unknownTarget.loops = [{ loopId: "loop", members: ["a"], boundaryRoleId: "a", counterField: "round", maxRounds: 1, onExhausted: "missing" }];
  assert.ok(validateSemanticIR(unknownTarget).some((item) => item.code === "IR_UNKNOWN_REFERENCE"));
  const invalidBudget = validIr();
  invalidBudget.loops = [{ loopId: "loop", members: ["a"], boundaryRoleId: "a", counterField: "round", maxRounds: 1, onExhausted: "end", maxRoleActivationsByRoleId: { a: 0 } }];
  assert.ok(validateSemanticIR(invalidBudget).some((item) => item.code === "IR_BUDGET_INVALID"));
});

test("restricted reducers are deterministic and reject invalid types", () => {
  assert.deepEqual(applyStateReducer("merge", { a: 1 }, { b: 2 }), { a: 1, b: 2 });
  assert.deepEqual(applyStateReducer("append", ["a"], "b"), ["a", "b"]);
  assert.equal(applyStateReducer("increment", 2, 3), 5);
  assert.equal(applyStateReducer("max", 2, 3), 3);
  assert.equal(applyStateReducer("set-once", "old", "new"), "old");
  assert.throws(() => applyStateReducer("merge", {}, []), /merge requires object/);
});

test("multi-file OGS specification snapshot is version and digest stable", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-spec-"));
  await mkdir(join(workdir, ".ogs", "contracts"), { recursive: true });
  const header = { version: "1", system: { systemId: "demo", systemVersion: "1" } };
  await writeFile(join(workdir, ".ogs", "semantics.yaml"), "version: '1'\nsystem:\n  systemId: demo\n  systemVersion: '1'\nstate:\n  schema: contracts/state.json\n");
  await writeFile(join(workdir, ".ogs", "models.yaml"), "version: '1'\nsystem:\n  systemId: demo\n  systemVersion: '1'\nmodels: {}\n");
  await writeFile(join(workdir, ".ogs", "contracts", "state.json"), JSON.stringify({ ...header, type: "object" }));
  const snapshot = await loadOgsSpecification(workdir);
  assert.equal(snapshot.systemId, "demo");
  assert.equal(Object.keys(snapshot.sources).length, 3);
  assert.match(snapshot.digest, /^[a-f0-9]{64}$/);
});

test("semantic specification snapshot excludes the runtime law catalog", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-spec-laws-"));
  await mkdir(join(workdir, ".ogs"), { recursive: true });
  await writeFile(join(workdir, ".ogs", "semantics.yaml"), [
    "version: '1'",
    "system:",
    "  systemId: demo",
    "  systemVersion: '1'"
  ].join("\n"));
  await writeFile(join(workdir, ".ogs", "laws.json"), JSON.stringify({
    laws: [{ lawId: "law.demo", constraints: { maxTransitions: 8 } }]
  }));

  const snapshot = await loadOgsSpecification(workdir);
  assert.equal(Object.keys(snapshot.sources).length, 1);
  assert.ok(Object.keys(snapshot.sources).every((path) => !path.endsWith("laws.json")));
});

test("multi-file OGS specification rejects inconsistent versions", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-spec-mismatch-"));
  await mkdir(join(workdir, ".ogs"), { recursive: true });
  await mkdir(join(workdir, ".ogs", "contracts"), { recursive: true });
  await writeFile(join(workdir, ".ogs", "contracts", "state.json"), JSON.stringify({ version: "1", type: "object" }));
  await writeFile(join(workdir, ".ogs", "semantics.yaml"), "version: '1'\nsystem:\n  systemId: demo\n  systemVersion: '1'\n");
  await writeFile(join(workdir, ".ogs", "models.yaml"), "version: '2'\nsystem:\n  systemId: demo\n  systemVersion: '1'\n");
  await assert.rejects(() => loadOgsSpecification(workdir), /Specification version mismatch/);
});

test("semantic compiler binds Mermaid topology to versioned semantics", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-semantic-compile-"));
  await mkdir(join(workdir, ".ogs"), { recursive: true });
  await mkdir(join(workdir, ".ogs", "contracts"), { recursive: true });
  await writeFile(join(workdir, ".ogs", "contracts", "state.json"), JSON.stringify({ version: "1", type: "object" }));
  await writeFile(join(workdir, ".ogs", "semantics.yaml"), [
    "version: '1'",
    "system:",
    "  systemId: demo",
    "  systemVersion: '1'",
    "state:",
    "  schema: contracts/state.json",
    "roles:",
    "  a: { modes: { default: {} } }",
    "  b: { modes: { default: {} } }",
    "joins:",
    "  b:",
    "    mode: all_of",
    "    sources: [a]",
    "    timeoutSeconds: 10",
    "    onTimeout: fail"
  ].join("\n"));
  const snapshot = await loadOgsSpecification(workdir);
  const system = {
    systemId: "demo", systemVersion: "1", entryRoleIds: ["a"], roleIds: ["a", "b"],
    flows: [{ fromRoleId: "a", toRoleId: "b", eventType: "READY" }],
    lawBinding: { globalLawRef: "law" }, executionBinding: {}, modelBinding: {}
  };
  const compiled = compileSemanticIR({ system, specification: snapshot, maxTransitionsPerRun: 10 });
  assert.equal(compiled.ir.joins[0].roleId, "b");
  assert.equal(compiled.ir.transitions[0].flowId, "a:READY:b");
  assert.match(compiled.digest, /^[a-f0-9]{64}$/);
  assert.equal(buildLoopScopeKey("lineage-a", "debate"), "lineage-a::debate");
});

test("semantic compiler freezes event contracts, retry policy, reducers, and capability budget", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-semantic-policy-"));
  await mkdir(join(workdir, ".ogs", "contracts"), { recursive: true });
  await writeFile(join(workdir, ".ogs", "contracts", "state.json"), JSON.stringify({ version: "1", type: "object" }));
  await writeFile(join(workdir, ".ogs", "contracts", "done.json"), JSON.stringify({ version: "1", type: "object", required: ["ok"] }));
  await writeFile(join(workdir, ".ogs", "semantics.yaml"), [
    "version: '1'", "system:", "  systemId: demo", "  systemVersion: '1'", "state:",
    "  schema: contracts/state.json", "  reducers: { count: increment }", "events:",
    "  READY:", "    payload: { schema: contracts/done.json }", "    writable_state_fields: [count]",
    "errors:", "  a:", "    retry: { max_attempts: 2, backoff: exponential }", "capabilities:",
    "  max_transitions_per_run: 10"
  ].join("\n"));
  const snapshot = await loadOgsSpecification(workdir);
  const system = { systemId: "demo", systemVersion: "1", entryRoleIds: ["a"], roleIds: ["a", "b"], flows: [{ fromRoleId: "a", toRoleId: "b", eventType: "READY" }], lawBinding: { globalLawRef: "law" }, executionBinding: {}, modelBinding: {} };
  const compiled = compileSemanticIR({ system, specification: snapshot, maxTransitionsPerRun: 20 });
  assert.equal(compiled.ir.stateSchema.reducers.count, "increment");
  assert.equal(compiled.ir.events.READY.payloadSchema.required[0], "ok");
  assert.deepEqual(compiled.ir.retryByRoleId.a, { maxAttempts: 2, backoff: "exponential" });
  assert.equal(compiled.ir.capabilities.maxTransitionsPerRun, 10);
});

test("Role Contract contributions must resolve to state or declared event payload fields", () => {
  const rolePackage = {
    manifest: {
      responsibility: { kind: "atomic", owns: [], contributes: ["decision", "finding"], doesNotOwn: [] },
      constraints: { writableStateFields: [], allowedTools: [] },
      outputs: { events: ["READY"], postconditions: [] },
      failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
      authority: { controlActions: [] }
    },
    outputSchema: {}
  };
  const args = {
    semanticIR: {
      stateSchema: { ref: "state.json", writableRolesByField: {} },
      events: { READY: { payloadSchema: { type: "object", properties: { finding: { type: "string" } } } } },
      composites: [],
      capabilities: { allowedToolsByRoleId: { reviewer: [] } }
    },
    specification: { sources: { "contracts/state.json": { digest: "state", value: { type: "object", properties: { decision: { type: "string" } } } } } },
    rolePackagesByRoleId: new Map([["reviewer", rolePackage]])
  };

  assert.doesNotThrow(() => validateSemanticRoleContracts(args));
  rolePackage.manifest.responsibility.contributes = ["invented_field"];
  assert.throws(
    () => validateSemanticRoleContracts(args),
    /contributes unknown state or declared output field invented_field/
  );
});

test("semantic compiler rejects join declarations that diverge from topology", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-semantic-join-"));
  await mkdir(join(workdir, ".ogs"), { recursive: true });
  await writeFile(join(workdir, ".ogs", "semantics.yaml"), [
    "version: '1'", "system:", "  systemId: demo", "  systemVersion: '1'", "state:", "  schema: contracts/state.json", "joins:", "  b:", "    mode: all_of", "    sources: [x]", "    timeoutSeconds: 10", "    onTimeout: fail"
  ].join("\n"));
  const snapshot = await loadOgsSpecification(workdir);
  const system = { systemId: "demo", systemVersion: "1", entryRoleIds: ["a"], roleIds: ["a", "b", "x"], flows: [{ fromRoleId: "a", toRoleId: "b", eventType: "READY" }], lawBinding: { globalLawRef: "law" }, executionBinding: {}, modelBinding: {} };
  assert.throws(() => compileSemanticIR({ system, specification: snapshot, maxTransitionsPerRun: 10 }), /sources must match Mermaid/);
});

test("semantic compiler validates composite input and output references independently", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-semantic-composite-"));
  await mkdir(join(workdir, ".ogs", "contracts"), { recursive: true });
  const contract = JSON.stringify({ version: "1", type: "object" });
  await writeFile(join(workdir, ".ogs", "contracts", "state.json"), contract);
  await writeFile(join(workdir, ".ogs", "contracts", "input.json"), contract);
  await writeFile(join(workdir, ".ogs", "contracts", "output.json"), contract);
  const systemSource = {
    systemId: "demo",
    systemVersion: "1",
    entryRoleIds: ["owner"],
    roleIds: ["owner"],
    flows: [],
    lawBinding: { globalLawRef: "law" },
    executionBinding: {},
    modelBinding: {}
  };
  const compile = async (inputContract, outputContract) => {
    await writeFile(join(workdir, ".ogs", "semantics.yaml"), [
      "version: '1'",
      "system:",
      "  systemId: demo",
      "  systemVersion: '1'",
      "state:",
      "  schema: contracts/state.json",
      "roles:",
      "  owner: { modes: { default: {} } }",
      "composites:",
      "  owner:",
      "    owner_role_id: owner",
      "    nested_system_ref: contracts/state.json",
      `    input_contract: contracts/${inputContract}`,
      `    output_contract: contracts/${outputContract}`,
      "    state_namespace: owner-state",
      "    checkpoint_namespace: owner-checkpoints",
      "    error_propagation: contain",
      "    termination_propagation: contain"
    ].join("\n"));
    return compileSemanticIR({ system: systemSource, specification: await loadOgsSpecification(workdir), maxTransitionsPerRun: 10 });
  };
  await assert.doesNotReject(() => compile("input.json", "output.json"));
  await assert.rejects(() => compile("missing-input.json", "output.json"), /Composite input contract not found/);
  await assert.rejects(() => compile("input.json", "missing-output.json"), /Composite output contract not found/);
});

test("semantic compiler loads nested systems and rejects composite cycles", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-semantic-composite-cycle-"));
  await mkdir(join(workdir, ".ogs", "contracts"), { recursive: true });
  await mkdir(join(workdir, ".ogs", "systems"), { recursive: true });
  const contract = JSON.stringify({ version: "1", type: "object" });
  await writeFile(join(workdir, ".ogs", "contracts", "state.json"), contract);
  await writeFile(join(workdir, ".ogs", "contracts", "input.json"), contract);
  await writeFile(join(workdir, ".ogs", "contracts", "output.json"), contract);
  const composite = (ownerRoleId, nestedSystemRef) => [
    `    owner_role_id: ${ownerRoleId}`,
    `    nested_system_ref: ${nestedSystemRef}`,
    "    input_contract: contracts/input.json",
    "    output_contract: contracts/output.json",
    "    state_namespace: state-owner",
    "    checkpoint_namespace: checkpoint-owner",
    "    error_propagation: contain",
    "    termination_propagation: contain"
  ];
  await writeFile(join(workdir, ".ogs", "semantics.yaml"), [
    "version: '1'", "system:", "  systemId: root", "  systemVersion: '1'",
    "state:", "  schema: contracts/state.json", "roles:", "  owner: { modes: { default: {} } }",
    "composites:", "  owner:", ...composite("owner", "systems/child.yaml")
  ].join("\n"));
  await writeFile(join(workdir, ".ogs", "systems", "child.yaml"), [
    "version: '1'", "system:", "  systemId: child", "  systemVersion: '1'", "composites:",
    "  child-owner:", ...composite("child-owner", "semantics.yaml")
  ].join("\n"));

  const snapshot = await loadOgsSpecification(workdir);
  assert.ok(Object.keys(snapshot.sources).some((source) => source.endsWith("/systems/child.yaml")));
  const system = {
    systemId: "root", systemVersion: "1", entryRoleIds: ["owner"], roleIds: ["owner"], flows: [],
    lawBinding: { globalLawRef: "law" }, executionBinding: {}, modelBinding: {}
  };
  assert.throws(
    () => compileSemanticIR({ system, specification: snapshot, maxTransitionsPerRun: 10 }),
    /Composite responsibility cycle detected/
  );
});

test("semantic compiler rejects undeclared cross-System state access", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-semantic-composite-state-"));
  await mkdir(join(workdir, ".ogs", "contracts"), { recursive: true });
  const contract = JSON.stringify({ version: "1", type: "object" });
  await writeFile(join(workdir, ".ogs", "contracts", "state.json"), contract);
  await writeFile(join(workdir, ".ogs", "contracts", "input.json"), contract);
  await writeFile(join(workdir, ".ogs", "contracts", "output.json"), contract);
  await writeFile(join(workdir, ".ogs", "semantics.yaml"), [
    "version: '1'", "system:", "  systemId: root", "  systemVersion: '1'",
    "state:", "  schema: contracts/state.json", "roles:", "  owner: { modes: { default: {} } }",
    "composites:", "  owner:",
    "    owner_role_id: owner", "    nested_system_ref: contracts/state.json",
    "    input_contract: contracts/input.json", "    output_contract: contracts/output.json",
    "    state_namespace: owner-state", "    checkpoint_namespace: owner-checkpoints",
    "    error_propagation: contain", "    termination_propagation: contain",
    "    read_state_fields: [secret]"
  ].join("\n"));
  const snapshot = await loadOgsSpecification(workdir);
  const system = {
    systemId: "root", systemVersion: "1", entryRoleIds: ["owner"], roleIds: ["owner"], flows: [],
    lawBinding: { globalLawRef: "law" }, executionBinding: {}, modelBinding: {}
  };
  assert.throws(
    () => compileSemanticIR({ system, specification: snapshot, maxTransitionsPerRun: 10 }),
    /Cross-System state access requires an explicit parent\/child state contract/
  );
});
