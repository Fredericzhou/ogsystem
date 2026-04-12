/**
 * Presents a single, normalized envelope for all runtime failures so downstream actors can
 * decide retry, persistence, and resume flows without touching stack traces.
 * This module avoids interpreting opaque errors; it only augments known variants with runtime metadata.
 */
import { ConfigValidationError } from "./config.js";
import { OpencodeExecutionError } from "./opencode-executor.js";
import { ToolExecutionError } from "./tool-runner.js";
import type {
  RuntimeErrorCategory,
  RuntimeErrorEnvelope,
  RuntimeErrorStage
} from "./types.js";

/**
 * Holds the canonical envelope emitted by runtime stages so the error surface can remain immutable.
 */
export class RuntimeError extends Error {
  constructor(public readonly envelope: RuntimeErrorEnvelope) {
    super(envelope.message);
    this.name = "RuntimeError";
  }
}

/**
 * Builds a RuntimeError without altering the envelope so callers can rethrow with preserved metadata.
 */
export function createRuntimeError(envelope: RuntimeErrorEnvelope): RuntimeError {
  return new RuntimeError(envelope);
}

/**
 * Collapses runtime errors, config validation failures, and tool/opencode failures into a single envelope
 * while carrying along the caller-defined metadata that controls retry/failure bits.
 */
export function normalizeRuntimeError(
  error: unknown,
  defaults: {
    errorCode: string;
    errorCategory: RuntimeErrorCategory;
    stage: RuntimeErrorStage;
    retryable: boolean;
    message?: string;
    roleId?: string;
    runId?: string;
    branchId?: string;
    line?: number;
  }
): RuntimeErrorEnvelope {
  if (error instanceof RuntimeError) {
    return error.envelope;
  }

  if (error instanceof ConfigValidationError) {
    return {
      errorCode: "CONFIG_VALIDATION_ERROR",
      errorCategory: "config",
      message: error.message,
      retryable: false,
      stage: defaults.stage,
      roleId: defaults.roleId,
      runId: defaults.runId,
      branchId: defaults.branchId,
      line: defaults.line
    };
  }

  if (error instanceof ToolExecutionError) {
    return {
      errorCode: `TOOL_EXECUTION_${error.category.toUpperCase()}`,
      errorCategory: "execution",
      message: error.message,
      retryable: error.category === "timeout",
      stage: defaults.stage,
      roleId: defaults.roleId,
      runId: defaults.runId,
      branchId: defaults.branchId,
      line: defaults.line
    };
  }

  if (error instanceof OpencodeExecutionError) {
    return {
      errorCode: "OPENCODE_EXECUTION_ERROR",
      errorCategory: "execution",
      message: error.message,
      retryable: true,
      stage: defaults.stage,
      roleId: defaults.roleId,
      runId: defaults.runId,
      branchId: defaults.branchId,
      line: defaults.line
    };
  }

  // Guarantee a non-empty envelope message even if upstream error lacks readable text.
  const message =
    defaults.message ??
    (error instanceof Error && error.message.trim() ? error.message : String(error));

  return {
    errorCode: defaults.errorCode,
    errorCategory: defaults.errorCategory,
    message,
    retryable: defaults.retryable,
    stage: defaults.stage,
    roleId: defaults.roleId,
    runId: defaults.runId,
    branchId: defaults.branchId,
    line: defaults.line
  };
}

/**
 * Serializes the envelope in a predictable order so operators can compare the failure metadata quickly.
 */
export function formatRuntimeErrorEnvelope(envelope: RuntimeErrorEnvelope): string {
  const parts = [
    `errorCode=${envelope.errorCode}`,
    `errorCategory=${envelope.errorCategory}`,
    `stage=${envelope.stage}`,
    `retryable=${String(envelope.retryable)}`,
    `message=${envelope.message}`
  ];
  if (envelope.roleId) {
    parts.push(`roleId=${envelope.roleId}`);
  }
  if (envelope.runId) {
    parts.push(`runId=${envelope.runId}`);
  }
  if (envelope.branchId) {
    parts.push(`branchId=${envelope.branchId}`);
  }
  if (envelope.line !== undefined) {
    parts.push(`line=${envelope.line}`);
  }
  return parts.join(" ");
}
