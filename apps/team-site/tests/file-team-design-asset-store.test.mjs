import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileTeamDesignAssetStore } from "../infrastructure/file-team-design-asset-store.mjs";

test("TeamVersion design assets persist role packages and handoff contracts in the Team workspace", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-team-assets-"));
  t.after(() => rm(workdir, { recursive: true, force: true }));
  const store = createFileTeamDesignAssetStore();
  const saved = await store.saveAssets({
    workdir,
    roleIds: ["analyst"],
    assets: {
      roles: { analyst: { "prompt.md": "Analyze the supplied material.", "role.json": JSON.stringify({ roleId: "analyst" }), "output.schema.json": JSON.stringify({ type: "object" }) } },
      contracts: JSON.stringify({ version: 1, contracts: [] })
    }
  });
  assert.equal(saved.roles.analyst["prompt.md"], "Analyze the supplied material.");
  assert.deepEqual(JSON.parse(await readFile(join(workdir, "og-roles", "roles", "analyst", "output.schema.json"), "utf8")), { type: "object" });
  assert.deepEqual(JSON.parse(await readFile(join(workdir, ".ogs", "contracts", "handoff.json"), "utf8")), { version: 1, contracts: [] });
});

test("TeamVersion model bindings persist in the executable model-selection asset and reload", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-team-model-selection-"));
  t.after(() => rm(workdir, { recursive: true, force: true }));
  const store = createFileTeamDesignAssetStore();
  const selection = {
    configVersion: "2",
    defaults: { backend: "codex", modelId: "gpt-6-luna" },
    roles: { analyst: { backend: "opencode", modelId: "big-pickle" } }
  };
  const saved = await store.saveAssets({ workdir, roleIds: ["analyst"], assets: { modelSelection: selection } });
  assert.equal(saved.modelSelection.configVersion, "2");
  assert.equal(saved.modelSelection.defaults.modelId, "gpt-6-luna");
  assert.equal(saved.modelSelection.roles.analyst.backend, "opencode");
  assert.equal(saved.modelSelection.roles.analyst.modelId, "big-pickle");
  assert.deepEqual(JSON.parse(await readFile(join(workdir, ".ogs", "model-selection.json"), "utf8")), selection);
});

test("release baseline scenarios persist as TeamVersion assets and reject linked paths", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-team-baselines-"));
  t.after(() => rm(workdir, { recursive: true, force: true }));
  const store = createFileTeamDesignAssetStore();
  const scenarios = [{ scenarioId: "release-smoke", revision: 1, expectedRoleIds: ["analyst"], outputSchema: { type: "object" } }];
  assert.deepEqual(await store.saveReleaseBaselineScenarios({ workdir, scenarios }), scenarios);
  assert.deepEqual(JSON.parse(await readFile(join(workdir, ".ogs", "release-baselines.json"), "utf8")), scenarios);

  const outside = await mkdtemp(join(tmpdir(), "ogs-team-baselines-outside-"));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await rm(join(workdir, ".ogs"), { recursive: true, force: true });
  await symlink(outside, join(workdir, ".ogs"), "junction");
  await assert.rejects(store.saveReleaseBaselineScenarios({ workdir, scenarios: [] }), /TEAM_ASSET_PATH_UNSAFE/);
});

test("TeamVersion design assets follow the configured role repository", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-team-assets-role-repo-"));
  t.after(() => rm(workdir, { recursive: true, force: true }));
  await mkdir(join(workdir, ".ogs"), { recursive: true });
  await writeFile(join(workdir, ".ogs", "runtime.json"), JSON.stringify({ roleRepo: "team-roles" }), "utf8");
  const store = createFileTeamDesignAssetStore();
  const saved = await store.saveAssets({
    workdir,
    roleIds: ["analyst"],
    assets: { roles: { analyst: { "prompt.md": "Configured repository prompt." } } }
  });
  assert.equal(saved.roles.analyst["prompt.md"], "Configured repository prompt.");
  assert.equal(await readFile(join(workdir, "team-roles", "roles", "analyst", "prompt.md"), "utf8"), "Configured repository prompt.");
  await assert.rejects(readFile(join(workdir, "og-roles", "roles", "analyst", "prompt.md"), "utf8"), { code: "ENOENT" });
});

test("TeamVersion design assets reject unsafe ids and malformed JSON before writing", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-team-assets-invalid-"));
  t.after(() => rm(workdir, { recursive: true, force: true }));
  const store = createFileTeamDesignAssetStore();
  await assert.rejects(store.saveAssets({ workdir, roleIds: ["../outside"], assets: { roles: { "../outside": { "prompt.md": "x" } } } }), /TEAM_ASSET_PATH_INVALID/);
  await assert.rejects(store.saveAssets({ workdir, roleIds: ["analyst"], assets: { roles: { analyst: { "role.json": "not json" } } } }), /TEAM_ASSET_INVALID_JSON/);
  assert.deepEqual(await store.readAssets({ workdir, roleIds: ["analyst"] }), { roles: { analyst: { "agent.md": "", "prompt.md": "", "role.json": "", "output.schema.json": "" } }, contracts: "", contractSchemas: {}, executionConfig: { profiles: [], tools: { tools: [] } }, modelSelection: { configVersion: "2" } });
});

test("TeamVersion execution profiles and tools persist validated runtime configuration", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-team-assets-execution-config-"));
  t.after(() => rm(workdir, { recursive: true, force: true }));
  const store = createFileTeamDesignAssetStore();
  const config = {
    profiles: [{ profileId: "analyst-profile", toolRef: "analyst-cli", timeoutMs: 45000, maxOutputBytes: 4096 }],
    tools: { tools: [{ toolRef: "analyst-cli", runner: "local_shell", command: "node", argsTemplate: ["./tools/analyze.mjs", "--json"], stdinMode: "text" }] }
  };
  const saved = await store.saveAssets({ workdir, roleIds: ["analyst"], assets: { executionConfig: config } });
  assert.deepEqual(saved.executionConfig, config);
  assert.deepEqual(JSON.parse(await readFile(join(workdir, "profiles.json"), "utf8")), config.profiles);
  assert.deepEqual(JSON.parse(await readFile(join(workdir, "tools.json"), "utf8")), config.tools);
});

test("TeamVersion execution configuration rejects invalid runtime fields before publishing", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-team-assets-invalid-execution-config-"));
  t.after(() => rm(workdir, { recursive: true, force: true }));
  await assert.rejects(createFileTeamDesignAssetStore().saveAssets({
    workdir,
    assets: { executionConfig: { profiles: [{ profileId: "bad", toolRef: "tool", timeoutMs: -1 }], tools: { tools: [] } } }
  }));
  await assert.rejects(readFile(join(workdir, "profiles.json"), "utf8"), { code: "ENOENT" });
});

test("TeamVersion design assets reject a symlinked role directory", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ogs-team-assets-link-"));
  const outside = await mkdtemp(join(tmpdir(), "ogs-team-assets-outside-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  await mkdir(join(root, "og-roles", "roles"), { recursive: true });
  await writeFile(join(outside, "prompt.md"), "outside", "utf8");
  try { await symlink(outside, join(root, "og-roles", "roles", "analyst"), "junction"); }
  catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error?.code)) return t.skip("symlink creation is not available on this platform");
    throw error;
  }
  await assert.rejects(createFileTeamDesignAssetStore().readAssets({ workdir: root, roleIds: ["analyst"] }), /TEAM_ASSET_PATH_UNSAFE/);
});

test("TeamVersion design asset retry repairs a publish failure after one file was committed", async (t) => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-team-assets-publish-failure-"));
  t.after(() => rm(workdir, { recursive: true, force: true }));
  const assets = {
    roles: {
      analyst: {
        "prompt.md": "New prompt.",
        "role.json": JSON.stringify({ roleId: "analyst", revision: 2 }),
        "output.schema.json": JSON.stringify({ type: "object", required: ["answer"] })
      }
    }
  };
  await createFileTeamDesignAssetStore().saveAssets({
    workdir,
    roleIds: ["analyst"],
    assets: { roles: { analyst: { "prompt.md": "Old prompt.", "role.json": JSON.stringify({ roleId: "analyst" }), "output.schema.json": JSON.stringify({ type: "object" }) } } }
  });
  let publishes = 0;
  const failingStore = createFileTeamDesignAssetStore({
    publish: async (...args) => {
      publishes += 1;
      if (publishes === 2) throw new Error("injected publish interruption");
      return rename(...args);
    }
  });
  await assert.rejects(failingStore.saveAssets({ workdir, roleIds: ["analyst"], assets }), /injected publish interruption/);
  const interrupted = await createFileTeamDesignAssetStore().readAssets({ workdir, roleIds: ["analyst"] });
  assert.equal(interrupted.roles.analyst["prompt.md"], "New prompt.");
  assert.equal(interrupted.roles.analyst["role.json"], JSON.stringify({ roleId: "analyst" }));
  assert.equal(interrupted.roles.analyst["output.schema.json"], JSON.stringify({ type: "object" }));
  const retried = await createFileTeamDesignAssetStore().saveAssets({ workdir, roleIds: ["analyst"], assets });
  assert.equal(retried.roles.analyst["prompt.md"], "New prompt.");
  assert.deepEqual(JSON.parse(retried.roles.analyst["role.json"]), { roleId: "analyst", revision: 2 });
  assert.deepEqual(JSON.parse(retried.roles.analyst["output.schema.json"]), { type: "object", required: ["answer"] });
});
