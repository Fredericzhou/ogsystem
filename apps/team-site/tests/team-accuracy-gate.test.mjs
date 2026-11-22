import assert from "node:assert/strict";
import test from "node:test";
import { createTeamLifecycleUseCases } from "../application/team-lifecycle-use-cases.mjs";
import { validateRolePackageManifest } from "../../../dist/runtime/role-repo.js";

function createHarness() {
  let roleContractComplete = true;
  let roleContractValid = true;
  let project = {
    projectId: "management-consulting-v1",
    teamVersionId: "management-consulting-v1",
    teamRootId: "management-consulting",
    source: "classic-template",
    caseId: "management-consulting",
    name: "管理咨询交付",
    teamVersionStatus: "draft",
    workdir: "/tmp/management-consulting-v1"
  };
  let review = null;
  const projectStore = {
    async getProject() { return project; },
    async listProjects() { return [project]; },
    async createProject() { throw new Error("not used"); },
    async removeProject() { throw new Error("not used"); },
    async saveProjectMetadata(_projectId, next) { project = next; return project; },
    async withProjectWriteLock(_projectId, _operation, action) { return action(); }
  };
  const useCases = createTeamLifecycleUseCases({
    projectStore,
    packageStore: {
      async exportTeamPackage() {
        return { team: { executableFiles: [{
          path: "og-roles/roles/lead/role.json",
          content: JSON.stringify({
            roleId: "lead",
            roleVersion: "1.0.0",
            name: "lead",
            description: "Owns the requested decision output.",
            promptTemplate: "prompt.md",
            outputSchema: "output.schema.json",
            tags: [],
            ogsContractVersion: 2,
            schemaVersion: 2,
            purpose: "Owns the requested decision output.",
            responsibility: { kind: "atomic", owns: [], contributes: ["content"], doesNotOwn: [] },
            inputs: { preconditions: roleContractComplete ? [{ op: roleContractValid ? "exists" : "unknown", args: [{ kind: "path", root: "role", path: ["input"] }] }] : [] },
            outputs: { postconditions: roleContractComplete ? [{ op: "exists", args: [{ kind: "path", root: "role", path: ["output"] }] }] : [], decisionCriteria: [] },
            authority: { controlActions: [] },
            constraints: { writableStateFields: [] },
            failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
            audit: { requiredFields: [] }
          })
        }] } };
      },
      async loadTeamPackage() {}
    },
    locks: {
      async withTeamVersionLock(_id, action) { return action(); },
      async withWorkspaceBindingLock(_id, action) { return action(); }
    },
    confirmation: {
      async computeDigests() { return { projectDigest: "project-digest", teamCoreDigest: "team-digest", teamDigestVersion: 2 }; },
      async validateTopology() {}
    },
    releaseEvidence: {
      async validateTrainingEvidence() {
        return { passedScenarioEvidence: { "classic-management-consulting": "simulation-1" } };
      },
      async prepareBuiltInTeamVersion() {}
    },
    caseMaterializer: { async isCurrent() { return true; } },
    accuracyReviewStore: {
      async readTeamAccuracyReview() { return review; },
      async saveTeamAccuracyReview({ review: next }) { review = next; return review; }
    },
    rolePackageValidator: { validateManifest: validateRolePackageManifest },
    caseCatalog: {
      getCase() {
        return { title: { "zh-CN": "管理咨询交付" }, detail: { scenario: { "zh-CN": "形成一份决策简报。" } } };
      },
      listCases() { return []; }
    }
  });
  return {
    useCases,
    getProject: () => project,
    setRoleContractComplete(value) { roleContractComplete = value; },
    setRoleContractValid(value) { roleContractValid = value; }
  };
}

const criteria = Object.fromEntries([
  "responsibilities", "authority", "inputs", "handoffs", "tools", "completion", "outputs"
].map((key) => [key, true]));

test("built-in TeamVersions still require an explicit current-digest accuracy review", async () => {
  const harness = createHarness();

  await assert.rejects(
    () => harness.useCases.trainTeamVersion("management-consulting-v1"),
    /TEAM_ACCURACY_REVIEW_REQUIRED/
  );

  const readiness = await harness.useCases.getTeamTrainingReadiness("management-consulting-v1");
  assert.equal(readiness.ready, false);
  assert.equal(readiness.accuracyReady, false);

  await assert.rejects(
    () => harness.useCases.saveTeamAccuracyReview("management-consulting-v1", {
      reviewer: "workflow-operator",
      representativeTask: "Assess market entry options and produce an evidence-backed brief.",
      criteria,
      notes: "Reviewed the team but did not attach a Sandbox run."
    }),
    /TEAM_ACCURACY_REVIEW_INVALID/
  );

  await harness.useCases.saveTeamAccuracyReview("management-consulting-v1", {
    reviewer: "workflow-operator",
    representativeTask: "Assess market entry options and produce an evidence-backed brief.",
    baselineEvidence: { "classic-management-consulting": "simulation-for-another-digest" },
    criteria,
    notes: "Reviewed a Sandbox run from a different TeamVersion digest."
  });
  await assert.rejects(
    () => harness.useCases.trainTeamVersion("management-consulting-v1"),
    /TEAM_ACCURACY_REVIEW_REQUIRED/
  );

  await harness.useCases.saveTeamAccuracyReview("management-consulting-v1", {
    reviewer: "workflow-operator",
    representativeTask: "Assess market entry options and produce an evidence-backed brief.",
    baselineEvidence: { "classic-management-consulting": "simulation-1" },
    criteria,
    notes: "Observed each specialist handoff and corrected the executive brief acceptance criteria."
  });

  const trained = await harness.useCases.trainTeamVersion("management-consulting-v1");
  assert.equal(trained.teamVersionStatus, "trained");
  assert.equal(trained.teamCoreDigest, "team-digest");
});
test("using a built-in draft routes to the review gate instead of mounting an untrained version", async () => {
  const harness = createHarness();
  const draft = await harness.useCases.createClassicTeamProject({ caseId: "management-consulting" });
  assert.equal(draft.teamVersionStatus, "draft");
  assert.equal(draft.projectId, "management-consulting-v1");
});

test("TeamVersion training rejects empty machine Role Contract semantics", async () => {
  const harness = createHarness();
  harness.setRoleContractComplete(false);
  await assert.rejects(
    () => harness.useCases.trainTeamVersion("management-consulting-v1"),
    /TEAM_ROLE_CONTRACT_INCOMPLETE:.*lead:inputs\.preconditions.*lead:outputs/
  );
  const readiness = await harness.useCases.getTeamTrainingReadiness("management-consulting-v1");
  assert.equal(readiness.ready, false);
  assert.equal(readiness.roleContractReady, false);
  assert.equal(readiness.baselineReady, true);
  assert.deepEqual(readiness.roleContractIssues, ["lead:inputs.preconditions", "lead:outputs"]);
});

test("TeamVersion training rejects malformed Role Contract conditions", async () => {
  const harness = createHarness();
  harness.setRoleContractValid(false);
  await assert.rejects(
    () => harness.useCases.trainTeamVersion("management-consulting-v1"),
    /TEAM_ROLE_CONTRACT_INCOMPLETE:.*lead:invalid-contract/
  );
  const readiness = await harness.useCases.getTeamTrainingReadiness("management-consulting-v1");
  assert.equal(readiness.roleContractReady, false);
  assert.deepEqual(readiness.roleContractIssues, ["lead:invalid-contract"]);
});
