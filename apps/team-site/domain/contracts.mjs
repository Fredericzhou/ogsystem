export const RUN_STATUSES = Object.freeze([
  "planning",
  "ready",
  "running",
  "pause_requested",
  "paused",
  "waiting_review",
  "completed",
  "failed",
  "cancel_requested",
  "cancelled"
]);

export const TERMINAL_RUN_STATUSES = new Set(["completed", "failed", "cancelled"]);
export const ACTIVE_RUN_STATUSES = new Set([
  "planning",
  "ready",
  "running",
  "pause_requested",
  "paused",
  "waiting_review",
  "cancel_requested"
]);

export function assertLatestProjectOverview(meta) {
  if (!meta || typeof meta.overview !== "string") {
    throw new Error("PROJECT_SCHEMA_UNSUPPORTED: project metadata must use overview.");
  }
}

export function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.has(status);
}
