import test from "node:test";
import assert from "node:assert/strict";

import { buildProjectedContext } from "../dist/runtime/role-input-projector.js";
import { buildArtifactReference } from "../dist/runtime/artifact-access.js";

const roleResult = (roleId, data, lineageId = "lineage-1") => ({
  roleId,
  event: "READY",
  content: `${roleId} output`,
  data,
  branchId: `${roleId}@1#1`,
  lineageId,
  loopIteration: 1
});

function project(contextMap, args = {}) {
  const branch = {
    branchId: "consumer@1#3",
    roleId: "consumer",
    loopIteration: 1,
    lineageId: "lineage-1",
    parentBranchId: args.parentBranchId === null ? undefined : args.parentBranchId ?? "producer@1#1"
  };
  return buildProjectedContext({
    roleId: "consumer",
    node: {
      contextMap,
      joinMode: args.joinMode,
      joinSources: args.joinSources ?? []
    },
    branch,
    state: {
      userPrompt: "request",
      roleResults: args.roleResults ?? {},
      humanReviewContextByBranchId: {}
    }
  });
}

test("optional direct data selectors omit unavailable sources and missing paths", () => {
  assert.deepEqual(project({ finding: "direct.data.findings?" }), {});
  assert.deepEqual(project({ finding: "direct.data.findings?" }, {
    parentBranchId: null,
    roleResults: { "producer@1#1": roleResult("producer", { findings: ["missing-parent"] }) }
  }), {});
  assert.deepEqual(project({ finding: "direct.data.findings?" }, {
    roleResults: { "producer@1#1": roleResult("producer", { unrelated: true }) }
  }), {});
});

test("optional direct data selectors preserve explicit null and present values", () => {
  const roleResults = { "producer@1#1": roleResult("producer", { findings: null, issue: { id: "ISSUE-7" } }) };
  assert.deepEqual(project({ finding: "direct.data.findings?" }, { roleResults }), { finding: null });
  assert.deepEqual(project({ issueId: "direct.data.issue.id?" }, { roleResults }), { issueId: "ISSUE-7" });
});

test("direct and join artifact selectors project opaque references with optional omission", () => {
  const artifactRef = buildArtifactReference({ runId: "run-1", executionId: "exec-1", mediaType: "text/plain" });
  const producer = { ...roleResult("producer", { findings: ["A"] }), artifactRef, provenance: { runId: "run-1", executionId: "exec-1", producerRoleId: "producer", branchId: "producer@1#1", lineageId: "lineage-1", loopIteration: 1, mediaType: "text/plain" } };
  assert.deepEqual(project({ artifact: "direct.artifact" }, { roleResults: { "producer@1#1": producer } }), { artifact: artifactRef });
  assert.deepEqual(project({ artifact: "direct.artifact?" }, { parentBranchId: null }), {});
});

test("optional join source selectors omit missing source data while required selectors fail closed", () => {
  const args = {
    joinMode: "quorum_of",
    joinSources: ["worker-a", "worker-b"],
    roleResults: { "worker-a@1#1": roleResult("worker-a", { findings: ["A"] }) }
  };
  assert.deepEqual(project({ findings: "source(worker-b).data.findings?" }, args), {});
  assert.throws(
    () => project({ findings: "source(worker-b).data.findings" }, args),
    (error) => error.envelope.errorCode === "ROLE_CONTEXT_SOURCE_UNAVAILABLE"
  );
});

test("optional join source selectors still reject undeclared sources", () => {
  assert.throws(
    () => project({ finding: "source(worker-c).data.findings?" }, {
      joinMode: "all_of",
      joinSources: ["worker-a", "worker-b"]
    }),
    (error) => error.envelope.errorCode === "ROLE_CONTEXT_SELECTOR_UNAUTHORIZED"
  );
});
