import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";

import { loadAuditTrailFromEvents } from "../dist/runtime/run-artifacts.js";
import {
  loadTimelineSnapshot,
  rebuildTimelineProjection
} from "../dist/runtime/timeline-projector.js";

test("loadAuditTrailFromEvents returns empty when events file is missing", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-events-missing-"));
  const audits = await loadAuditTrailFromEvents({
    context: {
      eventsPath: path.resolve(tempRoot, "missing-events.ndjson")
    }
  });

  assert.deepStrictEqual(audits, []);
});

test("loadAuditTrailFromEvents skips malformed lines and filters by allowed role ids", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-events-filter-"));
  const eventsPath = path.resolve(tempRoot, "events.ndjson");

  await writeFile(
    eventsPath,
    [
      "",
      "{",
      JSON.stringify({ type: "run_start", at: "2026-04-11T00:00:00.000Z" }),
      JSON.stringify({
        type: "audit",
        at: "2026-04-11T00:00:01.000Z",
        roleId: "role-a",
        status: "ok",
        durationMs: 1
      }),
      JSON.stringify({
        type: "audit",
        at: "2026-04-11T00:00:02.000Z",
        roleId: "role-b",
        status: "failed",
        durationMs: 2
      }),
      ""
    ].join("\n"),
    "utf8"
  );

  const audits = await loadAuditTrailFromEvents({
    context: {
      eventsPath
    },
    allowedRoleIds: new Set(["role-b"])
  });

  assert.strictEqual(audits.length, 1);
  assert.strictEqual(audits[0].roleId, "role-b");
  assert.strictEqual(audits[0].status, "failed");
});

test("timeline projection rebuilds machine-readable records from events", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-timeline-projection-"));
  const eventsPath = path.resolve(tempRoot, "events.ndjson");
  const timelinePath = path.resolve(tempRoot, "timeline.jsonl");

  await writeFile(
    eventsPath,
    [
      "",
      "{",
      JSON.stringify({ type: "run_start", at: "2026-04-11T00:00:00.000Z" }),
      JSON.stringify({
        type: "audit",
        at: "2026-04-11T00:00:01.000Z",
        roleId: "role-a",
        branchId: "role-a@1#1",
        lineageId: "role-a@1#1",
        loopIteration: 1,
        selectedEvent: "DONE",
        status: "ok",
        durationMs: 1
      }),
      JSON.stringify({
        type: "failure_handled",
        at: "2026-04-11T00:00:02.000Z",
        roleId: "role-b",
        branchId: "role-b@1#2",
        lineageId: "role-a@1#1",
        loopIteration: 1,
        errorCode: "TOOL_EXECUTION_FAILED"
      }),
      ""
    ].join("\n"),
    "utf8"
  );

  await rebuildTimelineProjection({ eventsPath, timelinePath });
  const lines = (await readFile(timelinePath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 3);
  const records = lines.map((line) => JSON.parse(line));
  assert.deepStrictEqual(
    records.map((record) => record.cursor),
    [0, 1, 2]
  );
  assert.equal(records[0].type, "run_start");
  assert.equal(records[1].roleId, "role-a");
  assert.equal(records[1].event, "DONE");
  assert.equal(records[1].status, "ok");
  assert.equal(records[1].durationMs, 1);
  assert.equal(records[2].errorCode, "TOOL_EXECUTION_FAILED");

  const snapshot = await loadTimelineSnapshot({
    timelinePath,
    cursor: 1,
    limit: 1,
    roleId: "role-a"
  });
  assert.equal(snapshot.events.length, 1);
  assert.equal(snapshot.events[0].record.type, "audit");
  assert.equal(snapshot.nextCursor, 3);
});

test("timeline projection tolerates missing event source", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-timeline-missing-"));
  const timelinePath = path.resolve(tempRoot, "timeline.jsonl");
  await rebuildTimelineProjection({
    eventsPath: path.resolve(tempRoot, "missing.ndjson"),
    timelinePath
  });
  assert.equal(await readFile(timelinePath, "utf8"), "");
});
