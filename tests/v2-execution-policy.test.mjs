import test from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";

import {
  assertCapabilitySnapshot,
  assertWithinExecutionRoot,
  createEffectiveExecutionPolicy,
  createRunCapabilitySnapshot,
  decidePermission,
  resolveEffectiveEnvironmentPolicy,
  resolveEffectiveTools
} from "../dist/runtime/v2-execution-policy.js";

const root = resolve("/tmp/ogs-v2-policy/execution/workspace");

function snapshot() {
  return createRunCapabilitySnapshot({
    backend: "codex",
    model: "gpt-test",
    adapterVersion: "codex-adapter-test-1",
    verifiedAt: "2026-11-15T00:00:00.000Z",
    verifiedTools: ["apply_patch", "exec_command"]
  });
}

function environment(resources = { filesystem: true, process: true, network: false }) {
  return resolveEffectiveEnvironmentPolicy({
    root,
    resources,
    intent: {
      filesystem: { read: true, write: true },
      process: true,
      network: false
    },
    limits: { timeoutMs: 60_000, maxOutputBytes: 1_000_000, maxStorageBytes: 10_000_000 }
  });
}

test("v2 Run Capability Snapshot is digest checked and frozen", () => {
  const value = snapshot();
  assertCapabilitySnapshot(value);
  assert.ok(Object.isFrozen(value));
  assert.ok(Object.isFrozen(value.verifiedTools));
  assert.throws(() => value.verifiedTools.push("unknown"), TypeError);
  assert.throws(() => assertCapabilitySnapshot({ ...value, digest: "tampered" }), /V2_CAPABILITY_SNAPSHOT_INVALID/);
});

test("v2 readiness fails closed when an allowed tool is not verified", () => {
  assert.throws(
    () => resolveEffectiveTools({ allowedTools: ["unknown"], snapshot: snapshot(), environment: environment() }),
    /V2_READINESS_TOOL_MISSING/
  );
});

test("v2 environment readiness fails closed when an explicit resource cannot be enforced", () => {
  assert.throws(
    () => resolveEffectiveEnvironmentPolicy({
      root,
      resources: { filesystem: true, process: true, network: false },
      intent: { filesystem: "read_only", process: false, network: true },
      limits: { timeoutMs: 1000, maxOutputBytes: 1024, maxStorageBytes: 1024 }
    }),
    /V2_READINESS_RESOURCE_UNENFORCEABLE.*network/
  );
});

test("v2 environment policy is versioned and carries a stable policy digest", () => {
  const value = environment();
  assert.equal(value.ogsContractVersion, 2);
  assert.equal(value.schemaVersion, 1);
  assert.equal(typeof value.policyDigest, "string");
});

test("v2 readiness fails closed when an adapter cannot enforce a tool resource", () => {
  assert.throws(
    () => createEffectiveExecutionPolicy({
      allowedTools: ["exec_command"],
      snapshot: snapshot(),
      environment: environment(),
      validateToolResources: () => ({ allowed: false, reason: "process boundary unavailable" })
    }),
    /V2_READINESS_RESOURCE_UNENFORCEABLE.*process boundary unavailable/
  );
});

test("v2 paths cannot escape the execution staging root", () => {
  assert.equal(assertWithinExecutionRoot(root, join(root, "src")), join(root, "src"));
  assert.throws(() => assertWithinExecutionRoot(root, resolve("/tmp/ogs-v2-policy/project")), /V2_STAGING_ESCAPE/);
});

test("v2 permission decision only allows frozen effective tools", () => {
  const policy = createEffectiveExecutionPolicy({
    allowedTools: ["exec_command"],
    snapshot: snapshot(),
    environment: environment()
  });
  assert.deepEqual(policy.effectiveTools, ["exec_command"]);
  assert.equal(decidePermission({ toolId: "exec_command", effectiveTools: policy.effectiveTools, policy: policy.environment }), "allow");
  assert.equal(decidePermission({ toolId: "apply_patch", effectiveTools: policy.effectiveTools, policy: policy.environment }), "deny");
  assert.equal(decidePermission({ toolId: "exec_command", effectiveTools: policy.effectiveTools, policy: policy.environment, resourceCheck: () => ({ allowed: false }) }), "deny");
});
