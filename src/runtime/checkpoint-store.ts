/** Runtime checkpoint persistence port. */
import {
  loadCommittedRoleExecutionOutcomes,
  loadPendingRuntimeCheckpoints,
  markRoleExecutionOutcomeReconciled,
  persistRuntimeCheckpoint
} from "./run-artifacts.js";

export type CheckpointStore = {
  persist: typeof persistRuntimeCheckpoint;
  loadPending: typeof loadPendingRuntimeCheckpoints;
  loadCommittedOutcomes: typeof loadCommittedRoleExecutionOutcomes;
  markOutcomeReconciled: typeof markRoleExecutionOutcomeReconciled;
};

export const filesystemCheckpointStore: CheckpointStore = {
  persist: persistRuntimeCheckpoint,
  loadPending: loadPendingRuntimeCheckpoints,
  loadCommittedOutcomes: loadCommittedRoleExecutionOutcomes,
  markOutcomeReconciled: markRoleExecutionOutcomeReconciled
};
