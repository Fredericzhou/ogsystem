import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { TeamRunRecord, TeamRunStore } from "./runtime.js";
import { TeamRunConflictError } from "./runtime.js";

const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function assertRunId(runId: string): void {
  if (!RUN_ID_PATTERN.test(runId)) throw new Error("TEAM_RUN_ID_INVALID: runId contains unsupported characters.");
}

function validateRecord(record: TeamRunRecord, expectedRunId?: string): void {
  if (!record || typeof record !== "object" || typeof record.runId !== "string") {
    throw new Error("TEAM_RUN_RECORD_INVALID: record must include a runId.");
  }
  assertRunId(record.runId);
  if (expectedRunId !== undefined && record.runId !== expectedRunId) {
    throw new Error("TEAM_RUN_RECORD_INVALID: record runId does not match the requested run.");
  }
  if (!Number.isInteger(record.revision) || record.revision < 0) {
    throw new Error("TEAM_RUN_RECORD_INVALID: revision must be a non-negative integer.");
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

export class FileTeamRunStore implements TeamRunStore {
  readonly rootDirectory: string;

  constructor(rootDirectory: string, private readonly options: { lockWaitMs?: number; staleLockMs?: number } = {}) {
    this.rootDirectory = resolve(rootDirectory);
  }

  private recordPath(runId: string): string {
    assertRunId(runId);
    return join(this.rootDirectory, `${runId}.json`);
  }

  private lockPath(runId: string): string {
    return `${this.recordPath(runId)}.lock`;
  }

  private async acquireLock(runId: string): Promise<() => Promise<void>> {
    await mkdir(this.rootDirectory, { recursive: true });
    const lockPath = this.lockPath(runId);
    const deadline = Date.now() + (this.options.lockWaitMs ?? 5000);
    while (true) {
      try {
        await mkdir(lockPath);
        try {
          await writeFile(join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, token: randomUUID(), createdAt: Date.now() }), { flag: "wx" });
        } catch (error) {
          await rm(lockPath, { recursive: true, force: true });
          throw error;
        }
        return async () => rm(lockPath, { recursive: true, force: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        await this.removeStaleLock(lockPath);
        if (Date.now() >= deadline) throw new TeamRunConflictError(`Timed out waiting for Team Run lock '${runId}'.`);
        await delay(5);
      }
    }
  }

  private async removeStaleLock(lockPath: string): Promise<void> {
    let lockStat;
    try {
      lockStat = await stat(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    let owner: { pid?: number } | undefined;
    try {
      owner = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as { pid?: number };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
    }
    const oldEnough = Date.now() - lockStat.mtimeMs > (this.options.staleLockMs ?? 30000);
    let ownerDead = false;
    if (Number.isInteger(owner?.pid)) {
      try {
        process.kill(owner!.pid!, 0);
      } catch (error) {
        ownerDead = (error as NodeJS.ErrnoException).code === "ESRCH";
      }
    }
    if (!ownerDead && !(oldEnough && !owner)) return;
    const quarantine = `${lockPath}.stale.${randomUUID()}`;
    try {
      await rename(lockPath, quarantine);
      await rm(quarantine, { recursive: true, force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async readRecord(runId: string): Promise<TeamRunRecord | undefined> {
    try {
      const record = JSON.parse(await readFile(this.recordPath(runId), "utf8")) as TeamRunRecord;
      validateRecord(record, runId);
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  private async writeAtomic(runId: string, record: TeamRunRecord): Promise<void> {
    const path = this.recordPath(runId);
    const tempPath = `${path}.${randomUUID()}.tmp`;
    try {
      const json = `${JSON.stringify(record)}\n`;
      await writeFile(tempPath, json, { encoding: "utf8", flag: "wx" });
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  async create(record: TeamRunRecord): Promise<void> {
    validateRecord(record);
    const release = await this.acquireLock(record.runId);
    try {
      if (await this.readRecord(record.runId)) throw new TeamRunConflictError(`Team Run '${record.runId}' already exists.`);
      await this.writeAtomic(record.runId, structuredClone(record));
    } finally {
      await release();
    }
  }

  async load(runId: string): Promise<TeamRunRecord | undefined> {
    const record = await this.readRecord(runId);
    return record ? structuredClone(record) : undefined;
  }

  async compareAndSet(runId: string, expectedRevision: number, record: TeamRunRecord): Promise<boolean> {
    assertRunId(runId);
    validateRecord(record, runId);
    if (record.revision !== expectedRevision + 1) {
      throw new Error("TEAM_RUN_RECORD_INVALID: CAS record revision must increment exactly once.");
    }
    const release = await this.acquireLock(runId);
    try {
      const current = await this.readRecord(runId);
      if (!current || current.revision !== expectedRevision) return false;
      await this.writeAtomic(runId, structuredClone(record));
      return true;
    } finally {
      await release();
    }
  }

  async listRunIds(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.rootDirectory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    return entries.filter((entry) => entry.endsWith(".json") && !entry.endsWith(".lock.json"))
      .map((entry) => entry.slice(0, -5))
      .filter((runId) => RUN_ID_PATTERN.test(runId))
      .sort();
  }
}
