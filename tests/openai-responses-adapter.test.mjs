import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { qwenBackendAdapter } from "../dist/runtime/qwen-adapter.js";
import { kimiBackendAdapter } from "../dist/runtime/kimi-adapter.js";
import { resolveSharedResponsesConfig } from "../dist/runtime/openai-responses-adapter.js";

test("shared Responses transport reuses Codex gateway configuration", async () => {
  const previous = {
    base: process.env.OGS_OPENAI_BASE_URL,
    key: process.env.OGS_OPENAI_API_KEY,
    openaiBase: process.env.OPENAI_BASE_URL,
    openaiKey: process.env.OPENAI_API_KEY,
    codexConfig: process.env.CODEX_CONFIG_PATH,
    codexAuth: process.env.CODEX_AUTH_PATH
  };
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogs-codex-config-"));
  const configPath = path.join(tempRoot, "config.toml");
  await writeFile(configPath, [
    "[model_providers.custom]",
    'base_url = "http://127.0.0.1:43123/v1"',
    'experimental_bearer_token = "codex-test-bearer"',
    ""
  ].join("\n"), "utf8");
  for (const name of ["OGS_OPENAI_BASE_URL", "OGS_OPENAI_API_KEY", "OPENAI_BASE_URL", "OPENAI_API_KEY"]) delete process.env[name];
  process.env.CODEX_CONFIG_PATH = configPath;
  process.env.CODEX_AUTH_PATH = path.join(tempRoot, "missing-auth.json");
  try {
    assert.deepEqual(resolveSharedResponsesConfig(), {
      baseUrl: "http://127.0.0.1:43123/v1",
      apiKey: "codex-test-bearer"
    });
  } finally {
    for (const [name, value] of Object.entries({
      OGS_OPENAI_BASE_URL: previous.base,
      OGS_OPENAI_API_KEY: previous.key,
      OPENAI_BASE_URL: previous.openaiBase,
      OPENAI_API_KEY: previous.openaiKey,
      CODEX_CONFIG_PATH: previous.codexConfig,
      CODEX_AUTH_PATH: previous.codexAuth
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Qwen and Kimi share the Codex-compatible gpt-6-luna Responses API", async () => {
  const previous = {
    base: process.env.OGS_OPENAI_BASE_URL,
    key: process.env.OGS_OPENAI_API_KEY,
    fetch: globalThis.fetch
  };
  const requests = [];
  process.env.OGS_OPENAI_BASE_URL = "http://127.0.0.1:43123/v1";
  process.env.OGS_OPENAI_API_KEY = "test-key";
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: JSON.parse(init.body) });
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: "resp-test", output: [{ content: [{ text: '{"ok":true}' }] }] }) };
  };
  try {
    for (const adapter of [qwenBackendAdapter, kimiBackendAdapter]) {
      const run = await adapter.startRun({ runContext: {}, targetDir: process.cwd() });
      const result = await run.execute({
        roleId: "adapter-test",
        prompt: "Return the result",
        schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
        modelId: "some-legacy-alias",
        workdir: process.cwd(),
        directory: process.cwd(),
        timeoutMs: 1000,
        maxOutputBytes: 4096
      });
      await run.close();
      assert.equal(result.modelId, "gpt-6-luna");
      assert.equal(result.exitCode, 0);
    }
  } finally {
    if (previous.base === undefined) delete process.env.OGS_OPENAI_BASE_URL; else process.env.OGS_OPENAI_BASE_URL = previous.base;
    if (previous.key === undefined) delete process.env.OGS_OPENAI_API_KEY; else process.env.OGS_OPENAI_API_KEY = previous.key;
    globalThis.fetch = previous.fetch;
  }
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.equal(request.url, "http://127.0.0.1:43123/v1/responses");
    assert.equal(request.body.model, "gpt-6-luna");
    assert.equal(request.body.store, false);
    assert.match(request.body.input, /Return only JSON matching this schema/);
  }
});

test("shared Responses API sessions abort their active request", async () => {
  const previous = {
    base: process.env.OGS_OPENAI_BASE_URL,
    key: process.env.OGS_OPENAI_API_KEY,
    fetch: globalThis.fetch
  };
  process.env.OGS_OPENAI_BASE_URL = "http://127.0.0.1:43123/v1";
  process.env.OGS_OPENAI_API_KEY = "test-key";
  let aborted = false;
  globalThis.fetch = async (_input, init) => await new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      aborted = true;
      reject(Object.assign(new Error("request aborted"), { name: "AbortError" }));
    }, { once: true });
  });
  try {
    const run = await qwenBackendAdapter.startRun({ runContext: {}, targetDir: process.cwd() });
    const pending = run.execute({
      roleId: "adapter-abort-test",
      sessionKey: "adapter-abort-session",
      prompt: "Wait for cancellation",
      schema: { type: "object" },
      modelId: "gpt-6-luna",
      workdir: process.cwd(),
      directory: process.cwd(),
      timeoutMs: 30_000,
      maxOutputBytes: 4096
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await run.abort({ sessionId: "adapter-abort-session", directory: process.cwd() });
    await assert.rejects(pending, /Responses API execution failed/);
    assert.equal(aborted, true);
    await run.close();
  } finally {
    if (previous.base === undefined) delete process.env.OGS_OPENAI_BASE_URL; else process.env.OGS_OPENAI_BASE_URL = previous.base;
    if (previous.key === undefined) delete process.env.OGS_OPENAI_API_KEY; else process.env.OGS_OPENAI_API_KEY = previous.key;
    globalThis.fetch = previous.fetch;
  }
});

test("shared Responses API requests honor a signal aborted before execution", async () => {
  const previous = {
    base: process.env.OGS_OPENAI_BASE_URL,
    key: process.env.OGS_OPENAI_API_KEY,
    fetch: globalThis.fetch
  };
  process.env.OGS_OPENAI_BASE_URL = "http://127.0.0.1:43123/v1";
  process.env.OGS_OPENAI_API_KEY = "test-key";
  let fetchCalled = false;
  globalThis.fetch = async (_input, init) => {
    fetchCalled = true;
    assert.equal(init.signal.aborted, true);
    throw Object.assign(new Error("request aborted"), { name: "AbortError" });
  };
  const controller = new AbortController();
  controller.abort(new Error("cancelled before dispatch"));
  try {
    const run = await kimiBackendAdapter.startRun({ runContext: {}, targetDir: process.cwd() });
    await assert.rejects(run.execute({
      roleId: "adapter-pre-abort-test",
      prompt: "Do not send",
      schema: { type: "object" },
      modelId: "gpt-6-luna",
      workdir: process.cwd(),
      directory: process.cwd(),
      timeoutMs: 30_000,
      maxOutputBytes: 4096,
      signal: controller.signal
    }), /Responses API execution failed/);
    assert.equal(fetchCalled, true);
    await run.close();
  } finally {
    if (previous.base === undefined) delete process.env.OGS_OPENAI_BASE_URL; else process.env.OGS_OPENAI_BASE_URL = previous.base;
    if (previous.key === undefined) delete process.env.OGS_OPENAI_API_KEY; else process.env.OGS_OPENAI_API_KEY = previous.key;
    globalThis.fetch = previous.fetch;
  }
});
