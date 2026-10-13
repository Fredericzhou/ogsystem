import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeJsonFileAtomic } from "../dist/runtime/json-file.js";

test("concurrent atomic JSON writes leave one complete target without temp files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ogs-json-atomic-"));
  const target = path.join(directory, "summary.json");
  const values = Array.from({ length: 12 }, (_, index) => ({ writer: index, payload: "x".repeat(2048) }));
  try {
    await Promise.all(values.map((value) => writeJsonFileAtomic(target, value)));
    const stored = JSON.parse(await readFile(target, "utf8"));
    assert.ok(values.some((value) => JSON.stringify(value) === JSON.stringify(stored)));
    assert.deepEqual(await readdir(directory), ["summary.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
