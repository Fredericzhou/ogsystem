import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { acquireProjectLock, ProjectLockError } from "../../../dist/runtime/project-run-lock.js";

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
      const contentPath = join(path, "content.txt");
      const metadataStats = await assertFilePath(metadataPath, "snapshot metadata");
      const contentStats = await assertFilePath(contentPath, "snapshot content");
      if (!metadataStats || !contentStats) continue;
      const [metadataBytes, content] = await Promise.all([readFile(metadataPath), readFile(contentPath)]);
      const record = JSON.parse(metadataBytes.toString("utf8"));
      if (record.deliverableId !== entry.name || !record.runId || !/^[a-f0-9]{64}$/.test(record.digest || "")) continue;
      if (createHash("sha256").update(content).digest("hex") !== record.digest) continue;
      recoveredItems.set(entry.name, record);
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
    async archive(project, metadata, content) {
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
          const digest = createHash("sha256").update(content, "utf8").digest("hex");
          const record = { ...metadata, deliverableId, digest, createdAt: new Date().toISOString() };
          try {
            await mkdir(temporaryPath);
            await writeFile(join(temporaryPath, "content.txt"), content, { encoding: "utf8", flag: "wx" });
            await writeFile(join(temporaryPath, "metadata.json"), `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
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
      const path = resolve(root, id, "content.txt");
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
      return content.toString("utf8");
    }
  });
}
