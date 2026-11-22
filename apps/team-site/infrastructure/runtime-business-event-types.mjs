// Projection of the Workspace runtime-event registry used by Team Site Run views.
// Flow Business Event values (READY, APPROVED, and related Role-result labels) are
// defined separately by the Runtime Business Event contract. Model/tool notifications
// stay in raw runtime evidence and are not user-facing.
export const TEAM_RUN_EVENT_TYPES = new Set([
  "role.started", "role.input_ready", "role_waiting", "role_retry_scheduled", "flow.activated",
  "start_dispatch_selected", "route_decision", "loop_budget_decision", "failure_handled", "result_committed",
  "join_activated", "join_quorum_reached", "join_late_arrival_ignored",
  "join_timed_out", "join_source_outcome_rejected", "loop_exhausted",
  "human_review_requested", "human_review_approved", "human_review_rework_requested",
  "human_review_rejected", "human_review_decision_rejected",
  "human_review_paused", "human_review_terminated", "human_review_expired",
  "run_waiting", "run_stopping", "run_stopped", "run_terminated", "join_conflict", "workspace_integrated"
]);

export function isRuntimeBusinessEvent(event) {
  const eventType = event && typeof event === "object"
    ? (typeof event.type === "string" ? event.type : event.eventType)
    : undefined;
  return typeof eventType === "string" && TEAM_RUN_EVENT_TYPES.has(eventType);
}
