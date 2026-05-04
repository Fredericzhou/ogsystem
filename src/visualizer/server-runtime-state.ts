export type ProjectCreateRequestCacheEntry = {
  cachedAtMs: number;
  payload?: Record<string, unknown>;
  promise?: Promise<Record<string, unknown>>;
};

export type ProjectCreateRequestCacheState = {
  projectCreateRequests: Map<string, ProjectCreateRequestCacheEntry>;
  projectCreateRequestCacheTtlMs: number;
  projectCreateRequestCacheMaxSize: number;
};

export type RunsListCacheEntry = {
  generatedAt: string;
  runs: unknown[];
  indexMtimeMs?: number;
  cachedAtMs: number;
  lastAccessedAtMs: number;
};

type VisualizerSseMetrics = {
  activeConnections: number;
  openedTotal: number;
  closedTotal: number;
  ticksTotal: number;
  snapshotsTotal: number;
  snapshotErrorsTotal: number;
  writesTotal: number;
  activeByRunId: Map<string, number>;
};

const RUNS_LIST_CACHE_TTL_MS = 10 * 60 * 1000;
const RUNS_LIST_CACHE_MAX_SIZE = 64;

const runsListCache = new Map<string, RunsListCacheEntry>();
const visualizerSseMetrics: VisualizerSseMetrics = {
  activeConnections: 0,
  openedTotal: 0,
  closedTotal: 0,
  ticksTotal: 0,
  snapshotsTotal: 0,
  snapshotErrorsTotal: 0,
  writesTotal: 0,
  activeByRunId: new Map()
};

function pruneProjectCreateRequestCache(
  state: ProjectCreateRequestCacheState,
  nowMs = Date.now()
): void {
  for (const [requestId, entry] of state.projectCreateRequests.entries()) {
    if (nowMs - entry.cachedAtMs > state.projectCreateRequestCacheTtlMs) {
      state.projectCreateRequests.delete(requestId);
    }
  }
  while (state.projectCreateRequests.size > state.projectCreateRequestCacheMaxSize) {
    const oldestRequestId = state.projectCreateRequests.keys().next().value;
    if (!oldestRequestId) {
      break;
    }
    state.projectCreateRequests.delete(oldestRequestId);
  }
}

function pruneRunsListCache(nowMs = Date.now()): void {
  for (const [workdir, entry] of runsListCache.entries()) {
    if (nowMs - entry.cachedAtMs > RUNS_LIST_CACHE_TTL_MS) {
      runsListCache.delete(workdir);
    }
  }
  while (runsListCache.size > RUNS_LIST_CACHE_MAX_SIZE) {
    let oldestWorkdir: string | undefined;
    let oldestAccessedAtMs = Number.POSITIVE_INFINITY;
    for (const [workdir, entry] of runsListCache.entries()) {
      if (entry.lastAccessedAtMs < oldestAccessedAtMs) {
        oldestWorkdir = workdir;
        oldestAccessedAtMs = entry.lastAccessedAtMs;
      }
    }
    if (!oldestWorkdir) {
      break;
    }
    runsListCache.delete(oldestWorkdir);
  }
}

export function readCachedProjectCreateResponse(
  state: ProjectCreateRequestCacheState,
  requestId: string,
  nowMs = Date.now()
): Record<string, unknown> | undefined {
  pruneProjectCreateRequestCache(state, nowMs);
  const cached = state.projectCreateRequests.get(requestId);
  return cached?.payload;
}

export function readPendingProjectCreateResponse(
  state: ProjectCreateRequestCacheState,
  requestId: string,
  nowMs = Date.now()
): Promise<Record<string, unknown>> | undefined {
  pruneProjectCreateRequestCache(state, nowMs);
  const cached = state.projectCreateRequests.get(requestId);
  return cached?.promise;
}

export function cacheProjectCreateResponse(
  state: ProjectCreateRequestCacheState,
  requestId: string,
  payload: Record<string, unknown>,
  nowMs = Date.now()
): void {
  pruneProjectCreateRequestCache(state, nowMs);
  state.projectCreateRequests.delete(requestId);
  state.projectCreateRequests.set(requestId, {
    cachedAtMs: nowMs,
    payload
  });
  pruneProjectCreateRequestCache(state, nowMs);
}

export function cachePendingProjectCreateResponse(
  state: ProjectCreateRequestCacheState,
  requestId: string,
  promise: Promise<Record<string, unknown>>,
  nowMs = Date.now()
): void {
  pruneProjectCreateRequestCache(state, nowMs);
  state.projectCreateRequests.delete(requestId);
  state.projectCreateRequests.set(requestId, {
    cachedAtMs: nowMs,
    promise
  });
  pruneProjectCreateRequestCache(state, nowMs);
}

export function clearPendingProjectCreateResponse(
  state: ProjectCreateRequestCacheState,
  requestId: string
): void {
  const cached = state.projectCreateRequests.get(requestId);
  if (cached?.promise) {
    state.projectCreateRequests.delete(requestId);
  }
}

export function createRunsListCacheEntry(args: {
  generatedAt: string;
  runs: unknown[];
  indexMtimeMs?: number;
}): RunsListCacheEntry {
  const nowMs = Date.now();
  return {
    generatedAt: args.generatedAt,
    runs: args.runs,
    indexMtimeMs: args.indexMtimeMs,
    cachedAtMs: nowMs,
    lastAccessedAtMs: nowMs
  };
}

export function readRunsListCache(workdir: string, indexMtimeMs?: number): RunsListCacheEntry | undefined {
  pruneRunsListCache();
  const cached = runsListCache.get(workdir);
  if (!cached) {
    return undefined;
  }
  const matchesIndex =
    (indexMtimeMs === undefined && cached.indexMtimeMs === undefined) ||
    (indexMtimeMs !== undefined && cached.indexMtimeMs === indexMtimeMs);
  if (!matchesIndex) {
    return undefined;
  }
  cached.lastAccessedAtMs = Date.now();
  return cached;
}

export function readFallbackRunsListCache(workdir: string): RunsListCacheEntry | undefined {
  pruneRunsListCache();
  const cached = runsListCache.get(workdir);
  if (!cached) {
    return undefined;
  }
  cached.lastAccessedAtMs = Date.now();
  return cached;
}

export function writeRunsListCache(workdir: string, entry: RunsListCacheEntry): void {
  runsListCache.set(workdir, entry);
  pruneRunsListCache();
}

export function clearRunsListCache(workdir: string): void {
  runsListCache.delete(workdir);
}

export function getRunsListCacheStats(): Record<string, unknown> {
  pruneRunsListCache();
  return {
    size: runsListCache.size,
    maxSize: RUNS_LIST_CACHE_MAX_SIZE,
    ttlMs: RUNS_LIST_CACHE_TTL_MS
  };
}

export function recordSseConnectionOpened(runId: string): void {
  visualizerSseMetrics.activeConnections += 1;
  visualizerSseMetrics.openedTotal += 1;
  visualizerSseMetrics.activeByRunId.set(runId, (visualizerSseMetrics.activeByRunId.get(runId) ?? 0) + 1);
}

export function recordSseSnapshotAttempt(): void {
  visualizerSseMetrics.snapshotsTotal += 1;
}

export function recordSseWrite(): void {
  visualizerSseMetrics.writesTotal += 1;
}

export function recordSseSnapshotError(): void {
  visualizerSseMetrics.snapshotErrorsTotal += 1;
}

export function recordSseTick(): void {
  visualizerSseMetrics.ticksTotal += 1;
}

export function recordSseConnectionClosed(runId: string): void {
  visualizerSseMetrics.activeConnections = Math.max(0, visualizerSseMetrics.activeConnections - 1);
  visualizerSseMetrics.closedTotal += 1;
  const activeForRun = (visualizerSseMetrics.activeByRunId.get(runId) ?? 1) - 1;
  if (activeForRun > 0) {
    visualizerSseMetrics.activeByRunId.set(runId, activeForRun);
  } else {
    visualizerSseMetrics.activeByRunId.delete(runId);
  }
}

export function getVisualizerSseMetricsSnapshot(): Record<string, unknown> {
  return {
    activeConnections: visualizerSseMetrics.activeConnections,
    openedTotal: visualizerSseMetrics.openedTotal,
    closedTotal: visualizerSseMetrics.closedTotal,
    ticksTotal: visualizerSseMetrics.ticksTotal,
    snapshotsTotal: visualizerSseMetrics.snapshotsTotal,
    snapshotErrorsTotal: visualizerSseMetrics.snapshotErrorsTotal,
    writesTotal: visualizerSseMetrics.writesTotal,
    activeByRunId: Object.fromEntries(visualizerSseMetrics.activeByRunId.entries())
  };
}
