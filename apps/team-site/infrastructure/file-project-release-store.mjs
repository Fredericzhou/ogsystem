import { createHash } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { assertMaterializationManifest, assertRelease, digestRecord } from "../../../dist/runtime/workspace-contracts.js";
import { projectOgsDir } from "./project-paths.mjs";
import { readProjectRunOwner } from "./project-run-evidence-paths.mjs";
import { assertSafeEvidencePath, readSafeEvidenceFile } from "./safe-evidence-path.mjs";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertId(value, field) {
  if (!ID.test(String(value || ""))) throw new Error(`${field} is invalid.`);
  return String(value);
}

function mediaTypeForPath(filePath) {
  const extension = extname(filePath).toLowerCase();
  const types = {
    ".css": "text/css",
    ".csv": "text/csv",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".mjs": "text/javascript",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".ts": "text/typescript",
    ".webp": "image/webp",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml"
  };
  return types[extension] || "application/octet-stream";
}

function pathSegments(value, field) {
  const normalized = String(value || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("//")) {
    throw new Error(`RELEASE_PATH_INVALID: ${field} must be relative.`);
  }
  const segments = normalized.split("/");
  // Dotfiles such as `.gitattributes` are valid tracked Workspace content.
  // Containment is enforced by rejecting empty, current-directory, and parent
  // segments; a leading dot alone is not a path traversal operation.
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`RELEASE_PATH_INVALID: ${field} contains an unsafe segment.`);
  }
  return segments;
}

function releaseStoreSegments(runId) {
  return [".ogs", "runs", assertId(runId, "runId"), "release-store"];
}

function manifestFileSegments(runId, release) {
  return [...releaseStoreSegments(runId), ...pathSegments(release.materializationManifestRef, "materialization manifest")];
}

function outputFileSegments(runId, release, filePath) {
  return [
    ...releaseStoreSegments(runId),
    "materializations",
    assertId(release.releaseId, "releaseId"),
    "output",
    ...pathSegments(filePath, "materialization file")
  ];
}

function assertManifest(manifest, release) {
  try {
    assertMaterializationManifest(manifest);
  } catch (error) {
    const message = String(error?.message || error);
    if (message.includes("DIGEST_MISMATCH")) throw new Error("RELEASE_MATERIALIZATION_DIGEST_MISMATCH: materialization manifest digest is invalid.");
    throw new Error("RELEASE_MATERIALIZATION_INVALID: materialization manifest is invalid.");
  }
  if (manifest.manifestId !== `${release.releaseId}:materialization`
    || manifest.releaseId !== release.releaseId || manifest.releaseCommit !== release.releaseCommit) {
    throw new Error("RELEASE_MATERIALIZATION_INVALID: materialization manifest is bound to another Release.");
  }
  for (const entry of manifest.files) pathSegments(entry.path, "materialization file");
  return manifest;
}

function publicReleaseRecord(value) {
  if (value.status === "published") return value;
  const { downloadReference: _downloadReference, ...held } = value;
  return held;
}

async function readReleaseRecord(root, runId, workspaceId, filename) {
  if (!/^release-[A-Za-z0-9._-]+\.json$/.test(filename)) return undefined;
  const segments = [...releaseStoreSegments(runId), "releases", filename];
  const value = JSON.parse(await readSafeEvidenceFile(root, segments, "utf8", "Release record"));
  assertRelease(value);
  if (value.runId !== runId || value.workspaceId !== workspaceId) {
    throw new Error("RELEASE_INVALID: Release identity does not match its owning Run and Project Workspace.");
  }
  if (value.status !== "published") return publicReleaseRecord(value);
  if (!value.materializationManifestRef || !value.materializationManifestDigest || !value.outputDigest || !value.downloadReference) {
    throw new Error("RELEASE_INVALID: published Release is missing materialization evidence.");
  }
  return value;
}

async function readDirectoryIfPresent(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function releaseEntries(project) {
  if (typeof project?.workspaceId !== "string" || !project.workspaceId.trim()) {
    throw new Error("RELEASE_INVALID: owning Project Workspace identity is required.");
  }
  const root = projectOgsDir(project);
  const entries = [];
  const seen = new Set();
  for (const task of project.taskRecords || []) {
    if (task?.deletedAt || !Array.isArray(task.runIds)) continue;
    for (const runId of task.runIds) {
      await readProjectRunOwner(project, task, runId);
      const dirSegments = [...releaseStoreSegments(runId), "releases"];
      try {
        await assertSafeEvidencePath(root, dirSegments, { kind: "directory", allowMissingFinal: true, label: "Release records" });
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      const directory = resolve(root, ...dirSegments);
      for (const entry of await readDirectoryIfPresent(directory)) {
        if (!entry.isFile() || entry.isSymbolicLink()) continue;
        const release = await readReleaseRecord(root, runId, project.workspaceId, entry.name);
        if (!release || seen.has(release.releaseId)) continue;
        seen.add(release.releaseId);
        entries.push({ ...release, taskId: task.taskId, teamVersionId: task.teamVersionId, attemptNumber: task.runIds.indexOf(runId) + 1 });
      }
    }
  }
  return entries.sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

async function findRelease(project, releaseId) {
  const id = assertId(releaseId, "releaseId");
  const release = (await releaseEntries(project)).find((entry) => entry.releaseId === id);
  if (!release) throw new Error("RELEASE_NOT_FOUND: Release does not exist.");
  return release;
}

async function readMaterialization(project, release) {
  if (release.status !== "published") throw new Error("RELEASE_NOT_PUBLISHED: only a published Release is readable.");
  const root = projectOgsDir(project);
  const manifest = JSON.parse(await readSafeEvidenceFile(root, manifestFileSegments(release.runId, release), "utf8", "Materialization manifest"));
  assertManifest(manifest, release);
  if (manifest.digest !== release.materializationManifestDigest) throw new Error("RELEASE_MATERIALIZATION_DIGEST_MISMATCH: Release manifest digest does not match.");
  if (digestRecord(manifest.files) !== release.outputDigest) {
    throw new Error("RELEASE_OUTPUT_DIGEST_MISMATCH: Release output digest does not match the materialization manifest.");
  }
  return manifest;
}

export function createFileProjectReleaseStore() {
  return Object.freeze({
    list: (project) => releaseEntries(project),
    async read(project, releaseId) {
      const release = await findRelease(project, releaseId);
      const manifest = await readMaterialization(project, release);
      return { release, manifest };
    },
    async listFiles(project, releaseId) {
      const { release, manifest } = await this.read(project, releaseId);
      return { releaseId: release.releaseId, files: manifest.files };
    },
    async readFile(project, releaseId, filePath, { maxBytes = 2 * 1024 * 1024, encoding = "utf8" } = {}) {
      const { release, manifest } = await this.read(project, releaseId);
      const relativePath = pathSegments(filePath, "materialization file").join("/");
      const entry = manifest.files.find((item) => item.path === relativePath);
      if (!entry) throw new Error("RELEASE_FILE_NOT_FOUND: file is not part of the materialization.");
      const root = projectOgsDir(project);
      const segments = outputFileSegments(release.runId, release, relativePath);
      const target = await assertSafeEvidencePath(root, segments, { kind: "file", label: "Materialization file" });
      const info = await stat(target);
      if (info.size > maxBytes) return { releaseId: release.releaseId, path: relativePath, size: info.size, digest: entry.digest, tooLarge: true };
      const bytes = await readSafeEvidenceFile(root, segments, null, "Materialization file");
      const actualDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (actualDigest !== entry.digest) throw new Error("RELEASE_FILE_DIGEST_MISMATCH: materialization file digest does not match.");
      return { releaseId: release.releaseId, path: relativePath, size: info.size, digest: actualDigest, mediaType: mediaTypeForPath(relativePath), content: encoding === null ? Buffer.from(bytes) : Buffer.from(bytes).toString(encoding) };
    }
  });
}
