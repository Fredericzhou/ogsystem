import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

test("adapter auto-resolves role packages by roleId", async () => {
  const result = await runSystemWithAdapter({
    systemPath: path.resolve("examples/console-system.mmd"),
    profilesPath: path.resolve("examples/console-profiles.json"),
    toolsPath: path.resolve("examples/console-tools.json"),
    lawsPath: path.resolve("examples/console-laws.json"),
    prompt: "分析当前仓库结构并输出摘要",
    workdir: process.cwd(),
    dryRun: true
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "demo-analyst");
  assert.strictEqual(result.auditTrail[0]?.selectedEvent, "ANALYSIS_DONE");
  assert.match(result.finalOutput ?? "", /\[dry-run\]/);
  assert.match(result.finalOutput ?? "", /codex/);
});
