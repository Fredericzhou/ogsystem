import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";

import { compileExecutionSnapshot } from "../dist/runtime/compiler.js";
import { createExecutionPlan } from "../dist/runtime/execution-plan.js";
import { loadRolePackage } from "../dist/runtime/role-repo.js";
import { parseSystemFromMermaidSource } from "../dist/runtime/parse-mermaid.js";
import { resolveEffectiveLaw } from "../dist/runtime/adapter.js";
import { validateLawsConfig } from "../dist/runtime/config.js";

async function loadLawCatalog() {
  const lawPath = path.resolve(".ogs", "laws.json");
  return validateLawsConfig(JSON.parse(await readFile(lawPath, "utf8")), lawPath);
}

async function loadRolePackages(roleIds, roleRootDir) {
  const rolePackagesByRoleId = new Map();
  for (const roleId of roleIds) {
    rolePackagesByRoleId.set(
      roleId,
      await loadRolePackage({
        roleId,
        roleRootDir
      })
    );
  }
  return rolePackagesByRoleId;
}

function alignContractEventsWithSystem(system, rolePackagesByRoleId) {
  for (const roleId of system.roleIds) {
    const rolePackage = rolePackagesByRoleId.get(roleId);
    if (!rolePackage) continue;
    rolePackage.manifest.outputs.events = [...new Set(
      system.flows
        .filter((flow) => flow.fromRoleId === roleId && !flow.eventType.startsWith("ERROR"))
        .map((flow) => flow.eventType)
    )].sort();
  }
}

test("compiler snapshot digest is stable across role package ordering", async () => {
  const source = await readFile(path.resolve("examples/target-model-binding-system.mmd"), "utf8");
  const system = parseSystemFromMermaidSource(source);
  const lawCatalog = await loadLawCatalog();
  const effectiveLaw = resolveEffectiveLaw(system, lawCatalog);
  const roleRootDir = path.resolve("og-roles", "roles");

  const forwardPackages = await loadRolePackages(system.roleIds, roleRootDir);
  const reversePackages = await loadRolePackages([...system.roleIds].reverse(), roleRootDir);

  const forwardResult = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId: forwardPackages,
    effectiveLaw
  });
  const reverseResult = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId: reversePackages,
    effectiveLaw
  });

  assert.equal(forwardResult.ok, true);
  assert.equal(forwardResult.diagnostics.length, 0);
  assert.equal(forwardResult.digest, reverseResult.digest);
  assert.equal(
    forwardResult.snapshot.runtimePromptInputSchemaPath,
    "(builtin runtime prompt input schema)"
  );
  assert.match(forwardResult.snapshot.runtimePromptInputSchemaDigest, /^[a-f0-9]{64}$/);
  assert.deepStrictEqual(forwardResult.snapshot.basePlan, createExecutionPlan(system));
  assert.deepStrictEqual(
    forwardResult.snapshot.roleSummaryByRoleId,
    reverseResult.snapshot.roleSummaryByRoleId
  );
  assert.deepStrictEqual(
    forwardResult.snapshot.flowSummaryByKey,
    reverseResult.snapshot.flowSummaryByKey
  );
});

test("plain Mermaid systems enforce the exact Role Contract event set", async () => {
  const source = await readFile(path.resolve("examples/target-model-binding-system.mmd"), "utf8");
  const system = parseSystemFromMermaidSource(source);
  const rolePackagesByRoleId = await loadRolePackages(system.roleIds, path.resolve("og-roles", "roles"));
  rolePackagesByRoleId.get("debate-judge").manifest.outputs.events = ["DECISION_READY", "UNDECLARED_EVENT"];

  const result = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    effectiveLaw: {
      forbiddenToolRefs: [],
      maxTransitions: undefined,
      allowNoopWithoutExecutionBinding: false
    }
  });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "IR_CONTRACT_INVALID" && diagnostic.roleId === "debate-judge"
  ));
});

test("compiler emits stable diagnostics for invalid join, context, loop, and contract metadata", async () => {
  const source = await readFile(path.resolve("examples/target-model-binding-system.mmd"), "utf8");
  const system = parseSystemFromMermaidSource(source);
  const lawCatalog = await loadLawCatalog();
  const effectiveLaw = resolveEffectiveLaw(system, lawCatalog);
  const roleRootDir = path.resolve("og-roles", "roles");
  const rolePackagesByRoleId = await loadRolePackages(system.roleIds, roleRootDir);

  system.graph = {
    ...system.graph,
    routeOrderByRoleId: {
      "debate-minimalist": ["debate-judge"]
    },
    joinModeByRoleId: {
      "debate-judge": "quorum_of"
    },
    joinSourcesByRoleId: {
      "debate-judge": ["debate-minimalist", "ghost"]
    },
    joinMinByRoleId: {
      "debate-judge": 2
    },
    contextMapByRoleId: {
      "debate-judge": {
        summary: "source(ghost).content",
        fallback: "direct.content"
      }
    },
    loopMaxByRoleId: {
      "debate-judge": 0
    },
    routingModeByRoleId: {
      ...system.graph.routingModeByRoleId
    }
  };

  const contractPlan = {
    handoffMode: "strict",
    contractPath: path.resolve("virtual", "handoff.contracts.json"),
    digest: "manual-contract-plan",
    flowContractsByKey: new Map([
      [
        "flow:debate-minimalist:GO:ghost",
        {
          definition: {
            id: "flow.contract.ghost",
            kind: "flow",
            match: {
              fromRoleId: "debate-minimalist",
              eventType: "GO",
              toRoleId: "ghost"
            },
            schema: "flow.schema.json",
            onViolation: "FAIL"
          },
          schema: {
            type: "object"
          },
          schemaPath: "flow.schema.json"
        }
      ]
    ]),
    roleInputContractsByRoleId: new Map([
      [
        "ghost",
        {
          definition: {
            id: "role_input.ghost",
            kind: "role_input",
            match: {
              roleId: "ghost"
            },
            schema: "input.schema.json",
            onViolation: "FAIL"
          },
          schema: {
            type: "object"
          },
          schemaPath: "input.schema.json"
        }
      ]
    ])
  };

  const result = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    effectiveLaw,
    contractPlan
  });

  const codes = new Set(result.diagnostics.map((diagnostic) => diagnostic.code));
  assert.equal(result.ok, false);
  assert.ok(codes.has("COMPILER_CONTEXT_SELECTOR_JOIN_ONLY"));
  assert.ok(codes.has("COMPILER_CONTEXT_SOURCE_UNDEFINED"));
  assert.ok(codes.has("COMPILER_JOIN_SOURCES_MISMATCH"));
  assert.ok(codes.has("COMPILER_LOOP_MAX_INVALID"));
  assert.ok(codes.has("COMPILER_FLOW_CONTRACT_UNBOUND"));
  assert.ok(codes.has("COMPILER_ROLE_INPUT_UNBOUND"));
});

test("compiler rejects noop roles that are unauthorized or ambiguously routed", async () => {
  const source = `flowchart TD
%% system.id=test.compiler.noop
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=test-operator
%% exec.bind.test-decision=profile.test-decision
input -->|START| operator[Role:test-operator]
operator[Role:test-operator] -->|NEXT| decider[Role:test-decision]
operator[Role:test-operator] -->|DONE| output
decider[Role:test-decision] -->|DONE| output
`;
  const system = parseSystemFromMermaidSource(source);
  const roleRootDir = path.resolve("og-roles", "roles");
  const rolePackagesByRoleId = await loadRolePackages(system.roleIds, roleRootDir);
  alignContractEventsWithSystem(system, rolePackagesByRoleId);

  const missingBindingLaw = {
    forbiddenToolRefs: [],
    maxTransitions: undefined,
    allowNoopWithoutExecutionBinding: false
  };
  const missingBindingResult = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    effectiveLaw: missingBindingLaw
  });
  assert.equal(missingBindingResult.ok, false);
  assert.deepStrictEqual(
    missingBindingResult.diagnostics.map((diagnostic) => diagnostic.code),
    ["COMPILER_ROLE_BINDING_MISSING"]
  );

  const ambiguousNoopLaw = {
    forbiddenToolRefs: [],
    maxTransitions: undefined,
    allowNoopWithoutExecutionBinding: true
  };
  const ambiguousNoopResult = compileExecutionSnapshot({
    system,
    rolePackagesByRoleId,
    effectiveLaw: ambiguousNoopLaw
  });
  assert.equal(ambiguousNoopResult.ok, false);
  assert.deepStrictEqual(
    ambiguousNoopResult.diagnostics.map((diagnostic) => diagnostic.code),
    ["COMPILER_ROLE_NOOP_AMBIGUOUS"]
  );
});

test("compiler fingerprints review metadata and rejects review on noop bindings", async () => {
  const sourceWithPause = `flowchart TD
%% system.id=test.compiler.review
%% system.version=0.1.0
%% law.global=law.test
%% entry.role=test-operator
%% exec.bind.test-operator=profile.test-operator
%% exec.bind.test-decision=profile.test-decision
%% review.mode.test-decision=required
%% review.timeout.test-decision=600
%% review.rework.target.test-decision=test-operator
%% review.terminate.scope.test-decision=branch
input -->|START| operator[Role:test-operator]
operator[Role:test-operator] -->|NEXT| decider[Role:test-decision]
decider[Role:test-decision] -->|DONE| output
`;
  const sourceWithTerminate = sourceWithPause.replace(
    "%% review.terminate.scope.test-decision=branch",
    "%% review.terminate.scope.test-decision=run"
  );
  const roleRootDir = path.resolve("og-roles", "roles");

  const pauseSystem = parseSystemFromMermaidSource(sourceWithPause);
  const terminateSystem = parseSystemFromMermaidSource(sourceWithTerminate);
  const pausePackages = await loadRolePackages(pauseSystem.roleIds, roleRootDir);
  const terminatePackages = await loadRolePackages(terminateSystem.roleIds, roleRootDir);
  alignContractEventsWithSystem(pauseSystem, pausePackages);
  alignContractEventsWithSystem(terminateSystem, terminatePackages);
  pausePackages.get("test-decision").manifest.authority.controlActions = ["approve", "pause", "rework", "terminate"];
  terminatePackages.get("test-decision").manifest.authority.controlActions = ["approve", "pause", "rework", "terminate"];
  const effectiveLaw = {
    forbiddenToolRefs: [],
    maxTransitions: undefined,
    allowNoopWithoutExecutionBinding: true
  };

  const pauseResult = compileExecutionSnapshot({
    system: pauseSystem,
    rolePackagesByRoleId: pausePackages,
    effectiveLaw
  });
  const terminateResult = compileExecutionSnapshot({
    system: terminateSystem,
    rolePackagesByRoleId: terminatePackages,
    effectiveLaw
  });

  assert.equal(pauseResult.ok, true);
  assert.deepStrictEqual(pauseResult.snapshot.reviewSummaryByRoleId, {
    "test-decision": {
      roleId: "test-decision",
      mode: "required",
      timeoutSeconds: 600,
      timeoutAction: "pause",
      reworkTargetRoleId: "test-operator",
      reworkMax: undefined,
      terminateScope: "branch"
    }
  });
  assert.notStrictEqual(pauseResult.digest, terminateResult.digest);

  pausePackages.get("test-decision").manifest.authority.controlActions = ["approve"];
  const unauthorizedReviewResult = compileExecutionSnapshot({
    system: pauseSystem,
    rolePackagesByRoleId: pausePackages,
    effectiveLaw
  });
  assert.equal(unauthorizedReviewResult.ok, false);
  assert.ok(unauthorizedReviewResult.diagnostics.some((diagnostic) =>
    diagnostic.code === "IR_CONTRACT_INVALID" && diagnostic.roleId === "test-decision" && diagnostic.message.includes("controlActions")
  ));

  const noopReviewSystem = parseSystemFromMermaidSource(
    sourceWithPause.replace("%% exec.bind.test-decision=profile.test-decision\n", "")
  );
  const noopReviewPackages = await loadRolePackages(noopReviewSystem.roleIds, roleRootDir);
  alignContractEventsWithSystem(noopReviewSystem, noopReviewPackages);
  noopReviewPackages.get("test-decision").manifest.authority.controlActions = ["approve", "pause", "rework", "terminate"];
  const noopReviewResult = compileExecutionSnapshot({
    system: noopReviewSystem,
    rolePackagesByRoleId: noopReviewPackages,
    effectiveLaw
  });

  assert.equal(noopReviewResult.ok, false);
  assert.deepStrictEqual(
    noopReviewResult.diagnostics.map((diagnostic) => diagnostic.code),
    ["COMPILER_REVIEW_REQUIRES_EXECUTION_BINDING"]
  );
});
