/** Runtime checkpoint persistence port. */
import {
  loadCommittedRoleExecutionOutcomes,
  loadPendingRuntimeCheckpoints,
  markRoleExecutionOutcomeSuperseded,
  markRoleExecutionOutcomeReconciled,
  persistRuntimeCheckpoint,
  updateRoleExecutionOutcomeAudit
} from "./run-artifacts.js";

export type CheckpointStore = {
  persist: typeof persistRuntimeCheckpoint;
  loadPending: typeof loadPendingRuntimeCheckpoints;
  loadCommittedOutcomes: typeof loadCommittedRoleExecutionOutcomes;
  markOutcomeReconciled: typeof markRoleExecutionOutcomeReconciled;
  markOutcomeSuperseded: typeof markRoleExecutionOutcomeSuperseded;
  updateOutcomeAudit: typeof updateRoleExecutionOutcomeAudit;
};

export const filesystemCheckpointStore: CheckpointStore = {
  persist: persistRuntimeCheckpoint,
  loadPending: loadPendingRuntimeCheckpoints,
  loadCommittedOutcomes: loadCommittedRoleExecutionOutcomes,
  markOutcomeReconciled: markRoleExecutionOutcomeReconciled,
  markOutcomeSuperseded: markRoleExecutionOutcomeSuperseded,
  updateOutcomeAudit: updateRoleExecutionOutcomeAudit
};
