import assert from "node:assert/strict";
import test from "node:test";
import { createRoleSourceSyncScheduler } from "../application/role-source-sync-scheduler.mjs";

function harness({ sync, reindex } = {}) {
  const statuses = new Map();
  let syncCount = 0;
  const scheduler = createRoleSourceSyncScheduler({
    listSources: async () => [{ sourceId: "agency-agents", enabled: true }],
    getSyncStatus: async (id) => statuses.get(id) || null,
    updateSyncStatus: async (id, status) => { statuses.set(id, structuredClone(status)); },
    synchronizeSource: async (id) => { syncCount += 1; return sync ? sync(id) : { commit: "a".repeat(40) }; },
    refreshSourceIndex: async (id) => reindex ? reindex(id) : { commit: "b".repeat(40) },
    now: () => new Date("2026-10-27T00:00:00.000Z"),
    logger: { error() {} }
  });
  return { scheduler, statuses, get syncCount() { return syncCount; } };
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
}

test("manual update runs in the background and persists running and success status", async () => {
  let finish;
  const gate = new Promise((resolve) => { finish = resolve; });
  const h = harness({ sync: async () => { await gate; return { commit: "a".repeat(40) }; } });
  assert.deepEqual(h.scheduler.enqueue("agency-agents"), { accepted: true, alreadyRunning: false });
  await settle();
  assert.equal(h.statuses.get("agency-agents").state, "running");
  assert.deepEqual(h.scheduler.enqueue("agency-agents"), { accepted: true, alreadyRunning: true });
  assert.equal(h.syncCount, 1);
  finish();
  await settle();
  assert.equal(h.statuses.get("agency-agents").state, "succeeded");
  assert.equal(h.statuses.get("agency-agents").lastSuccessfulCommit, "a".repeat(40));
  assert.equal(h.statuses.get("agency-agents").nextRunAt, undefined);
});

test("failed manual update records the error and retains prior successful metadata", async () => {
  const h = harness({ sync: async () => { throw new Error("temporary network failure"); } });
  h.statuses.set("agency-agents", {
    state: "succeeded", lastSuccessAt: "2026-10-26T00:00:00.000Z", lastSuccessfulCommit: "c".repeat(40)
  });
  h.scheduler.enqueue("agency-agents");
  await settle();
  const status = h.statuses.get("agency-agents");
  assert.equal(status.state, "failed");
  assert.equal(status.lastError, "temporary network failure");
  assert.equal(status.lastSuccessfulCommit, "c".repeat(40));
  assert.equal(status.lastSuccessAt, "2026-10-26T00:00:00.000Z");
});

test("restart recovery marks abandoned jobs interrupted without discarding last success", async () => {
  const h = harness();
  h.statuses.set("agency-agents", {
    state: "running", operation: "sync", startedAt: "2026-10-27T00:00:00.000Z",
    lastSuccessAt: "2026-10-26T00:00:00.000Z", lastSuccessfulCommit: "d".repeat(40)
  });
  await h.scheduler.recoverInterrupted();
  const status = h.statuses.get("agency-agents");
  assert.equal(status.state, "failed");
  assert.match(status.lastError, /interrupted/i);
  assert.equal(status.lastSuccessfulCommit, "d".repeat(40));
});
