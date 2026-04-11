import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";

import { loadAuditTrailFromEvents } from "../dist/runtime/run-artifacts.js";

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
