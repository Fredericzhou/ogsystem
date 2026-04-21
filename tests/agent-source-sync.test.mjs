import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";

import { runSystemWithAdapter } from "../dist/runtime/adapter.js";
import { loadRolePackage } from "../dist/runtime/role-repo.js";

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

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function writeAgencyFixture(rootDir, files) {
  await mkdir(rootDir, { recursive: true });
  await writeFile(
    path.resolve(rootDir, "README.md"),
    "# The Agency: AI Specialists Ready to Transform Your Workflow\n",
    "utf8"
  );
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.resolve(rootDir, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content, "utf8");
  }
}

test("sync-agent-sources generates canonical agency roles and runtime can load them", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-agent-source-"));
  const sourceRoot = path.resolve(tempRoot, "agency-agents");
  const rolesRepoRoot = path.resolve(tempRoot, "generated-og-roles");
  const rolesRoot = path.resolve(rolesRepoRoot, "roles");
  const lockFile = path.resolve(rolesRepoRoot, "sources.lock.json");
  const runtimeRoot = path.resolve(tempRoot, "runtime-project");
  const runtimeConfigPath = path.resolve(runtimeRoot, ".ogs", "runtime.json");
  const systemPath = path.resolve(runtimeRoot, "system.mmd");

  await writeAgencyFixture(sourceRoot, {
    "engineering/engineering-frontend-developer.md": [
      "name Frontend Developer",
      "description Expert frontend developer specializing in modern web technologies",
      "# Frontend Developer Agent Personality",
      "",
      "You build responsive, accessible interfaces."
    ].join("\n")
  });

  const sync = await runCommand("node", [
    "tools/agent-source/sync-agent-sources.mjs",
    "--source",
    "agency-agents",
    "--source-root",
    sourceRoot,
    "--roles-root",
    rolesRoot,
    "--lock-file",
    lockFile
  ]);
  assert.equal(sync.code, 0, sync.stderr);

  const generatedRole = await loadRolePackage({
    roleId: "imported.agency.frontend-developer",
    roleRootDir: rolesRoot
  });
  assert.match(generatedRole.agent, /Frontend Developer Agent Personality/);

  const promptTemplate = await readFile(
    path.resolve(rolesRoot, "imported.agency.frontend-developer", "prompt.md"),
    "utf8"
  );
  assert.match(promptTemplate, /User preferences:/);
  assert.match(promptTemplate, /Input:/);

  const sourceJson = JSON.parse(
    await readFile(path.resolve(rolesRoot, "imported.agency.frontend-developer", "source.json"), "utf8")
  );
  assert.equal(sourceJson.sourceId, "agency-agents");
  assert.equal(sourceJson.upstream.path, "engineering/engineering-frontend-developer.md");

  const lock = JSON.parse(await readFile(lockFile, "utf8"));
  assert.deepStrictEqual(lock.sources["agency-agents"].roleIds, ["imported.agency.frontend-developer"]);

  await mkdir(path.resolve(runtimeRoot, ".ogs"), { recursive: true });
  await writeFile(
    runtimeConfigPath,
    JSON.stringify(
      {
        executor: "opencode",
        roleRepo: rolesRepoRoot,
        modelRepo: path.resolve("og-models"),
        runsDir: ".ogs/runs"
      },
      null,
      2
    ),
    "utf8"
  );
  await writeDefaultModelSelection(runtimeRoot);
  await writeFile(
    path.resolve(runtimeRoot, ".ogs", "laws.json"),
    JSON.stringify(
      {
        laws: [
          {
            lawId: "law.imported.base",
            constraints: {
              forbiddenToolRefs: [],
              maxTransitions: 4,
              allowNoopWithoutExecutionBinding: false
            }
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
    [
      "flowchart TD",
      "%% system.id=imported.agency.smoke",
      "%% system.version=1.0.0",
      "%% law.global=law.imported.base",
      "%% entry.role=imported.agency.frontend-developer",
      "%% model.bind.imported.agency.frontend-developer=balanced-gpt52",
      "",
      "input -->|START| agent[Role:imported.agency.frontend-developer]",
      "agent[Role:imported.agency.frontend-developer] -->|DONE| output"
    ].join("\n"),
    "utf8"
  );

  const run = await runSystemWithAdapter({
    systemPath,
    runtimeConfigPath,
    lawsPath: path.resolve(runtimeRoot, ".ogs", "laws.json"),
    workdir: runtimeRoot,
    prompt: "Build a landing page",
    dryRun: true
  });
  assert.equal(run.status, "done");
  assert.equal(run.finalRoleId, "imported.agency.frontend-developer");
});

test("sync-agent-sources removes stale imported agency roles on re-sync", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "ogsystem-agent-source-clean-"));
  const sourceRoot = path.resolve(tempRoot, "agency-agents");
  const rolesRoot = path.resolve(tempRoot, "generated-og-roles", "roles");
  const lockFile = path.resolve(tempRoot, "generated-og-roles", "sources.lock.json");

  await writeAgencyFixture(sourceRoot, {
    "engineering/engineering-frontend-developer.md": "name Frontend Developer\n",
    "testing/testing-code-reviewer.md": "name Code Reviewer\n"
  });

  const firstSync = await runCommand("node", [
    "tools/agent-source/sync-agent-sources.mjs",
    "--source",
    "agency-agents",
    "--source-root",
    sourceRoot,
    "--roles-root",
    rolesRoot,
    "--lock-file",
    lockFile
  ]);
  assert.equal(firstSync.code, 0, firstSync.stderr);

  await rm(path.resolve(sourceRoot, "testing", "testing-code-reviewer.md"));

  const secondSync = await runCommand("node", [
    "tools/agent-source/sync-agent-sources.mjs",
    "--source",
    "agency-agents",
    "--source-root",
    sourceRoot,
    "--roles-root",
    rolesRoot,
    "--lock-file",
    lockFile
  ]);
  assert.equal(secondSync.code, 0, secondSync.stderr);

  await stat(path.resolve(rolesRoot, "imported.agency.frontend-developer"));
  await assert.rejects(
    () => stat(path.resolve(rolesRoot, "imported.agency.code-reviewer")),
    /ENOENT/
  );
});
