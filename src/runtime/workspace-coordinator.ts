import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { rename, unlink } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { relative, resolve, sep } from "node:path";
import type { GitCollaboration, GitMergeResult, GitRoleCommit, GitRoleWorktree, GitRestoreResult } from "./git-collaboration.js";
import { acquireCanonicalWorkspaceLock, assertCanonicalWorkspaceLock, readCanonicalWorkspaceLock } from "./workspace-lock.js";
import type { CanonicalWorkspaceLock, ReleaseRecord } from "./workspace-contracts.js";
import { assertEvidenceManifest, assertWorkspaceCheckpoint, assertWorkspaceRef, buildWorkspaceEvent, digestRecord, type EvidenceManifest, type WorkspaceCheckpoint, type WorkspaceEventEnvelope, type WorkspaceRef } from "./workspace-contracts.js";
import { createWorkspaceReleaseService, type WorkspaceReleaseService } from "./workspace-release.js";

const execFile = promisify(execFileCallback);

export type WorkspaceCoordinatorOptions = {
  repositoryRoot: string;
  evidenceDir: string;
  collaboration: GitCollaboration;
  workspaceId?: string;
  releaseStoreDir?: string;
};

function workspaceIdFor(repositoryRoot: string): string {
  return `workspace-${createHash("sha256").update(resolve(repositoryRoot), "utf8").digest("hex").slice(0, 24)}`;
}

function checkpointId(checkpoint: WorkspaceCheckpoint): string {
  const identity = `${checkpoint.runId}-${checkpoint.nodeId}-${checkpoint.attempt}`.replace(/[^A-Za-z0-9._-]/g, "_");
  const digest = createHash("sha256").update(JSON.stringify(checkpoint), "utf8").digest("hex").slice(0, 16);
  return `${identity}-${digest}`;
}

async function listEvidenceFiles(root: string, directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return [];
    throw error;
  });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listEvidenceFiles(root, path));
    else if (entry.isFile()) files.push(relative(root, path).split(sep).join("/"));
  }
  return files.sort();
}

export class WorkspaceCoordinator {
  readonly workspaceId: string;
  readonly release: WorkspaceReleaseService;

  constructor(private readonly options: WorkspaceCoordinatorOptions) {
    this.workspaceId = options.workspaceId ?? workspaceIdFor(options.repositoryRoot);
    this.release = createWorkspaceReleaseService(options.releaseStoreDir ?? resolve(options.evidenceDir, "release-store"));
  }

  private async persistCheckpoint(checkpoint: WorkspaceCheckpoint): Promise<void> {
    await mkdir(resolve(this.options.evidenceDir, "checkpoints"), { recursive: true });
    const path = resolve(this.options.evidenceDir, "checkpoints", `${checkpointId(checkpoint)}.json`);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporary, path).catch((error: unknown) => {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      });
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private async recordCommit(commit: GitRoleCommit | GitRestoreResult): Promise<void> {
    await mkdir(resolve(this.options.evidenceDir, "provenance"), { recursive: true });
    await writeFile(resolve(this.options.evidenceDir, "provenance", `${commit.resultCommit}.json`), `${JSON.stringify({ ...commit.provenance, ...( "targetCommit" in commit ? { targetCommit: commit.targetCommit, expectedCanonicalHead: commit.expectedCanonicalHead } : {}) }, null, 2)}\n`, "utf8");
  }

  async writeEvidenceManifest(args: { runId: string }): Promise<EvidenceManifest> {
    const root = resolve(this.options.evidenceDir);
    await mkdir(root, { recursive: true });
    const eventPath = resolve(root, "events.ndjson");
    const eventRefs: string[] = [];
    const events = await readFile(eventPath, "utf8").catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return "";
      throw error;
    });
    for (const [index, line] of events.split(/\r?\n/).entries()) {
      if (!line.trim()) continue;
      let event: unknown;
      try { event = JSON.parse(line); } catch { throw new Error(`[WORKSPACE_MANIFEST_EVIDENCE_INVALID] events.ndjson line ${index + 1} is malformed`); }
      if (!event || typeof event !== "object" || Array.isArray(event) || typeof (event as Record<string, unknown>).eventId !== "string" || !(event as Record<string, unknown>).eventId || (event as Record<string, unknown>).runId !== args.runId) {
        throw new Error(`[WORKSPACE_MANIFEST_EVIDENCE_INVALID] events.ndjson line ${index + 1} has an invalid Run event identity`);
      }
      eventRefs.push(`events.ndjson#${encodeURIComponent((event as Record<string, unknown>).eventId as string)}`);
    }
    const checkpointFiles = [
      ...await listEvidenceFiles(root, resolve(root, "checkpoints")),
      ...await listEvidenceFiles(root, resolve(root, "workspace", "checkpoints"))
    ];
    const provenanceRefs = await listEvidenceFiles(root, resolve(root, "provenance"));
    const reviewRefs = await listEvidenceFiles(root, resolve(root, "control", "reviews"));
    const manifestBase = {
      ogsContractVersion: 2 as const,
      schemaVersion: 1 as const,
      manifestId: `${args.runId}:evidence`,
      runId: args.runId,
      eventRefs: [...new Set(eventRefs)].sort(),
      checkpointRefs: [...new Set(checkpointFiles)].sort(),
      provenanceRefs,
      reviewRefs
    };
    const manifest: EvidenceManifest = { ...manifestBase, digest: digestRecord(manifestBase) };
    assertEvidenceManifest(manifest);
    const target = resolve(root, "evidence-manifest.json");
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
      await rename(temporary, target);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
    return manifest;
  }

  async prepare(args: { runId: string; nodeId: string; roleId: string; executionId: string; baseCommit: string; attempt?: number; branchId?: string; lineageId?: string; round?: number; loopIteration?: number; stateVersion?: number }): Promise<{ workspaceId: string; worktreeId: string; branch: string; worktree: GitRoleWorktree; checkpoint: WorkspaceCheckpoint }> {
    const worktree = await this.options.collaboration.addWorktree({ roleId: args.roleId, executionId: args.executionId, baseCommit: args.baseCommit });
    const worktreeId = createHash("sha256").update(JSON.stringify([args.roleId, args.executionId]), "utf8").digest("hex");
    const checkpoint: WorkspaceCheckpoint = {
      ogsContractVersion: 2, schemaVersion: 1, runId: args.runId, nodeId: args.nodeId, attempt: args.attempt ?? 1,
      status: "prepared", worktreeId, branch: worktree.branch, baseCommit: worktree.baseCommit, changedPaths: [],
      branchId: args.branchId ?? `${args.nodeId}@1#${args.attempt ?? 1}`, lineageId: args.lineageId ?? args.nodeId,
      round: args.round ?? 1, loopIteration: args.loopIteration ?? 1, stateVersion: args.stateVersion ?? 0,
      decisionBackground: {}, evidenceRefs: []
    };
    await this.persistCheckpoint(checkpoint);
    return { workspaceId: this.workspaceId, worktreeId, branch: worktree.branch, worktree, checkpoint };
  }

  async claim(args: { workspaceDir: string; owner: string; expectedCanonicalHead: string; currentCanonicalHead?: string; leaseMs?: number }): Promise<{ lock: CanonicalWorkspaceLock; release: () => Promise<void> }> {
    return acquireCanonicalWorkspaceLock({ ...args, workspaceId: this.workspaceId });
  }

  async commit(args: { runId: string; nodeId: string; roleId: string; worktree: GitRoleWorktree; message: string; checkpoint: WorkspaceCheckpoint; lfsObjectIds?: string[]; decisionBackground?: Record<string, unknown>; evidenceRefs?: string[] }): Promise<{ roleCommit: GitRoleCommit; checkpoint: WorkspaceCheckpoint; event: WorkspaceEventEnvelope }> {
    const roleCommit = await this.options.collaboration.commitWorktree(args.worktree, args.message);
    return this.recordRoleCommit({
      runId: args.runId,
      nodeId: args.nodeId,
      branchId: args.checkpoint.branchId,
      roleCommit,
      checkpoint: args.checkpoint,
      lfsObjectIds: args.lfsObjectIds,
      decisionBackground: args.decisionBackground,
      evidenceRefs: args.evidenceRefs
    });
  }

  async recordRoleCommit(args: {
    runId: string;
    nodeId: string;
    branchId: string;
    roleCommit: GitRoleCommit;
    checkpoint?: WorkspaceCheckpoint;
    lfsObjectIds?: string[];
    decisionBackground?: Record<string, unknown>;
    evidenceRefs?: string[];
  }): Promise<{ roleCommit: GitRoleCommit; checkpoint: WorkspaceCheckpoint; event: WorkspaceEventEnvelope }> {
    await this.recordCommit(args.roleCommit);
    const checkpoint: WorkspaceCheckpoint = {
      ...(args.checkpoint ?? {
        ogsContractVersion: 2,
        schemaVersion: 1,
        runId: args.runId,
        nodeId: args.nodeId,
        attempt: 1,
        status: "prepared",
        worktreeId: createHash("sha256").update(`${args.branchId}:${args.roleCommit.executionId}`, "utf8").digest("hex"),
        branch: args.roleCommit.branch,
        baseCommit: args.roleCommit.baseCommit,
        branchId: args.branchId,
        lineageId: args.branchId,
        round: 1,
        loopIteration: 0,
        stateVersion: 0,
        decisionBackground: {},
        evidenceRefs: []
      }),
      status: "completed",
      roleCommit: args.roleCommit.resultCommit,
      changedPaths: args.roleCommit.changedPaths,
      decisionBackground: args.decisionBackground ?? args.checkpoint?.decisionBackground ?? {},
      evidenceRefs: args.evidenceRefs ?? args.checkpoint?.evidenceRefs ?? []
    };
    assertWorkspaceCheckpoint(checkpoint);
    await this.persistCheckpoint(checkpoint);
    const event = buildWorkspaceEvent({
      eventId: `result_committed:${args.runId}:${args.nodeId}:${args.roleCommit.resultCommit}`,
      eventType: "result_committed",
      runId: args.runId,
      recordedAt: new Date().toISOString(),
      payload: {
        runId: args.runId,
        nodeId: args.nodeId,
        roleId: args.roleCommit.roleId,
        baseCommit: args.roleCommit.baseCommit,
        resultCommit: args.roleCommit.resultCommit,
        changedPaths: args.roleCommit.changedPaths,
        lfsObjectIds: args.lfsObjectIds ?? args.roleCommit.lfsObjectIds,
        decisionBackground: checkpoint.decisionBackground,
        evidenceRefs: checkpoint.evidenceRefs
      }
    });
    return { roleCommit: args.roleCommit, checkpoint, event };
  }

  async merge(args: { runId: string; nodeId: string; baseCommit: string; candidateCommits: string[]; mergeId: string; checkpoint: WorkspaceCheckpoint; order?: string[] }): Promise<{ merge: GitMergeResult; checkpoint: WorkspaceCheckpoint; event: WorkspaceEventEnvelope }> {
    const merge = await this.options.collaboration.mergeCommits({ mergeId: args.mergeId, baseCommit: args.baseCommit, candidateCommits: args.candidateCommits, order: args.order });
    return this.recordMerge({ runId: args.runId, nodeId: args.nodeId, merge, checkpoint: args.checkpoint });
  }

  async recordMerge(args: { runId: string; nodeId: string; merge: GitMergeResult; checkpoint?: WorkspaceCheckpoint }): Promise<{ merge: GitMergeResult; checkpoint: WorkspaceCheckpoint; event: WorkspaceEventEnvelope }> {
    const merge = args.merge;
    const checkpoint: WorkspaceCheckpoint = {
      ...(args.checkpoint ?? {
        ogsContractVersion: 2,
        schemaVersion: 1,
        runId: args.runId,
        nodeId: args.nodeId,
        attempt: 1,
        status: "prepared",
        worktreeId: createHash("sha256").update(`merge:${merge.mergeId}`, "utf8").digest("hex"),
        branch: merge.branch,
        baseCommit: merge.baseCommit,
        branchId: merge.mergeId,
        lineageId: merge.mergeId,
        round: 1,
        loopIteration: 0,
        stateVersion: 0,
        decisionBackground: {},
        evidenceRefs: merge.candidateCommits
      }),
      status: merge.status === "merged" ? "completed" : "waiting",
      ...(merge.mergeCommit ? { mergeCommit: merge.mergeCommit } : {}),
      changedPaths: merge.conflictPaths,
      evidenceRefs: merge.candidateCommits
    };
    assertWorkspaceCheckpoint(checkpoint);
    await this.persistCheckpoint(checkpoint);
    const event = buildWorkspaceEvent({
      eventId: `${merge.status === "conflict" ? "join_conflict" : "workspace_integrated"}:${args.runId}:${merge.mergeId}`,
      eventType: merge.status === "conflict" ? "join_conflict" : "workspace_integrated",
      runId: args.runId,
      recordedAt: new Date().toISOString(),
      payload: {
        mergeId: merge.mergeId,
        baseCommit: merge.baseCommit,
        candidateCommits: merge.candidateCommits,
        ...(merge.mergeCommit ? { mergeCommit: merge.mergeCommit } : {}),
        conflictPaths: merge.conflictPaths,
        provenance: merge.provenance
      }
    });
    return { merge, checkpoint, event };
  }

  async restore(args: { runId: string; nodeId: string; restoreId: string; targetCommit: string; expectedCanonicalHead: string; workspaceDir: string; leaseMs?: number; checkpoint: WorkspaceCheckpoint; message?: string }): Promise<{ restore: GitRestoreResult; checkpoint: WorkspaceCheckpoint }> {
    const currentCanonicalHead = String((await execFile("git", ["rev-parse", "HEAD"], { cwd: resolve(this.options.repositoryRoot), encoding: "utf8" })).stdout).trim();
    const handle = await this.claim({
      workspaceDir: args.workspaceDir,
      owner: args.runId,
      expectedCanonicalHead: args.expectedCanonicalHead,
      currentCanonicalHead,
      leaseMs: args.leaseMs
    });
    try {
      const assertRestoreLock = async () => {
        const head = String((await execFile("git", ["rev-parse", "HEAD"], { cwd: resolve(this.options.repositoryRoot), encoding: "utf8" })).stdout).trim();
        await assertCanonicalWorkspaceLock({
          workspaceDir: args.workspaceDir,
          lock: handle.lock,
          owner: args.runId,
          fencingToken: handle.lock.fencingToken,
          expectedCanonicalHead: args.expectedCanonicalHead,
          currentCanonicalHead: head
        });
      };
      await assertRestoreLock();
      const restore = await this.options.collaboration.restoreWorktree({ restoreId: args.restoreId, targetCommit: args.targetCommit, expectedCanonicalHead: args.expectedCanonicalHead, message: args.message ?? `Restore ${args.targetCommit}` });
      await assertRestoreLock();
      await this.recordCommit(restore);
      const checkpoint: WorkspaceCheckpoint = { ...args.checkpoint, status: "completed", roleCommit: restore.resultCommit, changedPaths: restore.changedPaths };
      await this.persistCheckpoint(checkpoint);
      return { restore, checkpoint };
    } finally {
      await handle.release();
    }
  }

  async updateCanonicalRef(args: { newCommit: string; expectedCanonicalHead: string; workspaceDir: string; lock: CanonicalWorkspaceLock }): Promise<void> {
    const currentCanonicalHead = (await execFile("git", ["rev-parse", "HEAD"], { cwd: resolve(this.options.repositoryRoot), encoding: "utf8" })).stdout.toString().trim();
    const currentLock = await readCanonicalWorkspaceLock(args.workspaceDir);
    if (!currentLock) throw new Error("[WORKSPACE_LOCK_OWNER_MISMATCH] canonical lock is missing");
    await assertCanonicalWorkspaceLock({
      workspaceDir: args.workspaceDir,
      lock: currentLock,
      owner: args.lock.owner,
      fencingToken: args.lock.fencingToken,
      expectedCanonicalHead: args.expectedCanonicalHead,
      currentCanonicalHead
    });
    await this.options.collaboration.updateCanonicalRef(args);
    if (args.newCommit !== args.expectedCanonicalHead) {
      await execFile("git", ["reset", "--hard", args.newCommit], {
        cwd: resolve(this.options.repositoryRoot),
        encoding: "utf8"
      });
    }
  }

  async cleanupMergedRunBranches(args: { runId: string; terminalStatus: "done" | "failed" | "terminated"; owner: string; workspaceDir: string; expectedCanonicalHead: string; leaseMs?: number }): Promise<{ removedWorktrees: string[]; removedBranches: string[] }> {
    if (!["done", "failed", "terminated"].includes(args.terminalStatus)) throw new Error("[WORKSPACE_CLEANUP_RUN_NOT_TERMINAL] cleanup requires a completed, failed, or terminated Run");
    if (args.runId !== this.options.collaboration.runId) throw new Error("[WORKSPACE_CLEANUP_RUN_MISMATCH] cleanup is limited to the owning collaboration Run");
    const currentCanonicalHead = String((await execFile("git", ["rev-parse", "HEAD"], { cwd: resolve(this.options.repositoryRoot), encoding: "utf8" })).stdout).trim();
    const handle = await this.claim({
      workspaceDir: args.workspaceDir,
      owner: args.owner,
      expectedCanonicalHead: args.expectedCanonicalHead,
      currentCanonicalHead,
      leaseMs: args.leaseMs
    });
    const removedBranches: string[] = [];
    try {
      const assertCleanupLock = async () => {
        const head = String((await execFile("git", ["rev-parse", "HEAD"], { cwd: resolve(this.options.repositoryRoot), encoding: "utf8" })).stdout).trim();
        const currentLock = await readCanonicalWorkspaceLock(args.workspaceDir);
        if (!currentLock) throw new Error("[WORKSPACE_LOCK_OWNER_MISMATCH] canonical lock is missing");
        await assertCanonicalWorkspaceLock({
          workspaceDir: args.workspaceDir,
          lock: currentLock,
          owner: args.owner,
          fencingToken: handle.lock.fencingToken,
          expectedCanonicalHead: args.expectedCanonicalHead,
          currentCanonicalHead: head
        });
        return head;
      };
      await assertCleanupLock();
      const removedWorktrees = await this.options.collaboration.removeRunWorktrees();
      await assertCleanupLock();
      for (const branch of await this.options.collaboration.runBranchEntries()) {
        if (!(await this.options.collaboration.isCommitAncestor(branch.commit, currentCanonicalHead))) continue;
        await assertCleanupLock();
        await this.options.collaboration.deleteRunBranch({
          ref: branch.ref,
          expectedCommit: branch.commit,
          workspaceDir: args.workspaceDir,
          expectedCanonicalHead: args.expectedCanonicalHead,
          lock: handle.lock
        });
        removedBranches.push(branch.ref);
      }
      return { removedWorktrees, removedBranches };
    } finally {
      await handle.release();
    }
  }

  async publishRelease(args: {
    releaseId: string;
    runId: string;
    workspaceDir: string;
    sourceDir: string;
    releaseCommit: string;
    expectedCanonicalHead: string;
    downloadReference?: string;
    leaseMs?: number;
  }): Promise<ReleaseRecord> {
    const prepared = await this.release.prepare({
      releaseId: args.releaseId,
      runId: args.runId,
      workspaceId: this.workspaceId,
      releaseCommit: args.releaseCommit,
      expectedCanonicalHead: args.expectedCanonicalHead
    });
    if (!(await this.options.collaboration.isCommitAncestor(prepared.expectedCanonicalHead, prepared.releaseCommit))) {
      await this.release.fail({ releaseId: prepared.releaseId, failureCode: "CANDIDATE_INVALID" });
      throw new Error("[CANDIDATE_INVALID] Release candidate must descend from expectedCanonicalHead");
    }
    await this.release.materialize({ releaseId: prepared.releaseId, sourceDir: args.sourceDir, downloadReference: args.downloadReference });
    let handle: { lock: CanonicalWorkspaceLock; release: () => Promise<void> } | undefined;
    try {
      const currentCanonicalHead = (await execFile("git", ["rev-parse", "HEAD"], { cwd: resolve(this.options.repositoryRoot), encoding: "utf8" })).stdout.toString().trim();
      if (currentCanonicalHead === prepared.releaseCommit && currentCanonicalHead !== prepared.expectedCanonicalHead) {
        return await this.reconcileRelease({ releaseId: prepared.releaseId, runId: args.runId, workspaceDir: args.workspaceDir, leaseMs: args.leaseMs });
      }
      handle = await this.claim({
        workspaceDir: args.workspaceDir,
        owner: args.runId,
        expectedCanonicalHead: args.expectedCanonicalHead,
        currentCanonicalHead,
        leaseMs: args.leaseMs
      });
      await this.updateCanonicalRef({
        newCommit: prepared.releaseCommit,
        expectedCanonicalHead: prepared.expectedCanonicalHead,
        workspaceDir: args.workspaceDir,
        lock: handle.lock
      });
      await this.release.markRefUpdated(prepared.releaseId);
      return await this.release.publish(prepared.releaseId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const failureCode = message.includes("WORKSPACE_LOCK_STALE_HEAD") || message.includes("GIT_COLLABORATION_STALE_CANONICAL_HEAD")
        ? "STALE_CANONICAL_HEAD" as const
        : undefined;
      if (failureCode) await this.release.fail({ releaseId: prepared.releaseId, failureCode }).catch(() => undefined);
      throw error;
    } finally {
      await handle?.release();
    }
  }

  async reconcileRelease(args: { releaseId: string; runId: string; workspaceDir: string; leaseMs?: number }): Promise<ReleaseRecord> {
    const record = await this.release.load(args.releaseId);
    if (!record) throw new Error("[RELEASE_NOT_FOUND] release must be prepared first");
    if (record.runId !== args.runId || record.workspaceId !== this.workspaceId) throw new Error("[RELEASE_STATE_INVALID] release identity does not match the owning Run and Workspace");
    const currentCanonicalHead = String((await execFile("git", ["rev-parse", "HEAD"], { cwd: resolve(this.options.repositoryRoot), encoding: "utf8" })).stdout).trim();
    if (currentCanonicalHead === record.releaseCommit) return this.release.reconcile({ releaseId: record.releaseId, canonicalHead: currentCanonicalHead });
    if (currentCanonicalHead !== record.expectedCanonicalHead) return this.release.reconcile({ releaseId: record.releaseId, canonicalHead: currentCanonicalHead });
    throw new Error("[RELEASE_RECONCILIATION_FAILED] canonical ref was not updated; resume the normal Release operation");
  }

  workspaceRef(args: { commit: string; path: string; digest: string }): WorkspaceRef {
    const ref = { ogsContractVersion: 2 as const, schemaVersion: 1 as const, workspaceId: this.workspaceId, ...args };
    assertWorkspaceRef(ref);
    return ref;
  }

  async readWorkspaceRef(ref: WorkspaceRef): Promise<Uint8Array> {
    assertWorkspaceRef(ref);
    if (ref.workspaceId !== this.workspaceId) throw new Error("[WORKSPACE_REF_WORKSPACE_MISMATCH] reference belongs to another Workspace");
    let output: Buffer;
    let treeEntry: string | undefined;
    try {
      const tree = await execFile("git", ["--literal-pathspecs", "ls-tree", "-z", "--full-tree", ref.commit, "--", ref.path], { cwd: resolve(this.options.repositoryRoot), encoding: "utf8" });
      treeEntry = String(tree.stdout).split("\0").find(Boolean);
      if (!treeEntry) throw new Error("missing tree entry");
      const header = treeEntry.slice(0, treeEntry.indexOf("\t")).split(" ");
      const mode = header[0];
      const type = header[1];
      if (mode === "120000" || type !== "blob") throw new Error("unsupported committed tree entry");
      const result = await execFile("git", ["show", `${ref.commit}:${ref.path}`], { cwd: resolve(this.options.repositoryRoot), encoding: "buffer", maxBuffer: 32 * 1024 * 1024 });
      output = Buffer.from(result.stdout as Uint8Array);
    } catch {
      if (treeEntry?.startsWith("120000 ")) {
        throw new Error("[WORKSPACE_REF_SYMLINK] symbolic links are not valid WorkspaceRef targets");
      }
      throw new Error("[WORKSPACE_REF_NOT_FOUND] committed path is unavailable");
    }
    const lfsPointer = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n?$/.exec(output.toString("utf8"));
    if (lfsPointer) {
      const lfsRootResult = await execFile("git", ["rev-parse", "--git-path", "lfs/objects"], { cwd: resolve(this.options.repositoryRoot), encoding: "utf8" });
      const lfsRoot = resolve(this.options.repositoryRoot, String(lfsRootResult.stdout).trim());
      const objectPath = resolve(lfsRoot, lfsPointer[1].slice(0, 2), lfsPointer[1].slice(2, 4), lfsPointer[1]);
      const object = await readFile(objectPath).catch(() => { throw new Error("[WORKSPACE_LFS_UNAVAILABLE] referenced Git LFS object is unavailable"); });
      const objectDigest = createHash("sha256").update(object).digest("hex");
      if (object.length !== Number(lfsPointer[2]) || objectDigest !== lfsPointer[1]) throw new Error("[WORKSPACE_LFS_DIGEST_MISMATCH] referenced Git LFS object failed checksum verification");
      if (`sha256:${objectDigest}` !== ref.digest) throw new Error("[WORKSPACE_REF_DIGEST_MISMATCH] committed content digest differs from WorkspaceRef");
      return object;
    }
    const actualDigest = `sha256:${createHash("sha256").update(output).digest("hex")}`;
    if (actualDigest !== ref.digest) throw new Error("[WORKSPACE_REF_DIGEST_MISMATCH] committed content digest differs from WorkspaceRef");
    return output;
  }
}

export function createWorkspaceCoordinator(options: WorkspaceCoordinatorOptions): WorkspaceCoordinator {
  return new WorkspaceCoordinator(options);
}
