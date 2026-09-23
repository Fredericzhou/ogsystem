import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("visualizer browser smoke keeps pnpm resolution platform-specific", async () => {
  const source = await readFile(new URL("../scripts/visualizer-browser-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /process\.platform !== "win32"\) return "pnpm"/);
  assert.match(source, /path\.join\(path\.dirname\(process\.execPath\), "pnpm\.cmd"\)/);
  assert.match(source, /process\.env\.PNPM_BIN/);
});
