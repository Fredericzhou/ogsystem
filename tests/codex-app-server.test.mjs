import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

import { CodexAppServerClient } from "../dist/runtime/codex-app-server.js";
import { decideAcpPermission } from "../dist/runtime/acp-adapter-support.js";

class FakeAppServerProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  exitCode = null;
  signalCode = null;
  pid = undefined;
  requests = [];
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
      respond({ turn: { id: `turn-${this.requests.length}` } });
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
