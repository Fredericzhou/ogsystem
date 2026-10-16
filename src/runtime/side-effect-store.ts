/** File-backed side-effect ledger for single-worker project runs. */
import { mkdir, readFile, open, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { writeJsonFileAtomic } from "./json-file.js";

export type SideEffectStatus =
  | "requested"
  | "running"
  | "completed"
  | "failed"
  | "timeout"
  | "interrupted"
  | "unknown"
  | "needs_review";

export type SideEffectRecord = {
  operationId: string;
  idempotencyKey: string;
  approvalId?: string | null;
  status: SideEffectStatus;
  startedAt?: string;
  completedAt?: string;
  result?: unknown;
  error?: string;
};

const FILE = "control/side-effects.json";
const LOCK_FILE = "control/side-effects.lock";
const SIDE_EFFECT_STATUSES: ReadonlySet<string> = new Set([
  "requested",
  "running",
  "completed",
  "failed",
  "timeout",
  "interrupted",
  "unknown",
  "needs_review"
]);

function pathFor(runDir: string): string {
  return resolve(runDir, FILE);
}

async function acquireLedgerLock(runDir: string): Promise<() => Promise<void>> {
  const path = resolve(runDir, LOCK_FILE);
  await mkdir(resolve(runDir, "control"), { recursive: true });
  const token = randomUUID();
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const handle = await open(path, "wx");
      await handle.writeFile(JSON.stringify({ token, pid: process.pid, createdAt: new Date().toISOString() }) + "\n", "utf8");
      await handle.close();
      return async () => {
        const current = await readFile(path, "utf8").catch(() => "");
        if (current.includes(token)) await unlink(path).catch(() => undefined);
      };
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      if (code !== "EEXIST") throw error;
      if (Date.now() >= deadline) throw new Error(`SIDE_EFFECT_LEDGER_LOCK_UNCERTAIN: ${path}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 10));
    }
  }
}

function isValidSideEffectRecord(value: unknown): value is SideEffectRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set([
    "operationId",
    "idempotencyKey",
    "approvalId",
    "status",
    "startedAt",
    "completedAt",
    "result",
    "error"
  ]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key))) return false;
  if (typeof record.operationId !== "string" || !record.operationId.trim()) return false;
  if (typeof record.idempotencyKey !== "string" || !record.idempotencyKey.trim()) return false;
  if (typeof record.status !== "string" || !SIDE_EFFECT_STATUSES.has(record.status)) return false;
  if (record.approvalId !== undefined && record.approvalId !== null && typeof record.approvalId !== "string") return false;
  for (const field of ["startedAt", "completedAt", "error"] as const) {
    if (record[field] !== undefined && typeof record[field] !== "string") return false;
  }
  return true;
}

function assertValidLedger(value: unknown, path: string): SideEffectRecord[] {
  if (!Array.isArray(value) || value.some((record) => !isValidSideEffectRecord(record))) {
    throw new Error(`SIDE_EFFECT_LEDGER_CORRUPT: ${path}`);
  }
  const records = value as SideEffectRecord[];
  const keys = new Set<string>();
  for (const record of records) {
    if (keys.has(record.idempotencyKey)) {
      throw new Error(`SIDE_EFFECT_LEDGER_CORRUPT: duplicate idempotency key ${record.idempotencyKey}`);
    }
    keys.add(record.idempotencyKey);
  }
  return records;
}

export async function loadSideEffects(runDir: string): Promise<SideEffectRecord[]> {
  const path = pathFor(runDir);
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as unknown;
    return assertValidLedger(value, path);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return [];
    if (error instanceof Error && error.message.startsWith("SIDE_EFFECT_LEDGER_CORRUPT")) throw error;
    throw new Error(`SIDE_EFFECT_LEDGER_CORRUPT: ${path}`);
  }
}

export async function recordSideEffect(runDir: string, record: SideEffectRecord): Promise<SideEffectRecord> {
  if (!isValidSideEffectRecord(record)) {
    throw new Error(`SIDE_EFFECT_RECORD_INVALID: ${(record as Partial<SideEffectRecord>).idempotencyKey ?? "unknown"}`);
  }
  const release = await acquireLedgerLock(runDir);
  try {
    const existing = await loadSideEffects(runDir);
    const index = existing.findIndex((item) => item.idempotencyKey === record.idempotencyKey);
    if (index >= 0) {
      const prior = existing[index];
      if (prior.operationId !== record.operationId) {
        throw new Error(`SIDE_EFFECT_IDEMPOTENCY_CONFLICT: ${record.idempotencyKey}`);
      }
      if (prior.status === "completed") {
        // A completed effect is the durable idempotent result. Replays must
        // return it rather than opening a second side-effect window.
        return prior;
      }
      if (prior.status === "unknown" || prior.status === "needs_review") {
        throw new Error(`SIDE_EFFECT_TERMINAL_UNCERTAIN: ${record.idempotencyKey} is ${prior.status}`);
      }
      existing[index] = record;
    } else {
      existing.push(record);
    }
    await writeJsonFileAtomic(pathFor(runDir), existing);
    return record;
  } finally {
    await release();
  }
}

export async function getSideEffectByKey(runDir: string, idempotencyKey: string): Promise<SideEffectRecord | undefined> {
  return (await loadSideEffects(runDir)).find((item) => item.idempotencyKey === idempotencyKey);
}
