import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileVersionedStateStore,
  StateVersionConflictError,
  VersionedStateStore,
  toOgsCloudEvent,
  projectOgsSpan,
  validateCapabilityPolicy,
  compileSubgraphSpec
} from "../dist/runtime/adapter.js";
import { appendAuditRecord } from "../dist/runtime/audit-recorder.js";

function snapshot() {
  return {
    schemaVersion: 1,
    stateVersion: 0,
    lastCheckpointSequence: 0,
    state: { count: 0 },
    irDigest: "ir",
    runtimeDigest: "runtime"
  };
}

test("state store is CAS and idempotent", () => {
  const store = new VersionedStateStore(snapshot());
  const first = store.commit({
    expectedStateVersion: 0,
    eventId: "e1",
    idempotencyKey: "k1",
    checkpointSequence: 7,
    update: (state) => ({ count: state.count + 1 })
  });
  assert.equal(first.status, "accepted");
  assert.equal(first.snapshot.stateVersion, 1);
  assert.equal(first.snapshot.lastCheckpointSequence, 7);
  assert.equal(store.commit({
    expectedStateVersion: 0,
    eventId: "e1",
    idempotencyKey: "k1",
    update: () => ({ count: 99 })
  }).status, "duplicate");
  assert.throws(() => store.commit({
    expectedStateVersion: 0,
    eventId: "e2",
    idempotencyKey: "k2",
    update: (state) => state
  }), StateVersionConflictError);
});

test("filesystem state store survives reload and rejects stale CAS", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-state-"));
  const path = join(root, "state.json");
  const store = new FileVersionedStateStore(path, snapshot());
  await store.commit({
    expectedStateVersion: 0,
    eventId: "e1",
    idempotencyKey: "k1",
    checkpointSequence: 3,
    update: (state) => ({ count: state.count + 1 })
  });
  const reloaded = new FileVersionedStateStore(path);
  assert.equal((await reloaded.load()).state.count, 1);
  assert.equal((await reloaded.load()).lastCheckpointSequence, 3);
  assert.equal((await reloaded.commit({
    expectedStateVersion: 1,
    eventId: "e1",
    idempotencyKey: "k1",
    update: () => ({ count: 20 })
  })).status, "duplicate");
  await assert.rejects(() => reloaded.commit({
    expectedStateVersion: 0,
    eventId: "e2",
    idempotencyKey: "k2",
    update: (state) => state
  }), StateVersionConflictError);
  assert.match(await readFile(path, "utf8"), /stateVersion/);
});

test("CloudEvents and trace projection preserve OGS identity and payload digest", () => {
  const event = toOgsCloudEvent({ id: "e", type: "ogs.role.completed", runId: "r", systemId: "s", systemVersion: "1", roleId: "worker", data: { ok: true } });
  assert.equal(event.specversion, "1.0");
  assert.equal(event.ogs.roleId, "worker");
  assert.match(event.ogs.payloadDigest, /^[a-f0-9]{64}$/);
  const span = projectOgsSpan({ traceId: "t", spanId: "s", name: "role", startedAt: "2026-01-01T00:00:00Z", runId: "r", roleId: "worker", status: "OK" });
  assert.equal(span.attributes["ogs.run_id"], "r");
  assert.equal(span.status, "OK");
});

test("capability policy fails closed on unknown roles and undeclared tools", () => {
  const errors = validateCapabilityPolicy({
    roleIds: ["worker"],
    allowedToolsByRoleId: { worker: ["shell"], ghost: [] },
    declaredToolsByRoleId: { worker: ["read"] },
    maxTransitionsPerRun: 10
  });
  assert.equal(errors.length, 2);
});

test("subgraph specs require isolated state and checkpoint namespaces", () => {
  const compiled = compileSubgraphSpec({ id: "debate", version: "1", source: "graphs/debate.mmd", inputs: ["question"], outputs: ["answer"], namespace: "subgraph:debate", checkpointNamespace: "checkpoint:debate" });
  assert.equal(compiled.namespace, "subgraph:debate");
  assert.throws(() => compileSubgraphSpec({ id: "bad", version: "1", source: "x", inputs: [], outputs: [], namespace: "same", checkpointNamespace: "same" }), /IR_SUBGRAPH_INVALID/);
});

test("audit recorder delegates the canonical audit event to the runtime service port", async () => {
  const root = await mkdtemp(join(tmpdir(), "ogs-audit-port-"));
  const received = [];
  await appendAuditRecord({
    runContext: { runDir: root, auditDir: root, redaction: { enabled: true } },
    audit: {
      at: new Date().toISOString(),
      roleId: "worker",
      status: "ok",
      exitCode: 0,
      durationMs: 1,
      stdoutPreview: "token=secret"
    },
    append: async (event) => received.push(event)
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].type, "audit");
  assert.equal(received[0].roleId, "worker");
  assert.equal(received[0].stdoutPreview, "token=[REDACTED]");
});
