import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { buildWorkspaceRef, type CanonicalWorkspaceLock, type WorkspaceRef } from "./workspace-contracts.js";
import { assertCanonicalWorkspaceLock, readCanonicalWorkspaceLock } from "./workspace-lock.js";

const execFile = promisify(execFileCallback);
const SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
// Execution IDs are timestamped by the runtime and contain ISO `T`/`Z` bytes.
// Keep the character set conservative while accepting those stable uppercase bytes.
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export type GitCollaborationProbe = {
  supported: boolean;
  repositoryRoot: string;
  head?: string;
  clean: boolean;
  workspaceRelativePath?: string;
  reason?: string;
};

export type GitRoleWorktree = {
  roleId: string;
  executionId: string;
  branch: string;
  path: string;
  baseCommit: string;
};

export type GitRoleCommit = GitRoleWorktree & {
  resultCommit: string;
  changedPaths: string[];
  /** Framework-generated immutable references for regular files changed by this commit. */
  workspaceRefs: WorkspaceRef[];
  lfsObjectIds: string[];
  provenance: {
    ogsContractVersion: 2;
    schemaVersion: 1;
    version: 1;
    kind: "role-commit";
    runId: string;
    roleId: string;
    executionId: string;
    baseCommit: string;
    resultCommit: string;
    changedPaths: string[];
  };
};

export type GitMergeResult = {
  mergeId: string;
  path: string;
  branch: string;
  baseCommit: string;
  candidateCommits: string[];
  status: "merged" | "conflict";
  mergeCommit?: string;
  conflictPaths: string[];
  provenance: {
    ogsContractVersion: 2;
    schemaVersion: 1;
    version: 1;
    kind: "merge";
    runId: string;
    mergeId: string;
    baseCommit: string;
    candidateCommits: string[];
    status: "merged" | "conflict";
    mergeCommit?: string;
    conflictPaths: string[];
  };
};

export type GitMergeVerification = {
  passed: boolean;
  head: string;
  clean: boolean;
  changedPaths: string[];
  reason?: "WORKTREE_NOT_CLEAN" | "DIFF_CHECK_FAILED" | "MERGE_HEAD_MISMATCH" | "MERGE_CANDIDATE_MISMATCH" | "MERGE_CANDIDATE_PROVENANCE_MISMATCH" | "MERGE_WORKTREE_MISMATCH";
};

export type GitRestoreResult = GitRoleCommit & {
  targetCommit: string;
  expectedCanonicalHead: string;
};

type GitMergeVerificationOptions = {
  mergeId?: string;
  branch?: string;
  mergeCommit?: string;
  candidateCommits?: string[];
};

export type GitCollaborationOptions = {
  repositoryRoot: string;
  worktreeRoot: string;
  runId: string;
  workspaceId?: string;
  timeoutMs?: number;
};

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export type GitCollaboration = ReturnType<typeof createGitCollaboration>;

type GitWorktreeEntry = { path: string; head?: string; branch?: string };

function assertId(value: string, label: string): string {
  if (!SAFE_ID.test(value) || value.includes("..") || value.endsWith(".")) throw new Error(`GIT_COLLABORATION_INVALID_${label.toUpperCase()}`);
  return value;
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith("/"));
}

/** Resolve an existing ancestor before appending missing components. This follows system links
 * such as macOS /var while still making containment checks against the actual filesystem path. */
async function resolveActualPath(candidate: string, label: string): Promise<string> {
  const absolute = resolve(candidate);
  let current = absolute;
  const missing: string[] = [];
  while (!(await lstat(current).catch(() => undefined))) {
    const parent = dirname(current);
    if (parent === current) throw new Error(`GIT_COLLABORATION_${label}_PATH_INVALID`);
    missing.unshift(current.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
    current = parent;
  }
  const actualCurrent = await realpath(current);
  const info = await lstat(actualCurrent);
  if (!info.isDirectory()) throw new Error(`GIT_COLLABORATION_${label}_NOT_DIRECTORY`);
  return resolve(actualCurrent, ...missing);
}

function parseWorktreeEntries(output: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: GitWorktreeEntry | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (!line) {
      if (current) entries.push(current);
      current = undefined;
      continue;
    }
    if (line.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: line.slice("worktree ".length) };
    } else if (current && line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (current && line.startsWith("branch ")) {
      current.branch = line.slice("branch ".length);
    }
  }
  if (current) entries.push(current);
  return entries;
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_") || ["SSH_ASKPASS", "GIT_ASKPASS", "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"].includes(key)) delete env[key];
  }
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_LFS_SKIP_SMUDGE: "1"
  };
}

async function runGit(cwd: string, args: string[], timeoutMs: number): Promise<string> {
  try {
    const hooksPath = process.platform === "win32" ? "NUL" : "/dev/null";
    const result = await execFile("git", [
      "-c", `core.hooksPath=${hooksPath}`,
      "-c", "core.autocrlf=false",
      "-c", "core.fsmonitor=false",
      ...args
    ], { cwd, env: gitEnv(), encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs, windowsHide: true });
    return String(result.stdout ?? "");
  } catch (error) {
    const detail = String((error as { stderr?: unknown; message?: unknown }).stderr || (error as Error).message || "git failed").trim().slice(0, 2000);
    throw new Error(`GIT_COLLABORATION_GIT_FAILED: ${args[0] ?? "git"}: ${detail}`);
  }
}

async function runGitAllowFailure(cwd: string, args: string[], timeoutMs: number): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const hooksPath = process.platform === "win32" ? "NUL" : "/dev/null";
    const result = await execFile("git", [
      "-c", `core.hooksPath=${hooksPath}`,
      "-c", "core.autocrlf=false",
      "-c", "core.fsmonitor=false",
      ...args
    ], { cwd, env: gitEnv(), encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: timeoutMs, windowsHide: true });
    return { code: 0, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
  } catch (error) {
    const item = error as { code?: unknown; stdout?: unknown; stderr?: unknown };
    return { code: Number(item.code) || 1, stdout: String(item.stdout ?? ""), stderr: String(item.stderr ?? "") };
  }
}

/** Parse Git's NUL-delimited name-only output without normalizing filename bytes. */
function parseNameOnlyPaths(output: string): string[] {
  return output.split("\0").filter((item) => item.length > 0);
}

async function readCommittedBlob(args: {
  repositoryRoot: string;
  commit: string;
  path: string;
  timeoutMs: number;
}): Promise<Buffer | undefined> {
  const tree = await runGitAllowFailure(args.repositoryRoot, ["ls-tree", "-z", "--full-tree", args.commit, "--", args.path], args.timeoutMs);
  if (tree.code !== 0) return undefined;
  const entry = tree.stdout.split("\0").find(Boolean);
  if (!entry) return undefined;
  const header = entry.slice(0, entry.indexOf("\t")).split(" ");
  if (header[0] === "120000" || header[1] !== "blob") return undefined;
  try {
    const result = await execFile("git", ["--literal-pathspecs", "show", `${args.commit}:${args.path}`], {
      cwd: args.repositoryRoot,
      env: gitEnv(),
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
      timeout: args.timeoutMs,
      windowsHide: true
    });
    return Buffer.from(result.stdout as Uint8Array);
  } catch {
    return undefined;
  }
}

async function workspaceRefsForCommit(args: {
  repositoryRoot: string;
  workspaceId: string;
  commit: string;
  changedPaths: string[];
  timeoutMs: number;
}): Promise<{ workspaceRefs: WorkspaceRef[]; lfsObjectIds: string[] }> {
  const refs: WorkspaceRef[] = [];
  const lfsObjectIds = new Set<string>();
  for (const path of args.changedPaths) {
    const pointerOrContent = await readCommittedBlob({ ...args, path });
    if (!pointerOrContent) continue;
    let content = pointerOrContent;
    const pointer = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n?$/.exec(content.toString("utf8"));
    if (pointer) {
      lfsObjectIds.add(`sha256:${pointer[1]}`);
      const lfsRootResult = await runGitAllowFailure(args.repositoryRoot, ["rev-parse", "--git-path", "lfs/objects"], args.timeoutMs);
      if (lfsRootResult.code !== 0) {
        throw new Error("[WORKSPACE_LFS_UNAVAILABLE] Git LFS object storage is unavailable for a committed pointer");
      }
      const objectPath = resolve(args.repositoryRoot, lfsRootResult.stdout.trim(), pointer[1].slice(0, 2), pointer[1].slice(2, 4), pointer[1]);
      try {
        content = await readFile(objectPath);
      } catch {
        throw new Error("[WORKSPACE_LFS_UNAVAILABLE] referenced Git LFS object is unavailable for the committed pointer");
      }
      const objectDigest = createHash("sha256").update(content).digest("hex");
      if (content.length !== Number(pointer[2]) || objectDigest !== pointer[1]) {
        throw new Error("[WORKSPACE_LFS_DIGEST_MISMATCH] referenced Git LFS object failed checksum verification");
      }
    }
    const digest = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    refs.push(buildWorkspaceRef({ workspaceId: args.workspaceId, commit: args.commit, path, digest }));
  }
  return { workspaceRefs: refs, lfsObjectIds: [...lfsObjectIds].sort() };
}

function encodeWorktreeId(roleId: string, executionId: string): string {
  return createHash("sha256").update(JSON.stringify([roleId, executionId]), "utf8").digest("hex");
}

async function detectUnsupportedRepositoryFeature(repositoryRoot: string, timeoutMs: number): Promise<string | undefined> {
  const indexedEntries = await runGitAllowFailure(repositoryRoot, ["ls-files", "--stage", "-z"], timeoutMs);
  if (indexedEntries.code === 0 && indexedEntries.stdout.split("\0").some((entry) => entry.startsWith("160000 "))) {
    return "SUBMODULE_UNSUPPORTED";
  }

  const trackedFiles = await runGitAllowFailure(repositoryRoot, ["ls-tree", "-r", "--name-only", "HEAD"], timeoutMs);
  let hasLfsAttributes = false;
  if (trackedFiles.code === 0) {
    for (const file of trackedFiles.stdout.split(/\r?\n/).filter((item) => item.endsWith(".gitattributes"))) {
      const attributes = await runGitAllowFailure(repositoryRoot, ["show", `HEAD:${file}`], timeoutMs);
      if (attributes.code === 0 && /filter=lfs\b/.test(attributes.stdout)) {
        hasLfsAttributes = true;
        break;
      }
    }
  }
  if (hasLfsAttributes) {
    const lfsVersion = await runGitAllowFailure(repositoryRoot, ["lfs", "version"], timeoutMs);
    if (lfsVersion.code !== 0) return "LFS_UNAVAILABLE";
  }
  if (trackedFiles.code !== 0) return "LFS_ATTRIBUTES_PROBE_FAILED";

  const sparseConfig = await runGitAllowFailure(repositoryRoot, ["config", "--bool", "--get", "core.sparseCheckout"], timeoutMs);
  if (sparseConfig.code === 0 && sparseConfig.stdout.trim().toLowerCase() === "true") return "SPARSE_CHECKOUT_UNSUPPORTED";
  const indexedModes = await runGitAllowFailure(repositoryRoot, ["ls-files", "-v", "-z"], timeoutMs);
  if (indexedModes.code === 0 && indexedModes.stdout.split("\0").some((entry) => entry.startsWith("S"))) {
    return "SPARSE_CHECKOUT_UNSUPPORTED";
  }
  return undefined;
}

export async function probeGitCollaboration(args: {
  repositoryRoot: string;
  workspaceDir?: string;
  timeoutMs?: number;
}): Promise<GitCollaborationProbe> {
  const repositoryRoot = await realpath(resolve(args.repositoryRoot));
  const timeoutMs = args.timeoutMs ?? 15_000;
  const rootOutput = await runGitAllowFailure(repositoryRoot, ["rev-parse", "--show-toplevel"], timeoutMs);
  if (rootOutput.code !== 0) return { supported: false, repositoryRoot, clean: false, reason: "NOT_A_GIT_REPOSITORY" };
  const actualRoot = resolve(rootOutput.stdout.trim());
  const worktreeProbe = await runGitAllowFailure(actualRoot, ["worktree", "list", "--porcelain"], timeoutMs);
  if (worktreeProbe.code !== 0) return { supported: false, repositoryRoot: actualRoot, clean: false, reason: "WORKTREE_UNAVAILABLE" };
  const headOutput = await runGitAllowFailure(actualRoot, ["rev-parse", "HEAD"], timeoutMs);
  if (headOutput.code !== 0 || !SHA.test(headOutput.stdout.trim())) return { supported: false, repositoryRoot: actualRoot, clean: false, reason: "NO_COMMIT" };
  const unsupportedFeature = await detectUnsupportedRepositoryFeature(actualRoot, timeoutMs);
  if (unsupportedFeature) {
    return {
      supported: false,
      repositoryRoot: actualRoot,
      head: headOutput.stdout.trim(),
      clean: false,
      reason: unsupportedFeature
    };
  }
  const status = await runGit(actualRoot, ["status", "--porcelain=v1"], timeoutMs);
  const clean = status.trim() === "";
  const workspace = args.workspaceDir
    ? await realpath(resolve(args.workspaceDir)).catch(() => resolve(args.workspaceDir!))
    : actualRoot;
  if (!isWithin(actualRoot, workspace)) return { supported: false, repositoryRoot: actualRoot, head: headOutput.stdout.trim(), clean, reason: "WORKSPACE_OUTSIDE_REPOSITORY" };
  return {
    supported: clean,
    repositoryRoot: actualRoot,
    head: headOutput.stdout.trim(),
    clean,
    workspaceRelativePath: relative(actualRoot, workspace).split(sep).join("/") || ".",
    ...(clean ? {} : { reason: "WORKTREE_NOT_CLEAN" })
  };
}

export function createGitCollaboration(options: GitCollaborationOptions) {
  const repositoryRoot = resolve(options.repositoryRoot);
  const worktreeRoot = resolve(options.worktreeRoot);
  const runId = assertId(options.runId, "run_id");
  const workspaceId = options.workspaceId ?? `workspace-${createHash("sha256").update(repositoryRoot, "utf8").digest("hex").slice(0, 24)}`;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const roleCommitsBySha = new Map<string, GitRoleCommit>();

  async function assertSafeWorktreePath(path: string): Promise<string> {
    const actualRepositoryRoot = await realpath(repositoryRoot);
    const actualWorktreeRoot = await resolveActualPath(worktreeRoot, "WORKTREE_ROOT");
    const actualWorktreePath = await resolveActualPath(path, "WORKTREE_PATH");
    if (isWithin(actualRepositoryRoot, actualWorktreePath)) {
      throw new Error("GIT_COLLABORATION_WORKTREE_ROOT_MUST_BE_OUTSIDE_REPOSITORY");
    }
    if (!isWithin(actualWorktreeRoot, actualWorktreePath)) throw new Error("GIT_COLLABORATION_WORKTREE_PATH_INVALID");
    return actualWorktreePath;
  }

  async function worktreeEntries(): Promise<GitWorktreeEntry[]> {
    const result = await runGitAllowFailure(repositoryRoot, ["worktree", "list", "--porcelain"], timeoutMs);
    return result.code === 0 ? parseWorktreeEntries(result.stdout) : [];
  }

  async function runBranchEntries(): Promise<Array<{ ref: string; commit: string }>> {
    const result = await runGitAllowFailure(repositoryRoot, ["for-each-ref", "--format=%(refname) %(objectname)", `refs/heads/ogs/${runId}`], timeoutMs);
    if (result.code !== 0) return [];
    return result.stdout.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      const [ref, commit] = line.trim().split(/\s+/);
      return ref && commit ? [{ ref, commit }] : [];
    });
  }

  async function removeRunWorktrees(): Promise<string[]> {
    const prefix = `refs/heads/ogs/${runId}/`;
    const paths: string[] = [];
    for (const entry of await worktreeEntries()) {
      if (!entry.branch?.startsWith(prefix)) continue;
      await removeWorktree(entry.path, true);
      paths.push(entry.path);
    }
    return paths;
  }

  async function deleteRunBranch(args: { ref: string; expectedCommit: string; workspaceDir: string; expectedCanonicalHead: string; lock: CanonicalWorkspaceLock }): Promise<void> {
    const { ref, expectedCommit } = args;
    if (!ref.startsWith(`refs/heads/ogs/${runId}/`) || !SHA.test(expectedCommit)) throw new Error("GIT_COLLABORATION_BRANCH_INVALID");
    if ((await worktreeEntries()).some((entry) => entry.branch === ref)) throw new Error("GIT_COLLABORATION_BRANCH_IN_USE");
    const currentCanonicalHead = (await runGit(repositoryRoot, ["rev-parse", "HEAD"], timeoutMs)).trim();
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
    const result = await runGitAllowFailure(repositoryRoot, ["update-ref", "-d", ref, expectedCommit], timeoutMs);
    if (result.code !== 0) throw new Error("GIT_COLLABORATION_BRANCH_CHANGED");
  }

  async function validateMergeCandidateSet(path: string, baseCommit: string, head: string, candidateCommits: string[]): Promise<void> {
    const candidates = new Set(candidateCommits);
    const history = await runGit(path, ["rev-list", "--parents", `${baseCommit}..${head}`], timeoutMs);
    for (const line of history.split(/\r?\n/).filter(Boolean)) {
      const [commit, firstParent, ...otherParents] = line.split(" ");
      if (candidates.has(commit)) continue;

      let isCandidateAncestor = false;
      for (const candidate of candidates) {
        const result = await runGitAllowFailure(path, ["merge-base", "--is-ancestor", commit, candidate], timeoutMs);
        if (result.code === 0) {
          isCandidateAncestor = true;
          break;
        }
      }
      if (isCandidateAncestor) continue;

      // `merge --no-ff` creates a coordinator-owned merge commit whose second
      // parent is the candidate being applied. Only current candidates may
      // account for such commits in an existing merge worktree.
      if (firstParent && otherParents.some((parent) => candidates.has(parent))) continue;
      throw new Error("GIT_COLLABORATION_MERGE_CANDIDATE_SET_MISMATCH");
    }
  }

  async function readAppliedMergeOrder(path: string, baseCommit: string, head: string, candidateCommits: string[]): Promise<string[]> {
    if (head === baseCommit) return [];
    const candidates = new Set(candidateCommits);
    const firstParentCommits = (await runGit(path, ["rev-list", "--first-parent", "--reverse", `${baseCommit}..${head}`], timeoutMs))
      .split(/\r?\n/)
      .filter(Boolean);
    const order: string[] = [];
    for (const mergeCommit of firstParentCommits) {
      const parents = (await runGit(path, ["rev-list", "--parents", "-n", "1", mergeCommit], timeoutMs)).trim().split(" ").slice(1);
      const candidate = parents[1];
      if (candidate && candidates.has(candidate)) order.push(candidate);
    }
    return order;
  }

  function branchName(kind: string, id: string): string {
    return `ogs/${runId}/${kind}/${assertId(id, kind)}`;
  }

  async function validateRoleCommitProvenance(commit: GitRoleCommit): Promise<void> {
    const provenance = commit.provenance;
    if (provenance.kind !== "role-commit"
      || provenance.runId !== runId
      || provenance.roleId !== commit.roleId
      || provenance.executionId !== commit.executionId
      || provenance.resultCommit !== commit.resultCommit
      || provenance.baseCommit !== commit.baseCommit) {
      throw new Error("GIT_COLLABORATION_ROLE_PROVENANCE_INVALID");
    }
    if (!SHA.test(commit.resultCommit) || !SHA.test(commit.baseCommit)) {
      throw new Error("GIT_COLLABORATION_ROLE_PROVENANCE_INVALID");
    }

    const roleBranch = branchName("role", encodeWorktreeId(commit.roleId, commit.executionId));
    let expectedPath: string;
    if (commit.branch === roleBranch) {
      expectedPath = resolve(worktreeRoot, runId, encodeWorktreeId(commit.roleId, commit.executionId));
    } else {
      const mergePrefix = `ogs/${runId}/merge/`;
      if (!commit.branch.startsWith(mergePrefix)) throw new Error("GIT_COLLABORATION_ROLE_PROVENANCE_INVALID");
      const mergeId = commit.branch.slice(mergePrefix.length);
      if (!SAFE_ID.test(mergeId) || commit.branch !== branchName("merge", mergeId)) {
        throw new Error("GIT_COLLABORATION_ROLE_PROVENANCE_INVALID");
      }
      expectedPath = resolve(worktreeRoot, runId, `merge-${mergeId}`);
    }
    const actualCommitPath = await assertSafeWorktreePath(commit.path);
    const actualExpectedPath = await resolveActualPath(expectedPath, "ROLE_COMMIT_PATH");
    if (actualCommitPath !== actualExpectedPath) throw new Error("GIT_COLLABORATION_ROLE_PROVENANCE_INVALID");

    await runGit(repositoryRoot, ["rev-parse", `${commit.resultCommit}^{commit}`], timeoutMs);
    const branchRef = `refs/heads/${commit.branch}`;
    const branchExists = await runGitAllowFailure(repositoryRoot, ["show-ref", "--verify", "--quiet", branchRef], timeoutMs);
    if (branchExists.code !== 0) throw new Error("GIT_COLLABORATION_ROLE_PROVENANCE_INVALID");
    const branchContainsCommit = await runGitAllowFailure(repositoryRoot, ["merge-base", "--is-ancestor", commit.resultCommit, commit.branch], timeoutMs);
    if (branchContainsCommit.code !== 0) throw new Error("GIT_COLLABORATION_ROLE_PROVENANCE_INVALID");
  }

  async function validateMergeCandidateProvenance(baseCommit: string, candidateCommits: string[]): Promise<void> {
    for (const candidate of candidateCommits) {
      const provenance = roleCommitsBySha.get(candidate);
      if (!provenance || provenance.baseCommit !== baseCommit || provenance.resultCommit !== candidate) {
        throw new Error("GIT_COLLABORATION_CANDIDATE_PROVENANCE_INVALID");
      }
      await validateRoleCommitProvenance(provenance);
    }
  }

  async function fixedBase(baseCommit?: string): Promise<string> {
    const value = baseCommit ?? (await runGit(repositoryRoot, ["rev-parse", "HEAD"], timeoutMs)).trim();
    if (!SHA.test(value)) throw new Error("GIT_COLLABORATION_INVALID_BASE_COMMIT");
    const resolved = (await runGit(repositoryRoot, ["rev-parse", `${value}^{commit}`], timeoutMs)).trim();
    if (resolved !== value) throw new Error("GIT_COLLABORATION_BASE_COMMIT_NOT_FOUND");
    return value;
  }

  async function addWorktree(args: { roleId: string; executionId: string; baseCommit?: string }): Promise<GitRoleWorktree> {
    const roleId = assertId(args.roleId, "role_id");
    const executionId = assertId(args.executionId, "execution_id");
    const baseCommit = await fixedBase(args.baseCommit);
    const worktreeId = encodeWorktreeId(roleId, executionId);
    const path = await assertSafeWorktreePath(resolve(worktreeRoot, runId, worktreeId));
    await mkdir(dirname(path), { recursive: true });
    const branch = branchName("role", worktreeId);
    await runGit(repositoryRoot, ["worktree", "add", "--no-checkout", "-b", branch, path, baseCommit], timeoutMs);
    await runGit(path, ["reset", "--hard", baseCommit], timeoutMs);
    return { roleId, executionId, branch, path, baseCommit };
  }

  async function commitWorktree(worktree: GitRoleWorktree, message: string, options?: { allowNoChanges?: boolean }): Promise<GitRoleCommit> {
    if (!message.trim() || message.length > 200) throw new Error("GIT_COLLABORATION_COMMIT_MESSAGE_INVALID");
    const status = await runGit(worktree.path, ["status", "--porcelain=v1"], timeoutMs);
    if (!status.trim()) {
      if (!options?.allowNoChanges) throw new Error("GIT_COLLABORATION_NO_CHANGES");
      const resultCommit = (await runGit(worktree.path, ["rev-parse", "HEAD"], timeoutMs)).trim();
      const changedPaths = resultCommit === worktree.baseCommit
        ? []
        : parseNameOnlyPaths(await runGit(worktree.path, ["diff", "--name-only", "-z", worktree.baseCommit, resultCommit], timeoutMs));
      const { workspaceRefs, lfsObjectIds } = await workspaceRefsForCommit({ repositoryRoot, workspaceId, commit: resultCommit, changedPaths, timeoutMs });
      const commit: GitRoleCommit = {
        ...worktree,
        resultCommit,
        changedPaths,
        workspaceRefs,
        lfsObjectIds,
        provenance: { ogsContractVersion: 2, schemaVersion: 1, version: 1, kind: "role-commit", runId, roleId: worktree.roleId, executionId: worktree.executionId, baseCommit: worktree.baseCommit, resultCommit, changedPaths }
      };
      roleCommitsBySha.set(resultCommit, commit);
      return commit;
    }
    await runGit(worktree.path, ["add", "--all", ":(exclude).ogs", ":(exclude).ogs/**"], timeoutMs);
    await runGit(worktree.path, ["-c", "user.name=OGS Runtime", "-c", "user.email=ogs-runtime@localhost", "commit", "--no-verify", "-m", message.trim(), "--trailer", `Run-Id=${runId}`, "--trailer", `Node-Id=${worktree.roleId}`, "--trailer", `Checkpoint-Id=${runId}:${worktree.roleId}:${worktree.executionId}`, "--trailer", `Base-Commit=${worktree.baseCommit}`], timeoutMs);
    const resultCommit = (await runGit(worktree.path, ["rev-parse", "HEAD"], timeoutMs)).trim();
    const changedPaths = parseNameOnlyPaths(await runGit(worktree.path, ["diff-tree", "--no-commit-id", "--name-only", "-z", "-r", resultCommit], timeoutMs));
    const { workspaceRefs, lfsObjectIds } = await workspaceRefsForCommit({ repositoryRoot, workspaceId, commit: resultCommit, changedPaths, timeoutMs });
    const commit: GitRoleCommit = {
      ...worktree,
      resultCommit,
      changedPaths,
      workspaceRefs,
      lfsObjectIds,
      provenance: { ogsContractVersion: 2, schemaVersion: 1, version: 1, kind: "role-commit", runId, roleId: worktree.roleId, executionId: worktree.executionId, baseCommit: worktree.baseCommit, resultCommit, changedPaths }
    };
    roleCommitsBySha.set(resultCommit, commit);
    return commit;
  }

  async function registerRoleCommit(commit: GitRoleCommit): Promise<void> {
    await validateRoleCommitProvenance(commit);
    roleCommitsBySha.set(commit.resultCommit, commit);
  }

  async function recoverPreparedRoleCommit(args: {
    roleId: string;
    executionId: string;
    branch: string;
    baseCommit: string;
  }): Promise<GitRoleCommit | undefined> {
    const roleId = assertId(args.roleId, "role_id");
    const executionId = assertId(args.executionId, "execution_id");
    const worktreeId = encodeWorktreeId(roleId, executionId);
    const expectedRoleBranch = branchName("role", worktreeId);
    const mergePrefix = `ogs/${runId}/merge/`;
    const isMergeBranch = args.branch.startsWith(mergePrefix);
    const expectedBranch = isMergeBranch ? args.branch : expectedRoleBranch;
    if (!isMergeBranch && args.branch !== expectedRoleBranch) {
      throw new Error("GIT_COLLABORATION_PREPARED_IDENTITY_MISMATCH");
    }
    if (isMergeBranch && !/^ogs\/[A-Za-z0-9._-]+\/merge\/[A-Za-z0-9._-]+$/.test(args.branch)) {
      throw new Error("GIT_COLLABORATION_PREPARED_IDENTITY_MISMATCH");
    }
    const baseCommit = await fixedBase(args.baseCommit);
    const branchHead = await runGitAllowFailure(repositoryRoot, ["rev-parse", "--verify", expectedBranch], timeoutMs);
    if (branchHead.code !== 0) return undefined;
    const resultCommit = branchHead.stdout.trim();
    if (resultCommit === baseCommit) return undefined;
    const parents = (await runGit(repositoryRoot, ["rev-list", "--parents", "-n", "1", resultCommit], timeoutMs)).trim().split(" ").slice(1);
    if (parents.length !== 1) throw new Error("GIT_COLLABORATION_PREPARED_COMMIT_MISMATCH");
    if (!isMergeBranch && parents[0] !== baseCommit) throw new Error("GIT_COLLABORATION_PREPARED_COMMIT_MISMATCH");
    if (isMergeBranch) {
      const basedOnBase = await runGitAllowFailure(repositoryRoot, ["merge-base", "--is-ancestor", baseCommit, resultCommit], timeoutMs);
      if (basedOnBase.code !== 0) throw new Error("GIT_COLLABORATION_PREPARED_COMMIT_MISMATCH");
    }
    const message = await runGit(repositoryRoot, ["show", "-s", "--format=%B", resultCommit], timeoutMs);
    const trailers = new Map<string, string>();
    for (const line of message.split(/\r?\n/)) {
      const match = /^([A-Za-z][A-Za-z0-9-]*):\s*(.*)$/.exec(line);
      if (match) trailers.set(match[1], match[2]);
    }
    if (trailers.get("Run-Id") !== runId
      || trailers.get("Node-Id") !== roleId
      || trailers.get("Checkpoint-Id") !== `${runId}:${roleId}:${executionId}`
      || trailers.get("Base-Commit") !== baseCommit) {
      throw new Error("GIT_COLLABORATION_PREPARED_COMMIT_PROVENANCE_INVALID");
    }
    const changedPaths = parseNameOnlyPaths(await runGit(repositoryRoot, ["diff-tree", "--no-commit-id", "--name-only", "-z", "-r", resultCommit], timeoutMs));
    const { workspaceRefs, lfsObjectIds } = await workspaceRefsForCommit({ repositoryRoot, workspaceId, commit: resultCommit, changedPaths, timeoutMs });
    const commit: GitRoleCommit = {
      roleId,
      executionId,
      branch: expectedBranch,
      path: isMergeBranch
        ? resolve(worktreeRoot, runId, `merge-${args.branch.slice(mergePrefix.length)}`)
        : resolve(worktreeRoot, runId, worktreeId),
      baseCommit,
      resultCommit,
      changedPaths,
      workspaceRefs,
      lfsObjectIds,
      provenance: { ogsContractVersion: 2, schemaVersion: 1, version: 1, kind: "role-commit", runId, roleId, executionId, baseCommit, resultCommit, changedPaths }
    };
    await registerRoleCommit(commit);
    return commit;
  }

  async function restoreWorktree(args: { restoreId: string; targetCommit: string; expectedCanonicalHead: string; message: string }): Promise<GitRestoreResult> {
    const expectedCanonicalHead = await fixedBase(args.expectedCanonicalHead);
    const targetCommit = await fixedBase(args.targetCommit);
    const worktree = await addWorktree({ roleId: "restore", executionId: assertId(args.restoreId, "restore_id"), baseCommit: expectedCanonicalHead });
    try {
      await runGit(worktree.path, ["read-tree", "--reset", "-u", targetCommit], timeoutMs);
      const commit = await commitWorktree(worktree, args.message);
      return { ...commit, targetCommit, expectedCanonicalHead };
    } finally {
      await removeWorktree(worktree.path, true).catch(() => undefined);
    }
  }

  async function updateCanonicalRef(args: { newCommit: string; expectedCanonicalHead: string }): Promise<void> {
    const expectedCanonicalHead = await fixedBase(args.expectedCanonicalHead);
    const newCommit = await fixedBase(args.newCommit);
    const branch = (await runGit(repositoryRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], timeoutMs)).trim();
    if (!branch) throw new Error("GIT_COLLABORATION_CANONICAL_REF_DETACHED");
    const result = await runGitAllowFailure(repositoryRoot, ["update-ref", `refs/heads/${branch}`, newCommit, expectedCanonicalHead], timeoutMs);
    if (result.code !== 0) throw new Error("GIT_COLLABORATION_STALE_CANONICAL_HEAD");
  }

  async function mergeCommits(args: { mergeId: string; baseCommit: string; candidateCommits: string[]; order?: string[] }): Promise<GitMergeResult> {
    const mergeId = assertId(args.mergeId, "merge_id");
    const baseCommit = await fixedBase(args.baseCommit);
    const candidateCommits = [...args.candidateCommits];
    if (!candidateCommits.length || candidateCommits.some((value) => !SHA.test(value)) || new Set(candidateCommits).size !== candidateCommits.length) throw new Error("GIT_COLLABORATION_CANDIDATES_INVALID");
    for (const commit of candidateCommits) {
      await runGit(repositoryRoot, ["rev-parse", `${commit}^{commit}`], timeoutMs);
      const basedOnBase = await runGitAllowFailure(repositoryRoot, ["merge-base", "--is-ancestor", baseCommit, commit], timeoutMs);
      if (basedOnBase.code !== 0) throw new Error("GIT_COLLABORATION_CANDIDATE_BASE_MISMATCH");
    }
    await validateMergeCandidateProvenance(baseCommit, candidateCommits);
    const ordered = args.order?.length ? args.order : candidateCommits;
    if (ordered.length !== candidateCommits.length || new Set(ordered).size !== candidateCommits.length || ordered.some((commit) => !candidateCommits.includes(commit))) {
      throw new Error("GIT_COLLABORATION_MERGE_ORDER_INVALID");
    }
    const path = await assertSafeWorktreePath(resolve(worktreeRoot, runId, `merge-${mergeId}`));
    const branch = branchName("merge", mergeId);
    await assertSafeWorktreePath(path);
    await mkdir(dirname(path), { recursive: true });
    const entries = await worktreeEntries();
    const existing = entries.find((entry) => resolve(entry.path) === path);
    const branchRef = `refs/heads/${branch}`;
    const branchExists = (await runGitAllowFailure(repositoryRoot, ["show-ref", "--verify", "--quiet", branchRef], timeoutMs)).code === 0;
    if (existing && existing.branch !== branchRef) throw new Error("GIT_COLLABORATION_MERGE_WORKTREE_MISMATCH");
    if (!existing) {
      if (branchExists) {
        await runGit(repositoryRoot, ["worktree", "add", "--no-checkout", path, branch], timeoutMs);
      } else {
        await runGit(repositoryRoot, ["worktree", "add", "--no-checkout", "-b", branch, path, baseCommit], timeoutMs);
        await runGit(path, ["reset", "--hard", baseCommit], timeoutMs);
      }
    }
    let headBeforeMerge = (await runGit(path, ["rev-parse", "HEAD"], timeoutMs)).trim();
    const baseIsAncestor = await runGitAllowFailure(path, ["merge-base", "--is-ancestor", baseCommit, headBeforeMerge], timeoutMs);
    if (baseIsAncestor.code !== 0) throw new Error("GIT_COLLABORATION_MERGE_BASE_MISMATCH");
    const existingStatus = await runGit(path, ["status", "--porcelain=v1"], timeoutMs);
    if (existingStatus.split(/\r?\n/).some((line) => line.startsWith("UU ") || line.startsWith("AA ") || line.startsWith("DD ") || line.startsWith("AU ") || line.startsWith("UA "))) {
      await runGitAllowFailure(path, ["merge", "--abort"], timeoutMs);
      await runGit(path, ["reset", "--hard", baseCommit], timeoutMs);
      headBeforeMerge = baseCommit;
    }
    else if (existingStatus.trim()) throw new Error("GIT_COLLABORATION_MERGE_WORKTREE_NOT_CLEAN");
    try {
      await validateMergeCandidateSet(path, baseCommit, headBeforeMerge, candidateCommits);
    } catch (error) {
      // A retry or resumed Run may replace a leaf commit under the same merge id.
      // Candidate provenance was checked above, so rebuild from the fixed base
      // instead of carrying an obsolete candidate into the new merge.
      if (!(error instanceof Error) || error.message !== "GIT_COLLABORATION_MERGE_CANDIDATE_SET_MISMATCH") {
        throw error;
      }
      await runGit(path, ["reset", "--hard", baseCommit], timeoutMs);
      await runGit(path, ["clean", "-fdx", "--exclude=.ogs", "--exclude=.ogs/**"], timeoutMs);
      headBeforeMerge = baseCommit;
    }
    if (headBeforeMerge !== baseCommit) {
      const appliedOrder = await readAppliedMergeOrder(path, baseCommit, headBeforeMerge, candidateCommits);
      if (!sameStringArray(appliedOrder, ordered)) {
        await runGit(path, ["reset", "--hard", baseCommit], timeoutMs);
        headBeforeMerge = baseCommit;
      }
    }
    for (const candidate of ordered) {
      const alreadyMerged = await runGitAllowFailure(path, ["merge-base", "--is-ancestor", candidate, "HEAD"], timeoutMs);
      if (alreadyMerged.code === 0) continue;
      const result = await runGitAllowFailure(
        path,
        ["-c", "user.name=OGS Runtime", "-c", "user.email=ogs-runtime@localhost", "merge", "--no-edit", "--no-ff", candidate],
        timeoutMs
      );
      if (result.code !== 0) {
        const conflicts = parseNameOnlyPaths(await runGitAllowFailure(path, ["diff", "--name-only", "--diff-filter=U", "-z"], timeoutMs).then((item) => item.stdout));
        if (conflicts.length === 0) {
          const detail = (result.stderr || result.stdout || "unknown git merge error").trim().slice(0, 2000);
          throw new Error(`GIT_COLLABORATION_MERGE_FAILED: ${detail}`);
        }
        return {
          mergeId, path, branch, baseCommit, candidateCommits, status: "conflict", conflictPaths: conflicts,
          provenance: { ogsContractVersion: 2, schemaVersion: 1, version: 1, kind: "merge", runId, mergeId, baseCommit, candidateCommits, status: "conflict", conflictPaths: conflicts }
        };
      }
    }
    const mergeCommit = (await runGit(path, ["rev-parse", "HEAD"], timeoutMs)).trim();
    return {
      mergeId, path, branch, baseCommit, candidateCommits, status: "merged", mergeCommit, conflictPaths: [],
      provenance: { ogsContractVersion: 2, schemaVersion: 1, version: 1, kind: "merge", runId, mergeId, baseCommit, candidateCommits, status: "merged", mergeCommit, conflictPaths: [] }
    };
  }

  async function verifyMergeWorktree(path: string, baseCommit: string, options: GitMergeVerificationOptions = {}): Promise<GitMergeVerification> {
    const target = resolve(path);
    const actualTarget = await assertSafeWorktreePath(target);
    if (actualTarget === await resolveActualPath(worktreeRoot, "WORKTREE_ROOT")) throw new Error("GIT_COLLABORATION_WORKTREE_PATH_INVALID");
    const base = await fixedBase(baseCommit);
    if (options.mergeId) {
      const expectedPath = await assertSafeWorktreePath(resolve(worktreeRoot, runId, `merge-${assertId(options.mergeId, "merge_id")}`));
      if (actualTarget !== expectedPath) throw new Error("GIT_COLLABORATION_MERGE_WORKTREE_MISMATCH");
      const entries = await worktreeEntries();
      const entry = entries.find((item) => resolve(item.path) === actualTarget);
      const expectedBranch = branchName("merge", options.mergeId);
      if (!entry || entry.branch !== `refs/heads/${expectedBranch}` || (options.branch && options.branch !== expectedBranch)) {
        throw new Error("GIT_COLLABORATION_MERGE_WORKTREE_MISMATCH");
      }
    }
    const head = (await runGit(actualTarget, ["rev-parse", "HEAD"], timeoutMs)).trim();
    const baseIsAncestor = await runGitAllowFailure(actualTarget, ["merge-base", "--is-ancestor", base, head], timeoutMs);
    if (baseIsAncestor.code !== 0) throw new Error("GIT_COLLABORATION_MERGE_BASE_MISMATCH");
    const status = await runGit(actualTarget, ["status", "--porcelain=v1"], timeoutMs);
    const changedPaths = parseNameOnlyPaths(await runGit(actualTarget, ["diff", "--name-only", "-z", base, head], timeoutMs));
    if (status.trim()) return { passed: false, head, clean: false, changedPaths, reason: "WORKTREE_NOT_CLEAN" };
    if (options.mergeCommit && options.mergeCommit !== head) return { passed: false, head, clean: true, changedPaths, reason: "MERGE_HEAD_MISMATCH" };
    if (options.candidateCommits) {
      try {
        await validateMergeCandidateProvenance(base, options.candidateCommits);
      } catch {
        return { passed: false, head, clean: status.trim() === "", changedPaths, reason: "MERGE_CANDIDATE_PROVENANCE_MISMATCH" };
      }
      for (const candidate of options.candidateCommits) {
        const included = await runGitAllowFailure(actualTarget, ["merge-base", "--is-ancestor", candidate, head], timeoutMs);
        if (included.code !== 0) return { passed: false, head, clean: true, changedPaths, reason: "MERGE_CANDIDATE_MISMATCH" };
      }
      try {
        await validateMergeCandidateSet(actualTarget, base, head, options.candidateCommits);
      } catch {
        return { passed: false, head, clean: true, changedPaths, reason: "MERGE_CANDIDATE_MISMATCH" };
      }
    }
    const diffCheck = await runGitAllowFailure(actualTarget, ["diff", "--check", base, head], timeoutMs);
    if (diffCheck.code !== 0) return { passed: false, head, clean: true, changedPaths, reason: "DIFF_CHECK_FAILED" };
    return { passed: true, head, clean: true, changedPaths };
  }

  async function isCommitAncestor(ancestor: string, descendant: string): Promise<boolean> {
    if (!SHA.test(ancestor) || !SHA.test(descendant)) throw new Error("GIT_COLLABORATION_COMMIT_INVALID");
    const result = await runGitAllowFailure(repositoryRoot, ["merge-base", "--is-ancestor", ancestor, descendant], timeoutMs);
    return result.code === 0;
  }

  async function resetWorktree(path: string, commit: string): Promise<void> {
    const target = resolve(path);
    const actualTarget = await assertSafeWorktreePath(target);
    if (actualTarget === await resolveActualPath(worktreeRoot, "WORKTREE_ROOT")) throw new Error("GIT_COLLABORATION_WORKTREE_PATH_INVALID");
    const resetCommit = (await runGit(repositoryRoot, ["rev-parse", `${commit}^{commit}`], timeoutMs)).trim();
    if (resetCommit !== commit) throw new Error("GIT_COLLABORATION_COMMIT_INVALID");
    await runGitAllowFailure(actualTarget, ["merge", "--abort"], timeoutMs);
    await runGit(actualTarget, ["reset", "--hard", resetCommit], timeoutMs);
    // Reset must also remove ignored files that a previous role/tool left in
    // the worktree. The operation is intentionally broad; assertSafeWorktreePath
    // above is the boundary that prevents it from touching the repository root.
    await runGit(actualTarget, ["clean", "-fdx", "--exclude=.ogs", "--exclude=.ogs/**"], timeoutMs);
  }

  async function removeWorktree(path: string, force = false): Promise<void> {
    const target = resolve(path);
    const actualTarget = await assertSafeWorktreePath(target);
    if (actualTarget === await resolveActualPath(worktreeRoot, "WORKTREE_ROOT")) throw new Error("GIT_COLLABORATION_WORKTREE_PATH_INVALID");
    await runGit(repositoryRoot, ["worktree", "remove", ...(force ? ["--force"] : []), actualTarget], timeoutMs);
    await rm(actualTarget, { recursive: true, force: true });
  }

  async function discardPreparedWorktree(args: {
    roleId: string;
    executionId: string;
    branch: string;
    baseCommit: string;
    workspaceDir: string;
    expectedCanonicalHead: string;
    lock: CanonicalWorkspaceLock;
  }): Promise<boolean> {
    const roleId = assertId(args.roleId, "role_id");
    const executionId = assertId(args.executionId, "execution_id");
    const worktreeId = encodeWorktreeId(roleId, executionId);
    const expectedBranch = branchName("role", worktreeId);
    const expectedPath = await assertSafeWorktreePath(resolve(worktreeRoot, runId, worktreeId));
    if (args.branch !== expectedBranch) throw new Error("GIT_COLLABORATION_PREPARED_IDENTITY_MISMATCH");
    const baseCommit = await fixedBase(args.baseCommit);
    const branchRef = `refs/heads/${expectedBranch}`;
    const branchCommit = await runGitAllowFailure(repositoryRoot, ["rev-parse", "--verify", branchRef], timeoutMs);
    if (branchCommit.code !== 0) return false;
    if (branchCommit.stdout.trim() !== baseCommit) return false;

    const entries = await worktreeEntries();
    const entry = entries.find((candidate) => resolve(candidate.path) === expectedPath);
    if (entry && entry.branch !== branchRef) throw new Error("GIT_COLLABORATION_PREPARED_IDENTITY_MISMATCH");
    if (entry) await removeWorktree(expectedPath, true);
    await deleteRunBranch({
      ref: branchRef,
      expectedCommit: baseCommit,
      workspaceDir: args.workspaceDir,
      expectedCanonicalHead: args.expectedCanonicalHead,
      lock: args.lock
    });
    return true;
  }

  return Object.freeze({ repositoryRoot, worktreeRoot, runId, workspaceId, probe: (workspaceDir?: string) => probeGitCollaboration({ repositoryRoot, workspaceDir, timeoutMs }), addWorktree, commitWorktree, registerRoleCommit, recoverPreparedRoleCommit, mergeCommits, verifyMergeWorktree, isCommitAncestor, resetWorktree, removeWorktree, discardPreparedWorktree, removeRunWorktrees, runBranchEntries, deleteRunBranch, restoreWorktree, updateCanonicalRef });
}
