import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

import { CodexAppServerClient, projectCodexStrictSchema } from "../dist/runtime/codex-app-server.js";
import { decideAcpPermission } from "../dist/runtime/acp-adapter-support.js";

class FakeAppServerProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode = null;
  signalCode = null;
  pid = undefined;
  requests = [];
  completeTurns = true;
  failTurnStarts = false;
  input = "";
  stdin = new Writable({
    write: (chunk, _encoding, callback) => {
      this.input += chunk.toString();
      const lines = this.input.split("\n");
      this.input = lines.pop() ?? "";
      for (const line of lines) this.onRequest(JSON.parse(line));
      callback();
    },
    final: (callback) => {
      callback();
      queueMicrotask(() => this.kill());
    }
  });

  onRequest(message) {
    if (!message.method) return;
    this.requests.push(message);
    const respond = (result) => this.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`);
    if (message.method === "model/list") {
      respond(message.params.cursor
        ? { data: [{ id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol" }] }
        : { data: [{ id: "gpt-6-astra" }], nextCursor: "page-2" });
    } else if (message.method === "thread/start") {
      respond({ thread: { id: "thread-new" } });
    } else if (message.method === "thread/resume") {
      respond({ thread: { id: message.params.threadId } });
    } else if (message.method === "turn/start") {
      if (this.failTurnStarts) {
        this.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, error: { code: -32000, message: "turn rejected" } })}\n`);
        return;
      }
      respond({ turn: { id: `turn-${this.requests.length}` } });
      if (!this.completeTurns) return;
      setImmediate(() => this.stdout.write(`${JSON.stringify({
        jsonrpc: "2.0",
        method: "turn/completed",
        params: {
          threadId: message.params.threadId,
          turn: { status: "completed", items: [{ type: "agentMessage", id: "message-final", text: JSON.stringify({ event: "READY", content: "ok" }) }] }
        }
      })}\n`));
    }
  }

  kill() {
    this.exitCode = 0;
    this.emit("exit", 0, null);
    return true;
  }
}

test("Codex app-server paginates models and resumes a persistent thread between role turns", async () => {
  const child = new FakeAppServerProcess();
  const client = new CodexAppServerClient(child);
  try {
    assert.deepEqual(await client.listModels(), [
      { id: "gpt-6-astra", displayName: "gpt-6-astra", isDefault: false },
      { id: "gpt-5.6-sol", displayName: "GPT-5.6 Sol", isDefault: false }
    ]);

    const first = await client.execute({ roleId: "planner", prompt: "plan", schema: {}, modelId: "gpt-6-astra", cwd: process.cwd(), timeoutMs: 1000 });
    const second = await client.execute({ roleId: "reviewer", prompt: "review", schema: {}, modelId: "gpt-6-astra", cwd: process.cwd(), timeoutMs: 1000, sessionId: first.sessionId });

    assert.equal(first.sessionId, "thread-new");
    assert.equal(second.sessionId, first.sessionId);
    assert.match(first.stdout, /"event":"READY"/);
    assert.deepEqual(child.requests.filter((entry) => entry.method.startsWith("thread/")).map((entry) => entry.method), ["thread/start", "thread/resume"]);
    assert.equal(child.requests.filter((entry) => entry.method === "turn/start").length, 2);
  } finally {
    await client.close();
  }
});

test("Codex workspace tool execution uses bounded workspaceWrite with never approval", async () => {
  const child = new FakeAppServerProcess();
  const client = new CodexAppServerClient(child);
  const root = "/tmp/ogs-codex-probe-root";
  try {
    await client.execute({
      roleId: "writer",
      prompt: "write",
      schema: {},
      modelId: "gpt-6-luna",
      cwd: root,
      timeoutMs: 1000,
      workspaceCapabilityPolicy: { root, read: true, write: true, command: true }
    });

    const starts = child.requests.filter((entry) => entry.method === "thread/start" || entry.method === "turn/start");
    assert.equal(starts.length, 2);
    assert.deepEqual(starts.map((entry) => entry.params.approvalPolicy), ["never", "never"]);
    assert.deepEqual(starts[0].params.sandbox, "workspace-write");
    assert.deepEqual(starts[1].params.sandboxPolicy, { type: "workspaceWrite", writableRoots: [root] });
  } finally {
    await client.close();
  }
});

test("Codex Role timeout interrupts the server-side turn before rejecting", async () => {
  const child = new FakeAppServerProcess();
  child.completeTurns = false;
  const client = new CodexAppServerClient(child);
  try {
    await assert.rejects(
      client.execute({
        roleId: "slow-role",
        prompt: "wait",
        schema: {},
        modelId: "gpt-6-luna",
        cwd: process.cwd(),
        timeoutMs: 20
      }),
      /Codex role slow-role timed out after 20ms/
    );
    assert.equal(child.requests.filter((entry) => entry.method === "turn/interrupt").length, 1);
  } finally {
    await client.close();
  }
});

test("Codex turn start failure releases the completion waiter", async () => {
  const child = new FakeAppServerProcess();
  child.failTurnStarts = true;
  const client = new CodexAppServerClient(child);
  try {
    await assert.rejects(client.execute({
      roleId: "rejected-role",
      prompt: "start",
      schema: {},
      modelId: "gpt-6-luna",
      cwd: process.cwd(),
      timeoutMs: 1000
    }), /turn rejected/);
    await client.close();
  } finally {
    await client.close();
  }
});

test("Codex app-server exit rejects an in-flight Role turn", async () => {
  const child = new FakeAppServerProcess();
  child.completeTurns = false;
  const client = new CodexAppServerClient(child);
  try {
    const pending = client.execute({
      roleId: "exited-role",
      prompt: "wait",
      schema: {},
      modelId: "gpt-6-luna",
      cwd: process.cwd(),
      timeoutMs: 1000
    });
    setTimeout(() => child.kill(), 10);
    await assert.rejects(pending, /Codex app-server exited/);
  } finally {
    await client.close();
  }
});

test("Codex strict schema projection materializes empty objects and exact required keys", () => {
  const source = {
    type: "object",
    properties: {
      data: { type: "object", additionalProperties: true },
      artifacts: { type: "array", items: { type: "object", properties: { path: { type: "string" } } } }
    },
    required: ["data"],
    additionalProperties: false
  };
  const projected = projectCodexStrictSchema(source);
  assert.deepEqual(projected.required, ["data", "artifacts"]);
  assert.deepEqual(projected.properties.data, {
    type: "object",
    properties: {},
    required: [],
    additionalProperties: false
  });
  assert.deepEqual(projected.properties.artifacts.items.required, ["path"]);
  assert.deepEqual(source.properties.data, { type: "object", additionalProperties: true });
});

test("ACP permission decisions require explicit bounded workspace capability", () => {
  const allowed = decideAcpPermission({
    action: "write",
    path: "output/report.txt",
    options: [{ optionId: "allow-once" }, { optionId: "allow-session" }]
  }, { root: "/tmp/ogs-execution", write: true });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.response.outcome.optionId, "allow-once");
  assert.equal(decideAcpPermission({ action: "write", path: "../outside", options: [{ optionId: "allow-once" }] }, { root: "/tmp/ogs-execution", write: true }).allowed, false);
  assert.equal(decideAcpPermission({ action: "write", path: "output/report.txt", options: [{ optionId: "allow-once" }] }, { root: "/tmp/ogs-execution" }).allowed, false);
  assert.equal(decideAcpPermission({ action: "command", command: "npm test", options: [{ optionId: "allow-once" }] }, { root: "/tmp/ogs-execution", command: true }).allowed, true);
});
