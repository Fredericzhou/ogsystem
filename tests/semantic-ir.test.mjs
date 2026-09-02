import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
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
import { loadSystemFromMermaid } from "../dist/runtime/parse-mermaid.js";
import {
  applySemanticBusinessState,
  replayPendingRuntimeCheckpoints
} from "../dist/runtime/graph-runner.js";
import { createInitialGraphState } from "../dist/runtime/graph-runtime-state.js";
import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import { planTransition } from "../dist/runtime/transition-planner.js";
import { createRunConsoleLogger } from "../dist/runtime/console-run-log.js";

function validIr() {
  return {
    version: 1,
    system: { systemId: "test", systemVersion: "1" },
    seats: [
      { roleId: "a", binding: {}, modes: { default: {} }, defaultMode: "default" },
      { roleId: "b", binding: {}, modes: { default: {} }, defaultMode: "default" }
    ],
    transitions: [{ flowId: "a-b", fromRoleId: "a", toRoleId: "b", eventType: "NEXT", channel: "normal", priority: 0 }],
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
        { fromRoleId: "reviewer", toRoleId: "rework", eventType: "REWORK" }
      ],
      joinSources: [],
      executionMode: "judge_feedback",
      modeAllowedEvents: ["REWORK"],
      binding: { kind: "noop" },
      isTerminal: false
    },
    branch: { branchId: "b", roleId: "reviewer", loopIteration: 0, branchSequence: 1, lineageId: "l", sessionLineageId: "l", status: "active" },
    state: {
      stateVersion: 0, userPrompt: "task", status: "running", error: "", transitionCount: 0,
      recentAudits: [], auditSummary: {}, roleMetricsByRoleId: {}, roleResults: {}, pendingReviewsById: {},
      reviewHistoryByBranchId: {}, humanReviewContextByBranchId: {}, reviewRoundByRoleLineageKey: {},
      branchRecords: {}, loopIterations: {}, selectedEventByBranchId: {}, finalOutput: "", finalRoleId: "",
      lastExecutedRoleId: "", nextBranchSequence: 2, lastCheckpointSequence: 0
    }
  });
  assert.equal(input.role_id, "reviewer");
  assert.equal(input.mode, "judge_feedback");
  assert.deepEqual(JSON.parse(input.allowed_events), ["REWORK"]);
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
  const plan = { entryRoleId: "a" };
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
  const context = { state: { score: 3 }, loop: {}, event: { type: "NEXT" }, role: {} };
  assert.equal(evaluateCondition({ op: "greater_than", args: [
    { kind: "path", root: "state", path: ["score"] },
    { kind: "literal", value: 2 }
  ] }, context), true);
  assert.deepEqual(validateConditionAst({ op: "call", args: [] }), ["condition.op is not allowed"]);
  assert.throws(() => evaluateCondition({ op: "equals", args: [
    { kind: "path", root: "state", path: ["bad-key"] },
    { kind: "literal", value: 1 }
  ] }, context), /Invalid condition path segment/);
});

test("semantic route selection is priority based and fail-closed on ambiguity", () => {
  const transitions = [
    { flowId: "fallback", eventType: "NEXT", toRoleId: "b", priority: 0 },
    { flowId: "conditional", eventType: "NEXT", toRoleId: "c", priority: 1, condition: { op: "equals", args: [{ kind: "path", root: "state", path: ["ok"] }, { kind: "literal", value: true }] } }
  ];
  assert.equal(selectSemanticRoute({ transitions, eventType: "NEXT", context: { state: { ok: true }, loop: {}, event: {}, role: {} } }).toRoleId, "c");
  assert.throws(() => selectSemanticRoute({ transitions: transitions.slice(1), eventType: "NEXT", context: { state: { ok: false }, loop: {}, event: {}, role: {} } }), /No condition matched/);
  assert.throws(() => selectSemanticRoute({ transitions: [transitions[0], { ...transitions[0], flowId: "other", toRoleId: "c" }], eventType: "NEXT", context: { state: {}, loop: {}, event: {}, role: {} } }), /Ambiguous routes/);
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
      { flowId: "fallback", eventType: "DONE", toRoleId: "retry", priority: 0 },
      { flowId: "approved", eventType: "DONE", toRoleId: "publish", priority: 1, condition: { op: "equals", args: [{ kind: "path", root: "state", path: ["approved"] }, { kind: "literal", value: true }] } }
    ],
    eventType: "DONE",
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

test("Loop Scope routes a boundary transition to onExhausted at max rounds", () => {
  const system = {
    systemId: "loop-exhaustion",
    systemVersion: "1",
    entryRoleId: "boundary",
    roleIds: ["boundary", "summary"],
    flows: [
      { fromRoleId: "boundary", toRoleId: "boundary", eventType: "REBUTTAL" },
      { fromRoleId: "boundary", toRoleId: "summary", eventType: "SUMMARY" },
      { fromRoleId: "summary", toRoleId: "output", eventType: "DONE" }
    ],
    lawBinding: { globalLawRef: "law.test" },
    talentBinding: {},
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

  assert.equal(transition.update.status, "running");
  assert.equal(transition.update.branchRecords?.[branch.branchId]?.status, "completed");
  const exhaustedBranch = Object.values(transition.update.branchRecords ?? {}).find(
    (candidate) => candidate.roleId === "summary"
  );
  assert.equal(exhaustedBranch?.status, "active");
  assert.deepEqual(transition.events, [{
    type: "loop_exhausted",
    at: transition.events[0].at,
    loopId: "debate",
    roleId: "boundary",
    lineageId: branch.lineageId,
    loopIteration: 1,
    maxRounds: 1,
    onExhausted: "summary"
  }]);
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
  assert.deepEqual(compiled.ir.events?.SEND_MINIMALIST?.payloadSchema?.required, ["debate_round"]);
  assert.ok(compiled.ir.events?.DECISION_READY?.payloadSchema);
  assert.ok(compiled.digest.length > 0);
});

test("event contracts validate declaration, payload shape, and writable fields", () => {
  const result = validateEventCandidate({
    roleId: "worker",
    mode: "default",
    eventType: "DONE",
    payload: { answer: "ok" },
    contracts: { DONE: { eventType: "DONE", payloadSchema: { type: "object", required: ["answer"] }, writableStateFields: ["answer"] } },
    stateUpdateFields: ["answer"]
  });
  assert.equal(result.eventType, "DONE");
  assert.match(result.payloadDigest, /^[a-f0-9]{64}$/);
  assert.throws(() => validateEventCandidate({ roleId: "worker", mode: "default", eventType: "UNKNOWN", payload: {}, contracts: {} }), /not declared/);
  assert.throws(() => validateEventCandidate({ roleId: "worker", mode: "default", eventType: "DONE", payload: {}, contracts: { DONE: { eventType: "DONE", payloadSchema: { type: "object", required: ["answer"] } } } }), /schema mismatch/);
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
  assert.equal(resolveJoinPolicy({ ...base, now: 60000 }).action, "terminate");
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
    systemId: "demo", systemVersion: "1", entryRoleId: "a", roleIds: ["a", "b"],
    flows: [{ fromRoleId: "a", toRoleId: "b", eventType: "NEXT" }],
    lawBinding: { globalLawRef: "law" }, talentBinding: {}, executionBinding: {}, modelBinding: {}
  };
  const compiled = compileSemanticIR({ system, specification: snapshot, maxTransitionsPerRun: 10 });
  assert.equal(compiled.ir.joins[0].roleId, "b");
  assert.equal(compiled.ir.transitions[0].flowId, "a:NEXT:b");
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
    "  DONE:", "    payload: { schema: contracts/done.json }", "    writable_state_fields: [count]",
    "errors:", "  a:", "    retry: { max_attempts: 2, backoff: exponential }", "capabilities:",
    "  max_transitions_per_run: 10"
  ].join("\n"));
  const snapshot = await loadOgsSpecification(workdir);
  const system = { systemId: "demo", systemVersion: "1", entryRoleId: "a", roleIds: ["a", "b"], flows: [{ fromRoleId: "a", toRoleId: "b", eventType: "DONE" }], lawBinding: { globalLawRef: "law" }, talentBinding: {}, executionBinding: {}, modelBinding: {} };
  const compiled = compileSemanticIR({ system, specification: snapshot, maxTransitionsPerRun: 20 });
  assert.equal(compiled.ir.stateSchema.reducers.count, "increment");
  assert.equal(compiled.ir.events.DONE.payloadSchema.required[0], "ok");
  assert.deepEqual(compiled.ir.retryByRoleId.a, { maxAttempts: 2, backoff: "exponential" });
  assert.equal(compiled.ir.capabilities.maxTransitionsPerRun, 10);
});

test("semantic compiler rejects join declarations that diverge from topology", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-semantic-join-"));
  await mkdir(join(workdir, ".ogs"), { recursive: true });
  await writeFile(join(workdir, ".ogs", "semantics.yaml"), [
    "version: '1'", "system:", "  systemId: demo", "  systemVersion: '1'", "state:", "  schema: contracts/state.json", "joins:", "  b:", "    mode: all_of", "    sources: [x]", "    timeoutSeconds: 10", "    onTimeout: fail"
  ].join("\n"));
  const snapshot = await loadOgsSpecification(workdir);
  const system = { systemId: "demo", systemVersion: "1", entryRoleId: "a", roleIds: ["a", "b", "x"], flows: [{ fromRoleId: "a", toRoleId: "b", eventType: "NEXT" }], lawBinding: { globalLawRef: "law" }, talentBinding: {}, executionBinding: {}, modelBinding: {} };
  assert.throws(() => compileSemanticIR({ system, specification: snapshot, maxTransitionsPerRun: 10 }), /sources must match Mermaid/);
});
