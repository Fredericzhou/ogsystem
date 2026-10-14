import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { generateDeploymentManifest } from "../dist/runtime/deployment-manifest.js";

test("deployment manifest records runtime versions and redacted semantic fingerprints", async () => {
  const manifest = await generateDeploymentManifest({
    workdir: path.resolve("examples/mulit-debate-ogs")
  });

  assert.equal(manifest.manifestVersion, 1);
  assert.equal(manifest.ogsystem.package, "ogsystem");
  assert.match(manifest.ogsystem.version, /^\d+\.\d+\.\d+/);
  assert.match(manifest.ogsystem.installedTreeSha256, /^[a-f0-9]{64}$/);
  assert.match(manifest.runtime.node, /^v\d+/);
  assert.equal(manifest.project.systemId, "investment.multi-debate");
  assert.match(manifest.fingerprints.runPlan, /^[a-f0-9]{64}$/);
  assert.ok(manifest.fingerprints.components.system);
  assert.ok(manifest.fingerprints.components.rolePackages);
  assert.ok(manifest.fingerprints.components.effectiveLaw);
  assert.doesNotMatch(JSON.stringify(manifest), /password|secret|api[_-]?key|token/i);
});
