/** Immutable executable project assets captured for a project Run. */
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readdir, readFile, realpath } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { writeJsonFileAtomic } from "./json-file.js";
import { resolveProjectRoleRootDir } from "./bundled-repos.js";
import type { RuntimeConfig } from "./types.js";

export const PROJECT_RUN_SNAPSHOT_DIR = "project-assets";
const MANIFEST_FILE = "manifest.json";

type SnapshotFile = {
  path: string;
  sha256: string;
  size: number;
};

type SnapshotManifest = {
  version: 1;
  algorithm: "sha256";
  files: SnapshotFile[];
};

async function listSnapshotFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = resolve(current, entry.name);
    const relativePath = relative(root, absolute).split(sep).join("/");
    if (entry.name === MANIFEST_FILE && current === root) continue;
    if (entry.isSymbolicLink()) {
      throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: symbolic links are not allowed in ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listSnapshotFiles(root, absolute));
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: unsupported snapshot entry ${relativePath}`);
    }
    files.push(relativePath);
  }
  return files;
}

function normalizeManifestValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => normalizeManifestValue(entry));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, normalizeManifestValue((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

function safeRelativePath(value: string): string {
  const normalized = value.replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (!normalized || normalized.startsWith("/") || parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: unsafe asset path ${value}`);
  }
  return normalized;
}

function hash(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function manifestDigest(manifest: SnapshotManifest): string {
  return hash(Buffer.from(JSON.stringify(normalizeManifestValue(manifest)), "utf8"));
}

function assertRealPathInside(root: string, target: string, label: string): void {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) {
    throw new Error(`PROJECT_RUN_SNAPSHOT_EXTERNAL_DEPENDENCY: ${label} must be inside the project.`);
  }
}

async function assertNoSymlinkComponents(root: string, target: string, allowMissing = false): Promise<void> {
  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(target);
  assertRealPathInside(resolvedRoot, resolvedTarget, target);
  const relativePath = relative(resolvedRoot, resolvedTarget);
  let current = resolvedRoot;
  for (const part of relativePath.split(sep).filter(Boolean)) {
    current = resolve(current, part);
    const entry = await lstat(current).catch(() => undefined);
    if (!entry) {
      if (allowMissing) return;
      throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: missing path component: ${current}`);
    }
    if (entry.isSymbolicLink()) {
      throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: symbolic link is not portable: ${current}`);
    }
  }
}

async function ensureRegularFile(path: string, sourceRoot?: string): Promise<void> {
  if (sourceRoot) await assertNoSymlinkComponents(sourceRoot, path);
  const fileStat = await lstat(path);
  if (fileStat.isSymbolicLink()) {
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: symbolic link is not portable: ${path}`);
  }
  if (!fileStat.isFile()) {
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: asset is not a regular file: ${path}`);
  }
  if (sourceRoot) {
    const [realRoot, realTarget] = await Promise.all([realpath(sourceRoot), realpath(path)]);
    assertRealPathInside(realRoot, realTarget, path);
  }
}

async function copyAsset(args: {
  source: string;
  sourceRoot?: string;
  snapshotDir: string;
  relativePath: string;
  files: SnapshotFile[];
}): Promise<void> {
  await ensureRegularFile(args.source, args.sourceRoot);
  const relativePath = safeRelativePath(args.relativePath);
  const target = resolve(args.snapshotDir, relativePath);
  await assertNoSymlinkComponents(args.snapshotDir, target, true);
  const existingTarget = await lstat(target).catch(() => undefined);
  if (existingTarget?.isSymbolicLink()) {
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: symbolic link is not portable: ${target}`);
  }
  await mkdir(resolve(target, ".."), { recursive: true });
  await copyFile(args.source, target);
  const content = await readFile(target);
  args.files.push({ path: relativePath, sha256: hash(content), size: content.byteLength });
}

async function copyTree(args: {
  sourceDir: string;
  sourceRoot: string;
  snapshotDir: string;
  targetPrefix: string;
  files: SnapshotFile[];
}): Promise<void> {
  const directoryStat = await lstat(args.sourceDir).catch(() => undefined);
  if (!directoryStat) return;
  if (directoryStat.isSymbolicLink()) {
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: symbolic link is not portable: ${args.sourceDir}`);
  }
  if (!directoryStat.isDirectory()) return;
  await assertNoSymlinkComponents(args.sourceRoot, args.sourceDir);
  const [realRoot, realDirectory] = await Promise.all([realpath(args.sourceRoot), realpath(args.sourceDir)]);
  assertRealPathInside(realRoot, realDirectory, args.sourceDir);
  const entries = await readdir(args.sourceDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const source = resolve(args.sourceDir, entry.name);
    const targetPath = `${args.targetPrefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: symbolic link is not portable: ${targetPath}`);
    }
    if (entry.isDirectory()) {
      await copyTree({ sourceDir: source, sourceRoot: args.sourceRoot, snapshotDir: args.snapshotDir, targetPrefix: targetPath, files: args.files });
    } else if (entry.isFile()) {
      await copyAsset({ source, sourceRoot: args.sourceRoot, snapshotDir: args.snapshotDir, relativePath: targetPath, files: args.files });
    }
  }
}

export async function snapshotProjectAssets(args: {
  sourceWorkdir: string;
  runDir: string;
  runtimeConfig: RuntimeConfig;
  additionalFiles?: string[];
}): Promise<string> {
  const snapshotDir = resolve(args.runDir, PROJECT_RUN_SNAPSHOT_DIR);
  const existingSnapshot = await lstat(snapshotDir).catch(() => undefined);
  if (existingSnapshot?.isSymbolicLink()) {
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: symbolic link is not portable: ${snapshotDir}`);
  }
  const files: SnapshotFile[] = [];
  const sourceRoot = await realpath(args.sourceWorkdir);
  await mkdir(snapshotDir, { recursive: true });

  await copyAsset({
    source: resolve(args.sourceWorkdir, "system.mmd"),
    sourceRoot,
    snapshotDir,
    relativePath: "system.mmd",
    files
  });

  const fixedFiles = [
    "system.design.json",
    ".ogs/semantics.yaml",
    ".ogs/semantics.yml",
    ".ogs/semantics.json",
    ".ogs/models.yaml",
    ".ogs/models.yml",
    ".ogs/models.json",
    ".ogs/model-selection.json",
    ".ogs/model-catalog.json",
    ".ogs/laws.json",
    ".ogs/user-profile.json",
    "profiles.json",
    "tools.json"
  ];
  for (const relativePath of fixedFiles) {
    const source = resolve(args.sourceWorkdir, relativePath);
    if (await lstat(source).then((value) => !value.isSymbolicLink() && value.isFile()).catch(() => false)) {
      await copyAsset({ source, sourceRoot, snapshotDir, relativePath, files });
    } else if (await lstat(source).then((value) => value.isSymbolicLink()).catch(() => false)) {
      throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: symbolic link is not portable: ${relativePath}`);
    }
  }

  const runtimePath = resolve(args.sourceWorkdir, ".ogs/runtime.json");
  await ensureRegularFile(runtimePath, sourceRoot);
  const snapshotRuntime = { ...args.runtimeConfig, roleRepo: "./og-roles" };
  const runtimeTarget = resolve(snapshotDir, ".ogs/runtime.json");
  await mkdir(resolve(runtimeTarget, ".."), { recursive: true });
  await writeJsonFileAtomic(runtimeTarget, snapshotRuntime);
  const runtimeContent = await readFile(runtimeTarget);
  files.push({ path: ".ogs/runtime.json", sha256: hash(runtimeContent), size: runtimeContent.byteLength });

  for (const directory of ["contracts", "systems", "subsystems"]) {
    await copyTree({
      sourceDir: resolve(args.sourceWorkdir, ".ogs", directory),
      sourceRoot,
      snapshotDir,
      targetPrefix: `.ogs/${directory}`,
      files
    });
  }

  const roleRootDir = resolveProjectRoleRootDir(args.sourceWorkdir, args.runtimeConfig.roleRepo);
  await copyTree({
    sourceDir: roleRootDir,
    sourceRoot,
    snapshotDir,
    targetPrefix: "og-roles/roles",
    files
  });

  for (const file of args.additionalFiles ?? []) {
    const source = resolve(args.sourceWorkdir, file);
    const realSource = await realpath(source);
    assertRealPathInside(sourceRoot, realSource, file);
    const relativePath = relative(args.sourceWorkdir, source).split(sep).join("/");
    if (!files.some((item) => item.path === relativePath)) {
      await copyAsset({ source, sourceRoot, snapshotDir, relativePath, files });
    }
  }

  files.sort((left, right) => left.path.localeCompare(right.path));
  const manifest: SnapshotManifest = { version: 1, algorithm: "sha256", files };
  await writeJsonFileAtomic(resolve(snapshotDir, MANIFEST_FILE), manifest);
  return snapshotDir;
}

export async function assertProjectAssetSnapshot(runDir: string, expectedManifestDigest?: string): Promise<string> {
  const snapshotDir = resolve(runDir, PROJECT_RUN_SNAPSHOT_DIR);
  const snapshotStat = await lstat(snapshotDir).catch(() => undefined);
  if (!snapshotStat || snapshotStat.isSymbolicLink() || !snapshotStat.isDirectory()) {
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: missing or unsafe snapshot directory ${snapshotDir}`);
  }
  const manifestStat = await lstat(resolve(snapshotDir, MANIFEST_FILE)).catch(() => undefined);
  if (!manifestStat || manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: missing or unsafe manifest in ${snapshotDir}`);
  }
  let manifest: SnapshotManifest;
  try {
    const parsed = JSON.parse(await readFile(resolve(snapshotDir, MANIFEST_FILE), "utf8")) as Partial<SnapshotManifest>;
    if (parsed.version !== 1 || parsed.algorithm !== "sha256" || !Array.isArray(parsed.files)) throw new Error("invalid manifest");
    manifest = parsed as SnapshotManifest;
  } catch {
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: missing or invalid manifest in ${snapshotDir}`);
  }
  if (expectedManifestDigest && manifestDigest(manifest) !== expectedManifestDigest) {
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: manifest digest mismatch in ${snapshotDir}`);
  }
  const seen = new Set<string>();
  for (const file of manifest.files) {
    if (!file || typeof file.path !== "string" || typeof file.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isInteger(file.size) || file.size < 0) {
      throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: invalid manifest entry in ${snapshotDir}`);
    }
    const relativePath = safeRelativePath(file.path);
    if (seen.has(relativePath)) {
      throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: invalid manifest entry in ${snapshotDir}`);
    }
    seen.add(relativePath);
    const path = resolve(snapshotDir, relativePath);
    await assertNoSymlinkComponents(snapshotDir, path).catch(() => {
      throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: missing or unsafe asset ${relativePath}`);
    });
    await ensureRegularFile(path).catch(() => {
      throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: missing or unsafe asset ${relativePath}`);
    });
    const content = await readFile(path);
    if (content.byteLength !== file.size || hash(content) !== file.sha256) {
      throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: asset hash mismatch ${relativePath}`);
    }
  }
  const actualFiles = await listSnapshotFiles(snapshotDir);
  const extraFiles = actualFiles.filter((file) => !seen.has(file));
  const missingFiles = [...seen].filter((file) => !actualFiles.includes(file));
  if (extraFiles.length > 0 || missingFiles.length > 0) {
    const detail = [
      extraFiles.length > 0 ? `unmanifested: ${extraFiles.join(", ")}` : "",
      missingFiles.length > 0 ? `missing: ${missingFiles.join(", ")}` : ""
    ].filter(Boolean).join("; ");
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: manifest does not match snapshot contents (${detail})`);
  }
  if (!seen.has("system.mmd") || !seen.has(".ogs/runtime.json")) {
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: required project assets are missing from ${snapshotDir}`);
  }
  return snapshotDir;
}

export async function readProjectAssetManifestDigest(runDir: string): Promise<string> {
  const snapshotDir = resolve(runDir, PROJECT_RUN_SNAPSHOT_DIR);
  const manifestStat = await lstat(resolve(snapshotDir, MANIFEST_FILE)).catch(() => undefined);
  if (!manifestStat || manifestStat.isSymbolicLink() || !manifestStat.isFile()) {
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: missing or unsafe manifest in ${snapshotDir}`);
  }
  const parsed = JSON.parse(await readFile(resolve(snapshotDir, MANIFEST_FILE), "utf8")) as Partial<SnapshotManifest>;
  if (parsed.version !== 1 || parsed.algorithm !== "sha256" || !Array.isArray(parsed.files)) {
    throw new Error(`PROJECT_RUN_SNAPSHOT_INVALID: missing or invalid manifest in ${snapshotDir}`);
  }
  return manifestDigest(parsed as SnapshotManifest);
}
