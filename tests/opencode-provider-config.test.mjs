import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveChatCompatibleProviders } from "../dist/runtime/opencode-provider-config.js";

test("OpenCode host preserves the configured provider model and tool capabilities", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-opencode-provider-test-"));
  const configPath = join(root, "opencode.json");
  try {
    await writeFile(configPath, JSON.stringify({
      provider: {
        "codex-gateway": {
          name: "Codex Compatible Gateway",
          npm: "@ai-sdk/openai",
          options: {
            baseURL: "http://gateway.invalid:8080",
            apiKey: "{env:CODEX_GATEWAY_API_KEY}",
            supportsStructuredOutputs: true
          },
          models: {
            "gpt-6-luna": {
              tool_call: true,
              modalities: { input: ["text"], output: ["text"] }
            }
          }
        }
      }
    }), "utf8");

    const providers = resolveChatCompatibleProviders({
      OGS_OPENCODE_CONFIG: configPath,
      OGS_OPENCODE_COMPATIBLE_PROVIDERS: "codex-gateway"
    });
    assert.equal(providers["codex-gateway"].npm, "@ai-sdk/openai");
    assert.equal(providers["codex-gateway"].options.baseURL, "http://gateway.invalid:8080");
    assert.equal(providers["codex-gateway"].options.apiKey, "{env:CODEX_GATEWAY_API_KEY}");
    assert.equal(providers["codex-gateway"].options.supportsStructuredOutputs, true);
    assert.equal(providers["codex-gateway"].models["gpt-6-luna"].tool_call, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("OpenCode host uses a conservative compatible fallback without user provider config", () => {
  const providers = resolveChatCompatibleProviders({
    OGS_OPENCODE_CONFIG: "/path/that/does/not/exist.json",
    OGS_OPENCODE_COMPATIBLE_PROVIDERS: "fallback-provider"
  });
  assert.deepEqual(providers, { "fallback-provider": { npm: "@ai-sdk/openai-compatible" } });
});
