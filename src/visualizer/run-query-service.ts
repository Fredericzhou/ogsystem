/** Read-only run query boundary used by the visualizer HTTP layer. */
import { readFile, stat } from "node:fs/promises";
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
import { loadTimelineTailSnapshot, type TimelineChannel } from "../runtime/timeline-projector.js";
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

export async function loadRunEventsSnapshot(args: {
  workdir: string; runId: string; cursor?: number; limit?: number;
  roleId?: string; branchId?: string; type?: string; reviewId?: string; status?: string; errorCode?: string; channel?: TimelineChannel;
}): Promise<{ events: NdjsonEntry[]; nextCursor: number }> {
  const runDir = resolveRunDir(args.workdir, args.runId);
  const limit = normalizeEventLimit(args.limit);
  return loadTimelineTailSnapshot({ timelinePath: resolve(runDir, "timeline.jsonl"), cursor: args.cursor, limit, roleId: args.roleId, branchId: args.branchId, type: args.type, reviewId: args.reviewId, status: args.status, errorCode: args.errorCode, channel: args.channel });
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
