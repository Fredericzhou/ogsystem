import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFileTeamDesignAssetStore } from "../infrastructure/file-team-design-asset-store.mjs";

async function fixture() {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-team-v2-assets-"));
  await mkdir(join(workdir, ".ogs"), { recursive: true });
  await mkdir(join(workdir, "og-roles", "roles", "writer"), { recursive: true });
  await writeFile(join(workdir, ".ogs", "runtime.json"), JSON.stringify({ roleRepo: "./og-roles" }), "utf8");
  await writeFile(join(workdir, ".ogs", "execution-bindings.json"), JSON.stringify({
    ogsContractVersion: 2,
    schemaVersion: 1,
    harnessTemplates: {
      writer: {
        ogsContractVersion: 2,
        schemaVersion: 1,
        templateId: "writer",
        backend: "codex",
        model: "gpt-6-luna",
        allowedTools: ["exec_command"],
        environment: { filesystem: "staged", process: "allow", network: "deny" }
      }
    },
    roles: { writer: { kind: "harness", harnessTemplate: "writer" } }
  }), "utf8");
  return workdir;
}

test("Team design assets expose v2 Harness bindings and reject v1 execution assets", async () => {
  const workdir = await fixture();
  try {
    const store = createFileTeamDesignAssetStore();
    const assets = await store.readAssets({ workdir, roleIds: ["writer"] });
    assert.equal(assets.executionBindings.ogsContractVersion, 2);
    assert.equal(assets.executionBindings.harnessTemplates.writer.backend, "codex");
    assert.equal("executionConfig" in assets, false);

    await writeFile(join(workdir, "profiles.json"), "[]", "utf8");
    await assert.rejects(store.readAssets({ workdir, roleIds: ["writer"] }), /V2_LEGACY_EXECUTION_ASSET/);
    await assert.rejects(
      store.saveAssets({ workdir, roleIds: ["writer"], assets: { executionConfig: { profiles: [], tools: { tools: [] } } } }),
      /V2_LEGACY_EXECUTION_CONFIG/
    );
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
