import { readFile } from "node:fs/promises";

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

  const records = parseJsonLines(content)
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
    .filter((entry): entry is { cursor: number; record: TimelineProjectionRecord } => entry !== undefined);

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
      return true;
    })
    .slice(0, limit);

  return {
    events,
    nextCursor: records.length
  };
}
