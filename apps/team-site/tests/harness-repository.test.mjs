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

test("Harness verification checks the discovered tool set without invoking a model", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-harness-repository-"));
  try {
    const repository = createFileHarnessRepositoryStore({ path: join(root, "harness-repository.json") });
    const modelCatalog = {
      discoverBackend: async () => ({
        source: { backend: "codex", status: "runnable" },
        models: [{ modelId: "gpt-6-luna", status: "active" }],
        nativeTools: { status: "ready", verifiedTools: ["apply_patch", "exec_command"] }
      })
    };
    let probes = 0;
    const backendRegistry = {
      getAdapter: () => ({
        getResourceCapabilities: () => ({ filesystem: true, process: true, network: false }),
        discoverNativeTools: async () => ({ verifiedTools: ["apply_patch", "exec_command"] })
      }),
      listDescriptors: () => []
    };
    const useCases = createHarnessRepositoryUseCases({
      repository,
      modelCatalog,
      backendRegistry,
      computeDigest: (value) => JSON.stringify(value),
      validateContract: async () => undefined,
      probeModelAvailability: async () => { probes += 1; throw new Error("model prompt must not run"); },
      workdir: root
    });
    await useCases.saveTemplate({ template: { ...template(), allowedTools: ["apply_patch"] } });
    const verified = await useCases.verifyTemplate("harness.test");
    assert.equal(verified.status, "verified");
    assert.equal(probes, 0);
    assert.equal(verified.verification.evidence.checks.at(-1).name, "model-catalog");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Harness discovery distinguishes tool visibility from tool restriction", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-harness-repository-"));
  try {
    const repository = createFileHarnessRepositoryStore({ path: join(root, "harness-repository.json") });
    const modelCatalog = {
      discoverBackend: async () => ({
        source: { backend: "codex", status: "runnable" },
        models: [{ modelId: "gpt-6-luna", status: "active" }]
      })
    };
    const backendRegistry = {
      getAdapter: () => ({
        nativeToolsConfigurable: false,
        getResourceCapabilities: () => ({ filesystem: true, process: true, network: false }),
        discoverNativeTools: async () => ({ verifiedTools: ["apply_patch", "exec_command"] })
      }),
      listDescriptors: () => []
    };
    const useCases = createHarnessRepositoryUseCases({
      repository,
      modelCatalog,
      backendRegistry,
      computeDigest: (value) => JSON.stringify(value),
      validateContract: async () => undefined,
      workdir: root
    });
    const discovery = await useCases.discoverBackend("codex", false, "gpt-6-luna");
    assert.deepEqual(discovery.nativeTools, {
      status: "ready",
      verifiedTools: ["apply_patch", "exec_command"],
      configurable: false
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Harness verification checks requested reasoning against the discovered model capability", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-harness-repository-"));
  try {
    const repository = createFileHarnessRepositoryStore({ path: join(root, "harness-repository.json") });
    const modelCatalog = {
      discoverBackend: async () => ({
        source: { backend: "codex", status: "runnable" },
        models: [{ modelId: "gpt-6-luna", status: "active", reasoning: { supported: true, kind: "effort", levels: ["low", "medium"], default: "medium" } }]
      })
    };
    const backendRegistry = {
      getAdapter: () => ({ getResourceCapabilities: () => ({ filesystem: true, process: true, network: false }), discoverNativeTools: async () => ({ verifiedTools: [] }) }),
      listDescriptors: () => []
    };
    const useCases = createHarnessRepositoryUseCases({ repository, modelCatalog, backendRegistry, computeDigest: (value) => JSON.stringify(value), validateContract: async () => undefined, workdir: root });
    await useCases.saveTemplate({ template: { ...template(), reasoningEffort: "high" } });
    await assert.rejects(useCases.verifyTemplate("harness.test"), (failure) => failure?.code === "HARNESS_REASONING_UNSUPPORTED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
