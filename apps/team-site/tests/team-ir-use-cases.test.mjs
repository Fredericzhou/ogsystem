import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createTeamIrUseCases } from "../application/team-ir-use-cases.mjs";
import { createFileTeamIrStore } from "../infrastructure/file-team-ir-store.mjs";
import { teamIRSemanticDigest } from "../../../dist/team-ir/index.js";

const fixtureUrl = new URL("../../../examples/team-ir-v2/classic-software-team.json", import.meta.url);
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"));

test("Team IR use cases validate, save with semantic CAS, and read by TeamVersion", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-team-ir-api-"));
  try {
    const calls = [];
    const useCases = createTeamIrUseCases({
      teamCatalog: { getTeamVersion: async (id) => ({ teamVersionId: id, teamRootId: "team-root", projectType: "team", teamVersionStatus: "draft", workdir: root }) },
      teamIrStore: createFileTeamIrStore(),
      withTeamVersionLock: async (id, action) => (calls.push(id), action())
    });

    const checked = await useCases.validateTeamIr("team-v1", fixture);
    assert.equal(checked.ok, true);
    assert.equal(checked.semanticDigest, teamIRSemanticDigest(fixture));
    const saved = await useCases.saveTeamIr("team-v1", { teamIR: fixture, expectedSemanticDigest: null });
    assert.equal(saved.saved, true);
    assert.equal(saved.semanticDigest, checked.semanticDigest);
    assert.equal((await useCases.getTeamIr("team-v1")).semanticDigest, checked.semanticDigest);
    assert.deepEqual(calls, ["team-root"]);
    await assert.rejects(useCases.saveTeamIr("team-v1", { teamIR: fixture, expectedSemanticDigest: "stale" }), /TEAM_IR_DIGEST_CONFLICT/);
    assert.deepEqual(JSON.parse(await readFile(join(root, ".ogs", "team.ir.json"), "utf8")), fixture);

    const invalid = { ...fixture, schemaVersion: 1 };
    const rejected = await useCases.saveTeamIr("team-v1", { teamIR: invalid, expectedSemanticDigest: checked.semanticDigest });
    assert.equal(rejected.saved, false);
    assert.equal(rejected.diagnostics.some((item) => item.severity === "error"), true);
    assert.equal((await useCases.getTeamIr("team-v1")).semanticDigest, checked.semanticDigest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Team IR use cases reject collaboration projects and immutable TeamVersions", async () => {
  const base = { teamVersionId: "team-v1", workdir: "/unused", projectType: "team", teamVersionStatus: "draft" };
  let current = {};
  const useCases = createTeamIrUseCases({
    teamCatalog: { getTeamVersion: async () => ({ ...base, ...current }) },
    teamIrStore: { read: async () => ({ teamIR: null, semanticDigest: null }), save: async () => ({}) },
    withTeamVersionLock: async (_id, action) => action()
  });
  current = { projectType: "collaboration" };
  await assert.rejects(useCases.getTeamIr("team-v1"), /TEAM_VERSION_NOT_FOUND/);
  current = { projectType: "team", teamVersionStatus: "released" };
  await assert.rejects(useCases.saveTeamIr("team-v1", { teamIR: fixture, expectedSemanticDigest: null }), /TEAM_VERSION_IMMUTABLE/);
});

test("Team IR release snapshot compiles a native v2 document and rejects legacy or invalid IR", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-team-ir-release-"));
  try {
    const teamIrStore = createFileTeamIrStore();
    const useCases = createTeamIrUseCases({
      teamCatalog: { getTeamVersion: async (id) => ({ teamVersionId: id, projectType: "team", teamVersionStatus: "draft", workdir: root }) },
      teamIrStore,
      resolveTeamIrReleaseClosure: async ({ teamIR }) => ({
        complete: true,
        packageDigests: Object.fromEntries(teamIR.agents.map((agent) => [agent.packageRef, "c".repeat(64)])),
        bindingDigests: Object.fromEntries(teamIR.bindings.map((binding) => [binding.id, "d".repeat(64)])),
        schemaDigests: {},
        adapterVersions: Object.fromEntries([...new Set(teamIR.bindings.map((binding) => binding.kind))].map((kind) => [kind, "adapter/1"])),
        packageSchemas: {}
      }),
      withTeamVersionLock: async (_id, action) => action()
    });
    await assert.rejects(useCases.getTeamIrReleaseSnapshot("team-v1"), /TEAM_IR_V2_REQUIRED/);
    await teamIrStore.save({ workdir: root, teamIR: { ...fixture, schemaVersion: 1 } });
    await assert.rejects(useCases.getTeamIrReleaseSnapshot("team-v1"), /TEAM_IR_INVALID/);
    await teamIrStore.save({ workdir: root, teamIR: fixture });
    const snapshot = await useCases.getTeamIrReleaseSnapshot("team-v1");
    assert.equal(snapshot.teamIrSemanticDigest, teamIRSemanticDigest(fixture));
    assert.match(snapshot.compiledPlanDigest, /^[a-f0-9]{64}$/);
    assert.equal(snapshot.compilerSemanticsVersion, "team-ir-v2/1");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Team IR release snapshot fails closed without a complete immutable dependency resolver", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-team-ir-release-closure-"));
  try {
    const teamIrStore = createFileTeamIrStore();
    await teamIrStore.save({ workdir: root, teamIR: fixture });
    const base = {
      teamCatalog: { getTeamVersion: async (id) => ({ teamVersionId: id, projectType: "team", teamVersionStatus: "draft", workdir: root }) },
      teamIrStore,
      withTeamVersionLock: async (_id, action) => action()
    };
    await assert.rejects(createTeamIrUseCases(base).getTeamIrReleaseSnapshot("team-v1"), /TEAM_IR_RELEASE_CLOSURE_UNAVAILABLE/);
    await assert.rejects(createTeamIrUseCases({ ...base, resolveTeamIrReleaseClosure: async () => ({ complete: false }) })
      .getTeamIrReleaseSnapshot("team-v1"), /TEAM_IR_RELEASE_CLOSURE_INCOMPLETE/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Team IR file store rejects symlinked .ogs directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-team-ir-symlink-"));
  const outside = await mkdtemp(join(tmpdir(), "ogs-team-ir-outside-"));
  try {
    const { symlink } = await import("node:fs/promises");
    await symlink(outside, join(root, ".ogs"), "dir");
    await assert.rejects(createFileTeamIrStore().save({ workdir: root, teamIR: fixture }), /TEAM_IR_PATH_UNSAFE/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});
