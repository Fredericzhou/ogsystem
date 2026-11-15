import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createGitCollaboration, runSystemWithAdapter } from "../dist/runtime/adapter.js";
import { latestRoleContract } from "../tests-support/role-fixture.mjs";

const execFile = promisify(execFileCallback);

async function git(cwd, args) {
  return execFile("git", [
    "-c", "user.name=OGS Python App Test",
    "-c", "user.email=ogs-python-app@example.test",
    ...args
  ], { cwd, maxBuffer: 8 * 1024 * 1024 });
}

async function writeRole(rolesRoot, roleId) {
  const roleDir = join(rolesRoot, roleId);
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, "role.json"), JSON.stringify({
    roleId,
    roleVersion: "1.0.0",
    name: roleId,
    description: `Python application role ${roleId}`,
    promptTemplate: "prompt.md",
    outputSchema: "output.schema.json",
    ...latestRoleContract({ events: ["READY"], allowedTools: ["tool.python"] }),
    failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
    constraints: { writableStateFields: [], allowedTools: ["tool.python"] }
  }, null, 2), "utf8");
  await writeFile(join(roleDir, "prompt.md"), "{{agent}}\n{{task}}\n{{input}}\n", "utf8");
  await writeFile(join(roleDir, "agent.md"), `# ${roleId}\n`, "utf8");
  await writeFile(join(roleDir, "output.schema.json"), JSON.stringify({
    type: "object",
    properties: { event: { type: "string", enum: ["READY"] }, content: { type: "string" } },
    required: ["event"],
    additionalProperties: true
  }, null, 2), "utf8");
}

test("real Python app collaboration merges parallel code and tests, validates at Join, and publishes", async () => {
  const controlRoot = await mkdtemp(join(tmpdir(), "ogs-python-app-collaboration-"));
  const repo = join(controlRoot, "python-app");
  const worktrees = join(controlRoot, "worktrees");
  const rolesRoot = join(controlRoot, "og-roles", "roles");
  const scriptsRoot = join(controlRoot, "scripts");
  const systemPath = join(controlRoot, "system.mmd");
  const profilesPath = join(controlRoot, "profiles.json");
  const toolsPath = join(controlRoot, "tools.json");
  const runtimePath = join(controlRoot, ".ogs", "runtime.json");
  const lawsPath = join(controlRoot, ".ogs", "laws.json");
  const userProfilePath = join(controlRoot, ".ogs", "user-profile.json");
  const modelSelectionPath = join(controlRoot, ".ogs", "model-selection.json");

  try {
    await mkdir(join(controlRoot, ".ogs"), { recursive: true });
    await mkdir(scriptsRoot, { recursive: true });
    await mkdir(rolesRoot, { recursive: true });
    await mkdir(repo, { recursive: true });
    await writeFile(join(repo, "README.md"), "Python calculator service\n", "utf8");
    await writeFile(join(repo, ".gitignore"), "__pycache__/\n*.py[cod]\n", "utf8");
    await git(controlRoot, ["init", "--quiet", repo]);
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "--quiet", "-m", "base Python application"]);
    const baseCommit = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();

    await cp(resolve(".ogs/laws.json"), lawsPath);
    await cp(resolve(".ogs/user-profile.json"), userProfilePath);
    await writeFile(modelSelectionPath, JSON.stringify({ configVersion: "3" }, null, 2), "utf8");
    await writeFile(runtimePath, JSON.stringify({ executor: "opencode", roleRepo: "./og-roles", runsDir: ".ogs/runs" }, null, 2), "utf8");
    await writeFile(profilesPath, JSON.stringify([
      { profileId: "profile.python", toolRef: "tool.python", timeoutMs: 30000 }
    ], null, 2), "utf8");

    const toolScript = join(scriptsRoot, "python-role.py");
    await writeFile(toolScript, `import json
import os
import subprocess
import sys
from pathlib import Path

role = os.environ["OGSYSTEM_ROLE_ID"]
if role == "api":
    Path("calculator.py").write_text(
        "import sys\\n\\ndef add(left, right):\\n    return left + right\\n\\ndef multiply(left, right):\\n    return left * right\\n\\nif __name__ == '__main__':\\n    operation, left, right = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])\\n    function = add if operation == 'add' else multiply\\n    print(function(left, right))\\n",
        encoding="utf-8",
    )
elif role == "tests":
    Path("test_calculator.py").write_text(
        "import unittest\\n\\nfrom calculator import add, multiply\\n\\n\\nclass CalculatorTests(unittest.TestCase):\\n    def test_add(self):\\n        self.assertEqual(add(2, 3), 5)\\n\\n    def test_multiply(self):\\n        self.assertEqual(multiply(4, 5), 20)\\n\\n\\nif __name__ == '__main__':\\n    unittest.main()\\n",
        encoding="utf-8",
    )
elif role == "join":
    result = subprocess.run(
        [sys.executable, "-m", "unittest", "discover", "-v"],
        capture_output=True,
        text=True,
        check=False,
    )
    Path("python-test-report.txt").write_text(result.stdout + result.stderr, encoding="utf-8")
    if result.returncode != 0:
        sys.stderr.write(result.stdout + result.stderr)
        raise SystemExit(result.returncode)

print(json.dumps({"event": "READY", "content": role}))
`, "utf8");
    await writeFile(toolsPath, JSON.stringify({ tools: [{
      toolRef: "tool.python",
      runner: "local_shell",
      command: "python3",
      argsTemplate: [toolScript],
      stdinMode: "none"
    }] }, null, 2), "utf8");

    for (const roleId of ["dispatch", "api", "tests", "join"]) await writeRole(rolesRoot, roleId);
    await writeFile(systemPath, `flowchart TD
%% system.id=test.python.app.collaboration
%% system.version=1.0.0
%% law.global=law.console.base
%% exec.bind.dispatch=profile.python
%% exec.bind.api=profile.python
%% exec.bind.tests=profile.python
%% exec.bind.join=profile.python
%% role.mode.dispatch=parallel_split
%% join.mode.join=all_of
%% join.sources.join=api,tests
start[开始] -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|READY| api[Role:api]
dispatch[Role:dispatch] -->|READY| tests[Role:tests]
api[Role:api] -->|READY| join[Role:join]
tests[Role:tests] -->|READY| join[Role:join]
join[Role:join] -->|READY| end[结束]
`, "utf8");

    const collaboration = createGitCollaboration({
      repositoryRoot: repo,
      worktreeRoot: worktrees,
      runId: "run-python-app"
    });
    const published = [];
    const result = await runSystemWithAdapter({
      systemPath,
      workdir: controlRoot,
      targetDir: repo,
      runtimeConfigPath: runtimePath,
      lawsPath,
      userProfilePath,
      profilesPath,
      toolsPath,
      runId: "run-python-app",
      prompt: "Implement and validate the Python calculator application.",
      gitCollaboration: {
        collaboration,
        baseCommit,
        publish: async (merge) => {
          published.push(merge);
          await git(repo, ["merge", "--ff-only", merge.mergeCommit]);
        }
      }
    });

    assert.equal(result.status, "done", JSON.stringify(result));
    assert.equal(published.length, 1);
    assert.equal(published[0].status, "merged");
    assert.ok(published[0].mergeCommit);
    assert.equal(await readFile(join(repo, "calculator.py"), "utf8"), "import sys\n\ndef add(left, right):\n    return left + right\n\ndef multiply(left, right):\n    return left * right\n\nif __name__ == '__main__':\n    operation, left, right = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])\n    function = add if operation == 'add' else multiply\n    print(function(left, right))\n");
    assert.match(await readFile(join(repo, "python-test-report.txt"), "utf8"), /OK/);
    const verification = await execFile("python3", ["-m", "unittest", "discover", "-v"], { cwd: repo });
    assert.match(`${verification.stdout}\n${verification.stderr}`, /OK/);
    const cliResult = await execFile("python3", ["calculator.py", "add", "2", "3"], { cwd: repo });
    assert.equal(cliResult.stdout.trim(), "5");
    const multiplyResult = await execFile("python3", ["calculator.py", "multiply", "6", "7"], { cwd: repo });
    assert.equal(multiplyResult.stdout.trim(), "42");
    assert.equal((await git(repo, ["status", "--porcelain=v1"])).stdout.trim(), "");
    const events = (await readFile(join(controlRoot, ".ogs", "runs", "run-python-app", "events.ndjson"), "utf8"))
      .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(events.filter((event) => event.type === "git_collaboration_role_commit").length >= 3);
    assert.ok(events.some((event) => event.type === "git_collaboration_merge" && event.phase === "join" && event.status === "merged"));
    assert.ok(events.some((event) => event.type === "git_collaboration_merge" && event.phase === "final" && event.status === "merged"));
  } finally {
    await rm(controlRoot, { recursive: true, force: true });
  }
});
