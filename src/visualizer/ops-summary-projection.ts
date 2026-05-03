import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  inspectRun,
  loadIndexedRuns,
  loadPersistedRunsIndex,
  resolveRunDir
} from "../runtime/project-lifecycle.js";
import { inspectRunResumeReadiness } from "./data.js";

type JsonRecord = Record<string, unknown>;

type FailureEntry = {
  runId: string;
  runDir: string;
  at?: string;
  roleId: string;
  branchId?: string;
  errorCode: string;
  errorCategory: string;
  message?: string;
};

type GroupCount = {
  key: string;
  count: number;
};

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function extractGraphState(state: unknown): JsonRecord | undefined {
  const record = asRecord(state);
  return asRecord(record?.graphState) ?? record;
}

function classifyFailure(errorCode: string, explicitCategory?: string): string {
  if (explicitCategory) {
    return explicitCategory;
  }
  if (errorCode.includes("TIMEOUT")) {
    return "timeout";
  }
  if (errorCode.includes("CONTRACT")) {
    return "contract";
  }
  if (errorCode.includes("SCHEMA")) {
    return "schema";
  }
  if (errorCode.includes("PROVIDER") || errorCode.includes("MODEL")) {
    return "provider";
  }
  if (errorCode === "ROLE_EXECUTION_FAILED") {
    return "role_execution";
  }
  return "runtime";
}

function pushCount(map: Map<string, number>, key: string | undefined): void {
  const normalized = key || "unknown";
  map.set(normalized, (map.get(normalized) ?? 0) + 1);
}

function toGroupCounts(map: Map<string, number>): GroupCount[] {
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function dedupeFailures(failures: FailureEntry[]): FailureEntry[] {
  const seen = new Set<string>();
  const deduped: FailureEntry[] = [];
  for (const failure of failures) {
    const key = [
      failure.runId,
      failure.at ?? "",
      failure.roleId,
      failure.branchId ?? "",
      failure.errorCode
    ].join("\u0000");
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(failure);
  }
  return deduped;
}

function extractFailureFromAudit(runId: string, runDir: string, audit: unknown): FailureEntry | undefined {
  const record = asRecord(audit);
  if (!record) {
    return undefined;
  }
  const envelope = asRecord(record.errorEnvelope);
  const errorCode = asString(envelope?.errorCode) ?? asString(record.errorCode);
  const status = asString(record.status);
  if (!errorCode && status !== "failed") {
    return undefined;
  }
  const normalizedCode = errorCode ?? "ROLE_EXECUTION_FAILED";
  const category = classifyFailure(
    normalizedCode,
    asString(envelope?.errorCategory) ?? asString(record.errorCategory)
  );
  return {
    runId,
    runDir,
    at: asString(record.at),
    roleId: asString(record.roleId) ?? "unknown",
    branchId: asString(record.branchId) ?? asString(envelope?.branchId),
    errorCode: normalizedCode,
    errorCategory: category,
    message: asString(envelope?.message) ?? asString(record.error)
  };
}

async function extractFailuresFromRuntimeEvents(runId: string, runDir: string): Promise<FailureEntry[]> {
  const entries = [
    { path: resolve(runDir, "timeline.jsonl"), source: "timeline" },
    { path: resolve(runDir, "events.ndjson"), source: "events" }
  ];
  const failures: FailureEntry[] = [];
  for (const entry of entries) {
    const content = await readFile(entry.path, "utf8").catch(() => "");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      const record = asRecord(parsed);
      const nestedRecord = asRecord(record?.record);
      const eventRecord = nestedRecord ?? record;
      const type = asString(eventRecord?.type);
      const status = asString(eventRecord?.status);
      const failure = extractFailureFromAudit(runId, runDir, {
        ...eventRecord,
        status: status ?? (type === "runtime_error" ? "failed" : undefined)
      });
      if (failure) {
        failures.push(failure);
      }
    }
  }
  return failures;
}

function extractFailures(args: {
  runId: string;
  runDir: string;
  state: JsonRecord | undefined;
  summary: JsonRecord | undefined;
}): FailureEntry[] {
  const failures = Array.isArray(args.state?.recentAudits)
    ? args.state.recentAudits
        .map((audit) => extractFailureFromAudit(args.runId, args.runDir, audit))
        .filter((item): item is FailureEntry => Boolean(item))
    : [];
  if (failures.length > 0) {
    return failures;
  }
  const envelope = asRecord(args.state?.errorEnvelope);
  const status = asString(args.summary?.status) ?? asString(args.state?.status);
  const errorCode = asString(envelope?.errorCode) ?? asString(args.summary?.errorCode);
  if (status !== "failed" && !errorCode) {
    return [];
  }
  const normalizedCode = errorCode ?? "ROLE_EXECUTION_FAILED";
  return [
    {
      runId: args.runId,
      runDir: args.runDir,
      at: asString(args.summary?.updatedAt),
      roleId: asString(args.state?.lastExecutedRoleId) ?? asString(args.summary?.lastRoleId) ?? "unknown",
      branchId: asString(envelope?.branchId),
      errorCode: normalizedCode,
      errorCategory: classifyFailure(normalizedCode, asString(envelope?.errorCategory)),
      message: asString(envelope?.message) ?? asString(args.state?.error) ?? asString(args.summary?.error)
    }
  ];
}

function countPendingReviews(state: JsonRecord | undefined): {
  pending: number;
  paused: number;
  byRole: GroupCount[];
} {
  const byRole = new Map<string, number>();
  let pending = 0;
  let paused = 0;
  const reviews = asRecord(state?.pendingReviewsById) ?? {};
  for (const review of Object.values(reviews)) {
    const record = asRecord(review);
    const status = asString(record?.status);
    if (status !== "pending" && status !== "paused") {
      continue;
    }
    if (status === "paused") {
      paused += 1;
    } else {
      pending += 1;
    }
    pushCount(byRole, asString(record?.roleId));
  }
  return {
    pending,
    paused,
    byRole: toGroupCounts(byRole)
  };
}

function countReworkBranches(state: JsonRecord | undefined): {
  pending: number;
  byRole: GroupCount[];
} {
  const byRole = new Map<string, number>();
  let pending = 0;
  const branches = asRecord(state?.branchRecords) ?? {};
  for (const branch of Object.values(branches)) {
    const record = asRecord(branch);
    if (asString(record?.activatedByEvent) !== "REWORK") {
      continue;
    }
    if (asString(record?.status) !== "active") {
      continue;
    }
    pending += 1;
    pushCount(byRole, asString(record?.roleId));
  }
  return {
    pending,
    byRole: toGroupCounts(byRole)
  };
}

async function loadRecentRuns(workdir: string): Promise<JsonRecord[]> {
  const persisted = await loadPersistedRunsIndex(workdir);
  if (persisted) {
    return persisted.runs as JsonRecord[];
  }
  return (await loadIndexedRuns(workdir)) as JsonRecord[];
}

export async function inspectProjectOpsSummaryVisualization(
  workdir: string,
  options: { runLimit?: number; failureLimit?: number; readinessLimit?: number } = {}
): Promise<Record<string, unknown>> {
  const runLimit = options.runLimit ?? 25;
  const failureLimit = options.failureLimit ?? 10;
  const readinessLimit = options.readinessLimit ?? 10;
  const indexedRuns = (await loadRecentRuns(workdir)).slice(0, runLimit);
  const failures: FailureEntry[] = [];
  const failuresByRole = new Map<string, number>();
  const failuresByErrorCode = new Map<string, number>();
  const failuresByErrorCategory = new Map<string, number>();
  const reviewByRole = new Map<string, number>();
  const reworkByRole = new Map<string, number>();
  let pendingReviews = 0;
  let pausedReviews = 0;
  let pendingReworks = 0;
  let inspectedRuns = 0;
  let skippedRuns = 0;

  for (const indexedRun of indexedRuns) {
    const runId = asString(indexedRun.runId);
    if (!runId) {
      skippedRuns += 1;
      continue;
    }
    try {
      const detail = await inspectRun(workdir, runId);
      const runDir = asString(detail.runDir) ?? resolveRunDir(workdir, runId);
      const state = extractGraphState(detail.state);
      const summary = asRecord(detail.summary);
      const runFailures = dedupeFailures([
        ...extractFailures({ runId, runDir, state, summary }),
        ...(await extractFailuresFromRuntimeEvents(runId, runDir))
      ]);
      failures.push(...runFailures);
      for (const failure of runFailures) {
        pushCount(failuresByRole, failure.roleId);
        pushCount(failuresByErrorCode, failure.errorCode);
        pushCount(failuresByErrorCategory, failure.errorCategory);
      }
      const reviewCounts = countPendingReviews(state);
      pendingReviews += reviewCounts.pending;
      pausedReviews += reviewCounts.paused;
      for (const item of reviewCounts.byRole) {
        reviewByRole.set(item.key, (reviewByRole.get(item.key) ?? 0) + item.count);
      }
      const reworkCounts = countReworkBranches(state);
      pendingReworks += reworkCounts.pending;
      for (const item of reworkCounts.byRole) {
        reworkByRole.set(item.key, (reworkByRole.get(item.key) ?? 0) + item.count);
      }
      inspectedRuns += 1;
    } catch {
      skippedRuns += 1;
    }
  }

  const resumeBlockersByCategory = new Map<string, number>();
  const resumeDriftSources = new Map<string, number>();
  const resumeRuns: Record<string, unknown>[] = [];
  for (const indexedRun of indexedRuns.slice(0, readinessLimit)) {
    const runId = asString(indexedRun.runId);
    if (!runId) {
      continue;
    }
    try {
      const readiness = await inspectRunResumeReadiness(workdir, runId);
      const blockers = Array.isArray(readiness.blockers)
        ? readiness.blockers.map((item) => asRecord(item)).filter(Boolean)
        : [];
      const driftSources = Array.isArray(readiness.driftSources)
        ? readiness.driftSources.map((item) => asRecord(item)).filter(Boolean)
        : [];
      const blocking = blockers.filter((blocker) => asBoolean(blocker?.blocking) === true);
      for (const blocker of blocking) {
        pushCount(resumeBlockersByCategory, asString(blocker?.category) ?? asString(blocker?.id));
      }
      for (const drift of driftSources) {
        if (asBoolean(drift?.changed) === true) {
          pushCount(resumeDriftSources, asString(drift?.source));
        }
      }
      resumeRuns.push({
        runId,
        canResume: asBoolean(readiness.canResume) ?? false,
        status: asString(readiness.status) ?? "unknown",
        blockingCount: blocking.length,
        changedDriftSourceCount: driftSources.filter((drift) => asBoolean(drift?.changed) === true).length
      });
    } catch {
      resumeRuns.push({
        runId,
        canResume: false,
        status: "unavailable",
        blockingCount: 0,
        changedDriftSourceCount: 0
      });
    }
  }

  failures.sort((left, right) => String(right.at ?? "").localeCompare(String(left.at ?? "")));
  const blockedRuns = resumeRuns.filter((run) => asBoolean(run.canResume) === false).length;
  return {
    workdir,
    generatedAt: new Date().toISOString(),
    scope: {
      runLimit,
      failureLimit,
      readinessLimit,
      indexedRunCount: indexedRuns.length,
      inspectedRunCount: inspectedRuns,
      skippedRunCount: skippedRuns,
      strategy: "bounded-sequential-scan",
      runtimeEventSources: ["timeline.jsonl", "events.ndjson"]
    },
    recentFailures: failures.slice(0, failureLimit),
    failureGroups: {
      byRole: toGroupCounts(failuresByRole),
      byErrorCode: toGroupCounts(failuresByErrorCode),
      byErrorCategory: toGroupCounts(failuresByErrorCategory)
    },
    reviewRework: {
      pendingReviewCount: pendingReviews,
      pausedReviewCount: pausedReviews,
      pendingReworkCount: pendingReworks,
      pendingReviewByRole: toGroupCounts(reviewByRole),
      pendingReworkByRole: toGroupCounts(reworkByRole)
    },
    resumeReadiness: {
      inspectedRunCount: resumeRuns.length,
      blockedRunCount: blockedRuns,
      readyRunCount: resumeRuns.length - blockedRuns,
      blockingByCategory: toGroupCounts(resumeBlockersByCategory),
      driftSources: toGroupCounts(resumeDriftSources),
      runs: resumeRuns
    },
    summary: {
      recentFailureCount: failures.length,
      pendingReviewCount: pendingReviews + pausedReviews,
      pendingReworkCount: pendingReworks,
      resumeBlockedRunCount: blockedRuns
    }
  };
}
