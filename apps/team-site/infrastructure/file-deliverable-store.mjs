import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { acquireProjectLock, ProjectLockError } from "../../../dist/runtime/project-run-lock.js";
import { hashVerifiedFile, openVerifiedFile } from "./verified-file-stream.mjs";

function safeId(value, field) {
  const id = String(value || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new Error(`${field} is invalid.`);
  return id;
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

const emptyIndex = () => ({ version: 1, items: [] });

async function acquireDeliverablesLock(workdir, operation) {
  const deadline = Date.now() + 10_000;
  let delay = 20;
  while (true) {
    try {
      return await acquireProjectLock({ workdir, kind: "deliverable-index", operation });
    } catch (error) {
      if (!(error instanceof ProjectLockError) || !error.retryable || Date.now() >= deadline) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
      delay = Math.min(delay * 2, 250);
    }
  }
}

async function writeIndex(indexPath, index) {
  await assertFilePath(indexPath, "index", true);
  await mkdir(resolve(indexPath, ".."), { recursive: true });
  const tempIndexPath = `${indexPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempIndexPath, `${JSON.stringify(index, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(tempIndexPath, indexPath);
  } finally {
    await rm(tempIndexPath, { force: true }).catch(() => undefined);
  }
}

async function assertRegularPath(path, label, allowMissing = false) {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new Error(`DELIVERABLE_LINK_NOT_ALLOWED: ${label} cannot be a symlink or junction.`);
    return stats;
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function assertFilePath(path, label, allowMissing = false) {
  const stats = await assertRegularPath(path, label, allowMissing);
  if (stats && !stats.isFile()) throw new Error(`DELIVERABLE_PATH_INVALID: ${label} must be a regular file.`);
  return stats;
}

function safeRelativeFilePath(value, label = "file path") {
  const normalized = String(value || "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || normalized.includes("//")) {
    throw new Error(`DELIVERABLE_PATH_INVALID: ${label} must be a safe relative path.`);
  }
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || segment.startsWith("."))) {
    throw new Error(`DELIVERABLE_PATH_INVALID: ${label} contains an unsafe path segment.`);
  }
  return segments.join("/");
}

async function verifyManifestTree(snapshotPath, record) {
  if (!record.manifestDigest) return;
  const manifestPath = join(snapshotPath, "manifest.json");
  const filesRoot = join(snapshotPath, "files");
  const manifestStats = await assertFilePath(manifestPath, "snapshot manifest");
  const filesStats = await assertRegularPath(filesRoot, "snapshot files", true);
  if (!manifestStats || !filesStats?.isDirectory()) throw new Error("DELIVERABLE_MANIFEST_INVALID: manifest or files tree is missing.");
  const manifestBytes = await readFile(manifestPath);
  if (createHash("sha256").update(manifestBytes).digest("hex") !== record.manifestDigest) {
    throw new Error("DELIVERABLE_MANIFEST_DIGEST_MISMATCH: manifest failed integrity verification.");
  }
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")); } catch { throw new Error("DELIVERABLE_MANIFEST_INVALID: manifest is not valid JSON."); }
  if (!manifest || !Array.isArray(manifest.files)) throw new Error("DELIVERABLE_MANIFEST_INVALID: files list is required.");
  const expectedPaths = new Set();
  for (const entry of manifest.files) {
    if (!entry || typeof entry.path !== "string" || !/^[a-f0-9]{64}$/.test(String(entry.sha256 || ""))) {
      throw new Error("DELIVERABLE_MANIFEST_INVALID: file entry is invalid.");
    }
    const relativePath = safeRelativeFilePath(entry.path, "manifest file");
    if (expectedPaths.has(relativePath)) throw new Error("DELIVERABLE_MANIFEST_INVALID: duplicate file path.");
    expectedPaths.add(relativePath);
    const filePath = resolve(filesRoot, relativePath);
    if (!filePath.startsWith(`${filesRoot}${sep}`)) throw new Error("DELIVERABLE_PATH_INVALID: file escaped deliverable tree.");
    const stats = await assertFilePath(filePath, "deliverable file");
    let verified;
    try { verified = await hashVerifiedFile(filePath, entry.sha256, "deliverable file"); }
    catch (error) {
      if (error?.code === "FILE_DIGEST_MISMATCH") throw new Error(`DELIVERABLE_FILE_DIGEST_MISMATCH: ${relativePath}`);
      throw error;
    }
    if (stats.size !== verified.size) {
      throw new Error(`DELIVERABLE_FILE_DIGEST_MISMATCH: ${relativePath}`);
    }
  }
  const actualPaths = new Set();
  async function collectFiles(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      safeRelativeFilePath(relativePath, "deliverable file");
      const target = join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`DELIVERABLE_LINK_NOT_ALLOWED: deliverable file ${relativePath} cannot be a symlink or junction.`);
      if (entry.isDirectory()) {
        await collectFiles(target, relativePath);
      } else if (entry.isFile()) {
        actualPaths.add(relativePath);
      } else {
        throw new Error(`DELIVERABLE_PATH_INVALID: deliverable file ${relativePath} must be a regular file.`);
      }
    }
  }
  await collectFiles(filesRoot);
  if (actualPaths.size !== expectedPaths.size || [...actualPaths].some((path) => !expectedPaths.has(path))) {
    throw new Error("DELIVERABLE_MANIFEST_INVALID: files tree does not match manifest.");
  }
  return manifest;
}

async function ensureSafeDirectories(workdir) {
  const rootStats = await assertRegularPath(workdir, "project directory");
  if (!rootStats?.isDirectory()) throw new Error("DELIVERABLE_PATH_INVALID: project directory must be a directory.");
  const projectRoot = await realpath(workdir);
  const site = join(projectRoot, ".site");
  const workspace = join(projectRoot, "workspace");
  const deliverablesRoot = join(workspace, "deliverables");
  for (const [path, label] of [[site, ".site"], [workspace, "workspace"], [deliverablesRoot, "workspace/deliverables"]]) {
    await mkdir(path, { recursive: true });
    const stats = await assertRegularPath(path, label);
    if (!stats?.isDirectory()) throw new Error(`DELIVERABLE_PATH_INVALID: ${label} must be a directory.`);
  }
  return { projectRoot, site, workspace, deliverablesRoot };
}

async function recoverSnapshots(root, indexPath, index) {
  await mkdir(resolve(indexPath, ".."), { recursive: true });
  await mkdir(root, { recursive: true });
  const siteEntries = await readdir(resolve(indexPath, ".."));
  for (const name of siteEntries) {
    if (/^deliverables\.json\.[A-Za-z0-9-]+\.tmp$/.test(name)) {
      await rm(join(resolve(indexPath, ".."), name), { force: true });
    }
  }
  const entries = await readdir(root, { withFileTypes: true });
  const recoveredItems = new Map();

  for (const entry of entries) {
    const path = join(root, entry.name);
    const entryStats = await assertRegularPath(path, "snapshot entry");
    if (entry.isSymbolicLink()) throw new Error("DELIVERABLE_LINK_NOT_ALLOWED: snapshot entries cannot be symlinks or junctions.");
    if (entry.isDirectory() && /^\.[A-Za-z0-9-]+\.tmp$/.test(entry.name)) {
      await rm(path, { recursive: true, force: true });
      continue;
    }
    if (!entryStats.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(entry.name)) continue;
    try {
      const metadataPath = join(path, "metadata.json");
      const contentPath = join(path, "content.json");
      const metadataStats = await assertFilePath(metadataPath, "snapshot metadata");
      const contentStats = await assertFilePath(contentPath, "snapshot content");
      if (!metadataStats || !contentStats) continue;
      const [metadataBytes, content] = await Promise.all([readFile(metadataPath), readFile(contentPath)]);
      const record = JSON.parse(metadataBytes.toString("utf8"));
      if (record.deliverableId !== entry.name || !record.runId || !/^[a-f0-9]{64}$/.test(record.digest || "")) continue;
      if (createHash("sha256").update(content).digest("hex") !== record.digest) continue;
      await verifyManifestTree(path, record);
      recoveredItems.set(entry.name, {
        ...record,
        summary: record.summary || content.toString("utf8").trim().replace(/\s+/g, " ").slice(0, 500),
        outputPath: record.outputPath || `workspace/deliverables/${entry.name}/content.json`
      });
    } catch (error) {
      if (error?.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
  }

  const items = [...recoveredItems.values()].sort((left, right) =>
    String(left.createdAt || "").localeCompare(String(right.createdAt || "")) || left.deliverableId.localeCompare(right.deliverableId)
  );
  const recovered = { version: 1, items };
  if (JSON.stringify(index) !== JSON.stringify(recovered)) await writeIndex(indexPath, recovered);
  return recovered;
}

export function createFileDeliverableStore() {
  return Object.freeze({
    async list(project) {
      await ensureSafeDirectories(project.workdir);
      const lock = await acquireDeliverablesLock(project.workdir, "deliverable-index-recovery");
      try {
        const paths = await ensureSafeDirectories(project.workdir);
        const indexPath = join(paths.site, "deliverables.json");
        await assertFilePath(indexPath, "index", true);
        const index = await recoverSnapshots(
          paths.deliverablesRoot,
          indexPath,
          await readJson(indexPath, emptyIndex())
        );
        return index.items;
      } finally {
        await lock.release();
      }
    },
    async archive(project, metadata, content, artifactBundle = undefined) {
      if (project.projectType !== "collaboration") throw new Error("PROJECT_TYPE_INVALID: deliverables belong to collaboration projects.");
      const runId = safeId(metadata.runId, "runId");
      const paths = await ensureSafeDirectories(project.workdir);
      const deliverablesRoot = paths.deliverablesRoot;
      const expectedRoot = paths.workspace;
      if (!deliverablesRoot.startsWith(`${expectedRoot}${sep}`)) throw new Error("Deliverable path is outside the project workspace.");
      return acquireDeliverablesLock(project.workdir, `deliverable-archive-${runId}`).then(async (lock) => {
        try {
          const indexPath = join(paths.site, "deliverables.json");
          await assertFilePath(indexPath, "index", true);
          const index = await recoverSnapshots(deliverablesRoot, indexPath, await readJson(indexPath, emptyIndex()));
          const existing = (index.items || []).find((item) => item.runId === runId);
          if (existing) return { ...existing, idempotentReplay: true };
          const deliverableId = randomUUID();
          const temporaryPath = join(deliverablesRoot, `.${deliverableId}.tmp`);
          const finalPath = join(deliverablesRoot, deliverableId);
          const contentJson = JSON.stringify(content, null, 2);
          const digest = createHash("sha256").update(contentJson, "utf8").digest("hex");
          const bundleFiles = Array.isArray(artifactBundle?.files) ? artifactBundle.files : [];
          const manifestFiles = bundleFiles.map((entry) => {
            const relativePath = safeRelativeFilePath(entry?.path, "artifact file");
            const bytes = Buffer.isBuffer(entry?.content) ? entry.content : Buffer.from(String(entry?.content ?? ""), entry?.encoding || "utf8");
            const sha256 = createHash("sha256").update(bytes).digest("hex");
            if (entry?.sha256 && String(entry.sha256).toLowerCase() !== sha256) throw new Error(`DELIVERABLE_FILE_DIGEST_MISMATCH: ${relativePath}`);
            return { path: relativePath, sha256, sizeBytes: bytes.byteLength, mediaType: entry?.mediaType || "application/octet-stream", bytes };
          });
          if (new Set(manifestFiles.map((entry) => entry.path)).size !== manifestFiles.length) throw new Error("DELIVERABLE_MANIFEST_INVALID: duplicate file path.");
          const manifest = manifestFiles.length > 0
            ? { version: 1, files: manifestFiles.map(({ bytes: _bytes, ...entry }) => entry) }
            : null;
          const manifestJson = manifest ? JSON.stringify(manifest, null, 2) : null;
          const manifestBytes = manifestJson ? `${manifestJson}\n` : null;
          const manifestDigest = manifestBytes ? createHash("sha256").update(manifestBytes, "utf8").digest("hex") : undefined;
          const record = {
            ...metadata,
            deliverableId,
            digest,
            ...(manifestDigest ? { manifestDigest, fileCount: manifestFiles.length } : {}),
            summary: metadata.summary || "",
            outputPath: `workspace/deliverables/${deliverableId}/content.json`,
            createdAt: new Date().toISOString()
          };
          try {
            await mkdir(temporaryPath);
            await writeFile(join(temporaryPath, "content.json"), contentJson, { encoding: "utf8", flag: "wx" });
            await writeFile(join(temporaryPath, "metadata.json"), `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
            if (manifest && manifestJson) {
              await writeFile(join(temporaryPath, "manifest.json"), manifestBytes, { encoding: "utf8", flag: "wx" });
              for (const entry of manifestFiles) {
                const target = resolve(temporaryPath, "files", entry.path);
                if (!target.startsWith(`${resolve(temporaryPath, "files")}${sep}`)) throw new Error("DELIVERABLE_PATH_INVALID: file escaped staging tree.");
                await mkdir(resolve(target, ".."), { recursive: true });
                await writeFile(target, entry.bytes, { flag: "wx" });
              }
            }
            await rename(temporaryPath, finalPath);
            const nextIndex = { version: 1, items: [...(index.items || []), record] };
            await writeIndex(indexPath, nextIndex);
            return record;
          } catch (error) {
            await rm(temporaryPath, { recursive: true, force: true }).catch(() => undefined);
            await rm(finalPath, { recursive: true, force: true }).catch(() => undefined);
            throw error;
          }
        } finally {
          await lock.release();
        }
      });
    },
    async readContent(project, deliverableId) {
      const id = safeId(deliverableId, "deliverableId");
      const items = await this.list(project);
      if (!items.some((item) => item.deliverableId === id)) throw new Error("DELIVERABLE_NOT_FOUND: deliverable does not exist.");
      const paths = await ensureSafeDirectories(project.workdir);
      const root = paths.deliverablesRoot;
      const path = resolve(root, id, "content.json");
      if (!path.startsWith(`${root}${sep}`)) throw new Error("Deliverable path is outside the project workspace.");
      const snapshotPath = resolve(root, id);
      const snapshotStats = await assertRegularPath(snapshotPath, "snapshot directory");
      if (!snapshotStats?.isDirectory()) throw new Error("DELIVERABLE_PATH_INVALID: snapshot must be a directory.");
      const contentStats = await assertFilePath(path, "snapshot content");
      if (!contentStats) throw new Error("DELIVERABLE_PATH_INVALID: snapshot content is missing.");
      const content = await readFile(path);
      const record = items.find((item) => item.deliverableId === id);
      if (createHash("sha256").update(content).digest("hex") !== record.digest) {
        throw new Error("DELIVERABLE_DIGEST_MISMATCH: deliverable content failed integrity verification.");
      }
      return JSON.parse(content.toString("utf8"));
    },
    async listFiles(project, deliverableId) {
      const id = safeId(deliverableId, "deliverableId");
      const items = await this.list(project);
      const record = items.find((item) => item.deliverableId === id);
      if (!record) throw new Error("DELIVERABLE_NOT_FOUND: deliverable does not exist.");
      const paths = await ensureSafeDirectories(project.workdir);
      const snapshotPath = resolve(paths.deliverablesRoot, id);
      const manifest = await verifyManifestTree(snapshotPath, record);
      return { deliverableId: id, files: manifest?.files || [] };
    },
    async readFile(project, deliverableId, filePath, { maxBytes = 2 * 1024 * 1024, encoding = "utf8" } = {}) {
      const id = safeId(deliverableId, "deliverableId");
      const relativePath = safeRelativeFilePath(filePath);
      const items = await this.list(project);
      const record = items.find((item) => item.deliverableId === id);
      if (!record) throw new Error("DELIVERABLE_NOT_FOUND: deliverable does not exist.");
      const paths = await ensureSafeDirectories(project.workdir);
      const snapshotPath = resolve(paths.deliverablesRoot, id);
      const manifest = await verifyManifestTree(snapshotPath, record);
      const entry = manifest?.files?.find((item) => item.path === relativePath);
      if (!entry) throw new Error("DELIVERABLE_FILE_NOT_FOUND: file is not part of the deliverable.");
      const target = resolve(snapshotPath, "files", relativePath);
      const stats = await assertFilePath(target, "deliverable file");
      if (stats.size > maxBytes) {
        let verified;
        try { verified = await hashVerifiedFile(target, entry.sha256, "deliverable file"); }
        catch (error) {
          if (error?.code === "FILE_DIGEST_MISMATCH") throw new Error(`DELIVERABLE_FILE_DIGEST_MISMATCH: ${relativePath}`);
          throw error;
        }
        return { deliverableId: id, path: relativePath, size: stats.size, sha256: verified.sha256, mediaType: entry.mediaType || "application/octet-stream", tooLarge: true };
      }
      const bytes = await readFile(target);
      const digest = createHash("sha256").update(bytes).digest("hex");
      if (digest !== entry.sha256) throw new Error("DELIVERABLE_FILE_DIGEST_MISMATCH: deliverable file failed integrity verification.");
      return {
        deliverableId: id,
        path: relativePath,
        size: bytes.byteLength,
        sha256: digest,
        mediaType: entry.mediaType || "application/octet-stream",
        content: encoding === null ? bytes : bytes.toString(encoding)
      };
    },
    async openFile(project, deliverableId, filePath, { range, maxBytes = 256 * 1024 * 1024, maxRangeBytes = 32 * 1024 * 1024 } = {}) {
      const id = safeId(deliverableId, "deliverableId");
      const relativePath = safeRelativeFilePath(filePath);
      const items = await this.list(project);
      const record = items.find((item) => item.deliverableId === id);
      if (!record) throw new Error("DELIVERABLE_NOT_FOUND: deliverable does not exist.");
      const paths = await ensureSafeDirectories(project.workdir);
      const snapshotPath = resolve(paths.deliverablesRoot, id);
      const manifest = await verifyManifestTree(snapshotPath, record);
      const entry = manifest?.files?.find((item) => item.path === relativePath);
      if (!entry) throw new Error("DELIVERABLE_FILE_NOT_FOUND: file is not part of the deliverable.");
      const target = resolve(snapshotPath, "files", relativePath);
      await assertFilePath(target, "deliverable file");
      let result;
      try {
        result = await openVerifiedFile(target, {
          expectedSha256: entry.sha256,
          range,
          maxBytes,
          maxRangeBytes,
          label: "deliverable file"
        });
      } catch (error) {
        if (error?.code === "FILE_DIGEST_MISMATCH") throw new Error(`DELIVERABLE_FILE_DIGEST_MISMATCH: ${relativePath}`);
        throw error;
      }
      return { ...result, deliverableId: id, path: relativePath, mediaType: entry.mediaType || "application/octet-stream" };
    }
  });
}
