import assert from "node:assert/strict";
import test from "node:test";
import { createTeamDesignUseCases } from "../application/team-design-use-cases.mjs";
import { computeReleaseBaselineDigest } from "../infrastructure/package-integrity.mjs";
import { validateRoleOutputSchemaDefinition, validateRolePackageManifest, validateRolePromptTemplate, validateRoleSourceRecord } from "../../../dist/runtime/role-repo.js";
import { isRuntimeOnlyErrorEvent } from "../../../dist/runtime/error-flow-utils.js";

function setup(overrides = {}) {
  const calls = [];
  let savedAuthoring = overrides.authoring || { version: 1 };
  const team = { projectId: "team-v1", teamVersionId: "team-v1", teamRootId: "team-root", projectType: "team", teamVersionStatus: "draft", projectDigest: "digest-1", workdir: "/teams/team-v1" };
  const useCases = createTeamDesignUseCases({
    teamCatalog: {
      getTeamVersion: async (id) => { calls.push(["get", id]); return { ...team, ...(overrides.team || {}) }; },
      assertTeamNameAvailable: async (...args) => { calls.push(["assertName", ...args]); }
    },
    withTeamVersionLock: async (id, action) => { calls.push(["lock", id]); return action(); },
    teamMetadataStore: { saveTeamMetadata: async (id, metadata) => (calls.push(["metadata", id, metadata]), metadata) },
    designStore: {
      saveAuthoring: async ({ workdir, authoring }) => { calls.push(["save", workdir, authoring]); savedAuthoring = authoring; return { validation: { ok: true } }; },
      saveSystemSource: async ({ workdir, systemSource }) => { calls.push(["saveSource", workdir, systemSource]); return { validation: { ok: true } }; }
    },
    designProjector: { project: async (current) => ({ projectId: current.projectId, systemSource: "flowchart TD", authoring: savedAuthoring, viewModel: {} }) },
    designSerializer: { serialize: () => "flowchart TD" },
    designValidator: { validate: async (current, body) => ({ ok: true, teamVersionId: current.teamVersionId, body }) },
    designAssetStore: {
      readAssets: async ({ workdir, roleIds }) => ({ workdir, roleIds, roles: {}, contracts: "", executionConfig: { profiles: [], tools: { tools: [] } }, modelSelection: { configVersion: "3", defaults: { backend: "codex", modelId: "gpt-6-luna" } } }),
      saveAssets: async (value) => (calls.push(["assets", value]), value.assets),
      saveImportedRoleAssets: async (value) => (calls.push(["importedAssets", value]), value)
    },
    packageIntegrity: { computeReleaseBaselineDigest },
    rolePackageValidator: {
      validateManifest: validateRolePackageManifest,
      validatePrompt: validateRolePromptTemplate,
      validateSchema: validateRoleOutputSchemaDefinition,
      validateSource: validateRoleSourceRecord,
      isRuntimeOnlyErrorEvent
    }
  });
  return { useCases, calls, team };
}

test("Team design loads and validates only through TeamVersion ownership", async () => {
  const { useCases, team } = setup();
  const design = await useCases.getTeamDesign(team.teamVersionId, "en");
  assert.equal(design.teamVersionId, team.teamVersionId);
  assert.equal(design.teamVersionDigest, "digest-1");
  assert.equal((await useCases.validateTeamDesign(team.teamVersionId, { authoring: {} })).teamVersionId, team.teamVersionId);
});

test("Team design rejects Collaboration Projects and immutable released or archived versions", async () => {
  const collaboration = setup({ team: { projectType: "collaboration" } });
  await assert.rejects(collaboration.useCases.getTeamDesign("project-1"), /TEAM_VERSION_NOT_FOUND/);
  const released = setup({ team: { teamVersionStatus: "released" } });
  await assert.rejects(released.useCases.saveTeamDesign("team-v1", { systemSource: "flowchart TD" }), /TEAM_VERSION_IMMUTABLE/);
  const archived = setup({ team: { teamVersionStatus: "archived" } });
  await assert.rejects(archived.useCases.saveTeamDesign("team-v1", { systemSource: "flowchart TD" }), /TEAM_VERSION_IMMUTABLE/);
});

test("Team design writes lock the Team root and use TeamVersion digest concurrency", async () => {
  const { useCases, calls, team } = setup();
  const saved = await useCases.saveTeamDesign(team.teamVersionId, {
    authoring: { version: 1 },
    expectedTeamVersionDigest: "digest-1"
  });
  assert.equal(saved.teamVersionId, team.teamVersionId);
  assert.deepEqual(calls.find((call) => call[0] === "lock"), ["lock", "team-root"]);
  assert.equal(calls.some((call) => call[0] === "save"), true);
  const stale = setup();
  await assert.rejects(stale.useCases.saveTeamDesign("team-v1", {
    systemSource: "flowchart TD",
    expectedTeamVersionDigest: "stale"
  }), /TEAM_VERSION_DIGEST_CONFLICT/);
});

test("Team metadata updates lock and persist Team-owned fields while invalidating release state", async () => {
  const { useCases, calls, team } = setup();
  const updated = await useCases.updateTeamMetadata(team.teamVersionId, { name: "  Research Team  ", overview: "Updated purpose" });
  assert.deepEqual(calls.find((call) => call[0] === "lock"), ["lock", "team-root"]);
  assert.deepEqual(calls.find((call) => call[0] === "assertName"), ["assertName", "Research Team", { excludeProjectId: "team-v1", teamRootId: "team-root" }]);
  const save = calls.find((call) => call[0] === "metadata");
  assert.equal(save[1], team.teamVersionId);
  assert.equal(save[2].name, "Research Team");
  assert.equal(save[2].teamName, "Research Team");
  assert.equal(save[2].overview, "Updated purpose");
  assert.equal(save[2].teamVersionStatus, "draft");
  assert.equal(Object.hasOwn(save[2], "projectStatus"), false);
  assert.equal(save[2].projectDigest, null);
  assert.equal(save[2].releasedAt, null);
  assert.equal(updated.name, "Research Team");
});

test("Team metadata cannot modify released versions or save a blank name", async () => {
  const released = setup({ team: { teamVersionStatus: "released" } });
  await assert.rejects(released.useCases.updateTeamMetadata("team-v1", { overview: "Change" }), /TEAM_VERSION_IMMUTABLE/);
  const blank = setup();
  await assert.rejects(blank.useCases.updateTeamMetadata("team-v1", { name: "  " }), /TEAM_NAME_REQUIRED/);
  assert.equal(blank.calls.some((call) => call[0] === "metadata"), false);
});

test("Team design assets are scoped to draft roles and reject immutable versions", async () => {
  const { useCases, calls, team } = setup();
  const loaded = await useCases.getTeamDesignAssets(team.teamVersionId);
  assert.deepEqual(loaded.roleIds, []);
  await assert.rejects(useCases.saveTeamDesignAssets(team.teamVersionId, { assets: { roles: { unknown: { "prompt.md": "x" } } } }), /TEAM_ASSET_ROLE_UNKNOWN/);
  assert.equal(calls.some((call) => call[0] === "assets"), false);
  await assert.rejects(useCases.saveTeamDesignAssets(team.teamVersionId, { assets: { contracts: JSON.stringify({ version: 1, contracts: [] }) } }), /TEAM_HANDOFF_MODE_REQUIRED/);
  const released = setup({ team: { teamVersionStatus: "released" } });
  await assert.rejects(released.useCases.saveTeamDesignAssets(team.teamVersionId, { assets: { contracts: "{}" } }), /TEAM_VERSION_IMMUTABLE/);
});

test("new role assets are validated against the submitted draft before design persistence", async () => {
  const { useCases, calls, team } = setup();
  const authoring = { version: 1, system: { handoffMode: "transition" }, roles: { "new-role": { bindingKind: "noop" } } };
  await useCases.saveTeamDesignAssets(team.teamVersionId, {
    authoring,
    assets: { roles: { "new-role": { "prompt.md": "New role instructions." } } }
  });
  await useCases.saveTeamDesign(team.teamVersionId, { authoring, expectedTeamVersionDigest: team.projectDigest });
  assert.deepEqual(calls.filter((call) => ["save", "assets"].includes(call[0])).map((call) => call[0]), ["assets", "save"]);
  assert.deepEqual(calls.find((call) => call[0] === "assets")[1].roleIds, ["new-role"]);
});

test("Studio persists model bindings from the same submitted authoring snapshot", async () => {
  const { useCases, calls, team } = setup();
  const authoring = {
    version: 1,
    roles: {
      analyst: { roleId: "analyst", bindingKind: "model", backend: "opencode", modelId: "big-pickle" },
      router: { roleId: "router", bindingKind: "noop" }
    }
  };
  await useCases.saveTeamDesignAssets(team.teamVersionId, { authoring, assets: {} });
  const assets = calls.find((call) => call[0] === "assets")[1].assets;
  assert.deepEqual(assets.modelSelection, {
    configVersion: "3",
    defaults: { backend: "codex", modelId: "gpt-6-luna" },
    roles: { analyst: { backend: "opencode", modelId: "big-pickle" } }
  });
});

test("Studio persists role fallback model references with an inherited or explicit primary model", async () => {
  const { useCases, calls, team } = setup();
  const authoring = {
    version: 1,
    roles: {
      inherited: { roleId: "inherited", bindingKind: "model", modelSelectionSource: "default", fallbackModelId: "codex-backup" },
      explicit: { roleId: "explicit", bindingKind: "model", backend: "claude", modelId: "sonnet", fallbackModelId: "claude-backup" }
    }
  };
  await useCases.saveTeamDesignAssets(team.teamVersionId, { authoring, assets: {} });
  const assets = calls.find((call) => call[0] === "assets")[1].assets;
  assert.deepEqual(assets.modelSelection.roles, {
    inherited: { backend: "codex", modelId: "gpt-6-luna", fallbackModelId: "codex-backup" },
    explicit: { backend: "claude", modelId: "sonnet", fallbackModelId: "claude-backup" }
  });
});

test("Studio keeps default model inheritance out of role overrides", async () => {
  const { useCases, calls, team } = setup();
  const authoring = {
    version: 1,
    roles: {
      inherited: { roleId: "inherited", bindingKind: "model", backend: "codex", modelId: "gpt-6-luna", modelSelectionSource: "default" },
      explicit: { roleId: "explicit", bindingKind: "model", backend: "opencode", modelId: "big-pickle", modelSelectionSource: "role" }
    }
  };
  await useCases.saveTeamDesignAssets(team.teamVersionId, { authoring, assets: {} });
  const assets = calls.find((call) => call[0] === "assets")[1].assets;
  assert.deepEqual(assets.modelSelection, {
    configVersion: "3",
    defaults: { backend: "codex", modelId: "gpt-6-luna" },
    roles: { explicit: { backend: "opencode", modelId: "big-pickle" } }
  });
});

test("source role copy requires Team graph events and records explicit confirmation", async () => {
  const authoring = {
    version: 1,
    roles: { analyst: { roleId: "analyst", bindingKind: "noop" } },
    flows: { done: { fromRoleId: "analyst", toRoleId: "__system_end__", eventType: "DONE" } }
  };
  const { useCases, calls, team } = setup({ authoring });
  const converted = {
    source: { sourceId: "agency-agents", gitUrl: "https://github.com/msitarzewski/agency-agents", commit: "a".repeat(40), path: "engineering/frontend.md", adapterId: "agency-agents-markdown", adapterVersion: "1", language: "en", sourceContentDigest: "b".repeat(64) },
    verification: { status: "unverified" },
    files: {
      "agent.md": "Instructions",
      "prompt.md": "{{agent}} {{task}}",
      "role.json": JSON.stringify({ roleId: "analyst", roleVersion: "source-test", name: "Analyst", description: "Review provided material", promptTemplate: "prompt.md", outputSchema: "output.schema.json", contractVersion: 1, purpose: "Perform the assigned analytical responsibility", responsibility: { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] }, inputs: { preconditions: [] }, outputs: { events: [], postconditions: [] }, authority: { controlActions: [] }, constraints: { writableStateFields: [], allowedTools: [] }, failure: { retryableErrorCodes: [], terminalErrorCodes: [] }, audit: { requiredFields: [] } }),
      "output.schema.json": JSON.stringify({ type: "object", properties: { event: { type: "string" } } }),
      "source.json": JSON.stringify({ version: 1, sourceId: "agency-agents", gitUrl: "https://github.com/msitarzewski/agency-agents", commit: "a".repeat(40), path: "engineering/frontend.md", adapterId: "agency-agents-markdown", adapterVersion: "1", language: "en", sourceContentDigest: "b".repeat(64), importedAt: "2026-10-27T00:00:00.000Z" })
    }
  };
  const sourceVersion = { ...converted.source, sourceDigest: converted.source.sourceContentDigest };
  await assert.rejects(useCases.copyRoleSourceToDraft({ teamVersionId: team.teamVersionId, roleId: "analyst", converted, sourceVersion, events: [], allowedTools: [], identityConfirmed: true }), /TEAM_SOURCE_EVENTS_MISMATCH/);
  await useCases.copyRoleSourceToDraft({ teamVersionId: team.teamVersionId, roleId: "analyst", converted, sourceVersion, events: ["DONE"], allowedTools: [], identityConfirmed: true });
  const saved = calls.find((call) => call[0] === "importedAssets")[1];
  const role = JSON.parse(saved.files["role.json"]);
  const source = JSON.parse(saved.files["source.json"]);
  assert.deepEqual(role.outputs.events, ["DONE"]);
  assert.deepEqual(role.constraints.allowedTools, []);
  assert.equal(source.verification.status, "verified");
});

test("source role copy can preserve an unverified Draft while confirmation is incomplete", async () => {
  const authoring = { version: 1, roles: { analyst: { roleId: "analyst", bindingKind: "noop" } }, flows: {} };
  const { useCases, calls, team } = setup({ authoring });
  const converted = {
    source: { sourceId: "agency-agents", gitUrl: "https://github.com/msitarzewski/agency-agents", commit: "a".repeat(40), path: "engineering/frontend.md", adapterId: "agency-agents-markdown", adapterVersion: "1", language: "en", sourceContentDigest: "b".repeat(64) },
    verification: { status: "unverified" },
    files: {
      "agent.md": "Instructions", "prompt.md": "{{agent}} {{task}}",
      "role.json": JSON.stringify({ roleId: "analyst", outputs: { events: [] }, constraints: { allowedTools: [] } }),
      "output.schema.json": JSON.stringify({ type: "object", properties: { event: { type: "string" } } }),
      "source.json": JSON.stringify({ version: 1, sourceId: "agency-agents", commit: "a".repeat(40), path: "engineering/frontend.md" })
    }
  };
  await useCases.copyRoleSourceToDraft({ teamVersionId: team.teamVersionId, roleId: "analyst", converted, sourceVersion: { ...converted.source, sourceDigest: converted.source.sourceContentDigest } });
  const saved = calls.find((call) => call[0] === "importedAssets")[1];
  assert.equal(JSON.parse(saved.files["source.json"]).verification.status, "unverified");
});
