import assert from "node:assert/strict";
import test from "node:test";
import {
  applyTeamJoinEvent,
  createTeamJoinRound,
  TeamJoinError
} from "../dist/team-ir/index.js";

function config(overrides = {}) {
  return {
    joinId: "collect",
    runId: "run-1",
    lineage: "main",
    mode: "all_of",
    handoffIds: ["left", "right"],
    timeoutMs: 100,
    requiredSourceIds: ["left"],
    requiredFields: ["common", "leftValue"],
    baseMapping: { data: { common: "run-data" } },
    ...overrides
  };
}

test("all_of merges baseMapping once, preserves Artifact provenance, and omits skipped optional values", () => {
  let round = createTeamJoinRound(config({
    requiredArtifactSlots: ["report"],
    baseMapping: {
      data: { common: "run-data" },
      artifacts: { report: { value: "base-artifact", mediaType: "text/plain" } }
    }
  }));
  round = applyTeamJoinEvent(round, { type: "predecessor_activated", at: 10 });
  round = applyTeamJoinEvent(round, { type: "arrival", sourceId: "left", contribution: {
    data: { leftValue: 1 },
    artifacts: { source: { value: "left-artifact", mediaType: "application/json" } }
  }, at: 11 });
  round = applyTeamJoinEvent(round, { type: "skip", sourceId: "right", at: 12 });
  assert.equal(round.status, "ready");
  assert.deepEqual(round.merged.data, { common: "run-data", leftValue: 1 });
  assert.deepEqual(round.merged.artifacts, {
    report: { sourceHandoffId: "join.baseMapping", value: "base-artifact", mediaType: "text/plain" },
    source: { sourceHandoffId: "left", value: "left-artifact", mediaType: "application/json" }
  });
  assert.deepEqual(round.sourceStates, { left: "arrived", right: "skipped" });
});

test("all_of fails when a required source skips or every source skips", () => {
  let required = createTeamJoinRound(config());
  required = applyTeamJoinEvent(required, { type: "predecessor_activated", at: 1 });
  required = applyTeamJoinEvent(required, { type: "skip", sourceId: "left", at: 2 });
  assert.equal(required.status, "failed");
  assert.equal(required.failure.code, "JOIN_SOURCE_SKIPPED");

  let empty = createTeamJoinRound(config({ requiredSourceIds: [], requiredFields: [] }));
  empty = applyTeamJoinEvent(empty, { type: "skip", sourceId: "left", at: 1 });
  empty = applyTeamJoinEvent(empty, { type: "skip", sourceId: "right", at: 2 });
  assert.equal(empty.status, "failed");
  assert.equal(empty.failure.code, "JOIN_NO_ARRIVALS");
});

test("quorum fires once at threshold and later source arrivals are audit-only for merged input", () => {
  let round = createTeamJoinRound(config({
    mode: "quorum_of", threshold: 1, requiredSourceIds: [],
    requiredFields: ["common"], baseMapping: { data: { common: "shared" } }
  }));
  round = applyTeamJoinEvent(round, { type: "arrival", sourceId: "left", contribution: { data: { leftValue: 1 } }, at: 3 });
  assert.equal(round.status, "ready");
  assert.deepEqual(round.merged.data, { common: "shared", leftValue: 1 });
  const readySnapshot = round;
  round = applyTeamJoinEvent(round, { type: "arrival", sourceId: "right", contribution: { data: { rightValue: 2 } }, at: 4 });
  assert.equal(round.status, "ready");
  assert.deepEqual(round.merged, readySnapshot.merged);
  assert.equal(round.sourceStates.right, "arrived");
  assert.equal(round.audit.filter((item) => item.type === "join.ready").length, 1);
  assert.equal(applyTeamJoinEvent(round, { type: "arrival", sourceId: "right", contribution: { data: { rightValue: 2 } }, at: 5 }), round);
  assert.throws(() => applyTeamJoinEvent(round, { type: "arrival", sourceId: "right", contribution: { data: { rightValue: 3 } }, at: 6 }), (error) => error.code === "JOIN_SOURCE_CONFLICT");
  assert.deepEqual(round.merged, readySnapshot.merged);
});

test("active quorum sibling failure after trigger still fails the Run", () => {
  let round = createTeamJoinRound(config({ mode: "quorum_of", threshold: 1, requiredSourceIds: [], requiredFields: [] }));
  round = applyTeamJoinEvent(round, { type: "arrival", sourceId: "left", contribution: { data: { leftValue: 1 } }, at: 3 });
  assert.equal(round.status, "ready");
  round = applyTeamJoinEvent(round, { type: "source_failed", sourceId: "right", at: 4, errorCode: "BINDING_SERVER_ERROR" });
  assert.equal(round.status, "failed");
  assert.equal(round.failure.code, "BINDING_SERVER_ERROR");
  assert.deepEqual(round.merged.data, { common: "run-data", leftValue: 1 });
});

test("quorum fails immediately when pending sources cannot reach threshold", () => {
  let round = createTeamJoinRound(config({ mode: "quorum_of", threshold: 2, requiredSourceIds: [], requiredFields: [] }));
  round = applyTeamJoinEvent(round, { type: "skip", sourceId: "left", at: 1 });
  assert.equal(round.status, "failed");
  assert.equal(round.failure.code, "JOIN_QUORUM_UNREACHABLE");
});

test("source failure fails the Join and signals the Run failure code", () => {
  const round = applyTeamJoinEvent(createTeamJoinRound(config()), {
    type: "source_failed", sourceId: "right", at: 12, errorCode: "BINDING_TIMEOUT"
  });
  assert.equal(round.status, "failed");
  assert.equal(round.failure.code, "BINDING_TIMEOUT");
  assert.equal(round.failure.sourceId, "right");
});

test("Join deadline starts at first predecessor activation and survives snapshot recovery", () => {
  let round = createTeamJoinRound(config({ requiredSourceIds: [], requiredFields: [] }));
  round = applyTeamJoinEvent(round, { type: "predecessor_activated", at: 20 });
  assert.equal(round.deadlineAt, 120);
  const recovered = structuredClone(round);
  assert.equal(applyTeamJoinEvent(recovered, { type: "tick", at: 119 }).status, "collecting");
  const timedOut = applyTeamJoinEvent(recovered, { type: "tick", at: 120 });
  assert.equal(timedOut.status, "failed");
  assert.equal(timedOut.failure.code, "JOIN_TIMEOUT");
  assert.equal(timedOut.deadlineAt, 120);
});

test("a late source arrival cannot mutate a failed timeout Join round", () => {
  let round = createTeamJoinRound(config({ requiredSourceIds: [], requiredFields: [] }));
  round = applyTeamJoinEvent(round, { type: "predecessor_activated", at: 20 });
  round = applyTeamJoinEvent(round, { type: "tick", at: 120 });
  assert.equal(round.status, "failed");
  assert.equal(round.failure.code, "JOIN_TIMEOUT");
  const failedSnapshot = structuredClone(round);

  const afterLateArrival = applyTeamJoinEvent(round, {
    type: "arrival", sourceId: "left", contribution: { data: { late: true } }, at: 121
  });
  assert.deepEqual(afterLateArrival, failedSnapshot);
  assert.equal(afterLateArrival.sourceStates.left, "pending");
  assert.deepEqual(afterLateArrival.contributions, {});
  assert.equal(afterLateArrival.merged, undefined);
});

test("Join source state is isolated by lineage and Loop round", () => {
  const isolated = { baseMapping: {}, requiredSourceIds: [], requiredFields: [] };
  const firstLineage = createTeamJoinRound(config({ ...isolated, lineage: "branch-a" }));
  const secondLineage = createTeamJoinRound(config({ ...isolated, lineage: "branch-b" }));
  const firstLoopRound = createTeamJoinRound(config({ ...isolated, lineage: "branch-a", loopRound: 1 }));
  const secondLoopRound = createTeamJoinRound(config({ ...isolated, lineage: "branch-a", loopRound: 2 }));

  assert.equal(new Set([firstLineage.key, secondLineage.key, firstLoopRound.key, secondLoopRound.key]).size, 4);

  const arrivedInFirstLineage = applyTeamJoinEvent(firstLineage, {
    type: "arrival", sourceId: "left", contribution: { data: { value: "branch-a" } }, at: 1
  });
  assert.equal(arrivedInFirstLineage.sourceStates.left, "arrived");
  assert.equal(secondLineage.sourceStates.left, "pending");
  assert.equal(firstLoopRound.sourceStates.left, "pending");
  assert.equal(secondLoopRound.sourceStates.left, "pending");

  const completedFirstLineage = applyTeamJoinEvent(arrivedInFirstLineage, {
    type: "arrival", sourceId: "right", contribution: { data: { other: "branch-a" } }, at: 2
  });
  assert.equal(completedFirstLineage.status, "ready");
  assert.equal(secondLineage.status, "collecting");
  assert.equal(firstLoopRound.status, "collecting");
  assert.equal(secondLoopRound.status, "collecting");
  assert.deepEqual(completedFirstLineage.merged.data, { value: "branch-a", other: "branch-a" });
});

test("first contribution starts deadline, target conflicts fail closed, and unknown sources reject", () => {
  let round = createTeamJoinRound(config({ requiredSourceIds: [], requiredFields: [], baseMapping: { data: { same: 0 } } }));
  round = applyTeamJoinEvent(round, { type: "arrival", sourceId: "left", contribution: { data: { same: 1 } }, at: 7 });
  assert.equal(round.deadlineAt, 107);
  round = applyTeamJoinEvent(round, { type: "arrival", sourceId: "right", contribution: {}, at: 8 });
  assert.equal(round.status, "failed");
  assert.equal(round.failure.code, "IR_JOIN_FIELD_CONFLICT");
  assert.throws(() => applyTeamJoinEvent(createTeamJoinRound(config()), {
    type: "skip", sourceId: "unknown", at: 1
  }), TeamJoinError);
});
