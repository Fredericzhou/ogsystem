import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("role-first graph contract is present in product documentation", async () => {
  const core = await read("docs/usage/ogsystem-core-concepts.md");
  const constitution = await read("docs/usage/ogsystem-orchestration-semantics-v1.md");
  const manual = await read("docs/usage/ogsystem-semantics-manual.md");
  const readme = await read("README.md");

  assert.match(core, /Role-first Graph Contract/);
  assert.match(core, /direct role-to-role handoff/);
  assert.match(core, /Events, actions, tasks, gateways, process steps/);
  assert.match(constitution, /角色优先图契约/);
  assert.match(manual, /角色优先图契约/);
  assert.match(manual, /execution-outcome\.json/);
  assert.doesNotMatch(manual, /^(?:[A-Za-z0-9_-]+)?\[Role:(?:execution_outcome|checkpoint|state)\]/m);
  assert.match(readme, /Graph modeling invariant/);
  assert.match(readme, /direct role-to-role handoff/);
});
