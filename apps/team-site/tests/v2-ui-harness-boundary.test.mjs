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

test("Harness cards count configured allowed tools rather than verification evidence", async () => {
  const source = await readFile(appSourcePath, "utf8");

  assert.match(source, /const allowedTools = item\.allowedTools \|\| \[\]/);
  assert.match(source, /\$\{allowedTools\.length\} \$\{en \? "allowed tools" : "个允许工具"\}/);
  assert.doesNotMatch(source, /\$\{verifiedTools\.length\} \$\{en \? "verified tools" : "个已验证工具"\}/);
});

test("Studio debug detail identifies a run by its unique simulation ID", async () => {
  const source = await readFile(appSourcePath, "utf8");

  assert.match(source, /const debugRunId = simulation\.simulationId \|\| simulationId/);
  assert.match(source, /\$\{state\.locale === "en" \? "Debug ID" : "调试号"\} · \$\{esc\(debugRunId\)\}/);
  assert.doesNotMatch(source, /\$\{esc\(simulation\.teamId \|\| teamId\)\} · \$\{esc\(simulation\.teamVersionId \|\| teamVersionId\)\}/);
});

test("Harness capability discovery ignores responses that no longer match the selection", async () => {
  const source = await readFile(appSourcePath, "utf8");
  const discovery = source.slice(source.indexOf("const showDiscovery = async () => {"), source.indexOf("form.elements.filesystem.value = env.filesystem"));

  assert.match(discovery, /const requestVersion = \+\+discoveryRequestVersion/);
  assert.match(discovery, /discoveryKey === `\$\{backendSelect\.value\}:\$\{form\.elements\.model\.value\.trim\(\)\}`/);
  assert.match(discovery, /const payload = await discover\([\s\S]*?if \(!isCurrentRequest\(\)\) return;/);
  assert.match(discovery, /catch \(error\) \{\s*if \(isCurrentRequest\(\)\)/);
  assert.match(discovery, /finally \{\s*if \(isCurrentRequest\(\)\) saveButtons\.forEach/);
});
