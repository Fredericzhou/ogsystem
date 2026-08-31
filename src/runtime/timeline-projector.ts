import { createReadStream } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";

import { writeTextFileAtomic } from "./json-file.js";

export type TimelineProjectionRecord = {
  version: 1;
  cursor: number;
  at: string;
  type: string;
  roleId?: string;
  branchId?: string;
  reviewId?: string;
  lineageId?: string;
  loopIteration?: number;
  event?: string;
  status?: string;
  durationMs?: number;
  errorCode?: string;
};

type TimelineSnapshotArgs = {
  timelinePath: string;
  cursor?: number;
  limit?: number;
  roleId?: string;
  branchId?: string;
  type?: string;
  reviewId?: string;
  status?: string;
  errorCode?: string;
};

type TimelineSnapshotEntry = {
  cursor: number;
  record: TimelineProjectionRecord;
};

type TimelineCacheEntry = {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
  nextCursor: number;
  entries: TimelineSnapshotEntry[];
  remainder: string;
};

const timelineTailCache = new Map<string, TimelineCacheEntry>();
const MAX_TIMELINE_CACHE_ENTRIES = 10_000;
const MAX_TIMELINE_CACHE_FILES = 32;

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseJsonLines(content: string): Array<Record<string, unknown>> {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return [];
        }
        return [parsed as Record<string, unknown>];
      } catch {
        return [];
      }
    });
}

function parseTimelineEntries(content: string): TimelineSnapshotEntry[] {
  return parseJsonLines(content)
    .map((line) => timelineEntryFromValue(line))
    .filter((entry): entry is TimelineSnapshotEntry => entry !== undefined);
}

function parseAppendedTimelineChunk(content: string): {
  entries: TimelineSnapshotEntry[];
  remainder: string;
} {
  const lines = content.split(/\r?\n/);
  let trailingPartial = "";
  if (!content.endsWith("\n")) {
    const candidate = lines.pop() ?? "";
    if (candidate.trim()) {
      try {
        const parsed = JSON.parse(candidate);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          const cursor = asNumber((parsed as Record<string, unknown>).cursor);
          const at = asString((parsed as Record<string, unknown>).at);
          const type = asString((parsed as Record<string, unknown>).type);
          if (cursor !== undefined && at && type) {
            lines.push(candidate);
          } else {
            trailingPartial = candidate;
          }
        } else {
          trailingPartial = candidate;
        }
      } catch {
        trailingPartial = candidate;
      }
    }
  }
  const entries = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      const entry = parseTimelineEntry(line);
      return entry ? [entry] : [];
    });
  return {
    entries,
    remainder: trailingPartial
  };
}

function filterTimelineEntries(
  records: TimelineSnapshotEntry[],
  args: TimelineSnapshotArgs,
  nextCursor = records.reduce((next, entry) => Math.max(next, entry.cursor + 1), 0)
): { events: TimelineSnapshotEntry[]; nextCursor: number } {
  const startCursor = Math.max(0, args.cursor ?? 0);
  const limit = args.limit ?? 500;
  const events = records
    .filter((entry) => entry.cursor >= startCursor)
    .filter((entry) => {
      if (args.type && entry.record.type !== args.type) {
        return false;
      }
      if (args.roleId && entry.record.roleId !== args.roleId) {
        return false;
      }
      if (args.branchId && entry.record.branchId !== args.branchId) {
        return false;
      }
      if (args.reviewId && entry.record.reviewId !== args.reviewId) {
        return false;
      }
      if (args.status && entry.record.status !== args.status) {
        return false;
      }
      if (args.errorCode && entry.record.errorCode !== args.errorCode) {
        return false;
      }
      return true;
    })
    .slice(0, limit);

  return {
    events,
    nextCursor
  };
}

function trimTimelineEntries(entries: TimelineSnapshotEntry[]): TimelineSnapshotEntry[] {
  return entries.length > MAX_TIMELINE_CACHE_ENTRIES
    ? entries.slice(-MAX_TIMELINE_CACHE_ENTRIES)
    : entries;
}

function cacheTimelineEntry(timelinePath: string, entry: TimelineCacheEntry): void {
  timelineTailCache.delete(timelinePath);
  timelineTailCache.set(timelinePath, entry);
  while (timelineTailCache.size > MAX_TIMELINE_CACHE_FILES) {
    const oldestPath = timelineTailCache.keys().next().value as string | undefined;
    if (!oldestPath) {
      break;
    }
    timelineTailCache.delete(oldestPath);
  }
}

function timelineEntryFromValue(value: unknown): TimelineSnapshotEntry | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const parsed = value as Record<string, unknown>;
  const cursor = asNumber(parsed.cursor);
  const at = asString(parsed.at);
  const type = asString(parsed.type);
  if (cursor === undefined || !at || !type) {
    return undefined;
  }
  return {
    cursor,
    record: parsed as TimelineProjectionRecord
  };
}

function parseTimelineEntry(line: string): TimelineSnapshotEntry | undefined {
  try {
    return timelineEntryFromValue(JSON.parse(line));
  } catch {
    return undefined;
  }
}

function matchesTimelineFilters(record: TimelineProjectionRecord, args: TimelineSnapshotArgs): boolean {
  return (!args.type || record.type === args.type)
    && (!args.roleId || record.roleId === args.roleId)
    && (!args.branchId || record.branchId === args.branchId)
    && (!args.reviewId || record.reviewId === args.reviewId)
    && (!args.status || record.status === args.status)
    && (!args.errorCode || record.errorCode === args.errorCode);
}

async function readTimelineSnapshotFromStart(
  args: TimelineSnapshotArgs
): Promise<{ events: TimelineSnapshotEntry[]; nextCursor: number }> {
  const events: TimelineSnapshotEntry[] = [];
  const startCursor = Math.max(0, args.cursor ?? 0);
  const limit = args.limit ?? 500;
  let nextCursor = 0;
  try {
    const reader = createInterface({
      input: createReadStream(args.timelinePath, { encoding: "utf8" }),
      crlfDelay: Infinity
    });
    for await (const line of reader) {
      const entry = parseTimelineEntry(line.trim());
      if (!entry) {
        continue;
      }
      nextCursor = Math.max(nextCursor, entry.cursor + 1);
      if (entry.cursor >= startCursor && matchesTimelineFilters(entry.record, args) && events.length < limit) {
        events.push(entry);
      }
    }
  } catch {
    return { events: [], nextCursor: 0 };
  }
  return { events, nextCursor };
}

function extractErrorCode(event: Record<string, unknown>): string | undefined {
  const direct = asString(event.errorCode);
  if (direct) {
    return direct;
  }
  const errorEnvelope = event.errorEnvelope;
  if (typeof errorEnvelope !== "object" || errorEnvelope === null || Array.isArray(errorEnvelope)) {
    return undefined;
  }
  return asString((errorEnvelope as Record<string, unknown>).errorCode);
}

export function projectTimelineRecord(args: {
  cursor: number;
  event: Record<string, unknown>;
}): TimelineProjectionRecord | undefined {
  const at = asString(args.event.at);
  const type = asString(args.event.type);
  if (!at || !type) {
    return undefined;
  }
  return {
    version: 1,
    cursor: args.cursor,
    at,
    type,
    roleId: asString(args.event.roleId),
    branchId: asString(args.event.branchId),
    reviewId: asString(args.event.reviewId),
    lineageId: asString(args.event.lineageId),
    loopIteration: asNumber(args.event.loopIteration),
    event: asString(args.event.event) ?? asString(args.event.selectedEvent),
    status: asString(args.event.status),
    durationMs: asNumber(args.event.durationMs),
    errorCode: extractErrorCode(args.event)
  };
}

export async function rebuildTimelineProjection(args: {
  eventsPath: string;
  timelinePath: string;
}): Promise<void> {
  let content: string;
  try {
    content = await readFile(args.eventsPath, "utf8");
  } catch {
    await writeTextFileAtomic(args.timelinePath, "");
    return;
  }

  const lines = parseJsonLines(content)
    .map((event, cursor) => projectTimelineRecord({ cursor, event }))
    .filter((record): record is TimelineProjectionRecord => record !== undefined)
    .map((record) => JSON.stringify(record));
  await writeTextFileAtomic(args.timelinePath, lines.join("\n"));
}

export async function loadTimelineSnapshot(args: {
  timelinePath: string;
  cursor?: number;
  limit?: number;
  roleId?: string;
  branchId?: string;
  type?: string;
  reviewId?: string;
  status?: string;
  errorCode?: string;
}): Promise<{ events: Array<{ cursor: number; record: TimelineProjectionRecord }>; nextCursor: number }> {
  let content: string;
  try {
    content = await readFile(args.timelinePath, "utf8");
  } catch {
    return {
      events: [],
      nextCursor: 0
    };
  }

  return filterTimelineEntries(parseTimelineEntries(content), args);
}

async function readFileSlice(path: string, position: number, length: number): Promise<string> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, position);
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function buildTimelineCacheEntry(timelinePath: string): Promise<TimelineCacheEntry> {
  const fileStat = await stat(timelinePath);
  const content = await readFile(timelinePath, "utf8");
  const parsed = parseAppendedTimelineChunk(content);
  return {
    mtimeMs: fileStat.mtimeMs,
    ctimeMs: fileStat.ctimeMs,
    size: fileStat.size,
    entries: trimTimelineEntries(parsed.entries),
    nextCursor: parsed.entries.reduce((next, entry) => Math.max(next, entry.cursor + 1), 0),
    remainder: parsed.remainder
  };
}

async function loadTimelineCacheEntry(timelinePath: string): Promise<TimelineCacheEntry> {
  const fileStat = await stat(timelinePath);
  const cached = timelineTailCache.get(timelinePath);
  if (!cached) {
    const entry = await buildTimelineCacheEntry(timelinePath);
    cacheTimelineEntry(timelinePath, entry);
    return entry;
  }
  if (
    fileStat.size < cached.size ||
    fileStat.mtimeMs < cached.mtimeMs ||
    (fileStat.ctimeMs !== cached.ctimeMs && fileStat.size <= cached.size)
  ) {
    const rebuilt = await buildTimelineCacheEntry(timelinePath);
    cacheTimelineEntry(timelinePath, rebuilt);
    return rebuilt;
  }
  if (
    fileStat.size === cached.size &&
    fileStat.mtimeMs === cached.mtimeMs &&
    fileStat.ctimeMs === cached.ctimeMs
  ) {
    cacheTimelineEntry(timelinePath, cached);
    return cached;
  }

  const appended = await readFileSlice(timelinePath, cached.size, fileStat.size - cached.size);
  const parsed = parseAppendedTimelineChunk(`${cached.remainder}${appended}`);
  const updated: TimelineCacheEntry = {
    mtimeMs: fileStat.mtimeMs,
    ctimeMs: fileStat.ctimeMs,
    size: fileStat.size,
    nextCursor: Math.max(
      cached.nextCursor,
      parsed.entries.reduce((next, entry) => Math.max(next, entry.cursor + 1), 0)
    ),
    entries: trimTimelineEntries(cached.entries.concat(parsed.entries)),
    remainder: parsed.remainder
  };
  cacheTimelineEntry(timelinePath, updated);
  return updated;
}

export async function loadTimelineTailSnapshot(
  args: TimelineSnapshotArgs
): Promise<{ events: TimelineSnapshotEntry[]; nextCursor: number }> {
  try {
    const cacheEntry = await loadTimelineCacheEntry(args.timelinePath);
    const startCursor = Math.max(0, args.cursor ?? 0);
    const firstCachedCursor = cacheEntry.entries[0]?.cursor;
    if (
      cacheEntry.nextCursor > startCursor &&
      (firstCachedCursor === undefined || startCursor < firstCachedCursor)
    ) {
      return readTimelineSnapshotFromStart(args);
    }
    return filterTimelineEntries(cacheEntry.entries, args, cacheEntry.nextCursor);
  } catch {
    return {
      events: [],
      nextCursor: 0
    };
  }
}
