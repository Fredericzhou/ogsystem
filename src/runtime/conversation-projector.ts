/**
 * Read-only conversation projection for Operate views.
 *
 * The event stream and state snapshot remain authoritative. This module only adapts their
 * operator-safe fields to the conversation contract; it never writes an artifact or produces a
 * value that can be used as a resume input.
 */
import { open, readFile, stat } from "node:fs/promises";

import { redactText } from "./redaction.js";
import type { RuntimeRedactionConfig } from "./types.js";

export type ConversationRouteChannel = "main" | "error" | "loop" | "join" | "feedback";

export type LayoutPresentationChannel =
  | "primary"
  | "normal"
  | "join"
  | "error"
  | "loop"
  | "backEdge";

export type ConversationRunStatus =
  | "running"
  | "stopping"
  | "waiting"
  | "done"
  | "failed"
  | "stopped"
  | "terminated";

export type ConversationItemStatus =
  | "unknown"
  | "ok"
  | "noop"
  | "failed"
  | "active"
  | "waiting"
  | "waiting_review"
  | "completed"
  | "pending"
  | "paused"
  | "resolved"
  | "expired"
  | "activated"
  | "timed_out"
  | "running"
  | "done"
  | "stopped"
  | "terminated";

export type ConversationSource =
  | { file: "events.ndjson"; cursor: number }
  | { file: "state.json"; snapshotVersion: number };

export type ConversationItem = {
  itemId: string;
  kind:
    | "role_message"
    | "route_decision"
    | "fan_out"
    | "join"
    | "loop_round"
    | "error_flow"
    | "human_review";
  roleId?: string;
  branchId?: string;
  lineageId?: string;
  loopIteration?: number;
  type?: string;
  event?: string;
  errorCode?: string;
  status: ConversationItemStatus;
  at: string;
  durationMs?: number;
  content?: { text: string; redacted: boolean; truncated: boolean };
  route?: {
    sourceRoleId?: string;
    targetRoleId?: string;
    channel: ConversationRouteChannel;
    presentationChannel: LayoutPresentationChannel;
    backEdge: boolean;
    condition?: string;
    outcome?: string;
  };
  join?: {
    joinRoleId: string;
    mode: "all_of" | "quorum_of";
    expected: string[];
    ready: string[];
    missing: string[];
    timedOut: boolean;
    finalAction?: string;
  };
  review?: {
    reviewId: string;
    reviewStatus: "pending" | "recorded" | "applied" | "expired";
    decision?: "approve" | "rework" | "pause" | "terminate";
  };
  source: ConversationSource;
};

export type ConversationFilters = {
  roleId?: string;
  branchId?: string;
  lineageId?: string;
  loopIteration?: number;
  event?: string;
  type?: string;
  reviewId?: string;
  errorCode?: string;
  status?: ConversationItemStatus;
  channel?: ConversationRouteChannel;
};

export type ConversationRunProjection = {
  version: 1;
  runId: string;
  systemId: string;
  status: ConversationRunStatus;
  cursor: { next: number; hasMore: boolean };
  items: ConversationItem[];
  filters: ConversationFilters;
};

export type ConversationSourceRecord = {
  file: "events.ndjson";
  cursor: number;
  record: unknown;
};

export type ConversationProjectionOptions = {
  runId: string;
  systemId?: string;
  status?: unknown;
  events?: readonly ConversationSourceRecord[] | readonly unknown[];
  stateSnapshot?: unknown;
  cursor?: { next?: number; hasMore?: boolean };
  /** Query cursor supplied by a read-only consumer; records before it are not projected. */
  startCursor?: number;
  /** Maximum number of filtered conversation items returned by the read-only query. */
  limit?: number;
  filters?: ConversationFilters;
  previous?: ConversationRunProjection;
  maxPreviewChars?: number;
  redaction?: RuntimeRedactionConfig;
};

export type ConversationProjectionDiagnostic = {
  source?: ConversationSource;
  code: "malformed_record" | "duplicate_record" | "unsupported_snapshot";
  message: string;
};

export type ConversationProjectionResult = {
  projection: ConversationRunProjection;
  diagnostics: ConversationProjectionDiagnostic[];
};

const DEFAULT_PREVIEW_CHARS = 800;
const KNOWN_ITEM_STATUSES = new Set<ConversationItemStatus>([
  "unknown", "ok", "noop", "failed", "active", "waiting", "waiting_review", "completed",
  "pending", "paused", "resolved", "expired", "activated", "timed_out", "running", "done",
  "stopped", "terminated"
]);
const ROUTE_CHANNELS = new Set<ConversationRouteChannel>(["main", "error", "loop", "join", "feedback"]);
const REVIEW_DECISIONS = new Set(["approve", "rework", "pause", "terminate"]);

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function integerValue(value: unknown): number | undefined {
  const number = numberValue(value);
  return number !== undefined && Number.isInteger(number) ? number : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function firstString(...values: unknown[]): string | undefined {
  return values.map(stringValue).find((value): value is string => value !== undefined);
}

function normalizeToken(value: unknown): string | undefined {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[ -]+/g, "_") : undefined;
}

/** Unknown and future status tokens intentionally become unknown. */
export function normalizeConversationItemStatus(value: unknown): ConversationItemStatus {
  const token = normalizeToken(value);
  return token && KNOWN_ITEM_STATUSES.has(token as ConversationItemStatus)
    ? token as ConversationItemStatus
    : "unknown";
}

export function normalizeConversationRunStatus(value: unknown): ConversationRunStatus | undefined {
  const token = normalizeToken(value);
  if (token === "running" || token === "stopping" || token === "waiting" || token === "done" ||
      token === "failed" || token === "stopped" || token === "terminated") {
    return token;
  }
  return undefined;
}

export function presentationChannelForRoute(
  channel: ConversationRouteChannel,
  backEdge = false
): LayoutPresentationChannel {
  if (backEdge) return "backEdge";
  if (channel === "main") return "primary";
  if (channel === "feedback") return "normal";
  return channel;
}

function inferChannel(value: RecordValue): ConversationRouteChannel {
  const nested = record(value.route);
  const explicit = firstString(value.channel, nested?.channel);
  if (explicit && ROUTE_CHANNELS.has(explicit as ConversationRouteChannel)) {
    return explicit as ConversationRouteChannel;
  }
  const event = (firstString(value.event, value.selectedEvent, value.type) ?? "").toUpperCase();
  if (event.includes("FEEDBACK")) return "feedback";
  if (event.startsWith("ERROR") || event.includes("FAILURE") || value.errorCode !== undefined || value.errorEnvelope !== undefined) {
    return "error";
  }
  if (event.includes("JOIN") || value.joinRoleId !== undefined || value.joinMode !== undefined || value.join !== undefined) {
    return "join";
  }
  if (event.includes("LOOP") || value.loopId !== undefined || value.loopReturn === true || value.backEdge === true) {
    return "loop";
  }
  return "main";
}

function buildRoute(value: RecordValue): ConversationItem["route"] | undefined {
  const nested = record(value.route);
  const sourceRoleId = firstString(nested?.sourceRoleId, nested?.fromRoleId, value.sourceRoleId, value.fromRoleId, value.from);
  const targetRoleId = firstString(nested?.targetRoleId, nested?.toRoleId, value.targetRoleId, value.toRoleId, value.nextRoleId, value.target);
  const condition = firstString(nested?.condition, nested?.conditionLabel, value.condition, value.conditionLabel);
  const outcome = firstString(nested?.outcome, nested?.evaluatedOutcome, value.outcome, value.evaluatedOutcome);
  const explicitBackEdge = booleanValue(nested?.backEdge) ?? booleanValue(value.backEdge) ??
    booleanValue(value.loopReturn) ?? false;
  const channel = inferChannel(value);
  if (!sourceRoleId && !targetRoleId && !condition && !outcome && !nested && value.channel === undefined && channel === "main") {
    return undefined;
  }
  const backEdge = channel === "loop" && explicitBackEdge;
  return {
    sourceRoleId,
    targetRoleId,
    channel,
    presentationChannel: presentationChannelForRoute(channel, backEdge),
    backEdge,
    condition,
    outcome
  };
}

function looksLikeRouteDecision(value: RecordValue, route: ConversationItem["route"] | undefined): boolean {
  const type = (firstString(value.type, value.event, value.selectedEvent) ?? "").toLowerCase();
  return type.includes("route") || type.includes("condition") || value.condition !== undefined ||
    value.conditionLabel !== undefined || (route?.condition !== undefined && route?.outcome !== undefined);
}

function itemKind(value: RecordValue, route: ConversationItem["route"] | undefined): ConversationItem["kind"] {
  const type = (firstString(value.type, value.event, value.selectedEvent) ?? "").toLowerCase();
  if (type.includes("review")) return "human_review";
  if (type.includes("join")) return "join";
  if (type.includes("fan_out") || type.includes("fanout") || type.includes("branch_activated")) return "fan_out";
  if (type.includes("loop")) return "loop_round";
  if (route?.channel === "error") return "error_flow";
  if (looksLikeRouteDecision(value, route)) return "route_decision";
  return "role_message";
}

function safeContent(value: unknown, options: ConversationProjectionOptions): ConversationItem["content"] | undefined {
  const source = typeof value === "string" ? value : value === undefined ? undefined : JSON.stringify(value);
  if (source === undefined) return undefined;
  const redacted = redactText(source, options.redaction);
  // Existing redaction handles credentials. This boundary also excludes local workspace paths
  // that may have been included by a generic executor or a future adapter.
  const pathSafe = redacted.replace(/(?:[A-Za-z]:[\\/]|\/(?:Users|home|private|workspace)[\\/])[^\s"'<>]+/gi, "[PRIVATE_PATH]");
  const wasRedacted = pathSafe !== source || /\[(?:REDACTED|redacted)\]/.test(pathSafe);
  const max = Math.max(1, Math.floor(options.maxPreviewChars ?? DEFAULT_PREVIEW_CHARS));
  const truncated = pathSafe.length > max;
  return {
    text: truncated ? `${pathSafe.slice(0, max)}...` : pathSafe,
    redacted: wasRedacted,
    truncated
  };
}

function contentFromRecord(value: RecordValue): unknown {
  if (Object.prototype.hasOwnProperty.call(value, "content")) return value.content;
  if (Object.prototype.hasOwnProperty.call(value, "stdoutPreview")) return value.stdoutPreview;
  if (Object.prototype.hasOwnProperty.call(value, "message")) return value.message;
  if (Object.prototype.hasOwnProperty.call(value, "error")) return value.error;
  return undefined;
}

function sourceKey(source: ConversationSource): string {
  return source.file === "state.json" ? `${source.file}:${source.snapshotVersion}` : `${source.file}:${source.cursor}`;
}

function itemId(runId: string, value: RecordValue, source: ConversationSource, kind: string): string {
  const explicit = firstString(value.itemId, value.eventId, value.id);
  if (explicit) return `${runId}:${source.file === "state.json" ? "snapshot" : "event"}:${explicit}`;
  return `${runId}:${kind}:${sourceKey(source)}`;
}

function reviewDecision(value: RecordValue): "approve" | "rework" | "pause" | "terminate" | undefined {
  const candidate = firstString(value.decision, value.reviewDecision);
  if (candidate && REVIEW_DECISIONS.has(candidate)) return candidate as "approve" | "rework" | "pause" | "terminate";
  const type = (firstString(value.type, value.event) ?? "").toLowerCase();
  if (type.includes("approved")) return "approve";
  if (type.includes("rework")) return "rework";
  if (type.includes("paused")) return "pause";
  if (type.includes("terminated")) return "terminate";
  return undefined;
}

function reviewStatus(value: RecordValue): "pending" | "recorded" | "applied" | "expired" {
  const explicit = firstString(value.reviewStatus);
  if (explicit === "pending" || explicit === "recorded" || explicit === "applied" || explicit === "expired") return explicit;
  const status = normalizeToken(value.status);
  if (status === "expired") return "expired";
  if (value.reconciledAt !== undefined || value.appliedAt !== undefined || value.applied === true || value.reconciled === true) return "applied";
  if (reviewDecision(value) || status === "recorded" || status === "resolved") return "recorded";
  return "pending";
}

function buildReview(value: RecordValue): ConversationItem["review"] | undefined {
  const reviewId = firstString(value.reviewId);
  if (!reviewId) return undefined;
  const decision = reviewDecision(value);
  return { reviewId, reviewStatus: reviewStatus(value), ...(decision ? { decision } : {}) };
}

function buildItem(args: {
  runId: string;
  value: RecordValue;
  source: ConversationSource;
  options: ConversationProjectionOptions;
}): ConversationItem | undefined {
  if (args.source.file !== "state.json" && (!stringValue(args.value.type) || !firstString(args.value.at, args.value.timestamp))) {
    return undefined;
  }
  const at = firstString(args.value.at, args.value.timestamp, args.value.requestedAt, args.value.decidedAt) ?? "unknown";
  const route = buildRoute(args.value);
  const kind = itemKind(args.value, route);
  const roleId = firstString(args.value.roleId, args.value.joinRoleId);
  const type = firstString(args.value.type) ?? "";
  const rawStatus = args.value.status ??
    (kind === "join" && (type.includes("activated") || type.includes("quorum_reached")) ? "activated" : undefined) ??
    (kind === "join" && type.includes("timed_out") ? "timed_out" : undefined) ??
    (kind === "human_review" && type.includes("requested") ? "pending" : undefined) ??
    (kind === "human_review" && (type.includes("approved") || type.includes("rework") || type.includes("terminated")) ? "resolved" : undefined) ??
    (kind === "human_review" && type.includes("paused") ? "paused" : undefined);
  const status = normalizeConversationItemStatus(rawStatus);
  const result: ConversationItem = {
    itemId: itemId(args.runId, args.value, args.source, kind),
    kind,
    ...(roleId ? { roleId } : {}),
    ...(firstString(args.value.branchId) ? { branchId: firstString(args.value.branchId) } : {}),
    ...(firstString(args.value.lineageId) ? { lineageId: firstString(args.value.lineageId) } : {}),
    ...(integerValue(args.value.loopIteration) !== undefined ? { loopIteration: integerValue(args.value.loopIteration) } : {}),
    ...(type ? { type } : {}),
    ...(firstString(args.value.event, args.value.selectedEvent) ? { event: firstString(args.value.event, args.value.selectedEvent) } : {}),
    ...(firstString(args.value.errorCode, record(args.value.errorEnvelope)?.errorCode) ? { errorCode: firstString(args.value.errorCode, record(args.value.errorEnvelope)?.errorCode) } : {}),
    status,
    at,
    ...(numberValue(args.value.durationMs) !== undefined ? { durationMs: numberValue(args.value.durationMs) } : {}),
    ...(route ? { route } : {}),
    source: args.source
  };
  const review = kind === "human_review" ? buildReview(args.value) : undefined;
  if (kind === "human_review" && !review) return undefined;
  if (review) result.review = review;
  if (kind === "join") {
    const joinRoleId = firstString(args.value.joinRoleId, args.value.roleId);
    if (!joinRoleId) return undefined;
    const expected = stringArray(args.value.expectedSources ?? args.value.expected ?? args.value.joinSources);
    const ready = stringArray(args.value.readySources ?? args.value.ready ?? args.value.satisfiedSources);
    const explicitMissing = stringArray(args.value.missingSources ?? args.value.missing);
    const missing = explicitMissing.length > 0
      ? explicitMissing
      : expected.filter((sourceRoleId) => !ready.includes(sourceRoleId));
    const modeValue = firstString(args.value.joinMode, args.value.mode);
    const mode = modeValue === "quorum_of" ? "quorum_of" : "all_of";
    const timedOut = args.value.timedOut === true || normalizeToken(args.value.status) === "timed_out" ||
      (firstString(args.value.type) ?? "").includes("timed_out");
    result.join = {
      joinRoleId,
      mode,
      expected,
      ready,
      missing,
      timedOut,
      ...(firstString(args.value.finalAction, args.value.action) ? { finalAction: firstString(args.value.finalAction, args.value.action) } : {})
    };
  }
  const content = safeContent(contentFromRecord(args.value), args.options);
  if (content) result.content = content;
  return result;
}

function normalizeSourceRecords(
  values: readonly ConversationSourceRecord[] | readonly unknown[] | undefined,
  diagnostics: ConversationProjectionDiagnostic[]
): ConversationSourceRecord[] {
  if (!values) return [];
  return values.flatMap((entry, index) => {
    const wrapper = record(entry);
    const isWrapper = wrapper && Object.prototype.hasOwnProperty.call(wrapper, "record") && numberValue(wrapper.cursor) !== undefined;
    const maybeRecord = isWrapper ? wrapper.record : entry;
    const sourceCursor = isWrapper ? wrapper.cursor : index;
    const cursor = integerValue(sourceCursor);
    const parsed = record(maybeRecord);
    if (cursor === undefined || !parsed) {
      diagnostics.push({ code: "malformed_record", message: `events.ndjson record ${index} has no numeric cursor or object payload.` });
      return [];
    }
    return [{ file: "events.ndjson", cursor, record: parsed }];
  });
}

function mergeSourceRecords(
  events: ConversationSourceRecord[],
  diagnostics: ConversationProjectionDiagnostic[]
): ConversationSourceRecord[] {
  const byCursor = new Map<number, ConversationSourceRecord>();
  for (const entry of events) {
    const existing = byCursor.get(entry.cursor);
    if (existing) {
      // Raw events carry content and full transition metadata; preserve that richer locator when
      // both current projections agree on a cursor.
      byCursor.set(entry.cursor, entry);
      diagnostics.push({ code: "duplicate_record", source: { file: entry.file, cursor: entry.cursor }, message: `Duplicate source cursor ${entry.cursor} was de-duplicated.` });
    } else {
      byCursor.set(entry.cursor, entry);
    }
  }
  return [...byCursor.values()].sort((left, right) => left.cursor - right.cursor);
}

function snapshotRecord(value: unknown): RecordValue | undefined {
  const root = record(value);
  if (!root) return undefined;
  const nested = record(root.graphState) ?? record(root.state);
  return nested ? { ...root, ...nested } : root;
}

function snapshotVersion(value: RecordValue): number | undefined {
  return integerValue(value.stateVersion);
}

function snapshotItems(args: {
  runId: string;
  snapshot: unknown;
  options: ConversationProjectionOptions;
  diagnostics: ConversationProjectionDiagnostic[];
}): ConversationItem[] {
  const root = record(args.snapshot);
  const value = snapshotRecord(args.snapshot);
  const version = value && snapshotVersion(value);
  if (!value || version === undefined) {
    if (root) args.diagnostics.push({ code: "unsupported_snapshot", message: "state.json snapshot has no integer stateVersion." });
    return [];
  }
  const source: ConversationSource = { file: "state.json", snapshotVersion: version };
  const items: ConversationItem[] = [];
  const at = firstString(value.at, value.updatedAt, value.projectionUpdatedAt) ?? "unknown";
  const branchRecords = record(value.branchRecords) ?? {};
  const roleResults = record(value.roleResults) ?? {};
  for (const [branchKey, rawResult] of Object.entries(roleResults)) {
    const result = record(rawResult);
    if (!result) continue;
    const branch = record(branchRecords[firstString(result.branchId) ?? branchKey]);
    const itemValue: RecordValue = {
      ...result,
      itemId: `role:${firstString(result.branchId, branch?.branchId, branchKey) ?? branchKey}`,
      at,
      status: "completed",
      branchId: firstString(result.branchId, branch?.branchId, branchKey),
      lineageId: firstString(result.lineageId, branch?.lineageId),
      loopIteration: integerValue(result.loopIteration) ?? integerValue(branch?.loopIteration),
      type: integerValue(result.loopIteration) !== undefined && integerValue(result.loopIteration)! > 0 ? "loop_round" : "role_message"
    };
    const item = buildItem({ runId: args.runId, value: itemValue, source, options: args.options });
    if (item) items.push(item);
  }
  const joinScopes = record(value.joinScopes) ?? {};
  for (const scope of Object.values(joinScopes)) {
    const join = record(scope);
    if (!join) continue;
    const itemValue: RecordValue = {
      ...join,
      itemId: `join:${firstString(join.joinId, join.joinRoleId, join.roleId) ?? "unknown"}`,
      type: "join",
      at: firstString(join.completedAt, join.startedAt, at) ?? at,
      roleId: firstString(join.joinRoleId, join.roleId),
      expectedSources: join.expectedSourceRoleIds,
      readySources: join.readySourceRoleIds,
      missingSources: join.missingSourceRoleIds,
      status: join.status,
      timedOut: join.status === "timed_out",
      finalAction: join.timeoutAction
    };
    const item = buildItem({ runId: args.runId, value: itemValue, source, options: args.options });
    if (item) items.push(item);
  }
  const pendingReviews = record(value.pendingReviewsById) ?? {};
  const histories = record(value.reviewHistoryByBranchId) ?? {};
  const reviewValues = new Map<string, RecordValue>();
  for (const rawReview of Object.values(pendingReviews)) {
    const review = record(rawReview);
    const id = review && firstString(review.reviewId);
    if (review && id) reviewValues.set(id, { ...review });
  }
  for (const rawHistory of Object.values(histories)) {
    if (!Array.isArray(rawHistory)) continue;
    for (const rawDecision of rawHistory) {
      const decision = record(rawDecision);
      const id = decision && firstString(decision.reviewId);
      if (!decision || !id) continue;
      reviewValues.set(id, { ...(reviewValues.get(id) ?? {}), ...decision, reviewId: id });
    }
  }
  for (const review of reviewValues.values()) {
    const draftResult = record(review.draftResult);
    const itemValue: RecordValue = {
      ...review,
      itemId: `review:${firstString(review.reviewId)}`,
      type: "human_review",
      at: firstString(review.at, review.decidedAt, review.requestedAt, at) ?? at,
      ...(draftResult?.content !== undefined ? { content: draftResult.content } : {})
    };
    const item = buildItem({ runId: args.runId, value: itemValue, source, options: args.options });
    if (item) items.push(item);
  }
  return items;
}

function filterItems(items: ConversationItem[], filters: ConversationFilters): ConversationItem[] {
  return items.filter((item) =>
    (!filters.roleId || item.roleId === filters.roleId) &&
    (!filters.branchId || item.branchId === filters.branchId) &&
    (!filters.lineageId || item.lineageId === filters.lineageId) &&
    (filters.loopIteration === undefined || item.loopIteration === filters.loopIteration) &&
    (!filters.event || item.event === filters.event) &&
    (!filters.type || item.type === filters.type) &&
    (!filters.reviewId || item.review?.reviewId === filters.reviewId) &&
    (!filters.errorCode || item.errorCode === filters.errorCode) &&
    (!filters.status || item.status === filters.status) &&
    (!filters.channel || item.route?.channel === filters.channel || (!item.route && filters.channel === "main"))
  );
}

function derivedRunStatus(options: ConversationProjectionOptions, items: ConversationItem[], snapshot: RecordValue | undefined): ConversationRunStatus {
  const direct = normalizeConversationRunStatus(options.status) ?? normalizeConversationRunStatus(snapshot?.status);
  const waiting = items.some((item) => item.status === "waiting" || item.status === "waiting_review" || item.review?.reviewStatus === "pending");
  if (waiting && (direct === "running" || direct === "stopped")) return "waiting";
  return direct ?? (waiting ? "waiting" : "running");
}

export function projectConversationRunWithDiagnostics(options: ConversationProjectionOptions): ConversationProjectionResult {
  const diagnostics: ConversationProjectionDiagnostic[] = [];
  const events = normalizeSourceRecords(options.events, diagnostics);
  const allSourceRecords = mergeSourceRecords(events, diagnostics);
  const startCursor = Math.max(0, integerValue(options.startCursor) ?? 0);
  const sourceRecords = allSourceRecords.filter((entry) => entry.cursor >= startCursor);
  const items = sourceRecords.flatMap((entry) => {
    const source: ConversationSource = { file: entry.file, cursor: entry.cursor };
    const item = buildItem({ runId: options.runId, value: entry.record as RecordValue, source, options });
    if (!item) diagnostics.push({ code: "malformed_record", source, message: "Source record could not be projected." });
    return item ? [item] : [];
  });
  const snapshot = options.stateSnapshot;
  const snapshotValue = snapshotRecord(snapshot);
  // Snapshot observations are anchored to state.json rather than the event cursor. Keep them in
  // every page's candidate set so a stream page cannot advance past the only snapshot source.
  items.push(...snapshotItems({ runId: options.runId, snapshot, options, diagnostics }));

  const previous = options.previous;
  const seen = new Set<string>();
  const merged = [...(previous?.items ?? []), ...items].filter((item) => {
    if (seen.has(item.itemId)) return false;
    seen.add(item.itemId);
    return true;
  });
  const acknowledged = previous?.cursor.next ?? 0;
  const incremental = previous ? merged.filter((item) => {
    if (item.source.file === "state.json") return true;
    return item.source.cursor >= acknowledged || previous.items.some((old) => old.itemId === item.itemId);
  }) : merged;
  const filters = options.filters ?? previous?.filters ?? {};
  const nextFromSources = allSourceRecords.reduce((next, entry) => Math.max(next, entry.cursor + 1), 0);
  const next = Math.max(previous?.cursor.next ?? 0, options.cursor?.next ?? 0, nextFromSources);
  const projectedItems = filterItems(incremental.sort((left, right) => {
    const leftCursor = left.source.file === "state.json" ? Number.MAX_SAFE_INTEGER : left.source.cursor;
    const rightCursor = right.source.file === "state.json" ? Number.MAX_SAFE_INTEGER : right.source.cursor;
    if (left.source.file === "state.json" && right.source.file === "state.json") {
      return left.source.snapshotVersion - right.source.snapshotVersion || left.itemId.localeCompare(right.itemId);
    }
    if (left.source.file === "state.json") return -1;
    if (right.source.file === "state.json") return 1;
    return leftCursor - rightCursor || left.itemId.localeCompare(right.itemId);
  }), filters);
  const limit = options.limit === undefined || !Number.isFinite(options.limit)
    ? undefined
    : Math.max(1, Math.floor(options.limit));
  const pageItems = limit === undefined ? projectedItems : projectedItems.slice(0, limit);
  const hasMore = limit !== undefined && projectedItems.length > limit;
  const lastPageStreamCursor = pageItems
    .map((item) => item.source.file === "state.json" ? -1 : item.source.cursor)
    .filter((cursor) => cursor >= 0)
    .at(-1);
  const pageNext = hasMore && lastPageStreamCursor !== undefined
    ? lastPageStreamCursor + 1
    : next;
  return {
    projection: {
      version: 1,
      runId: options.runId,
      systemId: options.systemId ?? firstString(snapshotValue?.systemId, record(snapshotValue?.system)?.id) ?? "",
      status: derivedRunStatus(options, incremental, snapshotValue),
      cursor: { next: pageNext, hasMore: options.cursor?.hasMore ?? hasMore },
      items: pageItems,
      filters
    },
    diagnostics
  };
}

export function projectConversationRun(options: ConversationProjectionOptions): ConversationRunProjection {
  return projectConversationRunWithDiagnostics(options).projection;
}

function parseJsonLines(content: string, diagnostics: ConversationProjectionDiagnostic[], startCursor = 0): { records: ConversationSourceRecord[]; pending: string } {
  const lines = content.split(/\r?\n/);
  const trailingLine = /\r?\n$/.test(content) ? undefined : lines.pop();
  let cursor = startCursor;
  const records = lines.flatMap((line, lineNumber) => {
    if (!line.trim()) return [];
    try {
      const entry = { file: "events.ndjson" as const, cursor, record: JSON.parse(line) };
      cursor += 1;
      return [entry];
    } catch {
      diagnostics.push({ code: "malformed_record", message: `Malformed JSON at events.ndjson:${lineNumber}.` });
      return [];
    }
  });
  let pending = "";
  if (trailingLine?.trim()) {
    try {
      records.push({ file: "events.ndjson", cursor, record: JSON.parse(trailingLine) });
      cursor += 1;
    } catch {
      // Keep an unterminated or partially-written final line for the next append.
      pending = trailingLine;
    }
  }
  return { records, pending };
}

const eventCache = new Map<string, {
  byteLength: number;
  modifiedAtMs: number;
  records: ConversationSourceRecord[];
  pending: string;
}>();

async function loadEventRecords(path: string, diagnostics: ConversationProjectionDiagnostic[]): Promise<ConversationSourceRecord[]> {
  const cached = eventCache.get(path);
  const fileStats = await stat(path).catch(() => undefined);
  if (!fileStats) return [];
  const byteLength = fileStats.size;
  const modifiedAtMs = fileStats.mtimeMs;
  if (cached && byteLength === cached.byteLength && modifiedAtMs === cached.modifiedAtMs) {
    return cached.records;
  }
  if (cached && byteLength > cached.byteLength) {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(byteLength - cached.byteLength);
      await handle.read(buffer, 0, buffer.length, cached.byteLength);
      const parsed = parseJsonLines(cached.pending + buffer.toString("utf8"), diagnostics, cached.records.length);
      const records = [...cached.records, ...parsed.records];
      eventCache.set(path, { byteLength, modifiedAtMs, records, pending: parsed.pending });
      return records;
    } finally {
      await handle.close();
    }
  }
  const text = await readFile(path, "utf8");
  const parsed = parseJsonLines(text, diagnostics);
  eventCache.set(path, { byteLength, modifiedAtMs, records: parsed.records, pending: parsed.pending });
  return parsed.records;
}

export async function loadConversationRunProjectionWithDiagnostics(args: {
  runId: string;
  systemId?: string;
  eventsPath?: string;
  statePath?: string;
  cursor?: { next?: number; hasMore?: boolean };
  startCursor?: number;
  limit?: number;
  filters?: ConversationFilters;
  previous?: ConversationRunProjection;
  maxPreviewChars?: number;
  redaction?: RuntimeRedactionConfig;
}): Promise<ConversationProjectionResult> {
  const diagnostics: ConversationProjectionDiagnostic[] = [];
  const [events, stateText] = await Promise.all([
    args.eventsPath ? loadEventRecords(args.eventsPath, diagnostics) : Promise.resolve([]),
    args.statePath ? readFile(args.statePath, "utf8").catch(() => "") : Promise.resolve("")
  ]);
  const stateSnapshot = stateText ? (() => {
    try { return JSON.parse(stateText); } catch { diagnostics.push({ code: "unsupported_snapshot", message: "state.json is not valid JSON." }); return undefined; }
  })() : undefined;
  const result = projectConversationRunWithDiagnostics({
    ...args,
    events,
    stateSnapshot
  });
  return {
    projection: result.projection,
    diagnostics: [...diagnostics, ...result.diagnostics]
  };
}

export async function loadConversationRunProjection(args: {
  runId: string;
  systemId?: string;
  eventsPath?: string;
  statePath?: string;
  cursor?: { next?: number; hasMore?: boolean };
  startCursor?: number;
  limit?: number;
  filters?: ConversationFilters;
  previous?: ConversationRunProjection;
  maxPreviewChars?: number;
  redaction?: RuntimeRedactionConfig;
}): Promise<ConversationRunProjection> {
  return (await loadConversationRunProjectionWithDiagnostics(args)).projection;
}
