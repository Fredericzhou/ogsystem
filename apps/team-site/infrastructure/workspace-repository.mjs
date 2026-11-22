import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFile = promisify(execFileCallback);

function gitEnv() {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_") || ["SSH_ASKPASS", "GIT_ASKPASS"].includes(key)) delete env[key];
  }
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null" };
}

async function git(cwd, args) {
  try {
    return String((await execFile("git", ["-c", "core.autocrlf=false", ...args], {
      cwd,
      env: gitEnv(),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024
    })).stdout || "");
  } catch (error) {
    const detail = String(error?.stderr || error?.message || "git failed").trim().slice(0, 2000);
    throw new Error(`WORKSPACE_GIT_FAILED: ${args[0] || "git"}: ${detail}`);
  }
}

async function gitStatus(cwd) {
  return (await git(cwd, ["status", "--porcelain=v1"])).trim();
}

function workspaceIdFor(root) {
  return `workspace-${createHash("sha256").update(resolve(root), "utf8").digest("hex").slice(0, 24)}`;
}

async function ensureLfs(cwd) {
  try {
    await git(cwd, ["lfs", "version"]);
  } catch {
    throw new Error("WORKSPACE_LFS_UNAVAILABLE: Git LFS is required for every Project Workspace.");
  }
  await git(cwd, ["lfs", "install", "--local", "--skip-repo"]);
}

async function ensureAttributes(root) {
  const path = resolve(root, ".gitattributes");
  let current = "";
  try { current = await readFile(path, "utf8"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const required = [
    "*.png filter=lfs diff=lfs merge=lfs -text",
    "*.jpg filter=lfs diff=lfs merge=lfs -text",
    "*.jpeg filter=lfs diff=lfs merge=lfs -text",
    "*.gif filter=lfs diff=lfs merge=lfs -text",
    "*.webp filter=lfs diff=lfs merge=lfs -text",
    "*.mp3 filter=lfs diff=lfs merge=lfs -text",
    "*.mp4 filter=lfs diff=lfs merge=lfs -text",
    "*.wav filter=lfs diff=lfs merge=lfs -text",
    "*.mov filter=lfs diff=lfs merge=lfs -text",
    "*.zip filter=lfs diff=lfs merge=lfs -text",
    "*.pdf filter=lfs diff=lfs merge=lfs -text"
  ];
  const lines = new Set(current.split(/\r?\n/).filter(Boolean));
  const next = [...lines, ...required.filter((line) => !lines.has(line))];
  if (next.length !== lines.size) await writeFile(path, `${next.join("\n")}\n`, "utf8");
}

async function commitWorkspace(root, message) {
  const status = await gitStatus(root);
  if (!status) return (await git(root, ["rev-parse", "HEAD"])).trim();
  await git(root, ["add", "--all"]);
  await git(root, [
    "-c", "user.name=OGS Framework", "-c", "user.email=ogs-framework@localhost",
    "commit", "--no-verify", "-m", message
  ]);
  return (await git(root, ["rev-parse", "HEAD"])).trim();
}

export async function ensureGitLfsWorkspace({ workspaceDir }) {
  const root = resolve(workspaceDir);
  await mkdir(root, { recursive: true });
  let isRepository = true;
  try { await git(root, ["rev-parse", "--show-toplevel"]); } catch { isRepository = false; }
  if (!isRepository) {
    await git(root, ["init", "--initial-branch=main"]);
  }
  await ensureLfs(root);
  await ensureAttributes(root);
  const head = await commitWorkspace(root, "Initialize Git + LFS Workspace");
  return { workspaceId: workspaceIdFor(root), repositoryRoot: root, baseCommit: head };
}

export async function commitGitLfsWorkspace({ workspaceDir, message }) {
  const root = resolve(workspaceDir);
  try { await git(root, ["rev-parse", "--show-toplevel"]); } catch {
    throw new Error("WORKSPACE_REPOSITORY_REQUIRED: Project Workspace is not a Git repository.");
  }
  await ensureLfs(root);
  return commitWorkspace(root, String(message || "Update Workspace"));
}

export async function readWorkspaceHead(workspaceDir) {
  return (await git(resolve(workspaceDir), ["rev-parse", "HEAD"])).trim();
}
