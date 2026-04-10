import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, writeFile } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

async function setupRepairFixture(mode) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-repair-"));
  const scriptPath = path.resolve(tempRoot, "repair-tool.js");
  const systemPath = path.resolve(tempRoot, "repair-system.mmd");
  const profilesPath = path.resolve(tempRoot, "repair-profiles.json");
  const toolsPath = path.resolve(tempRoot, "repair-tools.json");

  await writeFile(
    scriptPath,
    `const mode = process.argv[2];
switch (mode) {
  case "wrapped-json":
    console.log('assistant\\n\\\`\\\`\\\`json\\n{"event":"DONE","content":"wrapped"}\\n\\\`\\\`\\\`');
    break;
  case "unknown-event":
    console.log(JSON.stringify({ event: "NOT_DONE", content: "normalized" }));
    break;
  case "schema-mismatch":
    console.log(JSON.stringify({ event: "DONE", content: 123 }));
    break;
  default:
    throw new Error(\`Unsupported mode: \${mode}\`);
}
`,
    "utf8"
  );

  await writeFile(
    systemPath,
    `flowchart TD
%% system.id=repair.demo
%% system.version=1.0.0
%% law.global=law.branch
%% entry.role=test-operator
%% exec.bind.test-operator=profile.repair

input -->|GO| operator[Role:test-operator]
operator[Role:test-operator] -->|DONE| output
`,
    "utf8"
  );

  await writeFile(
    profilesPath,
    JSON.stringify([{ profileId: "profile.repair", toolRef: "tool.repair" }], null, 2),
    "utf8"
  );

  await writeFile(
    toolsPath,
    JSON.stringify(
      {
        tools: [
          {
            toolRef: "tool.repair",
            runner: "local_shell",
            command: "node",
            argsTemplate: [scriptPath, mode],
            stdinMode: "none"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  return {
    tempRoot,
    systemPath,
    profilesPath,
    toolsPath,
    lawsPath: path.resolve("tests/fixtures/laws/law-branch.json")
  };
}

test("runtime repairs wrapped JSON tool output once", async () => {
  const fixture = await setupRepairFixture("wrapped-json");
  const result = await runSystemWithAdapter({
    systemPath: fixture.systemPath,
    profilesPath: fixture.profilesPath,
    toolsPath: fixture.toolsPath,
    lawsPath: fixture.lawsPath,
    prompt: "repair wrapped json",
    workdir: fixture.tempRoot
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "test-operator");
  assert.equal(result.auditTrail[0]?.repair?.kind, "invalid_json");
  assert.equal(result.auditTrail[0]?.repair?.applied, true);
});

test("runtime normalizes unknown event only when one event is allowed", async () => {
  const fixture = await setupRepairFixture("unknown-event");
  const result = await runSystemWithAdapter({
    systemPath: fixture.systemPath,
    profilesPath: fixture.profilesPath,
    toolsPath: fixture.toolsPath,
    lawsPath: fixture.lawsPath,
    prompt: "repair unknown event",
    workdir: fixture.tempRoot
  });

  assert.strictEqual(result.status, "done");
  assert.strictEqual(result.finalRoleId, "test-operator");
  assert.equal(result.auditTrail[0]?.selectedEvent, "DONE");
  assert.equal(result.auditTrail[0]?.repair?.kind, "unknown_event");
});

test("runtime fails fast on schema mismatch after parsing output", async () => {
  const fixture = await setupRepairFixture("schema-mismatch");
  const result = await runSystemWithAdapter({
    systemPath: fixture.systemPath,
    profilesPath: fixture.profilesPath,
    toolsPath: fixture.toolsPath,
    lawsPath: fixture.lawsPath,
    prompt: "schema mismatch",
    workdir: fixture.tempRoot
  });

  assert.strictEqual(result.status, "failed");
  assert.match(result.error ?? "", /output\.schema\.json/);
  assert.match(result.error ?? "", /\$\.content/);
});
