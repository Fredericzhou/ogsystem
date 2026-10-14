import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { resolveRunDir } from "./project-lifecycle.js";

type SealManifest = {
  status?: unknown;
  artifact?: unknown;
  testReport?: unknown;
  files?: unknown;
};

type ManifestFile = {
  path: string;
  sha256: string;
};

export type PromoteSealedArtifactArgs = {
  workdir: string;
  runId: string;
  source: string;
  destination: string;
};

function fail(message: string): never {
  throw new Error(`ARTIFACT_PROMOTION_REJECTED: ${message}`);
}

function safeRelativePath(value: string, label: string): string {
  if (!value || isAbsolute(value) || value.includes("\0")) fail(`${label} must be a non-empty relative path.`);
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    fail(`${label} contains an unsafe path segment.`);
  }
  return segments.join(sep);
}

function isWithin(parent: string, candidate: string): boolean {
  const rel = relative(parent, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function listFiles(root: string, prefix = ""): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const path = resolve(root, entry.name);
    if (entry.isSymbolicLink()) fail(`sealed artifact contains a symbolic link: ${name}`);
    if (entry.isDirectory()) output.push(...await listFiles(path, name));
    else if (entry.isFile()) output.push(name);
    else fail(`sealed artifact contains an unsupported filesystem entry: ${name}`);
  }
  return output.sort();
}

async function assertContainedRealPath(parent: string, candidate: string, label: string): Promise<string> {
  const resolvedParent = await realpath(parent);
  const resolvedCandidate = await realpath(candidate);
  if (!isWithin(resolvedParent, resolvedCandidate)) fail(`${label} resolves outside its allowed directory.`);
  return resolvedCandidate;
}

async function assertNoSymlinkComponents(root: string, relativePath: string, label: string): Promise<void> {
  let current = root;
  for (const segment of relativePath.split(sep)) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) fail(`${label} contains a symbolic link: ${segment}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

export async function promoteSealedArtifact(args: PromoteSealedArtifactArgs): Promise<{
  runId: string;
  source: string;
  destination: string;
  fileCount: number;
  manifestSha256: string;
}> {
  const workdir = await realpath(resolve(args.workdir));
  const runDir = await realpath(resolveRunDir(workdir, args.runId));
  const summary = JSON.parse(await readFile(resolve(runDir, "summary.json"), "utf8")) as { status?: unknown };
  if (summary.status !== "done") fail(`run ${args.runId} is not done.`);

  const requestedSource = safeRelativePath(args.source, "--source").replaceAll(sep, "/");
  if (!requestedSource.startsWith("shared/")) fail("--source must be inside the run's shared/ directory.");
  const sharedDir = await realpath(resolve(runDir, "shared"));
  if (!isWithin(runDir, sharedDir)) fail("run shared directory resolves outside the run.");
  const sourceRelative = requestedSource.slice("shared/".length);
  const sealPath = resolve(sharedDir, "seal-manifest.json");
  const sealBytes = await readFile(sealPath);
  const manifest = JSON.parse(sealBytes.toString("utf8")) as SealManifest;
  if (manifest.status !== "sealed" || typeof manifest.artifact !== "string" || typeof manifest.testReport !== "string") {
    fail("seal manifest is incomplete or not sealed.");
  }
  const sealedArtifact = safeRelativePath(manifest.artifact.replace(/\/$/, ""), "seal manifest artifact").replaceAll(sep, "/");
  if (sourceRelative !== sealedArtifact) fail("--source does not match the artifact recorded in the seal manifest.");
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) fail("seal manifest has no source files.");

  const reportRelative = safeRelativePath(manifest.testReport, "seal manifest testReport");
  await assertNoSymlinkComponents(sharedDir, reportRelative, "test report path");
  const reportPath = resolve(sharedDir, reportRelative);
  await assertContainedRealPath(sharedDir, reportPath, "test report");
  const report = JSON.parse(await readFile(reportPath, "utf8")) as { passed?: unknown };
  if (report.passed !== true) fail("referenced test report is not passing.");

  const sourcePath = resolve(sharedDir, sourceRelative);
  await assertNoSymlinkComponents(sharedDir, sourceRelative, "artifact source path");
  const realSourcePath = await assertContainedRealPath(sharedDir, sourcePath, "artifact source");
  const expectedFiles = (manifest.files as ManifestFile[]).map((file) => {
    if (!file || typeof file.path !== "string" || !/^[a-f0-9]{64}$/.test(file.sha256)) {
      fail("seal manifest contains an invalid file entry.");
    }
    return { path: safeRelativePath(file.path, "seal manifest file"), sha256: file.sha256 };
  }).sort((left, right) => left.path.localeCompare(right.path));
  if (new Set(expectedFiles.map((file) => file.path)).size !== expectedFiles.length) fail("seal manifest contains duplicate file paths.");
  const actualFiles = await listFiles(realSourcePath);
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles.map((file) => file.path.replaceAll(sep, "/")))) {
    fail("artifact file set does not exactly match the seal manifest.");
  }
  for (const file of expectedFiles) {
    const sourceFile = resolve(realSourcePath, file.path);
    await assertContainedRealPath(realSourcePath, sourceFile, `artifact file ${file.path}`);
    const actualHash = createHash("sha256").update(await readFile(sourceFile)).digest("hex");
    if (actualHash !== file.sha256) fail(`artifact hash mismatch: ${file.path}`);
  }

  const destinationRelative = safeRelativePath(args.destination, "--destination");
  const destinationPath = resolve(workdir, destinationRelative);
  if (!isWithin(workdir, destinationPath) || destinationPath === workdir) fail("--destination must remain inside the project directory.");
  const destinationParent = dirname(destinationPath);
  await assertNoSymlinkComponents(workdir, relative(workdir, destinationParent), "destination parent path");
  await mkdir(destinationParent, { recursive: true });
  await assertNoSymlinkComponents(workdir, relative(workdir, destinationParent), "destination parent path");
  const realDestinationParent = await assertContainedRealPath(workdir, destinationParent, "destination parent");
  const realDestinationPath = resolve(realDestinationParent, basename(destinationPath));
  if (await lstat(realDestinationPath).then(() => true, () => false)) fail("destination already exists; promotion never overwrites.");

  const stagingDir = await mkdtemp(resolve(realDestinationParent, ".ogs-promotion-"));
  try {
    for (const file of expectedFiles) {
      const target = resolve(stagingDir, file.path);
      await mkdir(dirname(target), { recursive: true });
      await copyFile(resolve(realSourcePath, file.path), target);
    }
    const manifestSha256 = createHash("sha256").update(sealBytes).digest("hex");
    const promotionRecord = {
      version: 1,
      runId: args.runId,
      source: requestedSource,
      promotedAt: new Date().toISOString(),
      sealManifestSha256: manifestSha256,
      testReportSha256: createHash("sha256").update(await readFile(reportPath)).digest("hex")
    };
    await writeFile(resolve(stagingDir, "promotion.json"), `${JSON.stringify(promotionRecord, null, 2)}\n`, "utf8");
    await rename(stagingDir, realDestinationPath);
    return {
      runId: args.runId,
      source: requestedSource,
      destination: realDestinationPath,
      fileCount: expectedFiles.length,
      manifestSha256
    };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
