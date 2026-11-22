/** Single source for the append-only Runtime events in the Workspace contract. */
export const WORKSPACE_EVENT_TYPES = [
  "role.started", "role.input_ready", "role_waiting", "role_retry_scheduled", "flow.activated",
  "start_dispatch_selected", "route_decision", "loop_budget_decision", "failure_handled",
  "join_activated", "join_quorum_reached", "join_late_arrival_ignored", "join_timed_out",
  "join_source_outcome_rejected", "loop_exhausted", "human_review_requested", "human_review_approved",
  "human_review_rework_requested", "human_review_rejected", "human_review_decision_rejected",
  "human_review_paused", "human_review_terminated", "human_review_expired", "run_waiting",
  "run_stopping", "run_stopped", "run_terminated", "result_committed", "join_conflict",
  "workspace_integrated"
] as const;

export type WorkspaceEventType = (typeof WORKSPACE_EVENT_TYPES)[number];
