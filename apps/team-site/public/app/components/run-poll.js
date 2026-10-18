export const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.has(String(status || "").toLowerCase());
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

export function createRunPoller({
  projectId,
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
    const base = `/api/v1/projects/${encodeURIComponent(projectId)}/runs/${encodeURIComponent(runId)}`;
    try {
      const runResponse = await request(base, { signal: controller.signal });
      const run = await runResponse.json();
      if (stopped || pollVersion !== version || !isCurrent()) return;
      if (!runResponse.ok) throw new Error(run.error || "无法读取运行状态");
      const eventsResponse = await request(`${base}/events?limit=20`, { signal: controller.signal });
      const events = await eventsResponse.json();
      if (stopped || pollVersion !== version || !isCurrent()) return;
      if (!eventsResponse.ok) throw new Error(events.error || "无法读取运行事件");
      onUpdate({ run, events });
      if (!isTerminalRunStatus(run.state?.status || run.status)) timer = setTimeout(poll, intervalMs);
    } catch (error) {
      if (stopped || pollVersion !== version || !isCurrent() || isAbortError(error)) return;
      onError?.(error);
      timer = setTimeout(poll, intervalMs);
    } finally {
      if (activeController === controller) activeController = null;
    }
  };

  void poll();
  return stop;
}
