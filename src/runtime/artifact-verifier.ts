import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { VerifiedArtifactFileEntry, VerifiedArtifactManifest } from "./types.js";

export type ArtifactVerificationLimits = {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  /** Image artifacts use a separate default aligned with typical CLI model output sizes. */
  maxImageBytes?: number;
};

export const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export type ArtifactVerificationResult = {
  manifest: VerifiedArtifactManifest;
  manifestSha256: string;
  /** Bytes read from the same no-follow handles used for verification. */
  contentsByPath: ReadonlyMap<string, Buffer>;
};

export type SealManifest = {
  version: 1;
  status: "sealed";
  artifact: string;
  testReport: string;
  files: Array<{ path: string; sha256: string; mediaType?: string }>;
  manifestSha256: string;
  sealedAt: string;
};

function fail(code: string, message: string): never {
  throw new Error(`[${code}] ${message}`);
}

function safeRelativePath(value: string): string {
  if (!value || isAbsolute(value) || value.includes("\0")) fail("ARTIFACT_PATH_INVALID", "artifact path must be relative");
  const normalized = value.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    fail("ARTIFACT_PATH_INVALID", `unsafe artifact path: ${value}`);
  }
  return segments.join(sep);
}

function isWithin(parent: string, candidate: string): boolean {
  const relation = relative(parent, candidate);
  return relation === "" || (relation !== ".." && !relation.startsWith(`..${sep}`) && !isAbsolute(relation));
}

async function assertNoSymlinkComponents(root: string, relativePath: string): Promise<void> {
  let current = root;
  for (const segment of relativePath.split(sep)) {
    current = resolve(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) fail("ARTIFACT_SYMLINK_NOT_ALLOWED", relativePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

async function listRegularFiles(root: string, current = ""): Promise<string[]> {
  const directory = current ? resolve(root, current) : root;
  const output: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = current ? `${current}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) fail("ARTIFACT_SYMLINK_NOT_ALLOWED", path);
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) output.push(...await listRegularFiles(root, path));
    else if (entry.isFile()) output.push(path.replaceAll("/", sep));
    else fail("ARTIFACT_ENTRY_INVALID", path);
  }
  return output.sort();
}

export async function verifyArtifactDirectory(args: {
  root: string;
  artifactId: string;
  runId: string;
  producerRoleId: string;
  executionId: string;
  mediaTypeByPath?: Record<string, string>;
  limits?: ArtifactVerificationLimits;
  /** Optional declared file subset. An empty subset is rejected by the caller. */
  includePaths?: string[];
}): Promise<ArtifactVerificationResult> {
  const root = await realpath(resolve(args.root));
  const limits = args.limits ?? {};
  const allPaths = await listRegularFiles(root);
  const requested = args.includePaths?.map((path) => safeRelativePath(path).replaceAll(sep, "/"));
  const paths = requested
    ? requested.map((path) => {
        if (!allPaths.includes(path.replaceAll("/", sep))) fail("ARTIFACT_FILE_NOT_FOUND", path);
        return path.replaceAll("/", sep);
      })
    : allPaths;
  if (limits.maxFiles !== undefined && paths.length > limits.maxFiles) {
    fail("ARTIFACT_FILE_QUOTA_EXCEEDED", `${paths.length} files exceed limit ${limits.maxFiles}`);
  }
  const files: VerifiedArtifactFileEntry[] = [];
  const contentsByPath = new Map<string, Buffer>();
  let totalBytes = 0;
  for (const path of paths) {
    await assertNoSymlinkComponents(root, path);
    const absolute = resolve(root, path);
    const resolved = await realpath(absolute);
    if (!isWithin(root, resolved)) fail("ARTIFACT_PATH_ESCAPE", path);
    const handle = await open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let metadata;
    let bytes: Buffer;
    try {
      metadata = await handle.stat();
      if (!metadata.isFile()) fail("ARTIFACT_ENTRY_INVALID", path);
      bytes = await handle.readFile();
    } finally {
      await handle.close().catch(() => undefined);
    }
    if (limits.maxFileBytes !== undefined && metadata.size > limits.maxFileBytes) {
      fail("ARTIFACT_FILE_QUOTA_EXCEEDED", `${path} exceeds ${limits.maxFileBytes} bytes`);
    }
    const mediaType = args.mediaTypeByPath?.[path.replaceAll(sep, "/")];
    const imageLimit = limits.maxImageBytes ?? DEFAULT_MAX_IMAGE_BYTES;
    if (mediaType?.toLowerCase().startsWith("image/") && metadata.size > imageLimit) {
      fail("ARTIFACT_IMAGE_QUOTA_EXCEEDED", `${path} exceeds image limit ${imageLimit} bytes`);
    }
    totalBytes += metadata.size;
    if (limits.maxTotalBytes !== undefined && totalBytes > limits.maxTotalBytes) {
      fail("ARTIFACT_BYTES_QUOTA_EXCEEDED", `artifact exceeds ${limits.maxTotalBytes} bytes`);
    }
    files.push({
      path: path.replaceAll(sep, "/"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      sizeBytes: metadata.size,
      mediaType: mediaType || "application/octet-stream"
    });
    contentsByPath.set(path.replaceAll(sep, "/"), bytes);
  }
  const unsignedManifest = {
    version: 1,
    status: "verified",
    artifactId: args.artifactId,
    runId: args.runId,
    producerRoleId: args.producerRoleId,
    executionId: args.executionId,
    generatedAt: new Date().toISOString(),
    files,
    totalBytes
  } as const;
  const unsignedBytes = Buffer.from(`${JSON.stringify(unsignedManifest, null, 2)}\n`, "utf8");
  const manifestSha256 = createHash("sha256").update(unsignedBytes).digest("hex");
  const manifest: VerifiedArtifactManifest = { ...unsignedManifest, manifestSha256 };
  return { manifest, manifestSha256, contentsByPath };
}

export async function writeVerifiedArtifactManifest(args: {
  executionDir: string;
  manifest: VerifiedArtifactManifest;
}): Promise<{ path: string; sha256: string }> {
  const executionDir = resolve(args.executionDir);
  await mkdir(executionDir, { recursive: true });
  const path = resolve(executionDir, "artifact-manifest.json");
  const bytes = Buffer.from(`${JSON.stringify(args.manifest, null, 2)}\n`, "utf8");
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function writeSealManifest(args: {
  sharedDir: string;
  artifactRelativePath: string;
  testReportRelativePath: string;
  verified: ArtifactVerificationResult;
}): Promise<{ path: string; manifest: SealManifest; sha256: string }> {
  const artifact = safeRelativePath(args.artifactRelativePath).replaceAll(sep, "/");
  const testReport = safeRelativePath(args.testReportRelativePath).replaceAll(sep, "/");
  const manifest: SealManifest = {
    version: 1,
    status: "sealed",
    artifact,
    testReport,
    files: args.verified.manifest.files.map((entry) => ({ path: entry.path, sha256: entry.sha256, mediaType: entry.mediaType })),
    manifestSha256: args.verified.manifestSha256,
    sealedAt: new Date().toISOString()
  };
  const sharedDir = resolve(args.sharedDir);
  await mkdir(sharedDir, { recursive: true });
  // Keep the verified manifest in its own evidence file. Readers authenticate
  // the seal against this canonical record instead of trusting mutable seal
  // metadata and file entries.
  const verifiedManifestPath = resolve(sharedDir, "artifact-manifest.json");
  const verifiedManifestBytes = Buffer.from(`${JSON.stringify(args.verified.manifest, null, 2)}\n`, "utf8");
  await writeFile(verifiedManifestPath, verifiedManifestBytes, { flag: "wx" }).catch(async (error) => {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = await readFile(verifiedManifestPath);
    if (createHash("sha256").update(existing).digest("hex") !== createHash("sha256").update(verifiedManifestBytes).digest("hex")) {
      fail("ARTIFACT_MANIFEST_INVALID", "canonical verified manifest already exists with different content");
    }
  });
  const path = resolve(sharedDir, "seal-manifest.json");
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
  return { path, manifest, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function artifactVerificationError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`[ERROR.ARTIFACT_VERIFICATION_FAILED] ${message}`);
}

