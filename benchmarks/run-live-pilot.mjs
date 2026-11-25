#!/usr/bin/env node

/**
 * Reproducible live-model experiment driver.
 *
 * Visible tests may be used by an arm as an internal development gate. Hidden
 * tests are evaluated only after every selected arm has finished and saved a
 * delivery snapshot, so the independent oracle cannot leak into release logic.
 */

import { execFile as execFileCallback, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs, promisify } from "node:util";
import { createGitCollaboration, createWorkspaceCoordinator } from "../dist/runtime/adapter.js";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(import.meta.dirname, "..");
const tasksRoot = resolve(repoRoot, "benchmarks", "live-pilot", "tasks");
const artifactRoot = resolve(repoRoot, "benchmarks", "results", "artifacts");

const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    model: { type: "string", default: "gpt-6-luna" },
    "reasoning-effort": { type: "string", default: "low" },
    arm: { type: "string", default: "all" },
    task: { type: "string", default: "all" },
    seed: { type: "string", default: "1" },
    timeoutMs: { type: "string", default: "900000" },
    "dry-run": { type: "boolean", default: false },
    out: { type: "string", default: "" },
    help: { type: "boolean", short: "h", default: false }
  },
  strict: false
});

if (values.help) {
  console.log(`
OGSystem V2 live-model experiment driver
Usage:
  node benchmarks/run-live-pilot.mjs --dry-run
  node benchmarks/run-live-pilot.mjs --task=all --arm=all --seed=1 --out=benchmarks/results/v3-s1.json

Options:
  --model=<id>             Unified model (default: gpt-6-luna)
  --reasoning-effort=<x>  Codex reasoning effort (default: low)
  --arm=<A|B1|B2|C|all>   Arm selection (default: all)
  --task=<id|all>          Task selection (default: all)
  --seed=<n>               Paired execution-order seed (default: 1)
  --timeoutMs=<ms>        Per-role Codex timeout (default: 900000)
  --dry-run                Validate task oracles without model calls
  --out=<path>             Write full JSON evidence report
`);
  process.exit(0);
}

const MODEL = values.model;
const REASONING_EFFORT = values["reasoning-effort"];
const TIMEOUT_MS = Number(values.timeoutMs);
const SEED = String(values.seed);

async function git(cwd, args) {
  return execFile("git", ["-c", "user.name=OGS Pilot", "-c", "user.email=pilot@ogs.local", ...args], { cwd });
}

async function runCodex(cwd, prompt) {
  const started = performance.now();
  const args = [
    "exec", "-m", MODEL,
    "-c", `model_reasoning_effort=\"${REASONING_EFFORT}\"`,
    "--approve-for-me", "--skip-git-repo-check", "-C", cwd, prompt
  ];
  return await new Promise((resolveRun) => {
    const child = spawn("codex", args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({ ok: false, elapsedMs: performance.now() - started, stdout, stderr: `${stderr}${error.message}`, exitCode: null, signal: null });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveRun({ ok: !timedOut && code === 0, elapsedMs: performance.now() - started, stdout, stderr: timedOut ? `${stderr}\nTimed out after ${TIMEOUT_MS}ms` : stderr, exitCode: code, signal, timedOut });
    });
    child.stdin.end();
  });
}

async function runPytest(deliveredDir, testPath) {
  const evalDir = await mkdtemp(join(tmpdir(), "ogs-pilot-eval-"));
  try {
    await cp(deliveredDir, evalDir, { recursive: true, filter: (src) => !src.endsWith(".git") && !src.includes(`${sep}.git${sep}`) });
    await mkdir(join(evalDir, "_eval"), { recursive: true });
    await cp(testPath, join(evalDir, "_eval", "test_suite.py"));
    try {
      const { stdout, stderr } = await execFile("pytest", ["-q", "--tb=short", "_eval/test_suite.py"], { cwd: evalDir, env: { ...process.env, PYTHONPATH: evalDir }, timeout: 60_000 });
      const output = `${stdout ?? ""}\n${stderr ?? ""}`.trim();
      const passed = Number((output.match(/(\d+)\s+passed/) ?? [])[1] ?? 0);
      return { rawPass: true, passedTests: passed, failedTests: 0, totalTests: passed, output };
    } catch (error) {
      const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim();
      const passed = Number((output.match(/(\d+)\s+passed/) ?? [])[1] ?? 0);
      const failed = Number((output.match(/(\d+)\s+failed/) ?? [])[1] ?? 0);
      const errors = Number((output.match(/(\d+)\s+error/) ?? [])[1] ?? 0);
      return { rawPass: false, passedTests: passed, failedTests: failed + errors, totalTests: passed + failed + errors, output: output.slice(-1200) };
    }
  } finally {
    await rm(evalDir, { recursive: true, force: true });
  }
}

async function initTaskWorkspace(taskDir, prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const repo = join(root, "repo");
  await cp(join(taskDir, "repo"), repo, { recursive: true });
  await git(repo, ["init", "--quiet", "--initial-branch=main"]);
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "--quiet", "-m", "starter base"]);
  const baseCommit = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
  return { root, repo, baseCommit };
}

async function gitStatus(repo) {
  return (await git(repo, ["status", "--porcelain=v1"])).stdout.trim();
}

async function directoryDigest(directory) {
  const hash = createHash("sha256");
  async function visit(current) {
    const entries = (await readdir(current, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === ".ogs" || entry.name === "_eval" || entry.name === "__pycache__" || entry.name.endsWith(".pyc") || entry.name.endsWith(".pyo")) continue;
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        hash.update(relative(directory, path).split(sep).join("/") + "\0");
        hash.update(await readFile(path));
      }
    }
  }
  await visit(directory);
  return `sha256:${hash.digest("hex")}`;
}

async function persistSnapshot(sourceDir, targetDir) {
  await rm(targetDir, { recursive: true, force: true });
  await mkdir(dirname(targetDir), { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true, filter: (src) => !src.endsWith(".git") && !src.includes(`${sep}.git${sep}`) && !src.endsWith(".ogs") && !src.includes(`${sep}.ogs${sep}`) && !src.includes(`${sep}__pycache__${sep}`) && !src.endsWith(".pyc") && !src.endsWith(".pyo") });
  return { artifactPath: targetDir, artifactDigest: await directoryDigest(targetDir) };
}

function armBase(armId, task, wallTimeMs) {
  return {
    armId, taskId: task.taskId, model: MODEL, reasoningEffort: REASONING_EFFORT,
    wallTimeMs: Number(wallTimeMs.toFixed(1)), llmCalls: 0, roleRuns: [],
    mergeStatus: "not_applicable", releaseStatus: "not_applicable", failureCode: null,
    claimedComplete: false, visibleTestResult: null, hiddenTestResult: null,
    roleAttribution: false, canonicalIntegrity: false, verifiedArtifactDigest: false,
    failClosedOnError: false, artifactDigest: null, artifactPath: null
  };
}

async function runArmA(task, taskDir, snapshotDir) {
  const started = performance.now();
  const { root, repo } = await initTaskWorkspace(taskDir, `ogs-pilot-A-${task.taskId}-`);
  try {
    const run = await runCodex(repo, task.promptSingle);
    const visible = await runPytest(repo, join(taskDir, task.visibleTestFile));
    const result = armBase("A", task, performance.now() - started);
    result.roleRuns = [{ roleId: "single-agent", ...run }];
    result.llmCalls = 1;
    result.visibleTestResult = visible;
    result.claimedComplete = run.ok;
    result.canonicalIntegrity = (await gitStatus(repo)) === "";
    const snapshot = await persistSnapshot(repo, snapshotDir);
    Object.assign(result, snapshot);
    result.verifiedArtifactDigest = Boolean(visible.rawPass && result.artifactDigest);
    result.failClosedOnError = !result.claimedComplete || visible.rawPass;
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runArmB1(task, taskDir, snapshotDir) {
  const started = performance.now();
  const { root, repo } = await initTaskWorkspace(taskDir, `ogs-pilot-B1-${task.taskId}-`);
  try {
    const roleRuns = await Promise.all(task.roles.map(async (role) => ({ roleId: role.roleId, ...(await runCodex(repo, role.prompt)) })));
    const visible = await runPytest(repo, join(taskDir, task.visibleTestFile));
    const result = armBase("B1", task, performance.now() - started);
    result.roleRuns = roleRuns;
    result.llmCalls = roleRuns.length;
    result.visibleTestResult = visible;
    result.claimedComplete = roleRuns.every((run) => run.ok);
    result.mergeStatus = "shared_directory";
    // A canonical delivery must be a clean, version-controlled snapshot. Shared
    // directory edits are therefore not treated as canonical merely because
    // Git has not recorded an explicit conflict marker.
    result.canonicalIntegrity = (await gitStatus(repo)) === "";
    result.failClosedOnError = !result.claimedComplete || visible.rawPass;
    const snapshot = await persistSnapshot(repo, snapshotDir);
    Object.assign(result, snapshot);
    result.verifiedArtifactDigest = Boolean(visible.rawPass && result.artifactDigest);
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runArmB2(task, taskDir, snapshotDir) {
  const started = performance.now();
  const { root, repo, baseCommit } = await initTaskWorkspace(taskDir, `ogs-pilot-B2-${task.taskId}-`);
  try {
    const worktrees = [];
    for (const role of task.roles) {
      const dir = join(root, `wt-${role.roleId}`);
      await git(repo, ["worktree", "add", "--quiet", "-b", `branch-${role.roleId}`, dir, baseCommit]);
      worktrees.push({ role, dir, branch: `branch-${role.roleId}` });
    }
    const roleRuns = await Promise.all(worktrees.map(async (worktree) => {
      const run = await runCodex(worktree.dir, worktree.role.prompt);
      let commit = null;
      let commitError = null;
      try {
        await git(worktree.dir, ["add", "."]);
        await git(worktree.dir, ["commit", "--quiet", "--allow-empty", "-m", `role ${worktree.role.roleId}`]);
        commit = (await git(worktree.dir, ["rev-parse", "HEAD"])).stdout.trim();
      } catch (error) {
        commitError = String(error?.message ?? error);
      }
      return { roleId: worktree.role.roleId, ...run, commit, commitError };
    }));
    let conflictOnMain = false;
    let mergedCount = 0;
    for (const worktree of worktrees) {
      try {
        await git(repo, ["merge", "--quiet", worktree.branch]);
        mergedCount += 1;
      } catch {
        conflictOnMain = true;
        await git(repo, ["merge", "--abort"]).catch(() => undefined);
        break;
      }
    }
    const visible = await runPytest(repo, join(taskDir, task.visibleTestFile));
    const result = armBase("B2", task, performance.now() - started);
    result.roleRuns = roleRuns;
    result.llmCalls = roleRuns.length;
    result.visibleTestResult = visible;
    result.mergeStatus = conflictOnMain ? "conflict" : (mergedCount === worktrees.length ? "merged" : "incomplete");
    result.claimedComplete = roleRuns.every((run) => run.ok);
    result.roleAttribution = roleRuns.every((run) => Boolean(run.commit));
    result.canonicalIntegrity = (await gitStatus(repo)) === "";
    result.failClosedOnError = !result.claimedComplete || (!conflictOnMain && visible.rawPass);
    const snapshot = await persistSnapshot(repo, snapshotDir);
    Object.assign(result, snapshot);
    result.verifiedArtifactDigest = Boolean(visible.rawPass && result.artifactDigest && !conflictOnMain);
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runArmC(task, taskDir, snapshotDir) {
  const started = performance.now();
  const { root, repo, baseCommit } = await initTaskWorkspace(taskDir, `ogs-pilot-C-${task.taskId}-`);
  const worktreesDir = join(root, "worktrees");
  const evidenceDir = join(root, "evidence");
  const runId = `pilot-${task.taskId}-s${SEED}`;
  try {
    const collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktreesDir, runId });
    const coordinator = createWorkspaceCoordinator({ repositoryRoot: repo, evidenceDir, collaboration, workspaceId: `ws-${task.taskId}` });
    const prepared = [];
    for (const role of task.roles) prepared.push({ role, prep: await coordinator.prepare({ runId, nodeId: role.roleId, roleId: role.roleId, executionId: `exec-${role.roleId}`, baseCommit }) });
    const roleRuns = await Promise.all(prepared.map(async ({ role, prep }) => {
      const run = await runCodex(prep.worktree.path, role.prompt);
      try {
        const committed = await coordinator.commit({ runId, nodeId: role.roleId, roleId: role.roleId, worktree: prep.worktree, message: `role ${role.roleId} output`, checkpoint: prep.checkpoint });
        return { roleId: role.roleId, ...run, committed };
      } catch (error) {
        return { roleId: role.roleId, ...run, committed: null, commitError: String(error?.message ?? error) };
      }
    }));
    let merged;
    let deliveryDir = repo;
    let releaseCommit;
    let conflictFailClosed = true;
    let mergeStatus = "not_attempted";
    const candidates = roleRuns.filter((run) => run.committed?.roleCommit?.resultCommit);
    if (candidates.length > 0) {
      merged = await coordinator.merge({ runId, nodeId: "join-primary", baseCommit, candidateCommits: candidates.map((run) => run.committed.roleCommit.resultCommit), mergeId: "merge-primary", checkpoint: candidates[0].committed.checkpoint });
      mergeStatus = merged.merge.status;
      if (mergeStatus === "merged") {
        deliveryDir = merged.merge.path;
        releaseCommit = merged.merge.mergeCommit;
      } else {
        conflictFailClosed = (await gitStatus(repo)) === "" && (await git(repo, ["rev-parse", "HEAD"])).stdout.trim() === baseCommit;
      }
    }

    if (mergeStatus === "conflict" && task.reconcilerPrompt) {
      const diffs = await Promise.all(candidates.map(async (candidate) => `--- role ${candidate.roleId} ---\n${(await git(repo, ["diff", baseCommit, candidate.committed.roleCommit.resultCommit])).stdout}`));
      const recPrep = await coordinator.prepare({ runId, nodeId: "reconciler", roleId: "reconciler", executionId: "exec-reconciler", baseCommit });
      const recRun = await runCodex(recPrep.worktree.path, `${task.reconcilerPrompt}\n\nImmutable upstream role diffs:\n${diffs.join("\n")}`);
      const recRecord = { roleId: "reconciler", ...recRun };
      try {
        const recCommit = await coordinator.commit({ runId, nodeId: "reconciler", roleId: "reconciler", worktree: recPrep.worktree, message: "bounded review reconciliation", checkpoint: recPrep.checkpoint });
        recRecord.committed = recCommit;
        roleRuns.push(recRecord);
        merged = await coordinator.merge({ runId, nodeId: "join-reconciled", baseCommit, candidateCommits: [recCommit.roleCommit.resultCommit], mergeId: "merge-reconciled", checkpoint: recCommit.checkpoint });
        mergeStatus = merged.merge.status;
        if (mergeStatus === "merged") {
          deliveryDir = merged.merge.path;
          releaseCommit = merged.merge.mergeCommit;
        }
      } catch (error) {
        recRecord.commitError = String(error?.message ?? error);
        roleRuns.push(recRecord);
      }
    }

    const visible = await runPytest(deliveryDir, join(taskDir, task.visibleTestFile));
    let release;
    if (visible.rawPass && releaseCommit) {
      try {
        release = await coordinator.publishRelease({ releaseId: `rel-${task.taskId}`, runId, workspaceDir: repo, sourceDir: deliveryDir, releaseCommit, expectedCanonicalHead: baseCommit });
      } catch (error) {
        release = await coordinator.release.load(`rel-${task.taskId}`);
        if (!release) release = { status: "failed", failureCode: String(error?.message ?? error) };
      }
    }
    const result = armBase("C", task, performance.now() - started);
    result.roleRuns = roleRuns;
    result.llmCalls = roleRuns.length;
    result.visibleTestResult = visible;
    result.mergeStatus = mergeStatus;
    result.releaseStatus = release?.status ?? "not_attempted";
    result.failureCode = release?.failureCode ?? (mergeStatus === "conflict" ? "MERGE_CONFLICT" : null);
    result.claimedComplete = result.releaseStatus === "published";
    result.roleAttribution = candidates.length === task.roles.length && candidates.every((candidate) => Boolean(candidate.committed?.roleCommit?.resultCommit));
    result.canonicalIntegrity = conflictFailClosed && (mergeStatus !== "conflict" || result.releaseStatus === "published");
    result.failClosedOnError = !result.claimedComplete || (visible.rawPass && mergeStatus !== "conflict");
    const snapshot = await persistSnapshot(deliveryDir, snapshotDir);
    Object.assign(result, snapshot);
    result.verifiedArtifactDigest = Boolean(result.claimedComplete && visible.rawPass && result.artifactDigest);
    return result;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function loadTasks() {
  const dirs = (await readdir(tasksRoot)).sort();
  const loaded = [];
  for (const dir of dirs) {
    if (values.task !== "all" && values.task !== dir) continue;
    const taskDir = join(tasksRoot, dir);
    loaded.push({ task: JSON.parse(await readFile(join(taskDir, "task.json"), "utf8")), taskDir });
  }
  return loaded;
}

function seededOrder(items, key) {
  return [...items].sort((a, b) => createHash("sha256").update(`${key}:${a}`).digest("hex").localeCompare(createHash("sha256").update(`${key}:${b}`).digest("hex")));
}

function resultOnError(armId, task, error) {
  const result = armBase(armId, task, 0);
  result.failureCode = "RUNNER_ERROR";
  result.runnerError = String(error?.message ?? error);
  return result;
}

async function evaluateHidden(results, taskMap) {
  for (const result of results) {
    const taskEntry = taskMap.get(result.taskId);
    result.hiddenTestResult = result.artifactPath
      ? await runPytest(result.artifactPath, join(taskEntry.taskDir, taskEntry.task.hiddenTestFile))
      : { rawPass: false, passedTests: 0, failedTests: 0, totalTests: 0, output: "no delivery snapshot" };
    result.rawPass = Boolean(result.hiddenTestResult.rawPass);
    result.falseCompletion = Boolean(result.claimedComplete && !result.rawPass);
    result.fcr = result.falseCompletion;
    result.verifiedDelivery = Boolean(result.roleAttribution && result.canonicalIntegrity && result.verifiedArtifactDigest && result.failClosedOnError);
    result.auditDimensions = [result.roleAttribution, result.canonicalIntegrity, result.verifiedArtifactDigest, result.failClosedOnError].filter(Boolean).length;
  }
}

async function main() {
  const selected = await loadTasks();
  if (!selected.length) throw new Error(`No matching tasks found for --task=${values.task}`);
  if (values["dry-run"]) {
    const codexVersion = (await execFile("codex", ["--version"])).stdout.trim();
    console.log(`[DRY-RUN] Codex: ${codexVersion}`);
    for (const { task, taskDir } of selected) {
      const visible = await runPytest(join(taskDir, "repo"), join(taskDir, task.visibleTestFile));
      const hidden = await runPytest(join(taskDir, "repo"), join(taskDir, task.hiddenTestFile));
      console.log(`  ${task.taskId}: visible ${visible.passedTests}/${visible.totalTests}, starter hidden ${hidden.passedTests}/${hidden.totalTests} (${hidden.rawPass ? "unexpected pass" : "expected fail"})`);
    }
    return;
  }
  const selectedArms = values.arm === "all" ? ["A", "B1", "B2", "C"] : [values.arm];
  const runners = { A: runArmA, B1: runArmB1, B2: runArmB2, C: runArmC };
  if (selectedArms.some((arm) => !runners[arm])) throw new Error(`Unsupported arm: ${values.arm}`);
  const results = [];
  const taskMap = new Map(selected.map((entry) => [entry.task.taskId, entry]));
  for (const { task, taskDir } of selected) {
    for (const armId of seededOrder(selectedArms, `${task.taskId}:${SEED}`)) {
      const snapshotDir = join(artifactRoot, task.taskId, `s${SEED}`, armId);
      console.error(`[LIVE-PILOT-V3] task=${task.taskId} arm=${armId} seed=${SEED}`);
      let result;
      try {
        result = await runners[armId](task, taskDir, snapshotDir);
      } catch (error) {
        result = resultOnError(armId, task, error);
        console.error(`  runner error: ${result.runnerError}`);
      }
      results.push(result);
      console.error(`  visible=${result.visibleTestResult?.rawPass ?? false} merge=${result.mergeStatus} release=${result.releaseStatus} wall=${result.wallTimeMs}ms`);
    }
  }
  await evaluateHidden(results, taskMap);
  const serializedResults = results.map((result) => ({
    ...result,
    artifactPath: result.artifactPath ? relative(repoRoot, result.artifactPath).split(sep).join("/") : null
  }));
  const report = {
    protocolVersion: "v3-no-oracle-leakage", model: MODEL, reasoningEffort: REASONING_EFFORT,
    timeoutMs: TIMEOUT_MS, seed: SEED, tasks: selected.map(({ task }) => task.taskId), arms: selectedArms,
    hiddenEvaluation: "post-arm independent evaluation", timestamp: new Date().toISOString(), results: serializedResults
  };
  if (values.out) {
    await mkdir(dirname(resolve(values.out)), { recursive: true });
    await writeFile(resolve(values.out), `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log("\n| Task | Arm | Visible | Hidden RawPass | Claimed | FCR | VerifiedDelivery | Audit | Merge | Release | Wall (s) |");
  console.log("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | ---: |");
  for (const result of results) console.log(`| ${result.taskId} | ${result.armId} | ${result.visibleTestResult?.rawPass ? "PASS" : "FAIL"} | ${result.rawPass ? "PASS" : "FAIL"} | ${result.claimedComplete ? "YES" : "NO"} | ${result.fcr ? "YES" : "NO"} | ${result.verifiedDelivery ? "YES" : "NO"} | ${result.auditDimensions}/4 | ${result.mergeStatus} | ${result.releaseStatus} | ${(result.wallTimeMs / 1000).toFixed(1)} |`);
}

main().catch((error) => {
  console.error("Live pilot failed:", error);
  process.exit(1);
});
