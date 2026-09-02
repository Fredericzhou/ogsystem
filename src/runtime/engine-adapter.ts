import type { AdapterRunResult, ExecutionPlan, GraphState, GraphStateUpdate, RuntimeCheckpointRecord } from "./types.js";
import type { VersionedStateSnapshot } from "./versioned-state.js";

/** OGS-owned durable stream for role audits and graph transition evidence. */
export type RuntimeAuditEvent = Record<string, unknown> & { type: string };

export type RuntimeExecutionServices = {
  stateStore: {
    load(runId: string): Promise<VersionedStateSnapshot<GraphState> | undefined>;
    commit(args: {
      runId: string;
      expectedStateVersion: number;
      eventId: string;
      idempotencyKey: string;
      checkpointSequence?: number;
      update: GraphStateUpdate;
    }): Promise<{ status: "accepted" | "duplicate"; snapshot: VersionedStateSnapshot<GraphState>; resultDigest: string }>;
  };
  checkpointStore: {
    append(record: RuntimeCheckpointRecord): Promise<void>;
    list(runId: string): Promise<RuntimeCheckpointRecord[]>;
  };
  audit: { append(event: RuntimeAuditEvent): Promise<void> };
};

export type EngineRunInput = {
  plan: ExecutionPlan;
  initialState?: GraphState;
  prompt: string;
  /** Optional during the filesystem-runner bridge; native adapters must provide it. */
  runtimeServices?: RuntimeExecutionServices;
};

export interface ExecutionEngineAdapter {
  readonly engineId: string;
  readonly engineVersion: string;
  run(input: EngineRunInput): Promise<AdapterRunResult>;
}
