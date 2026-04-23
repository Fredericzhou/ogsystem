import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { appendFile, mkdtemp, writeFile } from "node:fs/promises";

import { loadTimelineTailSnapshot } from "../dist/runtime/timeline-projector.js";

test("timeline tail snapshot reads appended records incrementally", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-timeline-tail-"));
  const timelinePath = path.resolve(workdir, "timeline.jsonl");
  await writeFile(
    timelinePath,
    JSON.stringify({
      version: 1,
      cursor: 0,
      at: "2026-04-23T00:00:00.000Z",
      type: "run_start"
    }) + "\n",
    "utf8"
  );

  const first = await loadTimelineTailSnapshot({
    timelinePath,
    cursor: 0,
    limit: 10
  });
  assert.equal(first.events.length, 1);
  assert.equal(first.nextCursor, 1);
  assert.equal(first.events[0].record.type, "run_start");

  await appendFile(
    timelinePath,
    JSON.stringify({
      version: 1,
      cursor: 1,
      at: "2026-04-23T00:00:01.000Z",
      type: "audit",
      roleId: "alpha",
      status: "ok"
    }) + "\n",
    "utf8"
  );

  const second = await loadTimelineTailSnapshot({
    timelinePath,
    cursor: 1,
    limit: 10
  });
  assert.equal(second.events.length, 1);
  assert.equal(second.nextCursor, 2);
  assert.equal(second.events[0].record.type, "audit");
  assert.equal(second.events[0].record.roleId, "alpha");
});

test("timeline tail snapshot ignores partial trailing lines until they complete", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-timeline-partial-"));
  const timelinePath = path.resolve(workdir, "timeline.jsonl");
  await writeFile(
    timelinePath,
    JSON.stringify({
      version: 1,
      cursor: 0,
      at: "2026-04-23T00:00:00.000Z",
      type: "run_start"
    }) + "\n",
    "utf8"
  );

  await loadTimelineTailSnapshot({ timelinePath, cursor: 0, limit: 10 });
  await appendFile(
    timelinePath,
    '{"version":1,"cursor":1,"at":"2026-04-23T00:00:01.000Z","type":"audit"',
    "utf8"
  );

  const partial = await loadTimelineTailSnapshot({
    timelinePath,
    cursor: 1,
    limit: 10
  });
  assert.equal(partial.events.length, 0);
  assert.equal(partial.nextCursor, 1);

  await appendFile(timelinePath, ',"status":"ok"}\n', "utf8");
  const completed = await loadTimelineTailSnapshot({
    timelinePath,
    cursor: 1,
    limit: 10
  });
  assert.equal(completed.events.length, 1);
  assert.equal(completed.nextCursor, 2);
  assert.equal(completed.events[0].record.status, "ok");
});

test("timeline tail snapshot invalidates cache on file replacement", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-timeline-replace-"));
  const timelinePath = path.resolve(workdir, "timeline.jsonl");
  await writeFile(
    timelinePath,
    JSON.stringify({
      version: 1,
      cursor: 0,
      at: "2026-04-23T00:00:00.000Z",
      type: "run_start"
    }) + "\n",
    "utf8"
  );

  await loadTimelineTailSnapshot({ timelinePath, cursor: 0, limit: 10 });
  await writeFile(
    timelinePath,
    JSON.stringify({
      version: 1,
      cursor: 0,
      at: "2026-04-23T01:00:00.000Z",
      type: "a"
    }) + "\n",
    "utf8"
  );

  const replaced = await loadTimelineTailSnapshot({
    timelinePath,
    cursor: 0,
    limit: 10
  });
  assert.equal(replaced.events.length, 1);
  assert.equal(replaced.nextCursor, 1);
  assert.equal(replaced.events[0].record.type, "a");
});
