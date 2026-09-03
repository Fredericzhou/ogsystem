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
      type: "run_start",
      channel: "main"
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
  assert.equal(first.events[0].record.channel, "main");

  await appendFile(
    timelinePath,
    JSON.stringify({
      version: 1,
      cursor: 1,
      at: "2026-04-23T00:00:01.000Z",
      type: "audit",
      roleId: "alpha",
      status: "ok",
      channel: "main"
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

test("timeline tail cache bounds memory and preserves old cursor reads", async () => {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-timeline-bounded-"));
  const timelinePath = path.resolve(workdir, "timeline.jsonl");
  const records = Array.from({ length: 10_005 }, (_, cursor) => JSON.stringify({
    version: 1,
    cursor,
    at: `2026-04-23T00:00:${String(cursor % 60).padStart(2, "0")}.000Z`,
    type: "audit",
    channel: "main"
  }));
  await writeFile(timelinePath, `${records.join("\n")}\n`, "utf8");

  const oldest = await loadTimelineTailSnapshot({ timelinePath, cursor: 0, limit: 1 });
  assert.equal(oldest.events[0].cursor, 0);
  assert.equal(oldest.nextCursor, 10_005);

  const newest = await loadTimelineTailSnapshot({ timelinePath, cursor: 10_004, limit: 1 });
  assert.equal(newest.events[0].cursor, 10_004);
  assert.equal(newest.nextCursor, 10_005);
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
      type: "run_start",
      channel: "main"
    }) + "\n",
    "utf8"
  );

  await loadTimelineTailSnapshot({ timelinePath, cursor: 0, limit: 10 });
  await appendFile(
    timelinePath,
    '{"version":1,"cursor":1,"at":"2026-04-23T00:00:01.000Z","type":"audit","channel":"main"',
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
      type: "run_start",
      channel: "main"
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
      type: "a",
      channel: "main"
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
