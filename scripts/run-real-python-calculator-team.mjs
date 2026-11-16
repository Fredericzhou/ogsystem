import { execFile as execFileCallback } from "node:child_process";
import { access, cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { createGitCollaboration, runSystemWithAdapter } from "../dist/runtime/adapter.js";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(".");

async function git(cwd, args) {
  return execFile("git", [
    "-c", "user.name=OGS Real Calculator Test",
    "-c", "user.email=ogs-real-calculator@example.test",
    ...args
  ], { cwd, maxBuffer: 8 * 1024 * 1024 });
}

async function calculatorCommand(project, ...args) {
  try {
    await access(join(project, "calculator.py"));
    return ["calculator.py", ...args];
  } catch {
    await access(join(project, "calculator", "__main__.py"));
    return ["-m", "calculator", ...args];
  }
}

function roleManifest(roleId, description) {
  return {
    roleId,
    roleVersion: "v2-real-calculator",
    name: roleId,
    description,
    promptTemplate: "prompt.md",
    outputSchema: "output.schema.json",
    contractVersion: 2,
    purpose: description,
    responsibility: { kind: "atomic", owns: [], contributes: [], doesNotOwn: [] },
    inputs: { preconditions: [] },
    outputs: { events: ["READY"], postconditions: [] },
    authority: { controlActions: [] },
    constraints: { writableStateFields: [] },
    failure: { retryableErrorCodes: [], terminalErrorCodes: [] },
    audit: { requiredFields: [] },
    ogsContractVersion: 2
  };
}

async function writeRole(rolesRoot, roleId, description, agentInstructions) {
  const roleDir = join(rolesRoot, roleId);
  await mkdir(roleDir, { recursive: true });
  await writeFile(join(roleDir, "role.json"), JSON.stringify(roleManifest(roleId, description), null, 2), "utf8");
  await writeFile(join(roleDir, "agent.md"), agentInstructions, "utf8");
  await writeFile(join(roleDir, "prompt.md"), `{{agent}}

Allowed events:
{{allowed_events}}

User preferences:
{{user_preferences}}

Task:
{{task}}

Input:
{{input}}

Execution rules:
- Work directly in the current execution workspace using the backend-native tools provided by the selected CLI.
- For Codex, use exec_command for commands and tests, and apply_patch for files.
- Do not only explain a solution: inspect the workspace, make the changes, and verify them.
- This run uses Git for source delivery. Keep the response artifact list empty (artifacts: []); source files are delivered by the committed Git worktree and are checked by Join.
- Return exactly one JSON object matching output.schema.json after the work is complete.
`, "utf8");
  await writeFile(join(roleDir, "output.schema.json"), JSON.stringify({
    type: "object",
    required: ["event", "content"],
    properties: {
      event: { type: "string", enum: ["READY"] },
      content: { type: "string" }
    },
    additionalProperties: false
  }, null, 2), "utf8");
}

async function main() {
  const root = await mkdtemp(join(tmpdir(), "ogs-real-python-calculator-team-"));
  const project = join(root, "calculator-project");
  const worktrees = join(root, "worktrees");
  const rolesRoot = join(root, "og-roles", "roles");
  const systemPath = join(root, "system.mmd");
  const runtimePath = join(root, ".ogs", "runtime.json");
  const lawsPath = join(root, ".ogs", "laws.json");
  const profilePath = join(root, ".ogs", "user-profile.json");
  const modelCatalogPath = join(root, ".ogs", "model-catalog.json");
  const executionBindingsPath = join(root, ".ogs", "execution-bindings.json");

  try {
    await mkdir(join(root, ".ogs"), { recursive: true });
    await mkdir(project, { recursive: true });
    await mkdir(rolesRoot, { recursive: true });
    await writeFile(join(project, "README.md"), "# Calculator\n\nBuild a small Python calculator CLI.\n", "utf8");
    await writeFile(join(project, ".gitignore"), "__pycache__/\n*.py[cod]\n", "utf8");
    await git(root, ["init", "--quiet", project]);
    await git(project, ["add", "."]);
    await git(project, ["commit", "--quiet", "-m", "initial calculator project"]);
    const baseCommit = (await git(project, ["rev-parse", "HEAD"])).stdout.trim();

    await cp(join(repoRoot, ".ogs", "laws.json"), lawsPath);
    await cp(join(repoRoot, ".ogs", "user-profile.json"), profilePath);
    await cp(join(repoRoot, ".ogs", "model-catalog.json"), modelCatalogPath);
    await writeFile(executionBindingsPath, JSON.stringify({
      ogsContractVersion: 2,
      schemaVersion: 1,
      harnessTemplates: {
        "calculator-worker": {
          ogsContractVersion: 2,
          schemaVersion: 1,
          kind: "harness",
          templateId: "calculator-worker",
          backend: "codex",
          model: process.env.OGS_REAL_MODEL ?? "gpt-6-luna",
          allowedTools: ["apply_patch", "exec_command"],
          environment: {
            filesystem: "staged",
            process: "allow",
            network: "deny",
            limits: { timeoutMs: 600000, maxOutputBytes: 131072 }
          }
        }
      },
      roles: Object.fromEntries(["dispatch", "implementation", "tests", "join"].map((roleId) => [
        roleId,
        { kind: "harness", harnessTemplate: "calculator-worker" }
      ]))
    }, null, 2), "utf8");
    await writeFile(runtimePath, JSON.stringify({
      configVersion: "2",
      executor: "opencode",
      roleRepo: "./og-roles",
      runsDir: ".ogs/runs"
    }, null, 2), "utf8");

    await writeRole(rolesRoot, "dispatch", "Breaks the calculator task into implementation and test work.", `You are the task dispatcher. Read the user request and identify the two concrete work streams: calculator implementation and automated tests. Do not modify files in this role. Return READY with a short delegation summary and artifacts: [].`);
    await writeRole(rolesRoot, "implementation", "Implements the Python calculator application.", `You are the implementation engineer. Build a small, maintainable Python 3 calculator CLI in the current workspace. It must support add and multiply operations from the command line, expose reusable functions, and include clear input/error handling. Your owned paths are calculator/** and README.md. Do not create, edit, delete, or commit anything under tests/**; the separate tests Role owns that path. Inspect the existing project, create only your owned implementation files, run a basic smoke command, and run git diff --check; fix every reported whitespace error before returning READY. This is a parallel Git source role: do not declare artifacts; return artifacts: [] because your committed worktree is the delivery.`);
    await writeRole(rolesRoot, "tests", "Creates automated tests for the Python calculator.", `You are the test engineer. Add a Python unittest suite for the calculator contract described by the user. Your only owned paths are tests/**. Do not create, edit, delete, or commit calculator/**, README.md, or any other path; the implementation Role owns those paths. The implementation branch is separate, so write tests against the requested public contract and run syntax checks that are possible in this workspace; before returning READY run git diff --check and fix every reported whitespace error. The full suite runs after Join merges both branches. This is a parallel Git source role: do not declare artifacts; return artifacts: [] because your committed worktree is the delivery.`);
    await writeRole(rolesRoot, "join", "Integrates and validates the calculator application.", `You are the integration engineer. You are running after implementation and test branches have been merged into this workspace. Inspect all files, resolve any integration issue, run the complete Python unittest suite with python3 -m unittest discover -s tests -t . -p 'test_*.py' -v, run CLI smoke checks for add and multiply, and fix defects you find. Do not return READY until the application and tests pass. Leave a concise validation report in the workspace and then return READY with artifacts: [].`);

    await writeFile(systemPath, `flowchart TD
%% system.id=real.python.calculator.team
%% system.version=1.0.0
%% law.global=law.console.base
%% role.mode.dispatch=parallel_split
%% join.mode.join=all_of
%% join.sources.join=implementation,tests
start[开始] -->|START| dispatch[Role:dispatch]
dispatch[Role:dispatch] -->|READY| implementation[Role:implementation]
dispatch[Role:dispatch] -->|READY| tests[Role:tests]
implementation[Role:implementation] -->|READY| join[Role:join]
tests[Role:tests] -->|READY| join[Role:join]
join[Role:join] -->|READY| end[结束]
`, "utf8");

    const collaboration = createGitCollaboration({
      repositoryRoot: project,
      worktreeRoot: worktrees,
      runId: "real-python-calculator"
    });
    const published = [];
    const result = await runSystemWithAdapter({
      systemPath,
      workdir: root,
      targetDir: project,
      runtimeConfigPath: runtimePath,
      lawsPath,
      userProfilePath: profilePath,
      runId: "real-python-calculator",
      prompt: "Build a complete Python calculator application from this initial request. It must provide reusable add and multiply functions, a command line interface, automated tests, and a final integration validation. Work as a software team: implementation and tests may proceed in parallel, then integrate and verify before publishing.",
      gitCollaboration: {
        collaboration,
        baseCommit,
        publish: async (merge) => {
          published.push(merge);
          await git(project, ["merge", "--ff-only", merge.mergeCommit]);
        }
      }
    });

    if (result.status !== "done" || published.length !== 1) {
      const runEvents = (await readFile(join(root, ".ogs", "runs", "real-python-calculator", "events.ndjson"), "utf8"))
        .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
      const roleStatuses = runEvents
        .filter((event) => event.type === "audit")
        .map((event) => ({ roleId: event.roleId, status: event.status, durationMs: event.durationMs }));
      throw new Error(`Real calculator collaboration did not reach published completion: ${JSON.stringify({ resultStatus: result.status, published: published.length, roleStatuses })}`);
    }
    const testsDir = join(project, "tests");
    await mkdir(testsDir, { recursive: true });
    const discoveredTests = (await readdir(testsDir)).filter((name) => /^test_.*\.py$/.test(name));
    if (discoveredTests.length === 0) throw new Error("Real calculator collaboration produced no test_*.py files");
    const unittestPackageMarker = join(testsDir, "__init__.py");
    let hadUnittestPackageMarker = true;
    try { await access(unittestPackageMarker); } catch { hadUnittestPackageMarker = false; }
    if (!hadUnittestPackageMarker) await writeFile(unittestPackageMarker, "", "utf8");
    let tests;
    try {
      tests = await execFile("python3", ["-m", "unittest", "discover", "-s", "tests", "-t", ".", "-p", "test_*.py", "-v"], { cwd: project });
    } finally {
      if (!hadUnittestPackageMarker) await rm(unittestPackageMarker, { force: true });
      // A Role may have committed the package marker in its branch. Restore the
      // published tree's tracked state after the temporary discovery shim.
      await git(project, ["restore", "--source=HEAD", "--staged", "--worktree", "--", "" + "tests/__init__.py"]).catch(() => undefined);
    }
    const add = await execFile("python3", await calculatorCommand(project, "add", "2", "3"), { cwd: project });
    const multiply = await execFile("python3", await calculatorCommand(project, "multiply", "6", "7"), { cwd: project });
    const status = (await git(project, ["status", "--porcelain=v1"])).stdout.trim();
    const events = (await readFile(join(root, ".ogs", "runs", "real-python-calculator", "events.ndjson"), "utf8"))
      .trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    const evidence = {
      resultStatus: result.status,
      published: published.length,
      mergeCommit: published[0]?.mergeCommit,
      unittest: `${tests.stdout}\n${tests.stderr}`.trim(),
      add: add.stdout.trim(),
      multiply: multiply.stdout.trim(),
      gitStatus: status,
      roleCommitCount: events.filter((event) => event.type === "git_collaboration_role_commit").length,
      joinMerge: events.some((event) => event.type === "git_collaboration_merge" && event.phase === "join" && event.status === "merged"),
      finalMerge: events.some((event) => event.type === "git_collaboration_merge" && event.phase === "final" && event.status === "merged")
    };
    if (evidence.resultStatus !== "done" || evidence.published !== 1 || Number(evidence.add) !== 5 || Number(evidence.multiply) !== 42 || evidence.gitStatus || !evidence.joinMerge || !evidence.finalMerge) {
      throw new Error(`Real calculator collaboration failed: ${JSON.stringify(evidence)}`);
    }
    process.stdout.write(`${JSON.stringify({ ok: true, project, evidence }, null, 2)}\n`);
  } finally {
    if (process.env.OGS_KEEP_REAL_RUN !== "1") await rm(root, { recursive: true, force: true });
    else process.stderr.write(`Preserved real run workspace: ${root}\n`);
  }
}

await main();
