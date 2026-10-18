import { ACTIVE_RUN_STATUSES } from "./contracts.mjs";

export const TERMINAL_TASK_STATUSES = new Set(["completed", "failed", "cancelled", "deleted"]);

export function assertTaskExecutionSlot(project, taskId) {
  const active = (project?.taskRecords || []).find((item) => item.taskId !== taskId && !item.deletedAt && ACTIVE_RUN_STATUSES.has(item.status));
  if (active) throw new Error(`PROJECT_TASK_CONCURRENCY_LIMIT: task ${active.taskId} is currently ${active.status}; finish or cancel it before starting another task.`);
}

export function isTerminalTaskStatus(status) {
  return TERMINAL_TASK_STATUSES.has(status);
}
