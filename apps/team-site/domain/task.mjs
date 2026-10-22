import { ACTIVE_RUN_STATUSES } from "./contracts.mjs";

export const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "cancelled", "deleted"]);

const TASK_STATUSES = new Set([
  "queued", "planning", "ready", "running", "pause_requested", "paused",
  "waiting_review", "cancel_requested", "completed", "failed", "cancelled", "deleted"
]);

const transitions = new Map([
  ["queued", new Set(["planning", "running", "cancelled", "deleted"])],
  ["planning", new Set(["queued", "ready", "running", "cancel_requested", "failed", "cancelled", "deleted"])],
  ["ready", new Set(["running", "pause_requested", "cancel_requested", "failed", "deleted"])],
  ["running", new Set(["pause_requested", "paused", "waiting_review", "queued", "completed", "failed", "cancel_requested", "cancelled", "deleted"])],
  ["pause_requested", new Set(["paused", "running", "cancel_requested", "failed", "cancelled", "deleted"])],
  ["paused", new Set(["planning", "ready", "running", "waiting_review", "queued", "completed", "cancelled", "failed", "deleted"])],
  ["waiting_review", new Set(["paused", "queued", "planning", "ready", "running", "waiting_review", "cancel_requested", "completed", "cancelled", "failed", "deleted"])],
  ["cancel_requested", new Set(["cancelled", "failed", "deleted"])],
  ["completed", new Set(["deleted"])],
  ["failed", new Set(["queued", "planning", "deleted"])],
  ["cancelled", new Set(["deleted"])],
  ["deleted", new Set()]
]);

export function canTransitionTask(from, to) {
  return TASK_STATUSES.has(from) && transitions.get(from)?.has(to) === true;
}

export function assertTaskTransition(from, to) {
  if (!canTransitionTask(from, to)) {
    throw new Error(`TASK_TRANSITION_INVALID: cannot transition Task from ${String(from)} to ${String(to)}.`);
  }
}

export function assertTaskExecutionSlot(project, taskId) {
  const active = (project?.taskRecords || []).find((item) => item.taskId !== taskId && !item.deletedAt && ACTIVE_RUN_STATUSES.has(item.status));
  if (active) throw new Error(`PROJECT_TASK_CONCURRENCY_LIMIT: task ${active.taskId} is currently ${active.status}; finish or cancel it before starting another task.`);
}

export function isTerminalTaskStatus(status) {
  return TERMINAL_TASK_STATUSES.has(status);
}
