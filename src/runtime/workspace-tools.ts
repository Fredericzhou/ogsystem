import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

export type WorkspaceQuota = {
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxFiles?: number;
};

export type WorkspaceFileEntry = {
  path: string;
  sizeBytes: number;
  modifiedAt: string;
  sha256?: string;
};

export type WorkspacePatchEdit = {
  start: number;
  end: number;
  replacement: string;
};

export type WorkspaceTools = {
  root: string;
  listFiles(glob?: string): Promise<WorkspaceFileEntry[]>;
  readText(path: string, offset?: number, limit?: number): Promise<string>;
  writeText(path: string, content: string): Promise<WorkspaceFileEntry>;
  patchText(path: string, edits: WorkspacePatchEdit[]): Promise<WorkspaceFileEntry>;
};

function fail(code: string, message: string): never {
  throw new Error(`[${code}] ${message}`);
}

function safeRelativePath(value: string): string {
  if (!value || isAbsolute(value) || value.includes("\0")) {
    fail("WORKSPACE_PATH_INVALID", "path must be a non-empty relative path");
  }
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    fail("WORKSPACE_PATH_INVALID", "path contains an unsafe segment");
  }
  return segments.join(sep);
}

function isWithin(parent: string, candidate: string): boolean {
  const relation = relative(parent, candidate);
  return relation === "" || (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

async function assertNoSymlinkPath(root: string, path: string, allowMissing = false): Promise<void> {
  let current = root;
  for (const segment of path.split(sep)) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) fail("WORKSPACE_SYMLINK_NOT_ALLOWED", `symbolic link: ${path}`);
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function resolvePath(root: string, value: string, allowMissing = false): Promise<{ path: string; relativePath: string }> {
  const relativePath = safeRelativePath(value);
  await assertNoSymlinkPath(root, relativePath, allowMissing);
  const rootReal = await realpath(root);
  const path = resolve(rootReal, relativePath);
  const targetReal = await realpath(path).catch((error) => {
    if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") return path;
    throw error;
  });
  if (!isWithin(rootReal, targetReal)) fail("WORKSPACE_PATH_ESCAPE", `path escapes workspace: ${value}`);
  return { path, relativePath };
}

async function collectFiles(root: string, current = ""): Promise<WorkspaceFileEntry[]> {
  const absolute = current ? resolve(root, current) : root;
  const entries: WorkspaceFileEntry[] = [];
  for (const entry of await readdir(absolute, { withFileTypes: true })) {
    const relativePath = current ? `${current}/${entry.name}` : entry.name;
    const candidate = resolve(root, relativePath);
    if (entry.isSymbolicLink()) fail("WORKSPACE_SYMLINK_NOT_ALLOWED", `symbolic link: ${relativePath}`);
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) {
      entries.push(...await collectFiles(root, relativePath));
      continue;
    }
    if (!entry.isFile()) fail("WORKSPACE_ENTRY_INVALID", `unsupported filesystem entry: ${relativePath}`);
    const metadata = await stat(candidate);
    entries.push({
      path: relativePath.replaceAll(sep, "/"),
      sizeBytes: metadata.size,
      modifiedAt: new Date(metadata.mtimeMs).toISOString()
    });
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function assertQuota(entries: WorkspaceFileEntry[], quota: WorkspaceQuota): void {
  if (quota.maxFiles !== undefined && entries.length > quota.maxFiles) {
    fail("WORKSPACE_FILE_QUOTA_EXCEEDED", `workspace contains ${entries.length} files; limit is ${quota.maxFiles}`);
  }
  if (quota.maxFileBytes !== undefined && entries.some((entry) => entry.sizeBytes > quota.maxFileBytes!)) {
    fail("WORKSPACE_FILE_QUOTA_EXCEEDED", `a workspace file exceeds ${quota.maxFileBytes} bytes`);
  }
  const total = entries.reduce((sum, entry) => sum + entry.sizeBytes, 0);
  if (quota.maxTotalBytes !== undefined && total > quota.maxTotalBytes) {
    fail("WORKSPACE_BYTES_QUOTA_EXCEEDED", `workspace contains ${total} bytes; limit is ${quota.maxTotalBytes}`);
  }
}

export function createWorkspaceTools(args: {
  root: string;
  quota?: WorkspaceQuota;
}): WorkspaceTools {
  const root = resolve(args.root);
  const quota = args.quota ?? {};

  async function listFiles(glob?: string): Promise<WorkspaceFileEntry[]> {
    const entries = await collectFiles(root);
    assertQuota(entries, quota);
    if (!glob) return entries;
    const pattern = String(glob).replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
    const expression = new RegExp(`^${pattern}$`);
    return entries.filter((entry) => expression.test(entry.path));
  }

  async function readText(pathValue: string, offset = 0, limit = 200_000): Promise<string> {
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 0) {
      fail("WORKSPACE_READ_RANGE_INVALID", "offset and limit must be non-negative integers");
    }
    const target = await resolvePath(root, pathValue);
    const content = await readFile(target.path, "utf8");
    return content.slice(offset, offset + limit);
  }

  async function writeText(pathValue: string, content: string): Promise<WorkspaceFileEntry> {
    if (typeof content !== "string") fail("WORKSPACE_CONTENT_INVALID", "content must be text");
    const target = await resolvePath(root, pathValue, true);
    const bytes = Buffer.byteLength(content, "utf8");
    if (quota.maxFileBytes !== undefined && bytes > quota.maxFileBytes) {
      fail("WORKSPACE_FILE_QUOTA_EXCEEDED", `file contains ${bytes} bytes; limit is ${quota.maxFileBytes}`);
    }
    await mkdir(dirname(target.path), { recursive: true });
    await assertNoSymlinkPath(root, target.relativePath, true);
    const temporary = `${target.path}.${process.pid}.${Date.now()}.tmp`;
    const backup = resolve(dirname(target.path), `.${Date.now()}-${process.pid}.workspace-backup`);
    let hadExisting = false;
    try {
      try {
        const existing = await lstat(target.path);
        if (!existing.isFile()) fail("WORKSPACE_ENTRY_INVALID", `target is not a regular file: ${pathValue}`);
        await rename(target.path, backup);
        hadExisting = true;
      } catch (error) {
        if (error instanceof Error && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
      await rename(temporary, target.path);
      try {
        const metadata = await stat(target.path);
        const entries = await collectFiles(root);
        assertQuota(entries, quota);
        return {
          path: target.relativePath.replaceAll(sep, "/"),
          sizeBytes: metadata.size,
          modifiedAt: new Date(metadata.mtimeMs).toISOString(),
          sha256: createHash("sha256").update(content, "utf8").digest("hex")
        };
      } catch (error) {
        await rm(target.path, { force: true }).catch(() => undefined);
        if (hadExisting) await rename(backup, target.path);
        throw error;
      }
    } catch (error) {
      // Restore the original if staging or the final rename failed before the
      // quota check's rollback handler ran.
      if (hadExisting) {
        const restored = await lstat(target.path).then(() => true, () => false);
        if (!restored) await rename(backup, target.path).catch(() => undefined);
      }
      throw error;
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
      await rm(backup, { force: true }).catch(() => undefined);
    }
  }

  async function patchText(pathValue: string, edits: WorkspacePatchEdit[]): Promise<WorkspaceFileEntry> {
    if (!Array.isArray(edits) || edits.length === 0) fail("WORKSPACE_PATCH_INVALID", "at least one edit is required");
    const original = await readText(pathValue, 0, Number.MAX_SAFE_INTEGER);
    const ordered = [...edits].sort((left, right) => right.start - left.start);
    let previousStart = original.length + 1;
    for (const edit of ordered) {
      if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) || edit.start < 0 || edit.end < edit.start || edit.end > original.length) {
        fail("WORKSPACE_PATCH_INVALID", "edit range is outside the file");
      }
      if (edit.end > previousStart) fail("WORKSPACE_PATCH_INVALID", "edits overlap");
      if (typeof edit.replacement !== "string") fail("WORKSPACE_PATCH_INVALID", "replacement must be text");
      previousStart = edit.start;
    }
    let patched = original;
    for (const edit of ordered) patched = `${patched.slice(0, edit.start)}${edit.replacement}${patched.slice(edit.end)}`;
    return writeText(pathValue, patched);
  }

  return Object.freeze({ root, listFiles, readText, writeText, patchText });
}

