import assert from "node:assert/strict";
import test from "node:test";
import { createRuntimeProjectReadinessInspector } from "../infrastructure/runtime-project-readiness.mjs";

test("Project Readiness blocks versions without a native Team IR v2 document", async () => {
  const inspector = createRuntimeProjectReadinessInspector({ teamIrStore: { read: async () => ({ teamIR: null }) } });
  const readiness = await inspector.inspect("C:/projects/version");
  assert.equal(readiness.canDryRun, false);
  assert.equal(readiness.blockers[0].code, "TEAM_IR_V2_REQUIRED");
});

test("Project Readiness blocks when Team IR v2 storage is not configured", async () => {
  const inspector = createRuntimeProjectReadinessInspector();
  const readiness = await inspector.inspect("C:/projects/version");
  assert.equal(readiness.canDryRun, false);
  assert.equal(readiness.blockers[0].code, "TEAM_IR_V2_STORE_UNAVAILABLE");
});

test("native Team IR v2 readiness resolves the frozen closure without a legacy system file", async () => {
  const { classicSoftwareTeamIr, classicSoftwareTeamClosure, createClassicSoftwareTeamFakeBindings } = await import("./team-ir-test-runtime.mjs");
  const calls = [];
  const inspector = createRuntimeProjectReadinessInspector({
    teamIrStore: { read: async ({ workdir }) => (calls.push(["read", workdir]), { teamIR: classicSoftwareTeamIr }) },
    resolveReleaseClosure: async ({ team, teamIR }) => {
      calls.push(["closure", team.teamVersionId, teamIR]);
      return classicSoftwareTeamClosure;
    },
    resolveBindings: async ({ team, mode }) => {
      calls.push(["bindings", team.teamVersionId, mode]);
      return createClassicSoftwareTeamFakeBindings();
    },
    inspect: async () => { throw new Error("legacy system.mmd inspection must not run"); }
  });

  const team = { teamVersionId: "software-v2", teamIrSemanticDigest: undefined };
  const readiness = await inspector.inspect("/teams/software-v2", team);
  assert.equal(readiness.canDryRun, true);
  assert.deepEqual(readiness.blockers, []);
  assert.deepEqual(calls.map(([kind]) => kind), ["read", "closure", "bindings"]);
  assert.deepEqual(calls[2], ["bindings", "software-v2", "sandbox"]);
});

test("native Team IR v2 readiness fails closed when its resolver is missing", async () => {
  const { classicSoftwareTeamIr } = await import("./team-ir-test-runtime.mjs");
  const inspector = createRuntimeProjectReadinessInspector({
    teamIrStore: { read: async () => ({ teamIR: classicSoftwareTeamIr }) },
    inspect: async () => { throw new Error("legacy system.mmd inspection must not run"); }
  });
  const readiness = await inspector.inspect("/teams/software-v2", { teamVersionId: "software-v2" });
  assert.equal(readiness.canDryRun, false);
  assert.equal(readiness.blockers[0].code, "TEAM_IR_V2_RESOLVER_UNAVAILABLE");
});

test("saved semantic drafts remain non-runnable until diagnostics are cleared", async () => {
  const { classicSoftwareTeamIr } = await import("./team-ir-test-runtime.mjs");
  const draft = structuredClone(classicSoftwareTeamIr);
  draft.handoffs = draft.handoffs.filter((handoff) => handoff.to?.kind !== "result");
  const inspector = createRuntimeProjectReadinessInspector({
    teamIrStore: { read: async () => ({ teamIR: draft }) },
    resolveReleaseClosure: async () => { throw new Error("closure must not be reached for a diagnostic draft"); },
    resolveBindings: async () => { throw new Error("bindings must not be reached for a diagnostic draft"); }
  });
  const readiness = await inspector.inspect("/teams/software-v2", { teamVersionId: "software-v2" });
  assert.equal(readiness.canDryRun, false);
  assert.equal(readiness.blockers[0].code, "IR_RESULT_REQUIRED_MISSING");
});
