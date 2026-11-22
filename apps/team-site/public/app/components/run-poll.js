export const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.has(String(status || "").toLowerCase());
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

export function createRunPoller({
  projectId,
  taskId,
  runId,
  request,
  onUpdate,
  onError,
  isCurrent = () => true,
  intervalMs = 1000
}) {
  let stopped = false;
  let timer = null;
  let version = 0;
  let activeController = null;
  let eventCursor = 0;
  const collectedEvents = [];

  const stop = () => {
    stopped = true;
    version += 1;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    activeController?.abort();
    activeController = null;
  };

  const poll = async () => {
    if (stopped || !isCurrent()) return;
    const pollVersion = ++version;
    const controller = new AbortController();
    activeController = controller;
    const base = `/api/v2/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/runs/${encodeURIComponent(runId)}`;
    try {
      const runResponse = await request(base, { signal: controller.signal });
      const run = await runResponse.json();
      if (stopped || pollVersion !== version || !isCurrent()) return;
      if (!runResponse.ok) {
        const error = new Error(run.error || "无法读取运行状态");
        error.status = runResponse.status;
        throw error;
      }
      let hasFullPage;
      do {
        const eventsResponse = await request(`${base}/events?cursor=${eventCursor}&limit=1000`, { signal: controller.signal });
        const events = await eventsResponse.json();
        if (stopped || pollVersion !== version || !isCurrent()) return;
        if (!eventsResponse.ok) {
          const error = new Error(events.error || "无法读取运行事件");
          error.status = eventsResponse.status;
          throw error;
        }
        const pageEvents = Array.isArray(events.events) ? events.events : [];
        collectedEvents.push(...pageEvents);
        const nextCursor = Number(events.nextCursor);
        const lastEventCursor = Number(pageEvents.at(-1)?.cursor);
        eventCursor = Number.isSafeInteger(nextCursor) && nextCursor > eventCursor
          ? nextCursor
          : Number.isSafeInteger(lastEventCursor) ? lastEventCursor + 1 : eventCursor;
        hasFullPage = pageEvents.length === 1000;
      } while (hasFullPage);
      onUpdate({ run, events: { events: collectedEvents, nextCursor: eventCursor } });
      if (!isTerminalRunStatus(run.state?.status || run.status)) timer = setTimeout(poll, intervalMs);
    } catch (error) {
      if (stopped || pollVersion !== version || !isCurrent() || isAbortError(error)) return;
      onError?.(error);
      if (error?.status === 404) return;
      timer = setTimeout(poll, intervalMs);
    } finally {
      if (activeController === controller) activeController = null;
    }
  };

  void poll();
  return stop;
}
