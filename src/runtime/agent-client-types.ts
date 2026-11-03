export type AgentEvent =
  | { type: "session_started"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; tool: string; input?: unknown }
  | { type: "tool_finished"; tool: string; output?: unknown }
  | { type: "permission_required"; request: unknown }
  | { type: "turn_completed"; output: string }
  | { type: "turn_failed"; error: string }
  | { type: "session_recreated"; previousSessionId: string; sessionId: string; reason: string }
  | { type: "session_closed" };

export type AgentEventEnvelope = {
  schemaVersion: 1;
  runId: string;
  roleId: string;
  executionId: string;
  attempt: number;
  backend: string;
  sessionId?: string;
  sequence: number;
  at: string;
  event: AgentEvent;
};

export type AgentEventSink = (event: AgentEventEnvelope) => Promise<void> | void;

export function createAgentEventEmitter(args: {
  runId: string;
  roleId: string;
  executionId: string;
  attempt: number;
  backend: string;
  sessionId?: string;
  onEvent?: AgentEventSink;
}): { emit(event: AgentEvent): Promise<void>; getSequence(): number } {
  let sequence = 0;
  return {
    async emit(event) {
      if (!args.onEvent) return;
      sequence += 1;
      await args.onEvent({
        schemaVersion: 1,
        runId: args.runId,
        roleId: args.roleId,
        executionId: args.executionId,
        attempt: args.attempt,
        backend: args.backend,
        ...(args.sessionId ? { sessionId: args.sessionId } : {}),
        sequence,
        at: new Date().toISOString(),
        event
      });
    },
    getSequence() {
      return sequence;
    }
  };
}
