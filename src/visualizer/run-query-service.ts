/** Read-only run query boundary used by the visualizer HTTP layer. */
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  inspectRun,
  inspectRunRoleIo,
  loadIndexedRuns,
  loadPersistedRunsIndex,
  loadRunLogs,
  resolveRunDir
} from "../runtime/project-lifecycle.js";
import { loadTimelineTailSnapshot, projectTimelineRecord } from "../runtime/timeline-projector.js";
import { asRecord, asString } from "./json-guards.js";

export type NdjsonEntry = { cursor: number; record: Record<string, unknown> };
export type LoadedRunDetail = {
  runId: string;
  runDir: string;
  state: unknown;
  metrics: unknown;
  resolvedConfig: unknown;
  stopRequest: unknown;
  stopOutcome: unknown;
  summary?: unknown;
  systemSource: string | null;
  snapshotManifest: Record<string, unknown> | null;
};

const DEFAULT_EVENT_LIMIT = 200;
const MAX_EVENT_LIMIT = 1000;

function normalizeEventLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_EVENT_LIMIT;
  return Math.min(MAX_EVENT_LIMIT, Math.max(1, Math.floor(value as number)));
}

function matchesEventFilters(record: Record<string, unknown>, args: {
  roleId?: string; branchId?: string; type?: string; reviewId?: string; status?: string; errorCode?: string;
}): boolean {
  return (!args.type || asString(record.type) === args.type)
    && (!args.roleId || asString(record.roleId) === args.roleId)
    && (!args.branchId || asString(record.branchId) === args.branchId)
    && (!args.reviewId || asString(record.reviewId) === args.reviewId)
    && (!args.status || asString(record.status) === args.status)
    && (!args.errorCode || asString(record.errorCode) === args.errorCode);
}

async function readLegacyEvents(args: {
  runDir: string; cursor?: number; limit?: number;
  roleId?: string; branchId?: string; type?: string; reviewId?: string; status?: string; errorCode?: string;
}): Promise<{ events: NdjsonEntry[]; nextCursor: number }> {
  const records: NdjsonEntry[] = [];
  const startCursor = Math.max(0, args.cursor ?? 0);
  const limit = normalizeEventLimit(args.limit);
  let cursor = 0;
  try {
    const reader = createInterface({ input: createReadStream(resolve(args.runDir, "events.ndjson"), { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of reader) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        const record = projectTimelineRecord({ cursor, event: parsed as Record<string, unknown> });
        if (record && cursor >= startCursor && matchesEventFilters(record, args) && records.length < limit) {
          records.push({ cursor: record.cursor, record });
        }
        cursor += 1;
      } catch { /* tolerate a partially written final line */ }
    }
  } catch {
    return { events: [], nextCursor: 0 };
  }
  return { events: records, nextCursor: cursor };
}

async function hasTimeline(runDir: string): Promise<boolean> {
  try { return (await stat(resolve(runDir, "timeline.jsonl"))).isFile(); } catch { return false; }
}

export async function loadRunEventsSnapshot(args: {
  workdir: string; runId: string; cursor?: number; limit?: number;
  roleId?: string; branchId?: string; type?: string; reviewId?: string; status?: string; errorCode?: string;
}): Promise<{ events: NdjsonEntry[]; nextCursor: number }> {
  const runDir = resolveRunDir(args.workdir, args.runId);
  const limit = normalizeEventLimit(args.limit);
  if (await hasTimeline(runDir)) {
    return loadTimelineTailSnapshot({ timelinePath: resolve(runDir, "timeline.jsonl"), cursor: args.cursor, limit, roleId: args.roleId, branchId: args.branchId, type: args.type, reviewId: args.reviewId, status: args.status, errorCode: args.errorCode });
  }
  return readLegacyEvents({ ...args, runDir, limit });
}

async function readSystemSource(runDir: string): Promise<string | null> {
  return readFile(resolve(runDir, "system.mmd"), "utf8").catch(() => null);
}

async function readSnapshotManifest(runDir: string, systemSource: string | null): Promise<Record<string, unknown> | null> {
  try {
    const parsed = JSON.parse(await readFile(resolve(runDir, "snapshot-manifest.json"), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { manifestVersion: 0, status: "invalid", warning: "snapshot-manifest.json is not an object." };
    const manifest = parsed as Record<string, unknown>;
    const source = asRecord(manifest.source);
    const expectedHash = asString(source?.sourceHash);
    const actualHash = systemSource === null ? undefined : createHash("sha256").update(systemSource).digest("hex");
    return { ...manifest, status: expectedHash && actualHash && expectedHash !== actualHash ? "hash_mismatch" : "ok", actualSourceHash: actualHash, warning: expectedHash && actualHash && expectedHash !== actualHash ? "snapshot sourceHash differs from run artifact system.mmd; run artifact system.mmd is used as historical truth." : undefined };
  } catch {
    return { manifestVersion: 0, status: "missing", warning: "snapshot-manifest.json is missing; run artifact system.mmd remains the historical source." };
  }
}

export async function loadRunDetail(workdir: string, runId: string): Promise<LoadedRunDetail> {
  const detail = await inspectRun(workdir, runId) as Omit<LoadedRunDetail, "systemSource" | "snapshotManifest">;
  const runDir = resolveRunDir(workdir, runId);
  const systemSource = await readSystemSource(runDir);
  return { ...detail, systemSource, snapshotManifest: await readSnapshotManifest(runDir, systemSource) };
}

export const runQueryService = {
  list: loadIndexedRuns,
  loadIndex: loadPersistedRunsIndex,
  inspect: inspectRun,
  inspectRoleIo: inspectRunRoleIo,
  loadLogs: loadRunLogs,
  loadDetail: loadRunDetail,
  loadEvents: loadRunEventsSnapshot
};

export {
  inspectRun,
  inspectRunRoleIo,
  loadIndexedRuns,
  loadPersistedRunsIndex,
  loadRunLogs,
  resolveRunDir
};
