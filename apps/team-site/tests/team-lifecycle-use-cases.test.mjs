import assert from "node:assert/strict";
import test from "node:test";
import { createTeamLifecycleUseCases } from "../application/team-lifecycle-use-cases.mjs";

function setup({ projects = [], team, loaded = { validation: { ok: true } }, releaseEvidence, teamIrRelease, caseMaterializer } = {}) {
  const calls = [];
  const created = [];
  const store = {
    async getProject(id) { calls.push(["get", id]); return id === team?.projectId ? team : [...projects, ...created].find((item) => item.projectId === id); },
    async listProjects() { return projects; },
    async createProject(input) {
      calls.push(["create", input]);
      const project = { projectId: `new-${created.length + 1}`, workdir: `/tmp/new-${created.length + 1}`, ...input };
      created.push(project);
      return project;
    },
    async saveProjectMetadata(id, metadata) { calls.push(["save", id, metadata]); return { ...metadata, projectId: id }; },
    async withProjectWriteLock(_id, _operation, action) { return action(); },
    async removeProject(id) { calls.push(["remove", id]); },
  };
  const packageStore = {
    async exportTeamPackage(workdir) { calls.push(["export", workdir]); return { bundle: true }; },
    async loadTeamPackage(input) { calls.push(["load", input]); return loaded; }
  };
  const caseSpec = { id: "sample", title: { "zh-CN": "Sample Team" }, detail: { scenario: { "zh-CN": "Scenario" } } };
  const useCases = createTeamLifecycleUseCases({
    projectStore: store,
    packageStore,
    locks: {
      withWorkspaceBindingLock: (action) => action(),
      withTeamVersionLock: (_teamId, action) => { calls.push(["team-version-lock", _teamId]); return action(); }
    },
    confirmation: {
      async validateTopology() {},
      async computeDigests() { return { projectDigest: "digest", teamCoreDigest: "core", teamDigestVersion: 3 }; },
      async computeTopologyDigest() { return "core"; }
    },
    releaseEvidence: releaseEvidence || {
      async validateTeamIrReleaseEvidence(input) { calls.push(["release-evidence-v2", input]); return { ok: true }; },
      async prepareBuiltInTeamVersion(team, options) { calls.push(["prepare-built-in", team.projectId, options]); }
    },
    teamIrRelease: teamIrRelease || {
      async getTeamIrReleaseSnapshot(teamVersionId) {
        calls.push(["team-ir-compile", teamVersionId]);
        return { teamVersionId, teamIrSemanticDigest: "a".repeat(64), compiledPlanDigest: "b".repeat(64), compilerSemanticsVersion: "team-ir-v2/1" };
      },
      async copyTeamIr(sourceId, destinationWorkdir) { calls.push(["team-ir-copy", sourceId, destinationWorkdir]); return { copied: true }; }
    },
    caseMaterializer,
    caseCatalog: { getCase: (id) => id === "sample" ? caseSpec : undefined, listCases: () => [caseSpec] },
    assertTrustedTeamTopology: (value) => value.source === "classic"
  });
  return { calls, created, useCases };
}

test("Team lifecycle does not clone TeamVersions into Project workspaces", async () => {
  const harness = setup();
  assert.equal(harness.useCases.createProjectWorkspace, undefined);
  assert.equal(typeof harness.useCases.createProjectWorkspace, "undefined");
});

test("Team draft creation uses the Team lifecycle contract and normalizes supported fields", async () => {
  const harness = setup();
  const draft = await harness.useCases.createTeamDraft({ name: "  Support Team  ", overview: "  Coordinate support.  ", locale: "en" });
  assert.equal(draft.projectId, "new-1");
  assert.deepEqual(harness.calls.find(([kind]) => kind === "create")[1], {
    name: "Support Team", overview: "Coordinate support.", templateId: "empty", source: "team-factory", locale: "en"
  });
  await assert.rejects(() => harness.useCases.createTeamDraft({ name: "   " }), /TEAM_NAME_REQUIRED/);
});

test("TeamVersion fork numbers the next immutable version and imports into an empty workspace", async () => {
  const source = { projectId: "team-v1", workdir: "/teams/team-v1", name: "Research", templateId: "classic:software-team", teamId: "team-root", teamVersionId: "team-v1", teamVersionStatus: "released" };
  const harness = setup({ team: source, projects: [source, { projectId: "team-v2", teamId: "team-root", teamVersionNumber: 2 }] });
  const fork = await harness.useCases.forkTeamVersion("team-v1");
  assert.equal(fork.teamVersionNumber, 3);
  assert.equal(fork.parentTeamVersionId, "team-v1");
  assert.deepEqual(harness.calls.find(([name]) => name === "team-ir-copy"), ["team-ir-copy", "team-v1", "/tmp/new-1"]);
  assert.equal(harness.calls.find(([name]) => name === "create")[1].templateId, "empty");
  assert.equal(fork.templateId, "classic:software-team");
  await harness.useCases.releaseTeamVersion("team-v2");
  assert.equal(harness.calls.at(-1)[0], "save");
  assert.equal(harness.calls.at(-1)[2].teamVersionStatus, "released");
});

test("v2 Team release skips Mermaid topology trust and requires digest-bound v2 evidence", async () => {
  const validation = [];
  const evidenceCalls = [];
  let topologyDigest = "graph-v1";
  const source = {
    projectId: "classic-v1", workdir: "/teams/classic-v1", name: "Classic", teamId: "classic-root",
    teamVersionId: "classic-v1", teamVersionStatus: "released", source: "classic", caseId: "software-team", teamCoreDigest: "core-v1"
  };
  const harness = setup({ team: source });
  harness.useCases = createTeamLifecycleUseCases({
    projectStore: {
      async getProject(id) {
        return id === "classic-v1" ? source : harness.created.find((project) => project.projectId === id);
      },
      async listProjects() { return [source, ...harness.created]; },
      async createProject(input) {
        const project = { projectId: "classic-v2", workdir: "/teams/classic-v2", ...input };
        harness.created.push(project);
        return project;
      },
      async saveProjectMetadata(id, metadata) {
        const saved = { ...metadata, projectId: id };
        const index = harness.created.findIndex((project) => project.projectId === id);
        if (index >= 0) harness.created[index] = saved;
        return saved;
      },
      async removeProject() {},
      async withProjectWriteLock(_id, _operation, action) { return action(); }
    },
    packageStore: { async exportTeamPackage() { return {}; }, async loadTeamPackage() { return { validation: { ok: true } }; } },
    locks: { withWorkspaceBindingLock: (action) => action(), withTeamVersionLock: (_id, action) => action() },
    confirmation: {
      async validateTopology(project, options) { validation.push({ project, options }); },
      async computeDigests(project) {
        const digest = project.projectId === "classic-v2"
          ? (topologyDigest === "graph-v2" ? "core-v3" : project.overview === "edited" ? "core-v2" : "core-v1")
          : "core-v1";
        return { projectDigest: "digest", teamCoreDigest: digest };
      },
      async computeTopologyDigest() { return topologyDigest; }
    },
    releaseEvidence: { async validateTeamIrReleaseEvidence() { evidenceCalls.push("called"); return { ok: true }; } },
    teamIrRelease: { async getTeamIrReleaseSnapshot(teamVersionId) { return { teamVersionId, teamIrSemanticDigest: "a".repeat(64), compiledPlanDigest: "b".repeat(64), compilerSemanticsVersion: "team-ir-v2/1" }; }, async copyTeamIr() {} },
    caseCatalog: { getCase: () => undefined, listCases: () => [] }
  });

  const fork = await harness.useCases.forkTeamVersion("classic-v1");
  assert.equal(fork.caseId, "software-team");
  assert.equal(fork.trustedClassicTopologyDigest, "graph-v1");
  assert.equal(fork.parentTeamVersionId, "classic-v1");
  const unchangedReadiness = await harness.useCases.getTeamReleaseReadiness("classic-v2");
  assert.deepEqual(unchangedReadiness, {
    ok: true,
    teamVersionId: "classic-v2",
    teamCoreDigest: "core-v1",
    teamDigestVersion: undefined,
    teamIrSemanticDigest: "a".repeat(64),
    compiledPlanDigest: "b".repeat(64),
    compilerSemanticsVersion: "team-ir-v2/1",
    ready: true,
    proof: "team-ir-v2-sandbox"
  });
  assert.equal(evidenceCalls.length, 1);
  harness.created[0].overview = "edited";
  await harness.useCases.releaseTeamVersion("classic-v2");
  assert.equal(validation.length, 0);
  assert.equal(harness.created[0].trustedClassicTopologyDigest, null);
  assert.equal(evidenceCalls.length, 2);

  topologyDigest = "graph-v2";
  harness.created[0].teamVersionStatus = "draft";
  delete harness.created[0].projectStatus;
  harness.created[0].projectDigest = null;
  await harness.useCases.releaseTeamVersion("classic-v2");
  assert.equal(harness.created[0].trustedClassicTopologyDigest, null);
  assert.equal(evidenceCalls.length, 3);
});

test("forking an edited version preserves classic topology trust only while its topology digest matches", async () => {
  const source = {
    projectId: "classic-v2",
    workdir: "/teams/classic-v2",
    name: "Classic",
    teamId: "classic-root",
    teamRootId: "classic-root",
    teamVersionId: "classic-v2",
    teamVersionNumber: 2,
    teamVersionStatus: "released",
    source: "version-edit",
    caseId: "software-team",
    trustedClassicTopologyDigest: "core"
  };
  const preserved = setup({ team: source, projects: [source] });
  const fork = await preserved.useCases.forkTeamVersion("classic-v2");
  assert.equal(fork.trustedClassicTopologyDigest, "core");

  const changed = setup({ team: { ...source, trustedClassicTopologyDigest: "stale-topology" }, projects: [source] });
  const changedFork = await changed.useCases.forkTeamVersion("classic-v2");
  assert.equal(changedFork.trustedClassicTopologyDigest, null);
});

test("classic Team creation reuses a released version and provisions templates through the same flow", async () => {
  const existing = { projectId: "classic-v1", source: "classic", caseId: "sample", teamVersionStatus: "released", teamVersionNumber: 1 };
  const reuse = setup({ projects: [existing] });
  assert.equal(await reuse.useCases.createClassicTeamProject({ caseId: "sample" }), existing);
  assert.equal(reuse.created.length, 0);

  const template = setup();
  const created = await template.useCases.createClassicTeamProject({ caseId: "sample", asTemplate: true });
  assert.equal(created.source, "classic-template");
  assert.equal(template.calls.some(([name]) => name === "save"), false);
});

test("built-in template provisioning tolerates a name already owned by an existing TeamVersion", async () => {
  const useCases = createTeamLifecycleUseCases({
    projectStore: {
      async getProject() { return undefined; },
      async listProjects() { return [{ projectId: "existing", name: "Sample Team", source: "version-edit", teamVersionStatus: "draft" }]; },
      async createProject() { throw new Error("TEAM_NAME_EXISTS: a team with this name already exists."); },
      async saveProjectMetadata() {},
      async removeProject() {},
      async withProjectWriteLock(_id, _operation, action) { return action(); }
    },
    packageStore: { async exportTeamPackage() {}, async loadTeamPackage() {} },
    locks: { withWorkspaceBindingLock: (action) => action(), withTeamVersionLock: (_id, action) => action() },
    confirmation: { async validateTopology() {}, async computeDigests() { return {}; } },
    releaseEvidence: {},
    teamIrRelease: { async getTeamIrReleaseSnapshot() { throw new Error("unused"); }, async copyTeamIr() {} },
    caseCatalog: { listCases: () => [{ id: "sample" }], getCase: () => ({ id: "sample", title: { "zh-CN": "Sample Team" } }) }
  });
  assert.deepEqual(await useCases.provisionBuiltInTeamTemplates(), []);
});

test("classic template provisioning rematerializes stale generated structure", async () => {
  const template = { projectId: "classic-template-v1", workdir: "/templates/classic-v1", source: "classic-template", caseId: "sample", name: "Sample Team", teamVersionStatus: "draft" };
  const harness = setup({ projects: [template] });
  const materialized = [];
  harness.useCases = createTeamLifecycleUseCases({
    projectStore: {
      async getProject(id) { return id === template.projectId ? template : undefined; },
      async listProjects() { return [template]; },
      async createProject() { throw new Error("A current template already exists."); },
      async saveProjectMetadata(_id, metadata) { return metadata; },
      async removeProject() {},
      async withProjectWriteLock(_id, _operation, action) { return action(); }
    },
    packageStore: { async exportTeamPackage() {}, async loadTeamPackage() {} },
    locks: { withWorkspaceBindingLock: (action) => action(), withTeamVersionLock: (_id, action) => action() },
    confirmation: { async validateTopology() {}, async computeDigests() { return {}; } },
    releaseEvidence: { async validateTeamIrReleaseEvidence() { return { ok: true }; }, async prepareBuiltInTeamVersion() {} },
    teamIrRelease: { async getTeamIrReleaseSnapshot() { throw new Error("unused"); }, async copyTeamIr() {} },
    caseCatalog: { getCase: () => ({ id: "sample", title: { "zh-CN": "Sample Team" } }), listCases: () => [] },
    caseMaterializer: {
      async isCurrent() { return false; },
      async materialize(...args) { materialized.push(args); }
    }
  });

  assert.equal(await harness.useCases.createClassicTeamProject({ caseId: "sample", asTemplate: true }), template);
  assert.deepEqual(materialized, [["sample", template.workdir, "zh-CN"]]);
});

test("classic team creation publishes a refreshed current template when the released version is stale", async () => {
  const released = { projectId: "classic-v1", source: "classic", caseId: "sample", teamVersionStatus: "released", teamVersionNumber: 1 };
  const template = { projectId: "classic-template-v2", source: "classic-template", caseId: "sample", name: "Sample Team", teamVersionStatus: "draft", teamVersionNumber: 2 };
  const harness = setup({
    projects: [released, template],
    caseMaterializer: { async isCurrent() { return false; }, async materialize() {} }
  });

  const current = await harness.useCases.createClassicTeamProject({ caseId: "sample" });
  assert.equal(current.projectId, template.projectId);
  assert.equal(current.teamVersionStatus, "released");
  assert.deepEqual(harness.calls.find(([kind]) => kind === "prepare-built-in"), ["prepare-built-in", template.projectId, { caseId: "sample", prompt: "Scenario" }]);
});

test("release readiness always requires current Team IR v2 Sandbox proof", async () => {
  const unchanged = setup({ team: {
    projectId: "classic-v1",
    teamVersionId: "classic-v1",
    caseId: "software-team",
    trustedClassicTopologyDigest: "core"
  } });
  assert.deepEqual(await unchanged.useCases.getTeamReleaseReadiness("classic-v1"), {
    ok: true,
    teamVersionId: "classic-v1",
    teamCoreDigest: "core",
    teamDigestVersion: 3,
    teamIrSemanticDigest: "a".repeat(64),
    compiledPlanDigest: "b".repeat(64),
    compilerSemanticsVersion: "team-ir-v2/1",
    ready: true,
    proof: "team-ir-v2-sandbox"
  });
  assert.equal(unchanged.calls.some(([name]) => name === "release-evidence-v2"), true);

  const inherited = setup({ projects: [{ projectId: "classic-parent", teamVersionStatus: "released" }], team: {
    projectId: "classic-v1",
    teamVersionId: "classic-v1",
    caseId: "software-team",
    parentTeamVersionId: "classic-parent",
    trustedClassicTopologyDigest: "core",
  } });
  assert.deepEqual(await inherited.useCases.getTeamReleaseReadiness("classic-v1"), {
    ok: true,
    teamVersionId: "classic-v1",
    teamCoreDigest: "core",
    teamDigestVersion: 3,
    teamIrSemanticDigest: "a".repeat(64),
    compiledPlanDigest: "b".repeat(64),
    compilerSemanticsVersion: "team-ir-v2/1",
    ready: true,
    proof: "team-ir-v2-sandbox"
  });
  assert.equal(inherited.calls.some(([name]) => name === "release-evidence-v2"), true);

  const edited = setup({ team: {
    projectId: "classic-v1",
    teamVersionId: "classic-v1",
    caseId: "software-team",
    trustedClassicTopologyDigest: "stale-core"
  } });
  const readiness = await edited.useCases.getTeamReleaseReadiness("classic-v1");
  assert.equal(readiness.ready, true);
  assert.equal(readiness.proof, "team-ir-v2-sandbox");
  assert.equal(edited.calls.some(([name]) => name === "release-evidence-v2"), true);

  const failed = setup({
    team: { projectId: "classic-v1", teamVersionId: "classic-v1", caseId: "software-team", trustedClassicTopologyDigest: "core" },
    releaseEvidence: {
      async validateReleaseEvidence() { return { ok: true }; },
      async validateTeamIrReleaseEvidence() { throw new Error("TEAM_IR_V2_RELEASE_EVIDENCE_REQUIRED: compiledPlanDigest has no passing Sandbox evidence."); }
    }
  });
  const blocked = await failed.useCases.getTeamReleaseReadiness("classic-v1");
  assert.equal(blocked.ready, false);
  assert.match(blocked.reason, /TEAM_IR_V2_RELEASE_EVIDENCE_REQUIRED/);

  const legacyEvidenceOnly = setup({
    team: { projectId: "classic-v1", teamVersionId: "classic-v1", caseId: "software-team" },
    releaseEvidence: { async validateReleaseEvidence() { return { ok: true }; } }
  });
  const unavailable = await legacyEvidenceOnly.useCases.getTeamReleaseReadiness("classic-v1");
  assert.equal(unavailable.ready, false);
  assert.match(unavailable.reason, /TEAM_IR_V2_RELEASE_EVIDENCE_UNAVAILABLE/);
  await assert.rejects(legacyEvidenceOnly.useCases.releaseTeamVersion("classic-v1"), /TEAM_IR_V2_RELEASE_EVIDENCE_UNAVAILABLE/);
});

test("TeamVersion release validates its current digest and Sandbox proof under the Team lock", async () => {
  const team = {
    projectId: "team-v1", teamVersionId: "team-v1", teamRootId: "team-root",
    teamVersionStatus: "draft"
  };
  const harness = setup({ team });
  const released = await harness.useCases.releaseTeamVersion("team-v1");
  const lockIndex = harness.calls.findIndex(([name]) => name === "team-version-lock");
  const evidenceIndex = harness.calls.findIndex(([name]) => name === "release-evidence-v2");
  const saveIndex = harness.calls.findIndex(([name]) => name === "save");
  assert.deepEqual(harness.calls[lockIndex], ["team-version-lock", "team-root"]);
  assert.ok(lockIndex >= 0 && evidenceIndex > lockIndex && saveIndex > evidenceIndex);
  assert.equal(released.teamDigestVersion, 3);
  assert.equal(released.teamVersionStatus, "released");
  assert.equal(released.teamIrSemanticDigest, "a".repeat(64));
  assert.equal(released.compiledPlanDigest, "b".repeat(64));
  assert.equal(released.compilerSemanticsVersion, "team-ir-v2/1");
});

test("TeamVersion release refuses legacy or invalid IR and does not mutate release metadata", async () => {
  const team = { projectId: "team-v1", teamVersionId: "team-v1", teamVersionStatus: "draft" };
  const legacy = setup({ team, teamIrRelease: { async getTeamIrReleaseSnapshot() { throw new Error("TEAM_IR_V2_REQUIRED: rebuild this TeamVersion."); }, async copyTeamIr() {} } });
  await assert.rejects(legacy.useCases.releaseTeamVersion("team-v1"), /TEAM_IR_V2_REQUIRED/);
  assert.equal(legacy.calls.some(([name]) => name === "save"), false);

  const invalid = setup({ team, teamIrRelease: { async getTeamIrReleaseSnapshot() { throw new Error("TEAM_IR_INVALID: compile failed."); }, async copyTeamIr() {} } });
  const readiness = await invalid.useCases.getTeamReleaseReadiness("team-v1");
  assert.equal(readiness.ready, false);
  assert.match(readiness.reason, /TEAM_IR_INVALID/);
  await assert.rejects(invalid.useCases.releaseTeamVersion("team-v1"), /TEAM_IR_INVALID/);
  assert.equal(invalid.calls.some(([name]) => name === "save"), false);
});

test("released TeamVersion readiness and re-release reject changed frozen IR digests", async () => {
  const team = {
    projectId: "team-v1", teamVersionId: "team-v1", teamVersionStatus: "released",
    teamIrSemanticDigest: "c".repeat(64), compiledPlanDigest: "d".repeat(64), projectDigest: "digest", teamCoreDigest: "core"
  };
  const harness = setup({ team });
  const readiness = await harness.useCases.getTeamReleaseReadiness("team-v1");
  assert.equal(readiness.ready, false);
  assert.match(readiness.reason, /TEAM_IR_RELEASE_IMMUTABLE/);
  await assert.rejects(harness.useCases.releaseTeamVersion("team-v1"), /TEAM_IR_RELEASE_IMMUTABLE/);
  assert.equal(harness.calls.some(([name]) => name === "save"), false);
});

test("code-owned classic templates are provisioned as released TeamVersions", async () => {
  const harness = setup();
  const team = await harness.useCases.createClassicTeamProject({ caseId: "sample" });
  assert.equal(team.teamVersionStatus, "released");
  assert.equal(Object.hasOwn(team, "projectStatus"), false);
  assert.equal(team.trustedClassicTopologyDigest, null);
  assert.equal(harness.calls.some(([name]) => name === "prepare-built-in"), true);
  assert.equal(harness.calls.some(([name]) => name === "release-evidence-v2"), true);
});
