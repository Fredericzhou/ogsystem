import { createHash, randomUUID } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { assertMaterializationManifest, assertRelease, digestRecord, type MaterializationManifest, type MaterializationManifestEntry, type ReleaseFailureCode, type ReleaseRecord } from "./workspace-contracts.js";

const execFile = promisify(execFileCallback);

type ReleaseInput = {
  releaseId: string;
  runId: string;
  workspaceId: string;
  releaseCommit: string;
  expectedCanonicalHead: string;
};

function releaseFile(storeDir: string, releaseId: string): string {
  return resolve(storeDir, "releases", `${releaseId}.json`);
}

function manifestFile(storeDir: string, releaseId: string): string {
  return resolve(storeDir, "materializations", releaseId, "manifest.json");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error && typeof error.code === "string" ? error.code : undefined;
}

function isReleaseStoreUnavailable(error: unknown): boolean {
  return ["EACCES", "EIO", "EISDIR", "ENODEV", "ENFILE", "EMFILE", "ENODATA", "ENOSPC", "ENOTDIR", "EROFS"].includes(errorCode(error) ?? "");
}

function assertMaterializationPath(path: string): void {
  const invalid = !path || path !== path.normalize("NFC") || path.startsWith("/") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)
    || path.split("/").some((part) => !part || part === "." || part === ".."
      || /[<>:\"|?*]/.test(part) || /[. ]$/.test(part)
      || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i.test(part));
  if (invalid) throw new Error("[MATERIALIZATION_ENTRY_INVALID] Git tree contains a non-portable or unsafe path");
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

async function materializationEntries(sourceDir: string, releaseCommit: string): Promise<{ entries: MaterializationManifestEntry[]; contentByPath: Map<string, Buffer> }> {
  const entries: MaterializationManifestEntry[] = [];
  const contentByPath = new Map<string, Buffer>();
  const gitRoot = resolve(String((await execFile("git", ["rev-parse", "--show-toplevel"], { cwd: sourceDir, encoding: "utf8" })).stdout).trim());
  const treeOutput = String((await execFile("git", ["ls-tree", "-r", "-z", "--full-tree", releaseCommit], { cwd: gitRoot, encoding: "utf8" })).stdout);
  const treeEntries = treeOutput.split("\0").filter(Boolean).map((entry) => {
    const separator = entry.indexOf("\t");
    if (separator < 0) throw new Error("[MATERIALIZATION_ENTRY_INVALID] malformed Git tree entry");
    const header = entry.slice(0, separator).split(" ");
    return { mode: header[0], type: header[1], path: entry.slice(separator + 1) };
  });
  const portablePaths = new Set<string>();
  for (const treeEntry of treeEntries) {
    assertMaterializationPath(treeEntry.path);
    const portablePath = treeEntry.path.normalize("NFC").toLowerCase();
    if (portablePaths.has(portablePath)) throw new Error("[MATERIALIZATION_ENTRY_INVALID] Git tree contains paths that collide on a case-insensitive filesystem");
    portablePaths.add(portablePath);
  }
  const lfsRoot = resolve(gitRoot, String((await execFile("git", ["rev-parse", "--git-path", "lfs/objects"], { cwd: gitRoot, encoding: "utf8" })).stdout).trim());
  for (const treeEntry of treeEntries) {
    if (treeEntry.mode === "120000") throw new Error("[MATERIALIZATION_SYMLINK_NOT_ALLOWED] materialization source contains a symbolic link");
    if (treeEntry.type !== "blob") throw new Error(`[MATERIALIZATION_ENTRY_INVALID] unsupported Git tree entry ${treeEntry.path}`);
    const path = treeEntry.path;
    let bytes = Buffer.from((await execFile("git", ["show", `${releaseCommit}:${path}`], { cwd: gitRoot, encoding: "buffer" })).stdout);
    const text = bytes.toString("utf8");
    const pointer = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (\d+)\n?$/.exec(text);
    let lfsObjectId: string | undefined;
    if (pointer) {
      const objectPath = resolve(lfsRoot, pointer[1].slice(0, 2), pointer[1].slice(2, 4), pointer[1]);
      bytes = await readFile(objectPath).catch(() => { throw new Error("[MATERIALIZATION_LFS_UNAVAILABLE] referenced Git LFS object is unavailable"); });
      if (bytes.length !== Number(pointer[2]) || createHash("sha256").update(bytes).digest("hex") !== pointer[1]) throw new Error("[MATERIALIZATION_LFS_DIGEST_MISMATCH] referenced Git LFS object failed checksum verification");
      lfsObjectId = `sha256:${pointer[1]}`;
    }
    const item: MaterializationManifestEntry = {
      path,
      digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
      sizeBytes: bytes.length,
      ...(lfsObjectId ? { lfsObjectId } : {})
    };
    entries.push(item);
    contentByPath.set(path, bytes);
  }
  return { entries, contentByPath };
}

async function verifyMaterialization(storeDir: string, record: ReleaseRecord): Promise<void> {
  if (!record.materializationManifestRef || !record.materializationManifestDigest || !record.outputDigest || !record.downloadReference) {
    throw new Error("[RELEASE_RECONCILIATION_FAILED] materialization metadata is incomplete");
  }
  const manifestPath = resolve(storeDir, record.materializationManifestRef);
  let manifestContent: string;
  try {
    manifestContent = await readFile(manifestPath, "utf8");
  } catch (error) {
    throw new Error("[RELEASE_RECONCILIATION_FAILED] materialization manifest is unavailable", { cause: error });
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestContent) as unknown;
  } catch (error) {
    throw new Error("[WORKSPACE_MANIFEST_INVALID] materialization manifest is not valid JSON", { cause: error });
  }
  assertMaterializationManifest(manifest);
  if (manifest.manifestId !== `${record.releaseId}:materialization`
    || manifest.releaseId !== record.releaseId || manifest.releaseCommit !== record.releaseCommit
    || manifest.digest !== record.materializationManifestDigest) {
    throw new Error("[RELEASE_RECONCILIATION_FAILED] materialization manifest does not match the Release record");
  }
  if (digestRecord(manifest.files) !== record.outputDigest) {
    throw new Error("[OUTPUT_DIGEST_MISMATCH] Release output digest does not match the materialization manifest");
  }
  const outputRoot = resolve(storeDir, "materializations", record.releaseId, "output");
  for (const entry of manifest.files) {
    const target = resolve(outputRoot, entry.path);
    const info = await stat(target);
    if (!info.isFile()) throw new Error("[RELEASE_RECONCILIATION_FAILED] materialized output is incomplete");
    if (info.size !== entry.sizeBytes) throw new Error("[OUTPUT_DIGEST_MISMATCH] materialized output size does not match its manifest");
    const bytes = await readFile(target);
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (digest !== entry.digest) throw new Error("[OUTPUT_DIGEST_MISMATCH] materialized output digest mismatch");
  }
}

export class WorkspaceReleaseService {
  constructor(private readonly storeDir: string) {}

  async load(releaseId: string): Promise<ReleaseRecord | undefined> {
    try {
      const value = JSON.parse(await readFile(releaseFile(this.storeDir, releaseId), "utf8")) as unknown;
      assertRelease(value);
      return value;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async prepare(args: ReleaseInput): Promise<ReleaseRecord> {
    const existing = await this.load(args.releaseId);
    if (existing) {
      if (existing.runId !== args.runId || existing.workspaceId !== args.workspaceId || existing.releaseCommit !== args.releaseCommit || existing.expectedCanonicalHead !== args.expectedCanonicalHead) {
        throw new Error("[RELEASE_STATE_INVALID] releaseId is already bound to a different release identity");
      }
      return existing;
    }
    const now = new Date().toISOString();
    const record: ReleaseRecord = {
      ogsContractVersion: 2,
      schemaVersion: 1,
      ...args,
      status: "prepared",
      failureCode: null,
      createdAt: now,
      updatedAt: now
    };
    assertRelease(record);
    await writeJson(releaseFile(this.storeDir, args.releaseId), record);
    return record;
  }

  async materialize(args: { releaseId: string; sourceDir: string; downloadReference?: string }): Promise<ReleaseRecord> {
    const record = await this.load(args.releaseId);
    if (!record) throw new Error("[RELEASE_NOT_FOUND] release must be prepared first");
    if (record.status === "materialized" || record.status === "ref_updated" || record.status === "published") return record;
    if (record.status !== "prepared") throw new Error("[RELEASE_STATE_INVALID] only prepared releases can be materialized");
    let materialized: Awaited<ReturnType<typeof materializationEntries>>;
    try {
      materialized = await materializationEntries(resolve(args.sourceDir), record.releaseCommit);
    } catch (error) {
      const message = errorMessage(error);
      const failureCode: ReleaseFailureCode = message.includes("MATERIALIZATION_LFS_")
        ? "MATERIALIZATION_FAILED"
        : "CANDIDATE_INVALID";
      await this.fail({ releaseId: record.releaseId, failureCode });
      throw error;
    }
    try {
      const manifestEntries = materialized.entries;
      const manifestBase = {
        ogsContractVersion: 2 as const,
        schemaVersion: 1 as const,
        manifestId: `${record.releaseId}:materialization`,
        releaseId: record.releaseId,
        releaseCommit: record.releaseCommit,
        files: manifestEntries
      };
      const manifest: MaterializationManifest = { ...manifestBase, digest: digestRecord(manifestBase) };
      const destination = resolve(this.storeDir, "materializations", record.releaseId, "output");
      await mkdir(destination, { recursive: true });
      for (const entry of manifestEntries) {
        const target = resolve(destination, entry.path);
        await mkdir(dirname(target), { recursive: true });
        const content = materialized.contentByPath.get(entry.path);
        if (!content) {
          throw new Error(`[MATERIALIZATION_ENTRY_INVALID] missing materialized content ${entry.path}`);
        }
        await writeFile(target, content);
        const written = await readFile(target);
        if (written.length !== entry.sizeBytes || `sha256:${createHash("sha256").update(written).digest("hex")}` !== entry.digest) {
          throw new Error("[OUTPUT_DIGEST_MISMATCH] materialized output did not match its committed bytes");
        }
      }
      await writeJson(manifestFile(this.storeDir, record.releaseId), manifest);
      const outputDigest = digestRecord(manifestEntries);
      const next: ReleaseRecord = {
        ...record,
        status: "materialized",
        materializationManifestRef: relative(this.storeDir, manifestFile(this.storeDir, record.releaseId)),
        materializationManifestDigest: manifest.digest,
        outputDigest,
        downloadReference: args.downloadReference ?? `release://${record.releaseId}/output`,
        updatedAt: new Date().toISOString()
      };
      assertRelease(next);
      await writeJson(releaseFile(this.storeDir, record.releaseId), next);
      return next;
    } catch (error) {
      const message = errorMessage(error);
      const failureCode: ReleaseFailureCode = message.includes("OUTPUT_DIGEST_MISMATCH")
        ? "OUTPUT_DIGEST_MISMATCH"
        : isReleaseStoreUnavailable(error)
          ? "RELEASE_STORE_UNAVAILABLE"
          : message.includes("MATERIALIZATION_ENTRY_INVALID")
            ? "CANDIDATE_INVALID"
            : "MATERIALIZATION_FAILED";
      await this.fail({ releaseId: record.releaseId, failureCode });
      throw error;
    }
  }

  async markRefUpdated(releaseId: string): Promise<ReleaseRecord> {
    const record = await this.load(releaseId);
    if (!record || (record.status !== "materialized" && record.status !== "ref_updated")) throw new Error("[RELEASE_STATE_INVALID] materialization is required before ref_updated");
    if (record.status === "ref_updated") return record;
    const next = { ...record, status: "ref_updated" as const, updatedAt: new Date().toISOString() };
    assertRelease(next);
    await writeJson(releaseFile(this.storeDir, releaseId), next);
    return next;
  }

  async publish(releaseId: string): Promise<ReleaseRecord> {
    const record = await this.load(releaseId);
    if (!record || (record.status !== "ref_updated" && record.status !== "published")) throw new Error("[RELEASE_STATE_INVALID] canonical ref update is required before publish");
    if (record.status === "published") return record;
    const next = { ...record, status: "published" as const, failureCode: null, updatedAt: new Date().toISOString() };
    assertRelease(next);
    await writeJson(releaseFile(this.storeDir, releaseId), next);
    return next;
  }

  /** Reconcile a durable materialization after a cross-store write or CAS interruption. */
  async reconcile(args: { releaseId: string; canonicalHead: string }): Promise<ReleaseRecord> {
    const record = await this.load(args.releaseId);
    if (!record) throw new Error("[RELEASE_NOT_FOUND] release must be prepared first");
    if (record.status === "published" || record.status === "failed") return record;
    if (record.status !== "materialized" && record.status !== "ref_updated") {
      throw new Error("[RELEASE_RECONCILIATION_FAILED] release is not materialized");
    }
    try {
      await verifyMaterialization(this.storeDir, record);
    } catch (error) {
      const message = errorMessage(error);
      const failureCode: ReleaseFailureCode = message.includes("OUTPUT_DIGEST_MISMATCH")
        ? "OUTPUT_DIGEST_MISMATCH"
        : isReleaseStoreUnavailable(error)
          ? "RELEASE_STORE_UNAVAILABLE"
          : "RELEASE_RECONCILIATION_FAILED";
      await this.fail({ releaseId: record.releaseId, failureCode });
      throw error;
    }
    if (args.canonicalHead === record.releaseCommit) {
      if (record.status === "materialized") await this.markRefUpdated(record.releaseId);
      return this.publish(record.releaseId);
    }
    if (args.canonicalHead !== record.expectedCanonicalHead) {
      return this.fail({ releaseId: record.releaseId, failureCode: "STALE_CANONICAL_HEAD" });
    }
    return record;
  }

  async fail(args: { releaseId: string; failureCode: ReleaseFailureCode }): Promise<ReleaseRecord> {
    const record = await this.load(args.releaseId);
    if (!record) throw new Error("[RELEASE_NOT_FOUND] release must be prepared first");
    if (record.status === "published") throw new Error("[RELEASE_STATE_INVALID] published release cannot fail");
    const next = { ...record, status: "failed" as const, failureCode: args.failureCode, downloadReference: undefined, updatedAt: new Date().toISOString() };
    assertRelease(next);
    await writeJson(releaseFile(this.storeDir, args.releaseId), next);
    return next;
  }
}

export function createWorkspaceReleaseService(storeDir: string): WorkspaceReleaseService {
  return new WorkspaceReleaseService(resolve(storeDir));
}
