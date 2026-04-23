import { open, readFile, stat } from "node:fs/promises";

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
  entries: TimelineSnapshotEntry[];
  remainder: string;
};

const timelineTailCache = new Map<string, TimelineCacheEntry>();

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
    .map((line) => {
      const cursor = asNumber(line.cursor);
      const at = asString(line.at);
      const type = asString(line.type);
      if (cursor === undefined || !at || !type) {
        return undefined;
      }
      return {
        cursor,
        record: line as TimelineProjectionRecord
      };
    })
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
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return [];
        }
        const cursor = asNumber((parsed as Record<string, unknown>).cursor);
        const at = asString((parsed as Record<string, unknown>).at);
        const type = asString((parsed as Record<string, unknown>).type);
        if (cursor === undefined || !at || !type) {
          return [];
        }
        return [
          {
            cursor,
            record: parsed as TimelineProjectionRecord
          } satisfies TimelineSnapshotEntry
        ];
      } catch {
        return [];
      }
    });
  return {
    entries,
    remainder: trailingPartial
  };
}

function filterTimelineEntries(
  records: TimelineSnapshotEntry[],
  args: TimelineSnapshotArgs
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
    nextCursor: records.length
  };
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
    entries: parsed.entries,
    remainder: parsed.remainder
  };
}

async function loadTimelineCacheEntry(timelinePath: string): Promise<TimelineCacheEntry> {
  const fileStat = await stat(timelinePath);
  const cached = timelineTailCache.get(timelinePath);
  if (!cached) {
    const entry = await buildTimelineCacheEntry(timelinePath);
    timelineTailCache.set(timelinePath, entry);
    return entry;
  }
  if (
    fileStat.size < cached.size ||
    fileStat.mtimeMs < cached.mtimeMs ||
    (fileStat.ctimeMs !== cached.ctimeMs && fileStat.size <= cached.size)
  ) {
    const rebuilt = await buildTimelineCacheEntry(timelinePath);
    timelineTailCache.set(timelinePath, rebuilt);
    return rebuilt;
  }
  if (
    fileStat.size === cached.size &&
    fileStat.mtimeMs === cached.mtimeMs &&
    fileStat.ctimeMs === cached.ctimeMs
  ) {
    return cached;
  }

  const appended = await readFileSlice(timelinePath, cached.size, fileStat.size - cached.size);
  const parsed = parseAppendedTimelineChunk(`${cached.remainder}${appended}`);
  const updated: TimelineCacheEntry = {
    mtimeMs: fileStat.mtimeMs,
    ctimeMs: fileStat.ctimeMs,
    size: fileStat.size,
    entries: cached.entries.concat(parsed.entries),
    remainder: parsed.remainder
  };
  timelineTailCache.set(timelinePath, updated);
  return updated;
}

export async function loadTimelineTailSnapshot(
  args: TimelineSnapshotArgs
): Promise<{ events: TimelineSnapshotEntry[]; nextCursor: number }> {
  try {
    const cacheEntry = await loadTimelineCacheEntry(args.timelinePath);
    return filterTimelineEntries(cacheEntry.entries, args);
  } catch {
    return {
      events: [],
      nextCursor: 0
    };
  }
}
