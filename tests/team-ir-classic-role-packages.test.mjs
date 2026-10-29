import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { compileTeamIr } from "../dist/team-ir/compiler.js";
import { validateTeamIr } from "../dist/team-ir/index.js";
import { loadRolePackage } from "../dist/runtime/role-repo.js";

const fixturesDir = path.resolve("examples/team-ir-v2");
const roleRoot = path.resolve("og-roles/roles");
const addedRoleIds = new Set([
  "artifact-evidence-analyst", "artifact-evidence-editor", "cardiology-expert", "chief-reviewer", "compliance-reviewer", "consultation-dispatcher",
  "debate-host", "debate-opponent", "debate-proponent", "debate-reporter", "imaging-expert",
  "maker", "neurology-expert", "neutral-judge", "primary-reviewer", "release-gate",
  "signoff-chair", "software-implementer", "software-lead", "software-planner", "software-tester"
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function loadJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function packageDigest(roleDir) {
  const entries = (await readdir(roleDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const files = [];
  for (const name of entries) {
    files.push([name, (await readFile(path.join(roleDir, name))).toString("base64")]);
  }
  return sha256(JSON.stringify(files));
}

test("latest classic Team IR fixtures resolve immutable packaged role contracts and compile real closures", async () => {
  const files = (await readdir(fixturesDir)).filter((name) => name.endsWith(".json")).sort();
  assert.equal(files.length, 8, "classic fixture inventory must be explicit and complete");

  const packageJson = await loadJson(path.resolve("package.json"));
  const publishAllowlist = new Set(packageJson.files);
  const roleDigests = new Map();
  const referencedRoleIds = new Set();

  for (const file of files) {
    const fixture = await loadJson(path.join(fixturesDir, file));
    assert.deepEqual(validateTeamIr(fixture).filter((item) => item.severity === "error"), [], file);

    for (const agent of fixture.agents) {
      const match = /^role:(.+)@[^@]+$/.exec(agent.packageRef);
      assert.ok(match, `${file}:${agent.id} must use a versioned role package ref`);
      const roleId = match[1];
      referencedRoleIds.add(roleId);
      const roleDir = path.join(roleRoot, roleId);
      const manifest = await loadJson(path.join(roleDir, "role.json"));
      assert.equal(manifest.roleId, roleId, `${file}:${agent.id} package identity`);
      assert.ok(Array.isArray(manifest.constraints?.allowedTools), `${roleId} tool permissions must be explicit`);
      if (addedRoleIds.has(roleId)) {
        assert.deepEqual(manifest.constraints.allowedTools, [], `${roleId} must not declare tools`);
        assert.equal(manifest.roleVersion.split(".")[0], agent.packageRef.slice(agent.packageRef.lastIndexOf("@") + 1), `${roleId} version must match packageRef`);
      }
      const loaded = await loadRolePackage({ roleId, roleRootDir: roleRoot });
      assert.equal(loaded.manifest.roleId, roleId, `${roleId} must pass the production role package loader`);
      assert.equal(typeof manifest.promptTemplate, "string", `${roleId} prompt path`);
      assert.equal(typeof manifest.outputSchema, "string", `${roleId} contract path`);
      for (const name of ["agent.md", manifest.promptTemplate, manifest.outputSchema]) {
        assert.equal((await stat(path.join(roleDir, name))).isFile(), true, `${roleId}/${name}`);
      }
      const whitelistEntry = `og-roles/roles/${roleId}/**`;
      assert.ok(publishAllowlist.has(whitelistEntry), `${roleId} must ship with the published package`);
      const outputSchema = await loadJson(path.join(roleDir, manifest.outputSchema));
      assert.equal(outputSchema.type, "object", `${roleId} output contract must be a JSON object`);
      if (addedRoleIds.has(roleId)) {
        const outputSchemas = Object.values(agent.outputPorts).map((outputPort) => outputPort.dataSchema);
        const expectedSchema = outputSchemas.length === 1 ? outputSchemas[0] : { type: "object", oneOf: outputSchemas };
        assert.deepEqual(outputSchema, expectedSchema, `${roleId} contract must match its classic fixture outputs`);
      }
      roleDigests.set(agent.packageRef, await packageDigest(roleDir));
    }

    const closure = {
      packageDigests: Object.fromEntries(fixture.agents.map(({ packageRef }) => [packageRef, roleDigests.get(packageRef)])),
      bindingDigests: Object.fromEntries(fixture.bindings.map(({ id }) => [id, sha256(id)])),
      adapterVersions: Object.fromEntries([...new Set(fixture.bindings.map(({ kind }) => kind))].map((kind) => [kind, "fixture-adapter/1"]))
    };
    const plan = compileTeamIr(fixture, closure);
    const repeated = compileTeamIr(fixture, closure);
    assert.match(plan.compiledPlanDigest, /^[a-f0-9]{64}$/, file);
    assert.equal(repeated.compiledPlanDigest, plan.compiledPlanDigest, `${file} closure must be stable`);
  }

  const referenced = new Set();
  for (const file of files) {
    const fixture = await loadJson(path.join(fixturesDir, file));
    for (const agent of fixture.agents) referenced.add(agent.packageRef);
  }
  assert.equal(referenced.size, 22, "all classic fixture package references must be inventoried");
  assert.deepEqual([...addedRoleIds].sort(), [...referencedRoleIds].filter((roleId) => addedRoleIds.has(roleId)).sort());
});
