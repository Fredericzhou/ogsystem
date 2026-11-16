import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureProjectSkeleton, scaffoldProjectTemplate, syncProjectModels } from "../dist/runtime/project-lifecycle.js";

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

test("model sync refreshes the catalog without rewriting an existing Harness binding", async () => {
  const workdir = await mkdtemp(join(tmpdir(), "ogs-template-binding-freeze-"));
  try {
    await ensureProjectSkeleton({ workdir });
    await scaffoldProjectTemplate({ workdir, templateId: "minimal" });
    const bindingsPath = join(workdir, ".ogs", "execution-bindings.json");
    const before = JSON.parse(await readFile(bindingsPath, "utf8"));
    const templateId = before.defaults.harnessTemplate;
    before.harnessTemplates[templateId] = {
      ...before.harnessTemplates[templateId],
      backend: "codex",
      model: "custom/frozen-model"
    };
    await writeFile(bindingsPath, `${JSON.stringify(before)}\n`, "utf8");

    await syncProjectModels({
      workdir,
      commandRunner: async () => ({
        stdout: "openai/discovered-model\n{\"capabilities\":{\"input\":{\"text\":true},\"output\":{\"text\":true},\"toolcall\":true}}",
        exitCode: 0
      })
    });

    const after = JSON.parse(await readFile(bindingsPath, "utf8"));
    assert.equal(after.harnessTemplates[templateId].backend, "codex");
    assert.equal(after.harnessTemplates[templateId].model, "custom/frozen-model");
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});
