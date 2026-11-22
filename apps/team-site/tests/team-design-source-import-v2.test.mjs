import assert from "node:assert/strict";
import test from "node:test";
import { createTeamDesignUseCases } from "../application/team-design-use-cases.mjs";

test("imported Markdown role manifests are normalized to the v2 Role Package contract", async () => {
  const team = { projectId: "team-draft", teamVersionId: "team-draft", teamRootId: "team-root", teamVersionStatus: "draft", workdir: "/teams/team-draft" };
  const source = {
    sourceId: "source-1",
    gitUrl: "https://example.test/roles",
    commit: "a".repeat(40),
    path: "roles/writer.md",
    adapterId: "markdown-role",
    adapterVersion: "1.0.0",
    language: "en",
    sourceContentDigest: "digest-1"
  };
  const roleId = "technical-writer";
  const authoring = {
    roles: { [roleId]: { roleId, bindingKind: "model" } },
    flows: {}
  };
  let savedFiles;
  const designAssetStore = {
    async readAssets() { return { roles: savedFiles ? { [roleId]: savedFiles } : {}, executionBindings: { harnessTemplates: {} } }; },
    async saveAssets() {},
    async saveImportedRoleAssets({ files }) { savedFiles = files; }
  };
  const useCases = createTeamDesignUseCases({
    teamCatalog: {
      async getTeamVersion() { return team; },
      async assertTeamNameAvailable() {}
    },
    withTeamVersionLock: async (_id, action) => action(),
    teamMetadataStore: { async saveTeamMetadata(_id, value) { return value; } },
    designStore: {
      async saveAuthoring() { return { validation: { ok: true } }; },
      async saveSystemSource() { return { validation: { ok: true } }; }
    },
    designProjector: {
      async project() { return { projectId: team.projectId, authoring, systemSource: "flowchart TD", viewModel: {} }; }
    },
    designSerializer: { serialize() { return "flowchart TD"; } },
    designValidator: { async validate() { return { ok: true }; } },
    designAssetStore,
    packageIntegrity: { computeTrainingBaselineDigest() { return "digest"; } }
  });

  await useCases.copyRoleSourceToDraft({
    teamVersionId: team.teamVersionId,
    roleId,
    converted: {
      files: {
        "agent.md": "Write clearly.",
        "prompt.md": "{{agent}} {{task}}",
        "role.json": JSON.stringify({
          roleId: "old-role-id",
          roleVersion: "source-123",
          name: "Technical Writer",
          description: "Prepares clear documentation.",
          promptTemplate: "prompt.md",
          outputSchema: "output.schema.json",
          contractVersion: 1,
          purpose: "Prepare clear documentation for the requested audience.",
          responsibility: { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] },
          inputs: { preconditions: [] },
          outputs: { events: ["READY"], postconditions: [] },
          authority: { controlActions: [] },
          constraints: { writableStateFields: [], allowedTools: [] },
          failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
          audit: { requiredFields: [] }
        }),
        "output.schema.json": JSON.stringify({ type: "object", properties: { event: { type: "string" } } }),
        "source.json": JSON.stringify(source)
      },
      source,
      verification: { status: "unverified" }
    },
    sourceVersion: { ...source, sourceDigest: source.sourceContentDigest }
  });

  const manifest = JSON.parse(savedFiles["role.json"]);
  assert.equal(manifest.roleId, roleId);
  assert.equal(manifest.ogsContractVersion, 2);
  assert.equal(manifest.schemaVersion, 2);
  assert.equal("contractVersion" in manifest, false);
  assert.equal("events" in manifest.outputs, false);
  assert.equal("allowedTools" in manifest.constraints, false);
  assert.deepEqual(manifest.outputs.decisionCriteria, []);
  assert.equal(JSON.parse(savedFiles["output.schema.json"]).properties.event.enum, undefined);
  assert.equal(JSON.parse(savedFiles["source.json"]).sourceId, source.sourceId);
});
