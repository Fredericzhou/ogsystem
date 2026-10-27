export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface TeamIrDiagnostic {
  code: string;
  pointer: string;
  message: string;
  severity: "error" | "warning";
  relatedAgentIds?: string[];
  suggestedFix?: string;
}

export interface TeamIrDocument {
  schemaVersion: 2;
  team: { id: string; version: string; [key: string]: JsonValue };
  runInput: Record<string, JsonValue>;
  runResult: Record<string, JsonValue>;
  executionPolicy: Record<string, JsonValue>;
  agents: Array<Record<string, JsonValue>>;
  handoffs: Array<Record<string, JsonValue>>;
  orchestration: Record<string, JsonValue>;
  bindings: Array<Record<string, JsonValue>>;
  presentation?: Record<string, JsonValue>;
  $defs?: Record<string, JsonValue>;
  [key: string]: JsonValue | undefined;
}

export interface TeamIrParseResult {
  document?: TeamIrDocument;
  diagnostics: TeamIrDiagnostic[];
}

export type TeamRunStatus =
  | "queued"
  | "running"
  | "waiting_human_review"
  | "paused_input_required"
  | "failing"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type TeamArtifactSlot = {
  required: boolean;
  cardinality: "single";
  mediaTypes?: string[];
  acceptedMediaTypes?: string[];
};

export type TeamRetryPolicy = {
  maxAttempts: number;
  retryOn: Array<"transport" | "timeout" | "rate_limited" | "server_error">;
  backoff:
    | { mode: "none" }
    | { mode: "constant"; delayMs: number }
    | { mode: "exponential"; initialDelayMs: number; maxDelayMs: number };
};

export type TeamCondition =
  | { op: "equals" | "notEquals"; args: [JsonValueExpr, JsonValueExpr] }
  | { op: "and" | "or"; args: [TeamCondition, ...TeamCondition[]] }
  | { op: "not"; args: [TeamCondition] }
  | { op: "exists"; args: [{ $ref: string }] };

export type JsonValueExpr = JsonValue | { $ref: string } | { $literal: JsonValue } | JsonValueExpr[] | { [key: string]: JsonValueExpr };
