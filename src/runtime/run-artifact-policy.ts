import type { RunArtifactPolicyEntry } from "./types.js";

const RUN_ARTIFACT_POLICY: RunArtifactPolicyEntry[] = [
  {
    path: "state.json",
    retention: "runtime_consumed",
    resumeConsumed: true,
    description: "Authoritative graph state snapshot. Resume consumes state.json.graphState."
  },
  {
    path: "sessions.json",
    retention: "runtime_consumed",
    resumeConsumed: true,
    description: "Run-level executor session index used for session reload and reuse."
  },
  {
    path: "plan-fingerprint.json",
    retention: "runtime_consumed",
    resumeConsumed: true,
    description: "Runtime-loaded compatibility fingerprint used to hard-fail unsafe resume."
  },
  {
    path: "checkpoints/<sequence>-<executionId>.json",
    retention: "runtime_consumed",
    resumeConsumed: true,
    description: "Write-ahead graph update checkpoints replayed during resume/recovery."
  },
  {
    path: "events.ndjson",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Append-only audit/event history."
  },
  {
    path: "run.md",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Human-readable run summary."
  },
  {
    path: "request.md",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Original user prompt snapshot."
  },
  {
    path: "system.mmd",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "System snapshot used for the run."
  },
  {
    path: "audit/summary.md",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Human-readable audit summary."
  },
  {
    path: "audit/transitions.md",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Human-readable transition log."
  },
  {
    path: "opencode-server.json",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Run-level OpenCode server metadata."
  },
  {
    path: "shared/",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Run-shared writable workspace."
  },
  {
    path: "roles/<roleId>/role.md",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Latest role identity and execution binding snapshot."
  },
  {
    path: "roles/<roleId>/execution.json",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Latest execution metadata snapshot."
  },
  {
    path: "roles/<roleId>/inbox.md",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Latest normalized runtime input projection."
  },
  {
    path: "roles/<roleId>/prompt.md",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Latest rendered prompt."
  },
  {
    path: "roles/<roleId>/result.json",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Latest structured role result."
  },
  {
    path: "roles/<roleId>/outbox.md",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Latest human-readable result projection."
  },
  {
    path: "roles/<roleId>/audit.json",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Latest audit payload for the role."
  },
  {
    path: "roles/<roleId>/latest-session.json",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Latest operator-facing session snapshot; runtime reload uses sessions.json."
  },
  {
    path: "roles/<roleId>/private/",
    retention: "operator_latest",
    resumeConsumed: false,
    description: "Role-private writable workspace."
  },
  {
    path: "roles/<roleId>/executions/<executionId>/...",
    retention: "history_only",
    resumeConsumed: false,
    description: "Per-execution immutable history snapshot."
  },
  {
    path: "roles/<roleId>/executions/<executionId>/execution-outcome.json",
    retention: "history_only",
    resumeConsumed: true,
    description: "Durable execution outcome marker used to reconcile missing checkpoints after crashes."
  }
];

export function listRunArtifactPolicy(): RunArtifactPolicyEntry[] {
  return RUN_ARTIFACT_POLICY.slice();
}
