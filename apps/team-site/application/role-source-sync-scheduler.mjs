export function createRoleSourceSyncScheduler({
  listSources,
  getSyncStatus,
  updateSyncStatus,
  synchronizeSource,
  refreshSourceIndex,
  now = () => new Date(),
  logger = console
}) {
  if (![listSources, getSyncStatus, updateSyncStatus, synchronizeSource, refreshSourceIndex].every((item) => typeof item === "function")) {
    throw new TypeError("Role source sync scheduler dependencies are required.");
  }
  const inFlight = new Map();

  function timestamp() {
    return now().toISOString();
  }

  async function execute(sourceId, operation) {
    if (inFlight.has(sourceId)) return { alreadyRunning: true };
    const task = (async () => {
      const sources = await listSources();
      const source = sources.find((item) => item.sourceId === sourceId);
      if (!source) throw new Error("NOT_FOUND");
      if (!source.enabled) throw new Error("ROLE_SOURCE_DISABLED");
      const previous = await getSyncStatus(sourceId) || {};
      const startedAt = timestamp();
      await updateSyncStatus(sourceId, {
        ...previous,
        state: "running",
        operation,
        startedAt,
        finishedAt: null,
        lastError: null
      });
      try {
        const index = operation === "reindex" ? await refreshSourceIndex(sourceId) : await synchronizeSource(sourceId);
        const finishedAt = timestamp();
        await updateSyncStatus(sourceId, {
          ...previous,
          state: "succeeded",
          operation,
          startedAt,
          finishedAt,
          lastSuccessAt: finishedAt,
          lastSuccessfulCommit: index.commit,
          lastError: null
        });
        return { index };
      } catch (error) {
        const finishedAt = timestamp();
        const detail = String(error?.detail || error?.message || error || "ROLE_SOURCE_SYNC_FAILED").slice(0, 1000);
        await updateSyncStatus(sourceId, {
          ...previous,
          state: "failed",
          operation,
          startedAt,
          finishedAt,
          lastError: detail
        });
        logger.error?.(`Role source ${sourceId} ${operation} failed: ${detail}`);
        return { error: detail };
      }
    })();
    inFlight.set(sourceId, task);
    try { return await task; }
    finally { inFlight.delete(sourceId); }
  }

  function enqueue(sourceId, operation = "sync") {
    if (operation !== "sync" && operation !== "reindex") throw new Error("ROLE_SOURCE_OPERATION_INVALID");
    if (inFlight.has(sourceId)) return { accepted: true, alreadyRunning: true };
    void execute(sourceId, operation).catch((error) => {
      logger.error?.(`Unable to start role source ${sourceId} ${operation}: ${String(error?.message || error)}`);
    });
    return { accepted: true, alreadyRunning: false };
  }

  async function recoverInterrupted() {
    const sources = await listSources();
    for (const source of sources) {
      const previous = await getSyncStatus(source.sourceId);
      if (previous?.state !== "running") continue;
      await updateSyncStatus(source.sourceId, {
        ...previous,
        state: "failed",
        finishedAt: timestamp(),
        lastError: "Background update was interrupted by a Team Site restart."
      });
    }
  }

  return Object.freeze({ enqueue, recoverInterrupted, isRunning: (sourceId) => inFlight.has(sourceId) });
}
