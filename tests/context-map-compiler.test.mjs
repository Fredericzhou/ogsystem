import test from "node:test";
import assert from "node:assert/strict";

import { compileExecutionSnapshot } from "../dist/runtime/compiler.js";

function rolePackage(roleId) {
  return {
    manifest: {
      roleId,
      roleVersion: "2.0.0",
      name: roleId,
      description: "fixture",
      preferredModelTags: [],
      tags: [],
      schemaVersion: 2,
      purpose: "fixture",
      responsibility: "fixture",
      inputs: [],
      outputs: { postconditions: [], decisionCriteria: [] },
      authority: { controlActions: [] },
      constraints: {},
      failure: {},
      audit: {}
    },
    promptTemplate: "fixture",
    outputSchema: { type: "object" },
    agent: "fixture"
  };
}

test("compiler rejects direct context mappings without an incoming Flow", () => {
  const system = {
    systemId: "context-map.compiler",
    systemVersion: "2.0.0",
    entryRoleIds: ["entry"],
    startDispatch: { mode: "all" },
    startEventType: "START",
    terminalRoleOrder: ["entry"],
    roleIds: ["entry"],
    executionBinding: {},
    startFlows: [{ fromRoleId: "__system_start__", toRoleId: "entry", eventType: "START" }],
    flows: [],
    lawBinding: { globalLawRef: "law.test" },
    graph: {
      routingModeByRoleId: {},
      routeOrderByRoleId: {},
      joinModeByRoleId: {},
      joinSourcesByRoleId: {},
      joinMinByRoleId: {},
      contextMapByRoleId: { entry: { input: "direct.content" } },
      loopMaxByRoleId: {},
      reviewByRoleId: {}
    }
  };
  const result = compileExecutionSnapshot({
    system,
    resolvedModelsByRoleId: new Map([["entry", {
      backend: "codex",
      modelId: "gpt-6-luna",
      modelRef: "gpt-6-luna",
      bindingSource: "selection"
    }]]),
    rolePackagesByRoleId: new Map([["entry", rolePackage("entry")]]),
    effectiveLaw: {
      forbiddenToolRefs: [],
      allowNoopWithoutExecutionBinding: false,
      isolateExternalData: false
    }
  });
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.some((diagnostic) =>
    diagnostic.code === "COMPILER_CONTEXT_SOURCE_UNAVAILABLE" &&
    diagnostic.roleId === "entry" &&
    diagnostic.fieldName === "input"
  ));
});
