import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { invalidateProjectContextCache, loadProjectContext } from "../dist/visualizer/project-context-service.js";

async function writeRolePackage(workdir, roleId) {
  const roleDir = path.join(workdir, "og-roles", "roles", roleId);
  await mkdir(roleDir, { recursive: true });
  await writeFile(
    path.join(roleDir, "role.json"),
    JSON.stringify({
      roleId,
      roleVersion: "1.0.0",
      name: roleId,
      description: `${roleId} role`,
      promptTemplate: "prompt.md",
      outputSchema: "output.schema.json"
    }),
    "utf8"
  );
  await writeFile(path.join(roleDir, "prompt.md"), "{{agent}}\n{{task}}\n", "utf8");
  await writeFile(path.join(roleDir, "agent.md"), `# ${roleId}\n`, "utf8");
  await writeFile(
    path.join(roleDir, "output.schema.json"),
    JSON.stringify({ type: "object", properties: { content: { type: "string" } } }),
    "utf8"
  );
}

async function createProject() {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-project-context-"));
  const contractPath = path.join(workdir, "contracts", "handoff.json");
  await mkdir(path.join(workdir, ".ogs"), { recursive: true });
  await mkdir(path.dirname(contractPath), { recursive: true });
  await writeFile(
    path.join(workdir, ".ogs", "runtime.json"),
    JSON.stringify({ executor: "opencode", roleRepo: "./og-roles" }),
    "utf8"
  );
  await writeFile(
    path.join(workdir, ".ogs", "laws.json"),
    JSON.stringify({
      laws: [{
        lawId: "law.minimal.base",
        constraints: {
          forbiddenToolRefs: [],
          maxTransitions: 8,
          allowNoopWithoutExecutionBinding: false
        }
      }]
    }),
    "utf8"
  );
  await writeFile(
    path.join(workdir, ".ogs", "model-selection.json"),
    JSON.stringify({ configVersion: "1", defaults: { model: "opencode/test-model" } }),
    "utf8"
  );
  await writeRolePackage(workdir, "planner");
  await writeRolePackage(workdir, "writer");
  await writeFile(
    path.join(workdir, "system.mmd"),
    [
      "flowchart TD",
      "%% system.id=cache.context",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=planner",
      "%% handoff.mode=strict",
      `%% handoff.contracts=${contractPath}`,
      "input -->|ENTER| plannerNode[Role:planner]",
      "plannerNode[Role:planner] -->|DONE| writerNode[Role:writer]",
      "writerNode[Role:writer] -->|DONE| output"
    ].join("\n"),
    "utf8"
  );
  await writeFile(
    contractPath,
    JSON.stringify({
      version: 1,
      contracts: [{
        id: "planner-to-writer",
        kind: "flow",
        match: { fromRoleId: "planner", toRoleId: "writer", eventType: "DONE" },
        schema: "flow.schema.json"
      }]
    }),
    "utf8"
  );
  await writeFile(
    path.join(workdir, "contracts", "flow.schema.json"),
    JSON.stringify({ type: "object", properties: { content: { type: "string" } } }),
    "utf8"
  );
  return { workdir, contractPath };
}

test("project context cache invalidates when a loaded role package changes", async () => {
  const { workdir } = await createProject();
  try {
    const first = await loadProjectContext(workdir);
    const roleAgentPath = path.join(workdir, "og-roles", "roles", "writer", "agent.md");
    await writeFile(roleAgentPath, "# writer changed with new context\n", "utf8");

    const second = await loadProjectContext(workdir);

    assert.notStrictEqual(second, first);
    assert.equal(second.rolePackagesByRoleId.get("writer")?.agent, "# writer changed with new context\n");
  } finally {
    invalidateProjectContextCache(workdir);
    await rm(workdir, { recursive: true, force: true });
  }
});

test("project context cache invalidates when a contract schema changes", async () => {
  const { workdir, contractPath } = await createProject();
  try {
    const first = await loadProjectContext(workdir);
    const schemaPath = path.join(path.dirname(contractPath), "flow.schema.json");
    await writeFile(
      schemaPath,
      JSON.stringify({
        type: "object",
        properties: {
          content: { type: "string" },
          changed: { type: "boolean" }
        }
      }),
      "utf8"
    );

    const second = await loadProjectContext(workdir);

    assert.notStrictEqual(second, first);
    assert.notEqual(second.contractPlan?.digest, first.contractPlan?.digest);
    assert.notEqual(second.compilerSnapshot.digest, first.compilerSnapshot.digest);
  } finally {
    invalidateProjectContextCache(workdir);
    await rm(workdir, { recursive: true, force: true });
  }
});
