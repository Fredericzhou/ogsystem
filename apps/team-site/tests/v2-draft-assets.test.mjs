import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initializeV2TeamDraftAssets } from "../infrastructure/v2-team-draft-asset-initializer.mjs";
import { validateSystemDesign } from "../../../dist/design/change-set.js";

test("new Team drafts are initialized as loadable V2 Harness projects", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-v2-team-draft-"));
  try {
    await initializeV2TeamDraftAssets({ workdir }, "zh-CN");
    const bindings = JSON.parse(await readFile(join(workdir, ".ogs", "execution-bindings.json"), "utf8"));
    const runtime = JSON.parse(await readFile(join(workdir, ".ogs", "runtime.json"), "utf8"));
    const manifest = JSON.parse(await readFile(join(workdir, "team-roles", "roles", "owner", "role.json"), "utf8"));
    const design = JSON.parse(await readFile(join(workdir, "system.design.json"), "utf8"));
    assert.equal(bindings.ogsContractVersion, 2);
    assert.equal(bindings.defaults.harnessTemplate, "harness.team.factory.default");
    assert.deepEqual(bindings.harnessTemplates[bindings.defaults.harnessTemplate].allowedTools, ["apply_patch", "exec_command"]);
    assert.equal(bindings.harnessTemplates[bindings.defaults.harnessTemplate].environment.filesystem, "staged");
    assert.equal(bindings.harnessTemplates[bindings.defaults.harnessTemplate].environment.process, "allow");
    assert.equal(runtime.roleRepo, "team-roles");
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.outputs.events, undefined);
    assert.match(await readFile(join(workdir, "system.mmd"), "utf8"), /system\.version=2\.0\.0/);
    assert.deepEqual(validateSystemDesign(design), { ok: true, diagnostics: [], design });
    assert.equal(design.seats.owner.rolePackageRef, "owner");
    assert.deepEqual(design.seats.owner.binding, bindings.roles.owner);
    assert.deepEqual(design.bindings.owner, bindings.roles.owner);
    assert.deepEqual(design.transitions.map(({ fromSeatId, toSeatId, eventType }) => [fromSeatId, toSeatId, eventType]), [
      ["__system_start__", "owner", "START"],
      ["owner", "__system_end__", "READY"]
    ]);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
