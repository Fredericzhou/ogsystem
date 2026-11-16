import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileHarnessRepositoryStore } from "../infrastructure/file-harness-repository-store.mjs";
import { createHarnessRepositoryUseCases } from "../application/harness-repository-use-cases.mjs";

const template = (templateId = "harness.test") => ({
  ogsContractVersion: 2,
  schemaVersion: 1,
  kind: "harness",
  templateId,
  backend: "codex",
  model: "gpt-6-luna",
  allowedTools: [],
  environment: { filesystem: "none", process: "deny", network: "deny", limits: { timeoutMs: 1000, maxOutputBytes: 1000 } }
});

test("Harness repository stores drafts with immutable revisions and binding rejects drafts", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-harness-repository-"));
  try {
    const repository = createFileHarnessRepositoryStore({ path: join(root, "harness-repository.json") });
    const modelCatalog = { discoverBackend: async () => ({ source: { backend: "codex", status: "runnable" }, models: [{ modelId: "gpt-6-luna", status: "active" }] }) };
    const backendRegistry = { getAdapter: () => ({ getResourceCapabilities: () => ({ filesystem: true, process: true, network: true }) }), listDescriptors: () => [] };
    const useCases = createHarnessRepositoryUseCases({ repository, modelCatalog, backendRegistry, computeDigest: (value) => JSON.stringify(value), validateContract: async () => undefined, workdir: root });
    const first = await useCases.saveTemplate({ template: template(), name: "Test" });
    assert.equal(first.status, "draft");
    assert.equal(first.revision, 1);
    await assert.rejects(useCases.bindingSnapshot("harness.test"), /HARNESS_TEMPLATE_NOT_VERIFIED/);
    const second = await useCases.saveTemplate({ template: { ...template(), preset: "safe" }, name: "Test v2" });
    assert.equal(second.revision, 2);
    assert.equal((await useCases.getTemplate("harness.test", 1)).revision, 1);
    assert.equal((await useCases.listTemplates()).length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Harness repository allows unverified tools in drafts for later verification", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-harness-repository-"));
  try {
    const repository = createFileHarnessRepositoryStore({ path: join(root, "harness-repository.json") });
    const modelCatalog = { discoverBackend: async () => ({ source: { backend: "codex", status: "runnable" }, models: [{ modelId: "gpt-6-luna", status: "active" }] }) };
    const backendRegistry = { getAdapter: () => ({ getResourceCapabilities: () => ({ filesystem: true, process: true, network: true }) }), listDescriptors: () => [] };
    const useCases = createHarnessRepositoryUseCases({ repository, modelCatalog, backendRegistry, computeDigest: (value) => JSON.stringify(value), validateContract: async () => undefined, workdir: root });
    const saved = await useCases.saveTemplate({ template: { ...template(), allowedTools: ["unknown_tool"] } });
    assert.equal(saved.status, "draft");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
