import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";

import { inspectProjectReadiness } from "../dist/visualizer/project-readiness.js";

async function withTempProject(run) {
  const workdir = await mkdtemp(path.join(os.tmpdir(), "ogsystem-project-readiness-"));
  try {
    await mkdir(path.join(workdir, ".ogs"), { recursive: true });
    await writeFile(
      path.join(workdir, ".ogs", "runtime.json"),
      JSON.stringify({ executor: "opencode", roleRepo: "./og-roles" }, null, 2),
      "utf8"
    );
    await run(workdir);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
}

async function writeRolePackage(workdir, roleId, options = {}) {
  const roleDir = path.join(workdir, "og-roles", "roles", roleId);
  await mkdir(roleDir, { recursive: true });
  await writeFile(
    path.join(roleDir, "role.json"),
    JSON.stringify(
      {
        roleId,
        roleVersion: "1.0.0",
        name: roleId,
        description: `${roleId} role`,
        promptTemplate: "prompt.md",
        outputSchema: "output.schema.json"
      },
      null,
      2
    ),
    "utf8"
  );
  if (!options.omitPrompt) {
    await writeFile(path.join(roleDir, "prompt.md"), "{{agent}}\n\n{{task}}\n", "utf8");
  }
  if (!options.omitOutputSchema) {
    await writeFile(
      path.join(roleDir, "output.schema.json"),
      JSON.stringify(
        {
          "$schema": "http://json-schema.org/draft-07/schema#",
          type: "object",
          properties: {
            content: { type: "string" },
            event: { type: "string" },
            data: { type: "object" }
          },
          required: ["content"],
          additionalProperties: true
        },
        null,
        2
      ),
      "utf8"
    );
  }
  if (!options.omitAgent) {
    await writeFile(path.join(roleDir, "agent.md"), `# ${roleId}\n`, "utf8");
  }
  if (!options.omitSource) {
    await writeFile(path.join(roleDir, "source.json"), JSON.stringify({ source: "test" }, null, 2), "utf8");
  }
}

async function writeSystem(workdir, lines) {
  await writeFile(path.join(workdir, "system.mmd"), `${lines.join("\n")}\n`, "utf8");
}

async function writeModelCatalog(workdir, models) {
  await writeFile(
    path.join(workdir, ".ogs", "model-catalog.json"),
    JSON.stringify(
      {
        catalogVersion: "1",
        generatedAt: "2026-04-30T00:00:00.000Z",
        source: { command: "test" },
        models
      },
      null,
      2
    ),
    "utf8"
  );
}

test("project readiness reports missing execution bindings", async () => {
  await withTempProject(async (workdir) => {
    await writeRolePackage(workdir, "planner");
    await writeRolePackage(workdir, "writer");
    await writeSystem(workdir, [
      "flowchart TD",
      "%% system.id=readiness.missing.binding",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=planner",
      "%% model.bind.planner=opencode/gpt-5-nano",
      "input -->|ENTER| planner[Role:planner]",
      "planner[Role:planner] -->|DONE| writer[Role:writer]",
      "writer[Role:writer] -->|DONE| output"
    ]);

    const readiness = await inspectProjectReadiness(workdir);

    assert.equal(readiness.systemId, "readiness.missing.binding");
    assert.equal(readiness.canDryRun, false);
    assert.deepEqual(readiness.missingBindings, [
      {
        roleId: "writer",
        reason: "no exec.bind, model.bind, or model-selection default resolved"
      }
    ]);
    assert.ok(readiness.blockers.some((issue) => issue.code === "READINESS_BINDING_MISSING"));
  });
});

test("project readiness reports missing required role package files", async () => {
  await withTempProject(async (workdir) => {
    await writeRolePackage(workdir, "planner", { omitAgent: true });
    await writeSystem(workdir, [
      "flowchart TD",
      "%% system.id=readiness.role.health",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=planner",
      "%% model.bind.planner=opencode/gpt-5-nano",
      "input -->|ENTER| planner[Role:planner]",
      "planner[Role:planner] -->|DONE| output"
    ]);

    const readiness = await inspectProjectReadiness(workdir);
    const roleHealth = readiness.roleRepoHealth.roles.find((role) => role.roleId === "planner");

    assert.equal(readiness.canDryRun, false);
    assert.equal(roleHealth.status, "missing");
    assert.equal(roleHealth.files.agent, false);
    assert.ok(roleHealth.missingFiles.includes("agent"));
    assert.ok(readiness.blockers.some((issue) => issue.code === "READINESS_ROLE_PACKAGE_FILES_MISSING"));
  });
});

test("project readiness reports strict handoff missing contract coverage", async () => {
  await withTempProject(async (workdir) => {
    await writeRolePackage(workdir, "planner");
    await writeRolePackage(workdir, "writer");
    const contractsDir = path.join(workdir, "contracts");
    await mkdir(contractsDir, { recursive: true });
    await writeFile(
      path.join(contractsDir, "handoff.contracts.json"),
      JSON.stringify({ version: 1, contracts: [] }, null, 2),
      "utf8"
    );
    await writeSystem(workdir, [
      "flowchart TD",
      "%% system.id=readiness.strict.contract",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=planner",
      "%% handoff.mode=strict",
      `%% handoff.contracts=${path.join(contractsDir, "handoff.contracts.json")}`,
      "%% model.bind.planner=opencode/gpt-5-nano",
      "%% model.bind.writer=opencode/gpt-5-nano",
      "input -->|ENTER| planner[Role:planner]",
      "planner[Role:planner] -->|HANDOFF| writer[Role:writer]",
      "writer[Role:writer] -->|DONE| output"
    ]);

    const readiness = await inspectProjectReadiness(workdir);

    assert.equal(readiness.canDryRun, false);
    assert.equal(readiness.contractCoverage.handoffMode, "strict");
    assert.equal(readiness.contractCoverage.eligibleFlowCount, 1);
    assert.equal(readiness.contractCoverage.missingFlowCount, 1);
    assert.deepEqual(
      readiness.contractCoverage.missingFlows.map((flow) => flow.flowKey),
      ["planner:HANDOFF:writer"]
    );
    assert.ok(
      readiness.blockers.some(
        (issue) => issue.code === "READINESS_STRICT_HANDOFF_CONTRACT_MISSING"
      )
    );
  });
});

test("project readiness blocks model capability mismatches and warns on missing toolcall", async () => {
  await withTempProject(async (workdir) => {
    await writeRolePackage(workdir, "planner");
    await writeRolePackage(workdir, "writer");
    await writeModelCatalog(workdir, [
      {
        ref: "opencode/textless",
        provider: "opencode",
        model: "textless",
        status: "active",
        capabilities: { textInput: true, textOutput: false, toolcall: true },
        variants: []
      },
      {
        ref: "opencode/no-tools",
        provider: "opencode",
        model: "no-tools",
        status: "active",
        capabilities: { textInput: true, textOutput: true, toolcall: false },
        variants: []
      }
    ]);
    await writeSystem(workdir, [
      "flowchart TD",
      "%% system.id=readiness.model.capability",
      "%% system.version=1.0.0",
      "%% law.global=law.minimal.base",
      "%% entry.role=planner",
      "%% model.bind.planner=opencode/textless",
      "%% model.bind.writer=opencode/no-tools",
      "input -->|ENTER| planner[Role:planner]",
      "planner[Role:planner] -->|DONE| writer[Role:writer]",
      "writer[Role:writer] -->|DONE| output"
    ]);

    const readiness = await inspectProjectReadiness(workdir);

    assert.equal(readiness.canDryRun, false);
    assert.equal(readiness.modelCapabilityChecks.length, 2);
    assert.ok(readiness.blockers.some((issue) => issue.code === "READINESS_MODEL_CAPABILITY_MISMATCH" && issue.roleId === "planner"));
    assert.ok(readiness.warnings.some((issue) => issue.code === "READINESS_MODEL_CAPABILITY_WARNING" && issue.roleId === "writer"));
  });
});
