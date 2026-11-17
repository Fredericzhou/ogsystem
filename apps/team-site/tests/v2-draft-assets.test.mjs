import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeV2TeamDraftAssets } from "../infrastructure/v2-team-draft-asset-initializer.mjs";

test("new Team drafts are initialized as loadable V2 Harness projects", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-v2-team-draft-"));
  try {
    await initializeV2TeamDraftAssets({ workdir }, "zh-CN");
    const bindings = JSON.parse(await readFile(join(workdir, ".ogs", "execution-bindings.json"), "utf8"));
    const runtime = JSON.parse(await readFile(join(workdir, ".ogs", "runtime.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(workdir, "team-roles", "roles", "owner", "role.json"), "utf8"));
    assert.equal(bindings.ogsContractVersion, 2);
    assert.equal(bindings.defaults.harnessTemplate, "harness.team.factory.default");
    assert.deepEqual(bindings.harnessTemplates[bindings.defaults.harnessTemplate].allowedTools, ["apply_patch", "exec_command"]);
    assert.equal(bindings.harnessTemplates[bindings.defaults.harnessTemplate].environment.filesystem, "staged");
    assert.equal(bindings.harnessTemplates[bindings.defaults.harnessTemplate].environment.process, "allow");
    assert.equal(runtime.roleRepo, "team-roles");
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.outputs.events, undefined);
    assert.match(await readFile(join(workdir, "system.mmd"), "utf8"), /system\.version=2\.0\.0/);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
