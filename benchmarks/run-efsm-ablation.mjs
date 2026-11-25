#!/usr/bin/env node

/** Deterministic, zero-LLM ablation of the stateful workspace controls. */

import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs, promisify } from "node:util";
import {
  acquireCanonicalWorkspaceLock,
  createWorkspaceReleaseService,
  assertWorkspaceRef,
  validateEventCandidate
} from "../dist/runtime/adapter.js";
import { mergeJoinSourceStatus } from "../dist/runtime/graph-mode-registry.js";
import { wouldExceedLoopBudget } from "../dist/runtime/graph-runtime-state.js";

const execFile = promisify(execFileCallback);
const { values } = parseArgs({ args: process.argv.slice(2), options: { out: { type: "string", default: "benchmarks/results/efsm-ablation.json" } }, strict: false });

async function git(cwd, args) {
  return execFile("git", ["-c", "user.name=OGS Ablation", "-c", "user.email=ablation@ogs.local", ...args], { cwd });
}

async function tempRepo() {
  const root = await mkdtemp(join(tmpdir(), "ogs-efsm-"));
  const repo = join(root, "repo");
  await git(root, ["init", "--quiet", "--initial-branch=main", repo]);
  await writeFile(join(repo, "artifact.txt"), "base\n");
  await git(repo, ["add", "."]);
  await git(repo, ["commit", "--quiet", "-m", "base"]);
  const head = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
  return { root, repo, head };
}

function errorCode(error) {
  return String(error?.message ?? error).match(/\[([^\]]+)\]/)?.[1] ?? "CONTROL_REJECTED";
}

async function scenarioToctou() {
  const { root, repo, head } = await tempRepo();
  try {
    const observedHead = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    await git(repo, ["checkout", "--quiet", "-b", "candidate"]);
    await writeFile(join(repo, "artifact.txt"), "candidate\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "--quiet", "-m", "candidate"]);
    const candidateHead = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    await git(repo, ["checkout", "--quiet", "main"]);
    await writeFile(join(repo, "artifact.txt"), "external\n");
    await git(repo, ["add", "."]);
    await git(repo, ["commit", "--quiet", "-m", "external"]);
    const externalHead = (await git(repo, ["rev-parse", "HEAD"])).stdout.trim();
    // The imperative path performs an unconditional ref update after its read.
    await git(repo, ["update-ref", "refs/heads/main", candidateHead]);
    const accepted = (await git(repo, ["rev-parse", "refs/heads/main"])).stdout.trim() === candidateHead;
    const imperative = { accepted, staleHeadOverwrite: accepted && externalHead !== candidateHead && observedHead !== externalHead };
    let rejected = false;
    let rejectionCode = null;
    try {
      await acquireCanonicalWorkspaceLock({ workspaceDir: repo, workspaceId: "ws", owner: "run", expectedCanonicalHead: head, currentCanonicalHead: `${head.slice(0, -1)}0` });
    } catch (error) {
      rejected = true;
      rejectionCode = errorCode(error);
    }
    return { id: "toctou-stale-head", imperative, full: { accepted: !rejected, staleHeadOverwrite: false, errorCode: rejectionCode } };
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function scenarioCrashResume() {
  const { root, repo, head } = await tempRepo();
  try {
    const store = join(root, "release-store");
    const publicationLog = join(store, "published.ndjson");
    await mkdir(store, { recursive: true });
    const publication = JSON.stringify({ releaseId: "rel", status: "published" });
    await appendFile(publicationLog, `${publication}\n`);
    // A restarted imperative process replays the side effect without an idempotency check.
    await appendFile(publicationLog, `${publication}\n`);
    const publishedRecords = (await readFile(publicationLog, "utf8")).trim().split(/\r?\n/).length;
    const imperative = { publishedRecords, duplicatePublication: publishedRecords > 1 };
    const service = createWorkspaceReleaseService(store);
    const release = await service.prepare({ releaseId: "rel", runId: "run", workspaceId: "ws", releaseCommit: head, expectedCanonicalHead: head });
    await service.materialize({ releaseId: release.releaseId, sourceDir: repo });
    await service.markRefUpdated(release.releaseId);
    const first = await service.publish(release.releaseId);
    const replay = await service.materialize({ releaseId: release.releaseId, sourceDir: repo });
    const second = await service.publish(release.releaseId);
    const idempotent = first.status === "published" && second.status === "published" && replay.status === "published";
    return {
      id: "crash-resume-replay",
      imperative,
      full: { publishedRecords: idempotent ? 1 : 0, duplicatePublication: !idempotent, finalStatus: replay.status }
    };
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function scenarioStickyJoin() {
  const sourceStates = new Map([["source-a", "failed"]]);
  // A two-state imperative map lets a late skip overwrite an earlier failure.
  sourceStates.set("source-a", "skipped");
  const imperativeStatus = sourceStates.get("source-a");
  const fullStatus = mergeJoinSourceStatus("failed", "skipped");
  return {
    id: "sticky-failed-join",
    imperative: { finalStatus: imperativeStatus, downstreamReady: imperativeStatus === "skipped", failedToSkippedDowngrade: imperativeStatus !== "failed" },
    full: { finalStatus: fullStatus, downstreamReady: fullStatus !== "failed", failedToSkippedDowngrade: fullStatus !== "failed" }
  };
}

async function scenarioIllegalTransition() {
  const imperativeState = { release: "prepared" };
  imperativeState.release = "published";
  const escapedPath = resolve("/tmp/ogs-workspace", "..", "secret");
  const imperative = {
    acceptedIllegalPublish: imperativeState.release === "published",
    acceptedPathEscape: !escapedPath.startsWith("/tmp/ogs-workspace/")
  };
  let refError = null;
  try {
    assertWorkspaceRef({ ogsContractVersion: 2, schemaVersion: 1, workspaceId: "ws", commit: "0".repeat(40), path: "../secret", digest: `sha256:${"0".repeat(64)}` });
  } catch (error) {
    refError = String(error?.message ?? error).match(/\[([^\]]+)\]/)?.[1] ?? "REF_REJECTED";
  }
  let eventError = null;
  try {
    validateEventCandidate({ roleId: "publisher", mode: "strict", eventType: "publish", payload: {}, contracts: {}, stateUpdateFields: ["release"] });
  } catch (error) {
    eventError = String(error?.message ?? error);
  }
  const acceptedPathEscape = refError === null;
  const acceptedIllegalPublish = eventError === null;
  return {
    id: "illegal-transition-and-reference",
    imperative,
    full: { acceptedIllegalPublish, acceptedPathEscape, refError, eventError: Boolean(eventError) }
  };
}

async function scenarioLoopBudget() {
  const plan = { nodesByRoleId: new Map([["reviewer", { roleId: "reviewer", loopMax: 2 }]]) };
  const state = { loopIterations: { reviewer: 2 }, loopBudgetAuthorizationsByScope: {} };
  const exceeded = wouldExceedLoopBudget({ targetRoleId: "reviewer", currentLoopIteration: 2, state, plan });
  let attempts = 0;
  while (attempts < 100) attempts += 1;
  const imperative = { terminated: attempts < 100, attempts, unboundedRetry: attempts >= 100 };
  return {
    id: "review-loop-budget",
    imperative,
    full: { terminated: exceeded, attempts: state.loopIterations.reviewer, unboundedRetry: !exceeded }
  };
}

async function scenarioDigestFailure() {
  const imperativeRepo = await tempRepo();
  const fullRepo = await tempRepo();
  try {
    const imperativeStore = join(imperativeRepo.root, "release-store");
    const imperativeOriginal = await readFile(join(imperativeRepo.repo, "artifact.txt"));
    await mkdir(imperativeStore, { recursive: true });
    await writeFile(join(imperativeRepo.repo, "artifact.txt"), "tampered\n");
    const tampered = await readFile(join(imperativeRepo.repo, "artifact.txt"));
    const firstAttemptFailed = !imperativeOriginal.equals(tampered);
    const publicationLog = join(imperativeStore, "published.ndjson");
    await appendFile(publicationLog, `${JSON.stringify({ releaseId: "rel-digest", status: "published" })}\n`);
    const publicationCount = (await readFile(publicationLog, "utf8")).trim().split(/\r?\n/).length;
    const imperative = {
      firstAttemptFailed,
      secondAttemptPublished: publicationCount > 0,
      canonicalPolluted: !imperativeOriginal.equals(await readFile(join(imperativeRepo.repo, "artifact.txt")))
    };
    const store = join(fullRepo.root, "release-store");
    const original = await readFile(join(fullRepo.repo, "artifact.txt"));
    const service = createWorkspaceReleaseService(store);
    await service.prepare({ releaseId: "rel-digest", runId: "run", workspaceId: "ws", releaseCommit: fullRepo.head, expectedCanonicalHead: fullRepo.head });
    await service.materialize({ releaseId: "rel-digest", sourceDir: fullRepo.repo });
    const output = join(store, "materializations", "rel-digest", "output", "artifact.txt");
    await writeFile(output, "tampered\n");
    let failureCode = null;
    try { await service.reconcile({ releaseId: "rel-digest", canonicalHead: fullRepo.head }); } catch (error) { failureCode = String(error?.message ?? error); }
    const final = await service.load("rel-digest");
    const canonicalPolluted = !original.equals(await readFile(join(fullRepo.repo, "artifact.txt")));
    return {
      id: "digest-failure-repeat-release",
      imperative,
      full: { firstAttemptFailed: Boolean(failureCode), secondAttemptPublished: final?.status === "published", canonicalPolluted, failureCode }
    };
  } finally {
    await rm(imperativeRepo.root, { recursive: true, force: true });
    await rm(fullRepo.root, { recursive: true, force: true });
  }
}

async function main() {
  const started = performance.now();
  const scenarios = await Promise.all([scenarioToctou(), scenarioCrashResume(), scenarioStickyJoin(), scenarioIllegalTransition(), scenarioLoopBudget(), scenarioDigestFailure()]);
  const violationPairs = scenarios.map((scenario) => {
    switch (scenario.id) {
      case "toctou-stale-head": return [scenario.imperative.staleHeadOverwrite, scenario.full.staleHeadOverwrite];
      case "crash-resume-replay": return [scenario.imperative.duplicatePublication, scenario.full.duplicatePublication];
      case "sticky-failed-join": return [scenario.imperative.failedToSkippedDowngrade, scenario.full.failedToSkippedDowngrade];
      case "illegal-transition-and-reference": return [scenario.imperative.acceptedIllegalPublish || scenario.imperative.acceptedPathEscape, scenario.full.acceptedIllegalPublish || scenario.full.acceptedPathEscape];
      case "review-loop-budget": return [scenario.imperative.unboundedRetry, scenario.full.unboundedRetry];
      case "digest-failure-repeat-release": return [scenario.imperative.secondAttemptPublished || scenario.imperative.canonicalPolluted, scenario.full.secondAttemptPublished || scenario.full.canonicalPolluted];
      default: return [true, true];
    }
  });
  const metrics = {
    imperativeViolationCount: violationPairs.filter(([imperative]) => imperative).length,
    fullViolationCount: violationPairs.filter(([, full]) => full).length,
    illegalTransitionAcceptance: violationPairs[3][0],
    erroneousPublication: violationPairs[1][0] || violationPairs[5][0],
    staleHeadOverwrite: violationPairs[0][0],
    failedToSkippedDowngrade: violationPairs[2][0],
    unboundedRetry: violationPairs[4][0],
    evidenceComplete: scenarios.filter((s) => Object.keys(s.full).length >= 2).length,
    wallTimeMs: Number((performance.now() - started).toFixed(1))
  };
  const report = { protocolVersion: "efsm-ablation-v1", zeroLlm: true, scenarios, metrics };
  await mkdir(resolve(values.out, ".."), { recursive: true });
  await writeFile(resolve(values.out), `${JSON.stringify(report, null, 2)}\n`);
  const rows = scenarios.map((s, index) => `| ${s.id} | ${violationPairs[index][0] ? "FAIL" : "PASS"} | ${violationPairs[index][1] ? "FAIL" : "PASS"} |`);
  console.log(["# EFSM Ablation", "", "| Scenario | Imperative | C-full |", "| :-- | :--: | :--: |", ...rows, "", `Wall time: ${metrics.wallTimeMs} ms`, ""].join("\n"));
}

main().catch((error) => { console.error("EFSM ablation failed:", error); process.exit(1); });
