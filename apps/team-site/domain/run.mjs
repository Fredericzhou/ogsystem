import { ACTIVE_RUN_STATUSES, RUN_STATUSES, TERMINAL_RUN_STATUSES } from "./contracts.mjs";

const transitions = new Map([
  ["planning", new Set(["ready", "pause_requested", "cancel_requested", "failed"])],
  ["ready", new Set(["running", "pause_requested", "cancel_requested", "failed"])],
  ["running", new Set(["pause_requested", "waiting_review", "completed", "failed", "cancel_requested", "cancelled"])],
  ["pause_requested", new Set(["paused", "cancel_requested", "failed"])],
  ["paused", new Set(["running", "waiting_review", "cancelled", "failed"])],
  ["waiting_review", new Set(["paused", "cancelled", "failed"])],
  ["cancel_requested", new Set(["cancelled", "failed"])],
  ["completed", new Set()],
  ["failed", new Set()],
  ["cancelled", new Set()]
]);

export function canTransitionRun(from, to) {
  return RUN_STATUSES.includes(from) && transitions.get(from)?.has(to) === true;
}

export function assertRunTransition(from, to) {
  if (!canTransitionRun(from, to)) {
    throw new Error(`RUN_TRANSITION_INVALID: cannot transition Run from ${String(from)} to ${String(to)}.`);
  }
}

export function isActiveRunStatus(status) {
  return ACTIVE_RUN_STATUSES.has(status);
}

export function isTerminalRunStatus(status) {
  return TERMINAL_RUN_STATUSES.has(status);
}
