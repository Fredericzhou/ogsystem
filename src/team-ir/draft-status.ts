import type { TeamIrDiagnostic } from "./types.js";

/**
 * Diagnostics that make the document impossible to persist as a Team IR draft.
 * Semantic diagnostics are intentionally saveable: the editor must be able to
 * persist an incomplete mapping/topology and let release readiness reject it.
 */
const STRUCTURAL_CODES = new Set([
  "IR_SCHEMA_INVALID",
  "IR_DUPLICATE_VALUE",
  "IR_DUPLICATE_ID",
  "IR_UNKNOWN_AGENT",
  "IR_UNKNOWN_BINDING",
  "IR_UNKNOWN_HANDOFF",
  "IR_UNKNOWN_LOOP",
  "IR_UNKNOWN_PORT",
  "IR_UNKNOWN_SCHEMA_REF",
  "IR_SCHEMA_DIALECT",
  "IR_SCHEMA_DIALECT_UNSUPPORTED",
  "IR_SCHEMA_PATH_OUT_OF_SCOPE",
  "IR_SCHEMA_REF_FORBIDDEN",
  "IR_ROUTE_SOURCE_INVALID",
  "IR_ROUTE_SOURCE_MISMATCH",
  "IR_ROUTE_HANDOFF_MISMATCH",
  "IR_ROUTE_HANDOFF_OMITTED",
  "IR_ROUTE_HANDOFF_EXTRA",
  "IR_JOIN_TARGET_MISMATCH",
  "IR_JOIN_UNDECLARED_INBOUND",
  "IR_LOOP_BOUNDARY_INVALID",
  "IR_LOOP_BOUNDARY_HANDOFF_UNDECLARED",
  "IR_LOOP_ENTRY_INVALID",
  "IR_LOOP_EXIT_INVALID",
  "IR_BINDING_RETRY_INVALID",
  "IR_MAPPING_REF_INVALID",
  "IR_MAPPING_REF_SCOPE_INVALID",
  "IR_ROUTE_CONDITION_INVALID",
]);

export function isStructuralTeamIrDiagnostic(diagnostic: TeamIrDiagnostic): boolean {
  return STRUCTURAL_CODES.has(diagnostic.code) || diagnostic.code.startsWith("IR_UNKNOWN_");
}

export interface TeamIrDraftStatus {
  /** No error diagnostics at all; retained for the existing validation API. */
  ok: boolean;
  /** The document can be persisted as an editor draft. */
  draftSaveable: boolean;
  /** The document has no diagnostics and its external closure is complete. */
  releaseReady: boolean;
  hasStructuralErrors: boolean;
  hasSemanticErrors: boolean;
}

export function classifyTeamIrDiagnostics(
  diagnostics: TeamIrDiagnostic[],
  { releaseClosureComplete = false } = {}
): TeamIrDraftStatus {
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const hasStructuralErrors = errors.some(isStructuralTeamIrDiagnostic);
  const hasSemanticErrors = errors.some((diagnostic) => !isStructuralTeamIrDiagnostic(diagnostic));
  return {
    ok: errors.length === 0,
    draftSaveable: !hasStructuralErrors,
    releaseReady: errors.length === 0 && releaseClosureComplete,
    hasStructuralErrors,
    hasSemanticErrors,
  };
}
