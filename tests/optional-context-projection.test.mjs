import test from "node:test";
import assert from "node:assert/strict";

import { buildProjectedContext, buildRolePromptInput } from "../dist/runtime/role-input-projector.js";

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
      humanReviewContextByBranchId: {},
      ...(args.stateExtra ?? {})
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

test("artifact selectors are rejected because file delivery belongs to Workspace", () => {
  assert.throws(() => project({ artifact: "direct.artifact" }), /unsupported context selector/);
});

test("handoff projection preserves business data without technical execution fields", () => {
  const producer = {
    ...roleResult("producer", {
      decision: "publish",
      document: {
        path: "reports/brief.json",
        mediaType: "application/json",
        sizeBytes: 42,
        sha256: "a".repeat(64)
      }
    }),
    // These fields model accidental technical metadata attached by an adapter.
    backend: "opencode",
    model: "codex-gateway/gpt-6-luna",
    harnessTemplate: "workspace-writer",
    allowedTools: ["read", "write"],
    effectiveTools: ["read", "write"],
    effectiveEnvironmentPolicy: { filesystem: { write: true } },
    policyDigest: "policy-digest",
    capabilityDigest: "capability-digest",
    workspaceRoot: "/host/private/staging"
  };
  const state = {
    userPrompt: "publish the brief",
    roleResults: { "producer@1#1": producer },
    humanReviewContextByBranchId: {}
  };
  const node = {
    contextMap: {
      business: "direct.data",
    },
    outgoing: []
  };
  const branch = {
    branchId: "consumer@1#3",
    roleId: "consumer",
    loopIteration: 1,
    lineageId: "lineage-1",
    parentBranchId: "producer@1#1"
  };

  const prompt = buildRolePromptInput({ roleId: "consumer", node, branch, state });
  const projected = JSON.parse(prompt.input);
  assert.deepEqual(projected.business, {
    decision: "publish",
    document: {
      path: "reports/brief.json",
      mediaType: "application/json",
      sizeBytes: 42,
      sha256: "a".repeat(64)
    }
  });
  for (const forbidden of [
    "backend",
    "model",
    "harnessTemplate",
    "allowedTools",
    "effectiveTools",
    "effectiveEnvironmentPolicy",
    "policyDigest",
    "capabilityDigest",
    "workspaceRoot"
  ]) {
    assert.equal(Object.hasOwn(projected, forbidden), false, forbidden);
    assert.equal(prompt.input.includes(forbidden), false, forbidden);
  }
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

test("quorum join input uses the activation snapshot when a late source result exists", () => {
  const args = {
    joinMode: "quorum_of",
    joinSources: ["worker-a", "worker-b"],
    roleResults: {
      "worker-a@1#1": roleResult("worker-a", { findings: ["A"] }),
      "worker-b@1#2": roleResult("worker-b", { findings: ["B-late"] })
    },
    stateExtra: {
      joinScopes: {
        '["consumer","lineage-1",1]': {
          status: "activated",
          sourceArrivalByRoleId: {
            "worker-a": { branchId: "worker-a@1#1", arrivedAt: "2026-01-01T00:00:00.000Z" }
          }
        }
      }
    }
  };
  assert.deepEqual(project({ findings: "source(worker-b).data.findings?" }, args), {});
  assert.throws(
    () => project({ findings: "source(worker-b).data.findings" }, args),
    (error) => error.envelope.errorCode === "ROLE_CONTEXT_SOURCE_UNAVAILABLE"
  );
  assert.deepEqual(project({ joined: "source(worker-a).data.findings" }, args), {
    joined: ["A"]
  });
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
