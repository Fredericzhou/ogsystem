import test from "node:test";
import assert from "node:assert/strict";

import {
  discoverOpencodeNativeTools,
  executeOpencodeModelRole
} from "../dist/runtime/opencode-executor.js";
import {
  codexBackendAdapter,
  createDefaultBackendRegistry,
  normalizeCodexProtocolEvent,
  opencodeBackendAdapter,
  projectBackendCapabilityDirectory
} from "../dist/runtime/model-backend-registry.js";
import { createAgentEventEmitter } from "../dist/runtime/agent-client-types.js";

function transportFor(client) {
  let closed = 0;
  return {
    get closed() {
      return closed;
    },
    transport: {
      async startServer() {
        return {
          url: "http://127.0.0.1:4096",
          close() {
            closed += 1;
          },
          getOutput() {
            return "";
          }
        };
      },
      createClient() {
        return client;
      }
    }
  };
}

test("OpenCode native discovery returns sorted SDK tool IDs and closes its server", async () => {
  const harness = transportFor({
    session: {},
    tool: {
      async ids() {
        return { data: ["grep", "read", "grep", "bash", "invalid"] };
      }
    }
  });
  const result = await discoverOpencodeNativeTools({
    workdir: "/tmp/project",
    modelId: "openai/gpt-5.4-mini",
    timeoutMs: 5000
  }, harness.transport);

  assert.deepEqual(result.verifiedTools, ["bash", "grep", "read"]);
  assert.match(result.detail, /verified 3 tools/);
  assert.equal(harness.closed, 1);
});
test("backend evidence normalizes tool completion and permission decisions", async () => {
  const events = [];
  const emitter = createAgentEventEmitter({
    runId: "run-1",
    roleId: "writer",
    executionId: "exec-1",
    attempt: 1,
    backend: "codex",
    model: "gpt-6-luna",
    policyDigest: "policy-1",
    onEvent: (event) => events.push(event)
  });
  await emitter.emit({ type: "tool_started", tool: "exec_command" });
  await emitter.emit({ type: "tool_finished", tool: "exec_command", output: { status: "completed", exitCode: 0 } });
  await emitter.emit({ type: "permission_required", request: { requestId: "req-1", decision: { allowed: false, capability: "network", reason: "denied" } } });
  const invocation = events.find((event) => event.event.type === "tool_invocation" && event.event.status === "completed");
  const permission = events.find((event) => event.event.type === "permission_request");
  assert.equal(invocation.event.decision, "allow");
  assert.equal(invocation.ogsContractVersion, 2);
  assert.equal(invocation.model, "gpt-6-luna");
  assert.equal(invocation.event.status, "completed");
  assert.equal(invocation.event.policyDigest, "policy-1");
  assert.equal(permission.event.decision, "deny");
  assert.equal(permission.event.resource, "network");
});
test("OpenCode native discovery closes its server when the SDK payload is invalid", async () => {
  const harness = transportFor({
    session: {},
    tool: {
      async ids() {
        return { data: { invalid: true } };
      }
    }
  });

  await assert.rejects(
    discoverOpencodeNativeTools({
      workdir: "/tmp/project",
      modelId: "openai/gpt-5.4-mini",
      timeoutMs: 5000
    }, harness.transport),
    /invalid tool ID payload/
  );
  assert.equal(harness.closed, 1);
});

test("native adapters expose stable versions and conservative resource facts", () => {
  assert.equal(opencodeBackendAdapter.adapterVersion, "opencode-sdk-v2-native-tools-1");
  assert.equal(codexBackendAdapter.adapterVersion, "codex-app-server-v2-native-tools-1");
  assert.deepEqual(opencodeBackendAdapter.getResourceCapabilities(), {
    filesystem: false,
    process: false,
    network: false
  });
  assert.deepEqual(codexBackendAdapter.getResourceCapabilities(), {
    filesystem: true,
    process: true,
    network: false
  });
});

test("native adapters map the frozen environment policy into bounded workspace capabilities", () => {
  const policy = {
    ogsContractVersion: 2,
    schemaVersion: 1,
    root: "/tmp/ogs-policy",
    filesystem: { read: true, write: false },
    process: false,
    network: false,
    limits: { timeoutMs: 1000, maxOutputBytes: 1024, maxStorageBytes: 1024 },
    policyDigest: "policy"
  };
  assert.deepEqual(opencodeBackendAdapter.mapEnvironmentPolicy(policy), {
    root: policy.root,
    read: true,
    write: false,
    command: false,
    network: false
  });
  assert.deepEqual(codexBackendAdapter.mapEnvironmentPolicy(policy), {
    root: policy.root,
    read: true,
    write: false,
    command: false,
    network: false
  });
});

test("OpenCode denies task and dynamic tools when host resources are not fully enforceable", () => {
  const restricted = { filesystem: { read: false, write: false }, process: false, network: false };
  assert.equal(opencodeBackendAdapter.validateToolResources("task", restricted).allowed, false);
  assert.equal(opencodeBackendAdapter.validateToolResources("external_directory", restricted).allowed, false);
  assert.equal(opencodeBackendAdapter.validateToolResources("mcp/filesystem", restricted).allowed, false);
  assert.equal(opencodeBackendAdapter.validateToolResources("plugin.custom_tool", restricted).allowed, false);
  assert.equal(opencodeBackendAdapter.validateToolResources("question", restricted).allowed, true);
});


test("Codex protocol notifications normalize to bounded agent progress events", () => {
  assert.deepEqual(normalizeCodexProtocolEvent({
    method: "item/started",
    params: { item: { type: "commandExecution", command: "cat secret.txt" } }
  }), { type: "tool_started", tool: "exec_command" });
  assert.deepEqual(normalizeCodexProtocolEvent({
    method: "item/completed",
    params: { item: { type: "fileChange", status: "completed", exitCode: 0, patch: "private content" } }
  }), { type: "tool_finished", tool: "apply_patch", output: { status: "completed", exitCode: 0 } });
  assert.deepEqual(normalizeCodexProtocolEvent({
    method: "item/agentMessage/delta",
    params: { delta: "progress" }
  }), { type: "text_delta", text: "progress" });
  assert.equal(normalizeCodexProtocolEvent({
    method: "item/completed",
    params: { item: { type: "agentMessage", text: "private content" } }
  }), undefined);
});

test("backend capability directory is read-only and fail-closed for incomplete adapters", () => {
  const entries = projectBackendCapabilityDirectory(createDefaultBackendRegistry());
  assert.deepEqual(entries.map((entry) => entry.backendId), ["codex", "kimi", "ollama", "opencode", "pi", "qwen"]);
  const codex = entries.find((entry) => entry.backendId === "codex");
  assert.equal(codex.readiness, "degraded");
  assert.equal(codex.nativeTools.status, "refresh_required");
  assert.deepEqual(codex.permission, {
    decisions: ["allow", "deny"],
    interactiveApproval: false,
    configurable: false
  });
  assert.deepEqual(codex.modes, {
    execution: ["staged", "read_only"],
    approval: ["non_interactive"],
    configurable: false
  });
  const pi = entries.find((entry) => entry.backendId === "pi");
  assert.equal(pi.nativeTools.status, "refresh_required");
  assert.equal(pi.resources.filesystem, false);
  assert.equal(pi.resources.process, false);
  const opencode = entries.find((entry) => entry.backendId === "opencode");
  assert.equal(opencode.resources.filesystem, false);
  assert.equal(opencode.resources.process, false);
  for (const backendId of ["kimi", "ollama", "qwen"]) {
    const entry = entries.find((item) => item.backendId === backendId);
    assert.equal(entry.readiness, "unavailable");
    assert.equal(entry.nativeTools.status, "unavailable");
  }
  assert.equal(entries.some((entry) => entry.backendId === "claude"), false);
  for (const entry of entries) {
    assert.equal(Object.hasOwn(entry, "approvalPolicy"), false);
    assert.equal(Object.hasOwn(entry, "sandboxPolicy"), false);
    assert.equal(Object.hasOwn(entry, "protocol"), false);
  }
});

test("capability preview is keyed by backend and model", () => {
  const entries = projectBackendCapabilityDirectory(createDefaultBackendRegistry(), new Map([
    ["codex/gpt-6-luna", { readiness: "ready", verifiedTools: ["apply_patch", "exec_command"] }]
  ]));
  const codex = entries.find((entry) => entry.backendId === "codex");
  assert.equal(codex.readiness, "ready");
  assert.equal(codex.nativeTools.status, "ready");
  assert.deepEqual(codex.nativeTools.verifiedTools, ["apply_patch", "exec_command"]);
});

test("OpenCode execution projects only the frozen effective tools into the prompt", async () => {
  let promptArgs;
  const runClient = {
    url: "http://127.0.0.1:4096",
    startedAt: new Date().toISOString(),
    close() {},
    getOutput() {
      return "";
    },
    client: {
      session: {
        async create() {
          return { data: { id: "session-1" } };
        },
        async prompt(args) {
          promptArgs = args;
          return {
            data: {
              id: "message-1",
              info: { structured: { ok: true } },
              parts: []
            }
          };
        },
        async abort() {}
      }
    }
  };
  await executeOpencodeModelRole({
    roleId: "tool-policy",
    prompt: "return json",
    schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    modelRef: "openai/gpt-5.4-mini",
    workdir: "/tmp/project",
    directory: "/tmp/project",
    effectiveTools: ["read", "list"],
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient
  });

  assert.equal(promptArgs.tools.read, true);
  assert.equal(promptArgs.tools.glob, true);
  assert.equal(promptArgs.tools.bash, false);
  assert.equal(promptArgs.tools.write, false);
  assert.equal(promptArgs.tools.edit, false);
});

test("OpenCode artifact tool phase sends native tools before structured output", async () => {
  const prompts = [];
  const runClient = {
    url: "http://127.0.0.1:4096",
    startedAt: new Date().toISOString(),
    close() {},
    getOutput() {
      return "";
    },
    client: {
      session: {
        async create() {
          return { data: { id: "session-artifact" } };
        },
        async prompt(args) {
          prompts.push(args);
          return {
            data: {
              id: `message-${prompts.length}`,
              info: { structured: { ok: true } },
              parts: []
            }
          };
        },
        async abort() {}
      }
    }
  };

  await executeOpencodeModelRole({
    roleId: "artifact-writer",
    prompt: "create the requested artifact",
    schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
    modelRef: "openai/gpt-5.4-mini",
    workdir: "/tmp/project",
    directory: "/tmp/project",
    effectiveTools: ["read", "write"],
    artifactToolPhase: true,
    timeoutMs: 5000,
    maxOutputBytes: 4096,
    runClient
  });

  assert.equal(prompts.length, 2);
  assert.equal(prompts[0].tools.read, true);
  assert.equal(prompts[0].tools.write, true);
  assert.equal(prompts[0].format, undefined);
  assert.equal(prompts[1].tools.read, true);
  assert.equal(prompts[1].tools.write, true);
  assert.deepEqual(prompts[1].format, {
    type: "json_schema",
    schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] }
  });
});
