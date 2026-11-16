import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

async function read(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("v2 role-first graph contract is present in active documentation", async () => {
  const architecture = await read("docs/development/role-execution-architecture.md");
  const acceptance = await read("docs/development/v2-validation-and-acceptance.md");
  const manual = await read("docs/usage/usage-manual.md");
  const usageIndex = await read("docs/usage/README.md");
  const readme = await read("README.md");

  assert.match(architecture, /Role Contract/);
  assert.match(architecture, /Business Graph \/ Flow/);
  assert.match(architecture, /HandoffProjection/);
  assert.match(architecture, /Harness Template/);
  assert.match(architecture, /executable intersection/);
  assert.match(acceptance, /S1 \| Linear handoff/);
  assert.match(acceptance, /S19 \| Start and terminal aggregation/);
  assert.match(manual, /Create a Business Graph whose nodes reference v2 Role Contracts/);
  assert.match(manual, /Flow Contracts/);
  assert.match(usageIndex, /role-first/);
  assert.match(usageIndex, /direct handoff/);
  assert.match(readme, /Graph modeling invariant/);
  assert.match(readme, /direct role-to-role handoff/);
});
