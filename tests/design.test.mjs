import test from "node:test";
import assert from "node:assert/strict";

import {
  applyChangeSet,
  createChangeSet,
  createEmptySystemDesign,
  designToSystemDefinition,
  diffSystemDesign,
  exportDesignToMermaid,
  systemDefinitionToDesign,
  validateSystemDesign
} from "../dist/design/index.js";
import { loadRolePackages } from "../dist/runtime/runtime-loader.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import path from "node:path";

function baseDesign() {
  const design = createEmptySystemDesign({
    systemId: "test.design",
    entrySeatId: "intake"
  });
  design.seats.intake = {
    seatId: "intake",
    rolePackageRef: "intake",
    binding: { kind: "noop" }
  };
  design.bindings.intake = structuredClone(design.seats.intake.binding);
  return design;
}

test("System Design validates the role-seat graph and exports deterministic Mermaid", () => {
  const design = baseDesign();
  design.seats.review = {
    seatId: "review",
    rolePackageRef: "review",
    binding: { kind: "model", modelRef: "openai/gpt-5" },
    review: { mode: "required", timeoutAction: "pause" }
  };
  design.bindings.review = structuredClone(design.seats.review.binding);
  design.transitions.push({
    transitionId: "intake-done-review",
    fromSeatId: "intake",
    toSeatId: "review",
    eventType: "DONE"
  });
  design.transitions.push({
    transitionId: "review-approved-output",
    fromSeatId: "review",
    toSeatId: "__system_end__",
    eventType: "APPROVED"
  });

  assert.equal(validateSystemDesign(design).ok, true);
  const source = exportDesignToMermaid(design);
  assert.match(source, /system\.id=test\.design/);
  assert.match(source, /intake.*DONE.*review/);
  assert.match(source, /review.*APPROVED.*output/);
});

test("ChangeSet application is revisioned and rejects stale proposals", () => {
  const design = baseDesign();
  const changeSet = createChangeSet({
    baseRevision: 0,
    summary: "Add a reviewer",
    operations: [{
      type: "addSeat",
      seat: { seatId: "review", rolePackageRef: "review", binding: { kind: "noop" } },
      layout: { x: 320, y: 120 }
    }]
  });
  const applied = applyChangeSet({ design, changeSet });
  assert.equal(applied.ok, true);
  assert.equal(applied.design?.revision, 1);
  assert.ok(applied.design?.seats.review);

  const stale = applyChangeSet({ design: applied.design, changeSet });
  assert.equal(stale.ok, false);
  assert.equal(stale.diagnostics[0].code, "DESIGN_REVISION_CONFLICT");
});

test("Design validation rejects unsupported graph references", () => {
  const design = baseDesign();
  design.transitions.push({
    transitionId: "invalid",
    fromSeatId: "missing",
    toSeatId: "intake",
    eventType: "bad-event"
  });
  const result = validateSystemDesign(design);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.code === "DESIGN_TRANSITION_SOURCE_UNKNOWN"));
  assert.ok(result.diagnostics.some((item) => item.code === "DESIGN_EVENT_INVALID"));
});

test("Design validation rejects missing, mismatched, and extra binding index entries", () => {
  const missing = baseDesign();
  delete missing.bindings.intake;
  const missingResult = validateSystemDesign(missing);
  assert.equal(missingResult.ok, false);
  assert.ok(missingResult.diagnostics.some((item) => item.code === "DESIGN_BINDING_INDEX_MISSING" && item.path === "bindings.intake"));

  const mismatched = baseDesign();
  mismatched.bindings.intake = { kind: "exec", profileId: "different-profile" };
  const mismatchResult = validateSystemDesign(mismatched);
  assert.equal(mismatchResult.ok, false);
  assert.ok(mismatchResult.diagnostics.some((item) => item.code === "DESIGN_BINDING_INDEX_MISMATCH" && item.path === "bindings.intake"));

  const extra = baseDesign();
  extra.bindings.unknown = { kind: "noop" };
  const extraResult = validateSystemDesign(extra);
  assert.equal(extraResult.ok, false);
  assert.ok(extraResult.diagnostics.some((item) => item.code === "DESIGN_BINDING_INDEX_EXTRA" && item.path === "bindings.unknown"));
});

test("setBindings rejects an inconsistent design instead of applying it", () => {
  const design = baseDesign();
  const result = applyChangeSet({
    design,
    changeSet: createChangeSet({
      baseRevision: 0,
      summary: "Replace bindings index",
      operations: [{ type: "setBindings", bindings: {} }]
    })
  });

  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((item) => item.code === "DESIGN_BINDING_INDEX_MISSING"));
  assert.equal(design.revision, 0);
  assert.deepEqual(design.bindings.intake, { kind: "noop" });
});

test("canonical design compiles profile bindings and produces a reviewable diff", () => {
  const current = baseDesign();
  current.seats.intake.binding = { kind: "exec", profileId: "profile.intake" };
  current.bindings.intake = structuredClone(current.seats.intake.binding);
  const proposed = structuredClone(current);
  proposed.revision = 1;
  proposed.seats.intake.contextMap = { task: "global.task" };
  proposed.intent.objective = "Route a one-sentence request through the intake team.";
  const compiled = designToSystemDefinition(current);
  assert.equal(compiled.executionBinding.intake, "profile.intake");
  const changeSet = diffSystemDesign({
    current,
    proposed,
    summary: "Tune intake context"
  });
  assert.ok(changeSet.operations.some((operation) => operation.type === "updateSeat"));
  assert.ok(changeSet.operations.some((operation) => operation.type === "setIntent"));
  const applied = applyChangeSet({ design: current, changeSet });
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.design?.seats.intake.contextMap, { task: "global.task" });
  assert.equal(applied.design?.intent.objective, proposed.intent.objective);
});

test("design preserves a non-matching role package ref through runtime loading", async () => {
  const design = baseDesign();
  design.seats.intake.rolePackageRef = "demo-intake";
  const system = designToSystemDefinition(design);

  assert.equal(system.rolePackageRefByRoleId.intake, "demo-intake");
  const packages = await loadRolePackages({
    system,
    roleRootDir: path.resolve("og-roles", "roles")
  });
  assert.equal(packages.has("intake"), true);
  assert.equal(packages.get("intake")?.manifest.roleId, "demo-intake");

  const roundTripped = systemDefinitionToDesign(system);
  assert.equal(roundTripped.seats.intake.rolePackageRef, "demo-intake");
});

test("Mermaid entry boundary event survives parse and design export", () => {
  const system = parseSystemFromMermaidSource(`flowchart TD
%% system.id=test.entry
%% system.version=1.0.0
%% law.global=law.global
input -->|ENTER_REQUEST| intake[Role:intake]
intake[Role:intake] -->|DONE| output
`);

  assert.equal(system.entryEventType, "ENTER_REQUEST");
  const design = systemDefinitionToDesign(system);
  assert.equal(design.system.entryEventType, "ENTER_REQUEST");
  assert.match(exportDesignToMermaid(design), /input -->\|ENTER_REQUEST\|/);
});

test("design diff applies state, contracts, policies, and bindings without drift", () => {
  const current = baseDesign();
  current.bindings.intake = structuredClone(current.seats.intake.binding);
  const proposed = structuredClone(current);
  proposed.revision = 1;
  proposed.seats.intake.binding = { kind: "exec", profileId: "profile.intake" };
  proposed.bindings.intake = structuredClone(proposed.seats.intake.binding);
  proposed.state = {
    schemaVersion: 2,
    ref: "state.task",
    reducers: { score: "increment" },
    defaults: { score: 0 }
  };
  proposed.contracts = [{ id: "handoff", schema: "contracts/handoff.json" }];
  proposed.policies = { maxTransitionsPerRun: 12, errorFlowsEnabled: true };

  const changeSet = diffSystemDesign({ current, proposed, summary: "Update canonical runtime fields" });
  assert.ok(changeSet.operations.some((operation) => operation.type === "setStateSchema"));
  assert.ok(changeSet.operations.some((operation) => operation.type === "setContracts"));
  assert.ok(changeSet.operations.some((operation) => operation.type === "setPolicies"));
  assert.ok(changeSet.operations.some((operation) => operation.type === "setBindings"));

  const applied = applyChangeSet({ design: current, changeSet });
  assert.equal(applied.ok, true);
  assert.deepEqual(applied.design?.state, proposed.state);
  assert.deepEqual(applied.design?.contracts, proposed.contracts);
  assert.deepEqual(applied.design?.policies, proposed.policies);
  assert.deepEqual(applied.design?.bindings, proposed.bindings);
  assert.deepEqual(applied.design?.seats.intake.binding, proposed.seats.intake.binding);
});

test("seat operations keep the top-level bindings index synchronized", () => {
  const design = baseDesign();
  design.bindings.intake = structuredClone(design.seats.intake.binding);
  const added = applyChangeSet({
    design,
    changeSet: createChangeSet({
      baseRevision: 0,
      summary: "Add bound seat",
      operations: [{
        type: "addSeat",
        seat: { seatId: "worker", rolePackageRef: "worker", binding: { kind: "exec", profileId: "worker-profile" } }
      }]
    })
  });
  assert.equal(added.ok, true);
  assert.deepEqual(added.design?.bindings.worker, { kind: "exec", profileId: "worker-profile" });

  const deleted = applyChangeSet({
    design: added.design,
    changeSet: createChangeSet({
      baseRevision: 1,
      summary: "Remove bound seat",
      operations: [{ type: "deleteSeat", seatId: "worker" }]
    })
  });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.design?.bindings.worker, undefined);
});
