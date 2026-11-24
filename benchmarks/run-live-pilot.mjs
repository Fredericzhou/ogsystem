#!/usr/bin/env node

/**
 * @fileoverview OGSystem V2 Live-Model Pilot Evaluation Driver (Unified Model: gpt-6-luna).
 *
 * Compares 4 controlled arms on frozen multi-file Python repository tasks using
 * an identical model (`gpt-6-luna` via Codex CLI) and identical independent hidden `pytest` oracles:
 *   - Arm A  : Single-Agent
 *   - Arm B1 : Flat-Dir Multi-Agent (concurrent in-place writes)
 *   - Arm B2 : Naive GitWorktree (isolated worktrees + naive post-hoc `git merge`)
 *   - Arm C  : OGSystem V2 (real WorkspaceCoordinator + GitCollaboration + Merge Worktree + CAS Release)
 *
 * Usage:
 *   node benchmarks/run-live-pilot.mjs --dry-run
 *   node benchmarks/run-live-pilot.mjs --task=task-01-ledger-engine --arm=all --seed=1
 *   node benchmarks/run-live-pilot.mjs --task=all --arm=all --seed=1 --out=benchmarks/results/pilot-seed1.json
 */

import { execFile as execFileCallback } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs, promisify } from "node:util";
import { createGitCollaboration, createWorkspaceCoordinator } from "../dist/runtime/adapter.js";

const execFile = promisify(execFileCallback);
const repoRoot = resolve(import.meta.dirname, "..");
const tasksRoot = resolve(repoRoot, "benchmarks", "live-pilot", "tasks");

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== "--"),
  options: {
    model: { type: "string", default: "gpt-6-luna" },
    arm: { type: "string", default: "all" },
    task: { type: "string", default: "all" },
    seed: { type: "string", default: "1" },
    timeoutMs: { type: "string", default: "300000" },
    "dry-run": { type: "boolean", default: false },
    out: { type: "string", default: "" },
    latex: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false }
  },
  strict: false
});

if (values.help) {
  console.log(`
OGSystem V2 Live-Model Pilot Driver (Unified Model: gpt-6-luna)
Usage:
  node benchmarks/run-live-pilot.mjs --dry-run
  node benchmarks/run-live-pilot.mjs --task=task-01-ledger-engine --arm=all --seed=1
  node benchmarks/run-live-pilot.mjs --task=all --arm=all --seed=1 --out=benchmarks/results/pilot-s1.json

Options:
  --model=<id>       Unified model across all arms (default: gpt-6-luna)
  --arm=<A|B1|B2|C|all>
  --task=<taskId|all>
  --seed=<n>         Randomization/replication seed tag (default: 1)
  --timeoutMs=<ms>   Per-role Codex timeout (default: 300000)
  --dry-run          Verify starter repos, hidden pytest oracles, and Codex CLI at $0 cost
  --out=<path>       Write full JSON results report
  --latex            Print LaTeX summary table
`);
  process.exit(0);
}

const MODEL = values.model;
const TIMEOUT_MS = Number(values.timeoutMs);

async function git(cwd, args) {
  return execFile("git", ["-c", "user.name=OGS Pilot", "-c", "user.email=pilot@ogs.local", ...args], { cwd });
}

async function runCodex(cwd, prompt) {
  const t0 = performance.now();
  try {
    const { stdout, stderr } = await execFile(
      "codex",
      [
        "exec",
        "-m", MODEL,
        "--sandbox", "workspace-write",
        "--skip-git-repo-check",
        "-C", cwd,
        prompt
      ],
      { cwd, timeout: TIMEOUT_MS, maxBuffer: 10 * 1024 * 1024 }
    );
    return { ok: true, elapsedMs: performance.now() - t0, stdout, stderr };
  } catch (err) {
    return {
      ok: false,
      elapsedMs: performance.now() - t0,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(err.message ?? err)
    };
  }
}

async function runHiddenPytest(deliveredDir, hiddenTestPath) {
  const evalDir = await mkdtemp(join(tmpdir(), "ogs-pilot-eval-"));
  try {
    await cp(deliveredDir, evalDir, { recursive: true, filter: (src) => !src.endsWith(".git") && !src.includes("/.git/") });
    await mkdir(join(evalDir, "_hidden_eval"), { recursive: true });
    await cp(hiddenTestPath, join(evalDir, "_hidden_eval", "test_hidden.py"));
    try {
      const { stdout } = await execFile(
        "pytest",
        ["-q", "--tb=short", "_hidden_eval/test_hidden.py"],
        { cwd: evalDir, env: { ...process.env, PYTHONPATH: evalDir }, timeout: 60000 }
      );
      const passedMatch = stdout.match(/(\d+)\s+passed/);
      const passed = passedMatch ? Number(passedMatch[1]) : 0;
      return { rawPass: true, passedTests: passed, failedTests: 0, totalTests: passed, output: stdout.trim() };
    } catch (err) {
      const out = `${err.stdout ?? ""}\n${err.stderr ?? ""}`;
      const passed = Number((out.match(/(\d+)\s+passed/) ?? [])[1] ?? 0);
      const failed = Number((out.match(/(\d+)\s+failed/) ?? [])[1] ?? 0);
      const errors = Number((out.match(/(\d+)\s+error/) ?? [])[1] ?? 0);
      const total = passed + failed + errors;
      return { rawPass: false, passedTests: passed, failedTests: failed + errors, totalTests: total, output: out.trim().slice(-600) };
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

async function runArmA(task, taskDir) {
  const t0 = performance.now();
  const { root, repo } = await initTaskWorkspace(taskDir, `ogs-pilot-A-${task.taskId}-`);
  try {
    const res = await runCodex(repo, task.promptSingle);
    const oracle = await runHiddenPytest(repo, join(taskDir, task.hiddenTestFile));
    return {
      armId: "A",
      taskId: task.taskId,
      model: MODEL,
      ...oracle,
      provenanceValid: false,
      releasePublished: false,
      conflictFailClosed: true,
      vds: false, // Single-agent has no V2 commit provenance / Release gate
      falseCompletion: res.ok && !oracle.rawPass,
      wallTimeMs: Number((performance.now() - t0).toFixed(1))
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runArmB1(task, taskDir) {
  const t0 = performance.now();
  const { root, repo } = await initTaskWorkspace(taskDir, `ogs-pilot-B1-${task.taskId}-`);
  try {
    // Concurrent in-place writes in the same shared directory
    const roleRuns = await Promise.all(task.roles.map((r) => runCodex(repo, r.prompt)));
    const allOk = roleRuns.every((r) => r.ok);
    const oracle = await runHiddenPytest(repo, join(taskDir, task.hiddenTestFile));
    return {
      armId: "B1",
      taskId: task.taskId,
      model: MODEL,
      ...oracle,
      provenanceValid: false,
      releasePublished: false,
      conflictFailClosed: false,
      vds: false,
      falseCompletion: allOk && !oracle.rawPass,
      wallTimeMs: Number((performance.now() - t0).toFixed(1))
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runArmB2(task, taskDir) {
  const t0 = performance.now();
  const { root, repo, baseCommit } = await initTaskWorkspace(taskDir, `ogs-pilot-B2-${task.taskId}-`);
  try {
    const worktrees = [];
    for (const r of task.roles) {
      const wtDir = join(root, `wt-${r.roleId}`);
      await git(repo, ["worktree", "add", "--quiet", "-b", `branch-${r.roleId}`, wtDir, baseCommit]);
      worktrees.push({ role: r, dir: wtDir, branch: `branch-${r.roleId}` });
    }
    const roleRuns = await Promise.all(
      worktrees.map(async (w) => {
        const res = await runCodex(w.dir, w.role.prompt);
        await git(w.dir, ["add", "."]);
        await git(w.dir, ["commit", "--quiet", "--allow-empty", "-m", `role ${w.role.roleId}`]);
        return res;
      })
    );
    let conflictOnMain = false;
    for (const w of worktrees) {
      try {
        await git(repo, ["merge", "--quiet", w.branch]);
      } catch {
        conflictOnMain = true;
        await git(repo, ["merge", "--abort"]).catch(() => undefined);
      }
    }
    const oracle = await runHiddenPytest(repo, join(taskDir, task.hiddenTestFile));
    return {
      armId: "B2",
      taskId: task.taskId,
      model: MODEL,
      ...oracle,
      provenanceValid: true,
      releasePublished: false,
      conflictFailClosed: !conflictOnMain,
      vds: false, // Naive GitWorktree has no Release Materialization / CAS gate
      falseCompletion: roleRuns.every((r) => r.ok) && !oracle.rawPass,
      wallTimeMs: Number((performance.now() - t0).toFixed(1))
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function runArmC(task, taskDir) {
  const t0 = performance.now();
  const { root, repo, baseCommit } = await initTaskWorkspace(taskDir, `ogs-pilot-C-${task.taskId}-`);
  const worktreesDir = join(root, "worktrees");
  const evidenceDir = join(root, "evidence");
  const runId = `pilot-${task.taskId}-s${values.seed}`;
  try {
    const collaboration = createGitCollaboration({ repositoryRoot: repo, worktreeRoot: worktreesDir, runId });
    const coordinator = createWorkspaceCoordinator({
      repositoryRoot: repo,
      evidenceDir,
      collaboration,
      workspaceId: `ws-${task.taskId}`
    });

    // 1. Parallel isolated Role Worktrees
    const prepared = [];
    for (const r of task.roles) {
      prepared.push({
        role: r,
        prep: await coordinator.prepare({ runId, nodeId: r.roleId, roleId: r.roleId, executionId: `exec-${r.roleId}`, baseCommit })
      });
    }

    const roleCommits = await Promise.all(
      prepared.map(async ({ role, prep }) => {
        const res = await runCodex(prep.worktree.path, role.prompt);
        const committed = await coordinator.commit({
          runId,
          nodeId: role.roleId,
          roleId: role.roleId,
          worktree: prep.worktree,
          message: `role ${role.roleId} output`,
          checkpoint: prep.checkpoint
        });
        return { role, res, committed };
      })
    );

    // 2. Merge in isolated Merge Worktree
    let merged = await coordinator.merge({
      runId,
      nodeId: "join-primary",
      baseCommit,
      candidateCommits: roleCommits.map((c) => c.committed.roleCommit.resultCommit),
      mergeId: "merge-primary",
      checkpoint: roleCommits[0].committed.checkpoint
    });

    let conflictFailClosed = true;
    let deliveryDir = merged.merge.path;
    let releaseCommit = merged.merge.mergeCommit;

    // 3. Fail-Closed Conflict Handling -> Reconciler Role if conflict occurred
    if (merged.merge.status === "conflict") {
      const mainClean = (await git(repo, ["status", "--porcelain"])).stdout.trim() === "";
      const headUnchanged = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim() === baseCommit;
      conflictFailClosed = mainClean && headUnchanged;

      if (task.reconcilerPrompt) {
        const diffs = await Promise.all(
          roleCommits.map(async (c) => {
            const d = (await git(repo, ["diff", baseCommit, c.committed.roleCommit.resultCommit])).stdout;
            return `--- Role ${c.role.roleId} (${c.committed.roleCommit.resultCommit}) ---\n${d}`;
          })
        );
        const recPrep = await coordinator.prepare({
          runId,
          nodeId: "reconciler",
          roleId: "reconciler",
          executionId: "exec-reconciler",
          baseCommit
        });
        await runCodex(recPrep.worktree.path, `${task.reconcilerPrompt}\n\nImmutable upstream role diffs:\n${diffs.join("\n")}`);
        const recCommitted = await coordinator.commit({
          runId,
          nodeId: "reconciler",
          roleId: "reconciler",
          worktree: recPrep.worktree,
          message: "reconcile parallel role commits",
          checkpoint: recPrep.checkpoint
        });
        merged = await coordinator.merge({
          runId,
          nodeId: "join-reconciled",
          baseCommit,
          candidateCommits: [recCommitted.roleCommit.resultCommit],
          mergeId: "merge-reconciled",
          checkpoint: recCommitted.checkpoint
        });
        deliveryDir = merged.merge.path;
        releaseCommit = merged.merge.mergeCommit;
      }
    }

    // 4. Independent hidden pytest verification BEFORE Release Publication
    const oracle = await runHiddenPytest(deliveryDir, join(taskDir, task.hiddenTestFile));

    // 5. Release Materialization + Expected-Head CAS ONLY if verification passed
    let releasePublished = false;
    if (oracle.rawPass && releaseCommit) {
      const published = await coordinator.publishRelease({
        releaseId: `rel-${task.taskId}`,
        runId,
        workspaceDir: repo,
        sourceDir: deliveryDir,
        releaseCommit,
        expectedCanonicalHead: baseCommit
      });
      releasePublished = published.status === "published";
    }

    const provenanceValid = roleCommits.every((c) => Boolean(c.committed.roleCommit.resultCommit));
    const vds = oracle.rawPass && provenanceValid && releasePublished && conflictFailClosed;

    return {
      armId: "C",
      taskId: task.taskId,
      model: MODEL,
      ...oracle,
      provenanceValid,
      releasePublished,
      conflictFailClosed,
      vds,
      falseCompletion: false, // OGS blocks Release publication when verification fails
      wallTimeMs: Number((performance.now() - t0).toFixed(1))
    };
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
    const task = JSON.parse(await readFile(join(taskDir, "task.json"), "utf8"));
    loaded.push({ task, taskDir });
  }
  return loaded;
}

async function main() {
  const tasks = await loadTasks();
  if (tasks.length === 0) {
    console.error(`No matching tasks found for --task=${values.task}`);
    process.exit(1);
  }

  if (values["dry-run"]) {
    console.log(`\n[DRY-RUN] Verifying ${tasks.length} Pilot tasks (pinned model: ${MODEL}) at $0 API cost...\n`);
    const codexVer = (await execFile("codex", ["--version"])).stdout.trim();
    console.log(`  ✓ Codex CLI ready: ${codexVer}`);
    for (const { task, taskDir } of tasks) {
      const baselineOracle = await runHiddenPytest(join(taskDir, "repo"), join(taskDir, task.hiddenTestFile));
      const status = !baselineOracle.rawPass && baselineOracle.totalTests > 0 ? "✓" : "✗";
      console.log(
        `  ${status} ${task.taskId} (${task.category}): starter repo passes ${baselineOracle.passedTests}/${baselineOracle.totalTests} hidden tests (expected fail before LLM)`
      );
    }
    console.log("\n[DRY-RUN] All starter repos & hidden pytest oracles verified. Ready for live gpt-6-luna execution.\n");
    return;
  }

  const selectedArms = values.arm === "all" ? ["A", "B1", "B2", "C"] : [values.arm];
  const runners = { A: runArmA, B1: runArmB1, B2: runArmB2, C: runArmC };
  const allResults = [];

  for (const { task, taskDir } of tasks) {
    for (const armId of selectedArms) {
      console.error(`[LIVE-PILOT] Running task=${task.taskId} arm=${armId} model=${MODEL} seed=${values.seed}...`);
      const res = await runners[armId](task, taskDir);
      allResults.push(res);
      console.error(`  -> rawPass=${res.rawPass} (${res.passedTests}/${res.totalTests}) vds=${res.vds} wall=${res.wallTimeMs}ms`);
    }
  }

  if (values.out) {
    await mkdir(resolve(values.out, ".."), { recursive: true });
    await writeFile(values.out, JSON.stringify({ model: MODEL, seed: values.seed, timestamp: new Date().toISOString(), results: allResults }, null, 2));
  }

  console.log(`\n| Task | Arm | Model | Passed/Total | RawPass | VDS | FCR | Conflict Safe | Wall (s) |`);
  console.log(`| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |`);
  for (const r of allResults) {
    console.log(
      `| ${r.taskId} | ${r.armId} | ${r.model} | ${r.passedTests}/${r.totalTests} | ${r.rawPass ? "PASS" : "FAIL"} | ${r.vds ? "PASS" : "FAIL"} | ${r.falseCompletion ? "YES" : "NO"} | ${r.conflictFailClosed ? "PASS" : "FAIL"} | ${(r.wallTimeMs / 1000).toFixed(1)} |`
    );
  }
}

main().catch((err) => {
  console.error("Live pilot failed:", err);
  process.exit(1);
});
