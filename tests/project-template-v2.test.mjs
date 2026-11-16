import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureProjectSkeleton, scaffoldProjectTemplate } from "../dist/runtime/project-lifecycle.js";

test("active project templates keep model selection outside the graph source", async () => {
  for (const templateId of ["minimal", "advanced-features"]) {
    const workdir = await mkdtemp(join(tmpdir(), `ogs-template-${templateId}-`));
    try {
      await ensureProjectSkeleton({ workdir });
      await scaffoldProjectTemplate({ workdir, templateId });
      const source = await readFile(join(workdir, "system.mmd"), "utf8");
      assert.doesNotMatch(source, /model\.bind\./);
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }
});

test("active project templates persist complete v2 Harness bindings", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-template-bindings-"));
  try {
    await ensureProjectSkeleton({ workdir });
    await scaffoldProjectTemplate({ workdir, templateId: "minimal" });
    const bindings = JSON.parse(await readFile(join(workdir, ".ogs", "execution-bindings.json"), "utf8"));
    assert.equal(bindings.ogsContractVersion, 2);
    assert.equal(bindings.schemaVersion, 1);
    const templateId = bindings.defaults.harnessTemplate;
    assert.equal(bindings.harnessTemplates[templateId].backend, "codex");
    assert.equal(bindings.harnessTemplates[templateId].model, "gpt-6-luna");
    assert.deepEqual(bindings.harnessTemplates[templateId].allowedTools, []);
    assert.equal(bindings.harnessTemplates[templateId].environment.network, "deny");
    assert.ok(bindings.roles["hello-ogsystem"]);
    assert.equal(bindings.roles["hello-ogsystem"].harnessTemplate, templateId);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
