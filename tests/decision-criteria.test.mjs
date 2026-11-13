import test from "node:test";
import assert from "node:assert/strict";

import { validateDecisionOutput } from "../dist/runtime/decision-criteria.js";
import { validateRolePackageManifest } from "../dist/runtime/role-repo.js";

const criteria = [
  { id: "cost_limit", description: "总成本不超过预算", severity: "required", failureAction: "rework", evidenceHint: "artifacts/cost.json" },
  { id: "security", description: "没有硬性安全问题", severity: "critical", failureAction: "reject", evidenceHint: "artifacts/security.json" }
];

function output(event, overrides = {}) {
  return {
    event,
    roleId: "reviewer",
    data: {
      decisionReason: "已完成条件检查",
      criteria: [
        { id: "cost_limit", status: "pass", severity: "required", evidence: ["artifacts/cost.json"] },
        { id: "security", status: "pass", severity: "critical", evidence: ["artifacts/security.json"] }
      ],
      ...overrides
    }
  };
}

test("decision output accepts an evidence-backed approval", () => {
  assert.doesNotThrow(() => validateDecisionOutput({ ...output("APPROVED"), criteria, roleId: "reviewer" }));
});

test("decision output rejects approval with a hard failed criterion", () => {
  assert.throws(
    () => validateDecisionOutput({
      ...output("APPROVED", { criteria: [
        { id: "cost_limit", status: "pass", severity: "required", evidence: ["artifacts/cost.json"] },
        { id: "security", status: "fail", severity: "critical", evidence: ["artifacts/security.json"], reason: "硬性问题" }
      ] }),
      criteria,
      roleId: "reviewer"
    }),
    /DECISION_APPROVED_EVIDENCE_MISSING/
  );
});

test("decision output requires changes tied to a rework criterion", () => {
  assert.throws(
    () => validateDecisionOutput({
      ...output("NEEDS_REWORK", {
        criteria: [
          { id: "cost_limit", status: "fail", severity: "required", evidence: ["artifacts/cost.json"] },
          { id: "security", status: "pass", severity: "critical", evidence: ["artifacts/security.json"] }
        ],
        requiredChanges: [{ criterionId: "security", action: "补充说明" }]
      }),
      criteria,
      roleId: "reviewer"
    }),
    /DECISION_REWORK_CHANGES_UNMATCHED/
  );
  assert.doesNotThrow(() => validateDecisionOutput({
    ...output("NEEDS_REWORK", {
      criteria: [
        { id: "cost_limit", status: "fail", severity: "required", evidence: ["artifacts/cost.json"] },
        { id: "security", status: "pass", severity: "critical", evidence: ["artifacts/security.json"] }
      ],
      requiredChanges: [{ criterionId: "cost_limit", action: "降低预计成本" }]
    }),
    criteria,
    roleId: "reviewer"
  }));
});

test("role manifests accept sorted decision criteria under outputs", () => {
  assert.doesNotThrow(() => validateRolePackageManifest({
    roleId: "reviewer",
    roleVersion: "1.0.0",
    name: "Reviewer",
    description: "Reviews a result.",
    promptTemplate: "prompt.md",
    outputSchema: "output.schema.json",
    contractVersion: 1,
    purpose: "Review a result against declared quality criteria.",
    responsibility: { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] },
    inputs: { preconditions: [] },
    outputs: { events: ["APPROVED", "NEEDS_REWORK", "REJECTED"], postconditions: [], decisionCriteria: criteria.sort((a, b) => a.id.localeCompare(b.id)) },
    authority: { controlActions: [] },
    constraints: { writableStateFields: [], allowedTools: [] },
    failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
    audit: { requiredFields: [] }
  }, "reviewer/role.json"));
});
