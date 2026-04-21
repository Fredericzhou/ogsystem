import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";

async function writeDefaultModelSelection(workdir) {
  await writeFile(
    path.resolve(workdir, ".ogs", "model-selection.json"),
    JSON.stringify(
      {
        configVersion: "1",
        defaults: {
          model: "opencode/gpt-5-nano",
          timeoutMs: 120000,
          maxOutputBytes: 65536
        }
      },
      null,
      2
    ),
    "utf8"
  );
}

async function writeModelBoundRole(args) {
  const roleDir = path.resolve(args.rolesRoot, args.roleId);
  await mkdir(roleDir, { recursive: true });
  await writeFile(
    path.resolve(roleDir, "role.json"),
    JSON.stringify(
      {
        roleId: args.roleId,
        roleVersion: "1.0.0",
        name: args.name ?? args.roleId,
        description: args.description ?? `${args.roleId} test role`,
        promptTemplate: "prompt.md",
        outputSchema: "output.schema.json"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "prompt.md"),
    [
      "{{agent}}",
      "",
      "Allowed events:",
      "{{allowed_events}}",
      "",
      "User preferences:",
      "{{user_preferences}}",
      "",
      "Task:",
      "{{task}}",
      "",
      "Input:",
      "{{input}}"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "agent.md"),
    `# ${args.roleId}\n\n${args.description ?? `${args.roleId} test role`}\n`,
    "utf8"
  );
  await writeFile(
    path.resolve(roleDir, "output.schema.json"),
    JSON.stringify(
      {
        type: "object",
        properties: {
          event: {
            type: "string",
            enum: args.allowedEvents
          },
          content: {
            type: "string"
          },
          data: {
            type: "object",
            additionalProperties: true
          }
        },
        required: args.requireEvent === false ? [] : ["event"],
        additionalProperties: true
      },
      null,
      2
    ),
    "utf8"
  );
}

test("transition mode fails closed when a skipped flow leaves a join orphaned", async () => {
  const repoRoot = process.cwd();
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-transition-orphan-join-"));
  const systemPath = path.resolve(tempRoot, "system.mmd");
  const runtimePath = path.resolve(tempRoot, ".ogs", "runtime.json");
  const rolesRoot = path.resolve(tempRoot, "og-roles", "roles");
  const contractsDir = path.resolve(tempRoot, "contracts");

  await mkdir(path.resolve(tempRoot, ".ogs"), { recursive: true });
  await mkdir(rolesRoot, { recursive: true });
  await mkdir(contractsDir, { recursive: true });

  await writeFile(
    runtimePath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: "./og-roles",
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeDefaultModelSelection(tempRoot);

  await writeModelBoundRole({
    rolesRoot,
    roleId: "dispatcher",
    allowedEvents: ["PASS"],
    requireEvent: false
  });
  await writeModelBoundRole({
    rolesRoot,
    roleId: "a",
    allowedEvents: ["DONE_A"]
  });
  await writeModelBoundRole({
    rolesRoot,
    roleId: "b",
    allowedEvents: ["DONE_B"]
  });
  await writeModelBoundRole({
    rolesRoot,
    roleId: "review",
    allowedEvents: ["DONE"]
  });

  await writeFile(
    path.resolve(contractsDir, "dispatch-a.schema.json"),
    JSON.stringify(
      {
        type: "object",
        properties: {
          content: {
            type: "string",
            const: "dispatch to branch a"
          }
        },
        required: ["content"],
        additionalProperties: true
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(contractsDir, "dispatch-b.schema.json"),
    JSON.stringify(
      {
        type: "object",
        properties: {
          content: {
            type: "string"
          }
        },
        required: ["content"],
        additionalProperties: true
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    path.resolve(contractsDir, "handoff.contracts.json"),
    JSON.stringify(
      {
        version: 1,
        contracts: [
          {
            id: "dispatcher.a.v1",
            kind: "flow",
            match: {
              fromRoleId: "dispatcher",
              mode: "split",
              toRoleId: "a"
            },
            schema: "dispatch-a.schema.json",
            onViolation: "WARN"
          },
          {
            id: "dispatcher.b.v1",
            kind: "flow",
            match: {
              fromRoleId: "dispatcher",
              mode: "split",
              toRoleId: "b"
            },
            schema: "dispatch-b.schema.json",
            onViolation: "FAIL"
          }
        ]
      },
      null,
      2
    ),
    "utf8"
  );

  await writeFile(
    systemPath,
    `flowchart TD
%% system.id=test.transition.orphan.join
%% system.version=1.0.0
%% law.global=law.console.base
%% entry.role=dispatcher
%% handoff.mode=transition
%% handoff.contracts=contracts/handoff.contracts.json
%% role.mode.dispatcher=parallel_split
%% join.mode.review=quorum_of
%% join.sources.review=a,b
%% join.min.review=2
%% model.bind.dispatcher=fast-gpt54
%% model.bind.a=balanced-gpt52
%% model.bind.b=balanced-gpt52
%% model.bind.review=deep-o3

input -->|START| dispatcher[Role:dispatcher]
dispatcher[Role:dispatcher] -->|TO_A| a[Role:a]
dispatcher[Role:dispatcher] -->|TO_B| b[Role:b]
a[Role:a] -->|DONE_A| review[Role:review]
b[Role:b] -->|DONE_B| review[Role:review]
review[Role:review] -->|DONE| output
`,
    "utf8"
  );

  const result = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath: runtimePath,
    lawsPath: path.resolve(repoRoot, ".ogs", "laws.json"),
    userProfilePath: path.resolve(repoRoot, ".ogs", "user-profile.json"),
    prompt: "orphan join prompt",
    workdir: tempRoot,
    dryRun: true
  });

  assert.strictEqual(result.status, "failed");
  assert.match(result.error ?? "", /unreachable/i);
  assert.strictEqual(result.errorEnvelope?.errorCode, "GRAPH_JOIN_UNREACHABLE_AFTER_TRANSITION_SKIP");
});
