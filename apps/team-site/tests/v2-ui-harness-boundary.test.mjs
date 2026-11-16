import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const appSourcePath = join(import.meta.dirname, "..", "public", "app", "views", "app.js");

test("active Team Site role inspector exposes Harness bindings without v1 execution editors", async () => {
  const source = await readFile(appSourcePath, "utf8");

  assert.match(source, /studioHarnessBindingMarkup/);
  assert.match(source, /data-studio-role-field=\\"harnessTemplate\\"/);
  assert.doesNotMatch(source, /data-studio-profile-field/);
  assert.doesNotMatch(source, /data-studio-tool-field/);
  assert.doesNotMatch(source, /data-studio-role-tool/);
  assert.doesNotMatch(source, /Execution profile ID/);
  assert.doesNotMatch(source, /<option value=\\"exec\\"/);
  assert.doesNotMatch(source, /<option value=\\"noop\\"/);
});
