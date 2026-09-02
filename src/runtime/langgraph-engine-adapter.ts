import { runSystemWithGraphRunner, type RunnerInput } from "./graph-runner.js";
import { createInitialGraphState } from "./graph-runtime-state.js";
import { createFilesystemRuntimeServices } from "./filesystem-runtime-services.js";
import { semanticIRDigest } from "./semantic-ir.js";
import type { AdapterRunResult } from "./types.js";
import type { EngineRunInput, ExecutionEngineAdapter } from "./engine-adapter.js";

/**
 * OGS' first execution backend. It owns only the mapping from the frozen execution plan
 * to LangGraph; routing, contracts, recovery, and audit remain in the OGS runner.
 */
export class LangGraphEngineAdapter implements ExecutionEngineAdapter {
  readonly engineId = "langgraph";
  readonly engineVersion = "1";

  constructor(private readonly runtime: Omit<RunnerInput, "plan" | "prompt" | "initialState">) {}

  async run(input: EngineRunInput): Promise<AdapterRunResult> {
    // The current LangGraph runner still owns filesystem checkpoint/audit writes. Keeping the
    // port on the input makes that migration explicit without allowing the adapter to reinterpret
    // OGS business semantics.
    const irDigest = input.plan.semanticIR ? semanticIRDigest(input.plan.semanticIR) : "none";
    const runtimeServices = input.runtimeServices ?? createFilesystemRuntimeServices({
      context: this.runtime.runContext,
      initialState: input.initialState ?? createInitialGraphState({ plan: input.plan, prompt: input.prompt }),
      irDigest
    });
    const persistedSnapshot = await runtimeServices.stateStore.load(this.runtime.runContext.runId);
    if (persistedSnapshot && persistedSnapshot.irDigest !== irDigest) {
      throw new Error(`Versioned state Semantic IR digest mismatch: expected ${irDigest}, found ${persistedSnapshot.irDigest}`);
    }
    // The versioned state store is the linearized recovery authority. A filesystem state.json
    // can lag when the process crashes after CAS commit but before the graph stream persists its
    // projection, so prefer the newer durable snapshot while retaining the caller snapshot for
    // compatibility with stores that have no persisted state yet.
    const hasDurableProgress = Boolean(persistedSnapshot && persistedSnapshot.state.stateVersion > 0);
    const recoveredState = input.initialState || hasDurableProgress
      ? (persistedSnapshot &&
          (!input.initialState || persistedSnapshot.state.stateVersion >= input.initialState.stateVersion)
          ? persistedSnapshot.state
          : input.initialState)
      : undefined;
    return runSystemWithGraphRunner({
      ...this.runtime,
      plan: input.plan,
      prompt: input.prompt,
      initialState: recoveredState,
      runtimeServices
    });
  }
}
