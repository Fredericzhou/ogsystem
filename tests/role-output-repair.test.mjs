import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

async function setupRepairFixture(args) {
  const mode = args.mode;
  const roleId = args.roleId ?? "test-operator";
  const systemSource =
    args.systemSource ??
    `flowchart TD
%% system.id=repair.demo
%% system.version=1.0.0
%% law.global=law.branch
%% entry.role=${roleId}
%% exec.bind.${roleId}=profile.repair

input -->|GO| operator[Role:${roleId}]
operator[Role:${roleId}] -->|DONE| output
`;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-repair-"));
  const scriptPath = path.resolve(tempRoot, "repair-tool.js");
  const systemPath = path.resolve(tempRoot, "repair-system.mmd");
  const profilesPath = path.resolve(tempRoot, "repair-profiles.json");
  const toolsPath = path.resolve(tempRoot, "repair-tools.json");
  const runtimeConfigPath = path.resolve(tempRoot, "runtime.json");
  const roleDir = path.resolve(tempRoot, "og-roles", "roles", "test-operator");

  await mkdir(roleDir, { recursive: true });
  await writeFile(
    path.resolve(roleDir, "role.json"),
    JSON.stringify(
      {
        roleId: "test-operator",
        roleVersion: "1.0.0",
        name: "Test Operator",
        description: "Repair-policy fixture role.",
        promptTemplate: "prompt.md",
        outputSchema: "output.schema.json",
        tags: ["test"]
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(path.resolve(roleDir, "prompt.md"), "Task:\n{{task}}\n\nReturn JSON only.\n", "utf8");
  await writeFile(
    path.resolve(roleDir, "output.schema.json"),
    JSON.stringify(
      {
        type: "object",
        required: ["event", "content"],
        properties: {
          event: {
            type: "string",
            enum: ["DONE"]
          },
          content: {
            type: "string"
          },
          data: {
            type: "object"
          }
        },
        additionalProperties: false
      },
      null,
      2
    ),
    "utf8"
  );

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
    console.log(JSON.stringify({ event: "WRONG", content: "bad" }));
    break;
  default:
    throw new Error(\`Unsupported mode: \${mode}\`);
}
`,
    "utf8"
  );

  await writeFile(
    systemPath,
    systemSource,
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

  await writeFile(
    runtimeConfigPath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: path.resolve("og-roles"),
        modelRepo: path.resolve("og-models"),
        runsDir: ".ogsystems"
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
    runtimeConfigPath,
    lawsPath: path.resolve("tests/fixtures/laws/law-branch.json")
  };
}

test("runtime repairs wrapped JSON tool output once", async () => {
  const fixture = await setupRepairFixture({ mode: "wrapped-json" });
  const result = await runSystemWithAdapter({
    systemPath: fixture.systemPath,
    runtimeConfigPath: fixture.runtimeConfigPath,
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
  const fixture = await setupRepairFixture({ mode: "unknown-event" });
  const result = await runSystemWithAdapter({
    systemPath: fixture.systemPath,
    runtimeConfigPath: fixture.runtimeConfigPath,
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
  const fixture = await setupRepairFixture({
    mode: "schema-mismatch",
    roleId: "test-decision",
    systemSource: `flowchart TD
%% system.id=repair.schema.demo
%% system.version=1.0.0
%% law.global=law.branch
%% entry.role=test-decision
%% exec.bind.test-decision=profile.repair

input -->|GO| decision[Role:test-decision]
decision[Role:test-decision] -->|PATH_A| branchA[Role:test-branch-a]
decision[Role:test-decision] -->|PATH_B| branchB[Role:test-branch-b]
branchA[Role:test-branch-a] -->|END_A| output
branchB[Role:test-branch-b] -->|END_B| output
`
  });
  const result = await runSystemWithAdapter({
    systemPath: fixture.systemPath,
    runtimeConfigPath: fixture.runtimeConfigPath,
    profilesPath: fixture.profilesPath,
    toolsPath: fixture.toolsPath,
    lawsPath: fixture.lawsPath,
    prompt: "schema mismatch",
    workdir: fixture.tempRoot
  });

  assert.strictEqual(result.status, "failed");
  assert.match(result.error ?? "", /output\.schema\.json/);
  assert.match(result.error ?? "", /\$\.event/);
});
