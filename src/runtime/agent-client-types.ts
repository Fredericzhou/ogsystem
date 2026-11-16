export type AgentEvent =
  | { type: "session_started"; sessionId: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_started"; tool: string; input?: unknown }
  | { type: "tool_finished"; tool: string; output?: unknown }
  | { type: "permission_required"; request: unknown }
  | { type: "tool_invocation"; tool: string; decision: "allow" | "deny"; status: "started" | "completed" | "failed" | "denied"; durationMs?: number; policyDigest?: string }
  | { type: "permission_request"; requestId: string; resource: string; decision: "allow" | "deny"; reason?: string; policyDigest?: string }
  | { type: "turn_completed"; output: string }
  | { type: "turn_failed"; error: string }
  | { type: "session_recreated"; previousSessionId: string; sessionId: string; reason: string }
  | { type: "session_closed" };

export type AgentEventEnvelope = {
  ogsContractVersion: 2;
  schemaVersion: 1;
  runId: string;
  roleId: string;
  executionId: string;
  attempt: number;
  backend: string;
  model: string;
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
  model?: string;
  sessionId?: string;
  policyDigest?: string;
  onEvent?: AgentEventSink;
}): { emit(event: AgentEvent): Promise<void>; getSequence(): number } {
  let sequence = 0;
  const toolStartedAt = new Map<string, number>();
  const send = async (event: AgentEvent): Promise<void> => {
    if (!args.onEvent) return;
    sequence += 1;
    await args.onEvent({
      ogsContractVersion: 2,
      schemaVersion: 1,
      runId: args.runId,
      roleId: args.roleId,
      executionId: args.executionId,
      attempt: args.attempt,
      backend: args.backend,
      model: args.model ?? "unknown",
      ...(args.sessionId ? { sessionId: args.sessionId } : {}),
      sequence,
      at: new Date().toISOString(),
      event
    });
  };
  return {
    async emit(event) {
      if (event.type === "tool_started") toolStartedAt.set(event.tool, Date.now());
      await send(event);
      if (event.type === "tool_started") {
        await send({
          type: "tool_invocation",
          tool: event.tool,
          decision: "allow",
          status: "started",
          ...(args.policyDigest ? { policyDigest: args.policyDigest } : {})
        });
      }
      if (event.type === "tool_finished") {
        const started = toolStartedAt.get(event.tool);
        toolStartedAt.delete(event.tool);
        const output = event.output && typeof event.output === "object" && !Array.isArray(event.output)
          ? event.output as Record<string, unknown>
          : {};
        const status = output.status === "failed" || output.status === "error" || (typeof output.exitCode === "number" && output.exitCode !== 0)
          ? "failed"
          : "completed";
        await send({
          type: "tool_invocation",
          tool: event.tool,
          decision: "allow",
          status,
          ...(started !== undefined ? { durationMs: Math.max(0, Date.now() - started) } : {}),
          ...(args.policyDigest ? { policyDigest: args.policyDigest } : {})
        });
      }
      if (event.type === "permission_required") {
        const request = event.request && typeof event.request === "object" && !Array.isArray(event.request)
          ? event.request as Record<string, unknown>
          : {};
        const nested = request.decision && typeof request.decision === "object" && !Array.isArray(request.decision)
          ? request.decision as Record<string, unknown>
          : request;
        const allowed = nested.allowed === true || nested.decision === "allow";
        await send({
          type: "permission_request",
          requestId: typeof request.requestId === "string" ? request.requestId : `${args.executionId}:${sequence}`,
          resource: typeof nested.capability === "string" ? nested.capability : typeof nested.resource === "string" ? nested.resource : "unknown",
          decision: allowed ? "allow" : "deny",
          ...(typeof nested.reason === "string" ? { reason: nested.reason } : {}),
          ...(args.policyDigest ? { policyDigest: args.policyDigest } : {})
        });
        if (!allowed && typeof nested.tool === "string" && nested.tool.trim()) {
          await send({
            type: "tool_invocation",
            tool: nested.tool.trim(),
            decision: "deny",
            status: "denied",
            ...(args.policyDigest ? { policyDigest: args.policyDigest } : {})
          });
        }
      }
    },
    getSequence() {
      return sequence;
    }
  };
}
