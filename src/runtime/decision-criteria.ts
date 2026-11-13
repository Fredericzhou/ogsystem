import type { DecisionCriterionConfig } from "./types.js";

const DECISION_EVENTS = new Set(["APPROVED", "REJECTED", "NEEDS_REWORK", "BLOCKED"]);
const VALID_STATUSES = new Set(["pass", "fail", "unknown"]);

export class DecisionCriteriaValidationError extends Error {
  constructor(readonly code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DecisionCriteriaValidationError";
  }
}

function fail(code: string, message: string): never {
  throw new DecisionCriteriaValidationError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates the runtime result against criteria declared by the Role contract.
 * Roles without decisionCriteria keep the existing event-only contract.
 */
export function validateDecisionOutput(args: {
  event?: string;
  data?: Record<string, unknown>;
  criteria?: DecisionCriterionConfig[];
  roleId: string;
}): void {
  if (!args.criteria?.length || !DECISION_EVENTS.has(String(args.event))) return;
  const data = args.data;
  if (!data || !isRecord(data)) {
    fail("DECISION_EVIDENCE_REQUIRED", `Role "${args.roleId}" decision output must include data`);
  }
  const reason = data.decisionReason;
  if (!nonEmptyString(reason)) {
    fail("DECISION_REASON_REQUIRED", `Role "${args.roleId}" ${args.event} output must include data.decisionReason`);
  }
  const rawResults = data.criteria;
  if (!Array.isArray(rawResults)) {
    fail("DECISION_CRITERIA_REQUIRED", `Role "${args.roleId}" decision output must include data.criteria`);
  }

  const configured = new Map(args.criteria.map((criterion) => [criterion.id, criterion]));
  const seen = new Set<string>();
  const results = new Map<string, { status: string; evidence: string[]; reason?: string }>();
  for (const [index, raw] of rawResults.entries()) {
    if (!isRecord(raw) || !nonEmptyString(raw.id) || !VALID_STATUSES.has(String(raw.status))) {
      fail("DECISION_CRITERIA_INVALID", `Role "${args.roleId}" data.criteria[${index}] must contain a valid id and status`);
    }
    const id = String(raw.id);
    const config = configured.get(id);
    if (!config) fail("DECISION_CRITERIA_UNKNOWN", `Role "${args.roleId}" returned unknown decision criterion "${id}"`);
    if (seen.has(id)) fail("DECISION_CRITERIA_DUPLICATE", `Role "${args.roleId}" returned decision criterion "${id}" more than once`);
    seen.add(id);
    if (raw.severity !== undefined && raw.severity !== config.severity) {
      fail("DECISION_CRITERIA_SEVERITY_MISMATCH", `Role "${args.roleId}" criterion "${id}" severity does not match its contract`);
    }
    const evidence = raw.evidence === undefined
      ? []
      : Array.isArray(raw.evidence) && raw.evidence.every((item) => nonEmptyString(item))
        ? raw.evidence.map(String)
        : undefined;
    if (!evidence) fail("DECISION_EVIDENCE_INVALID", `Role "${args.roleId}" criterion "${id}" evidence must be a string array`);
    const resultReason = raw.reason === undefined ? undefined : String(raw.reason);
    results.set(id, { status: String(raw.status), evidence, ...(resultReason ? { reason: resultReason } : {}) });
  }
  for (const criterion of args.criteria) {
    if (!seen.has(criterion.id)) fail("DECISION_CRITERIA_MISSING", `Role "${args.roleId}" did not return criterion "${criterion.id}"`);
    const result = results.get(criterion.id)!;
    if (result.status === "pass" && (criterion.severity === "required" || criterion.severity === "critical") && result.evidence.length === 0) {
      fail("DECISION_EVIDENCE_MISSING", `Role "${args.roleId}" criterion "${criterion.id}" passed without evidence`);
    }
  }

  const failures = args.criteria
    .map((criterion) => ({ criterion, result: results.get(criterion.id)! }))
    .filter(({ result }) => result.status === "fail");
  const unknowns = args.criteria
    .map((criterion) => ({ criterion, result: results.get(criterion.id)! }))
    .filter(({ result }) => result.status === "unknown");
  const hardFailures = failures.filter(({ criterion }) => criterion.severity === "required" || criterion.severity === "critical");
  const hardRejectFailures = failures.filter(({ criterion }) => criterion.failureAction === "reject" && criterion.severity !== "advisory");

  if (args.event === "APPROVED" && (hardFailures.length > 0 || unknowns.some(({ criterion }) => criterion.severity === "required" || criterion.severity === "critical"))) {
    fail("DECISION_APPROVED_EVIDENCE_MISSING", `Role "${args.roleId}" cannot approve with failed or unknown required criteria`);
  }
  if (args.event === "REJECTED") {
    if (hardRejectFailures.some(({ result }) => result.evidence.length === 0)) {
      fail("DECISION_EVIDENCE_MISSING", `Role "${args.roleId}" rejected with a hard failure that has no evidence`);
    }
    if (hardRejectFailures.length === 0) {
      fail("DECISION_REJECTED_HARD_FAILURE_REQUIRED", `Role "${args.roleId}" rejected without a configured hard failure`);
    }
  }
  if (args.event === "NEEDS_REWORK") {
    if (hardRejectFailures.length > 0) {
      fail("DECISION_REWORK_HARD_FAILURE_CONFLICT", `Role "${args.roleId}" has a hard failure that must be rejected before rework can be requested`);
    }
    const reworkIds = new Set(
      failures.filter(({ criterion }) => criterion.failureAction === "rework").map(({ criterion }) => criterion.id)
    );
    if (reworkIds.size === 0) {
      fail("DECISION_REWORK_CRITERION_REQUIRED", `Role "${args.roleId}" requested rework without a failed rework criterion`);
    }
    if ([...reworkIds].some((id) => results.get(id)?.evidence.length === 0)) {
      fail("DECISION_EVIDENCE_MISSING", `Role "${args.roleId}" requested rework for a failed criterion without evidence`);
    }
    if (!Array.isArray(data.requiredChanges) || data.requiredChanges.length === 0) {
      fail("DECISION_REWORK_CHANGES_REQUIRED", `Role "${args.roleId}" rework output must include data.requiredChanges`);
    }
    const changeIds = new Set<string>();
    for (const [index, change] of data.requiredChanges.entries()) {
      if (!isRecord(change) || !nonEmptyString(change.criterionId) || !nonEmptyString(change.action)) {
        fail("DECISION_REWORK_CHANGES_INVALID", `Role "${args.roleId}" data.requiredChanges[${index}] must include criterionId and action`);
      }
      const criterionId = String(change.criterionId);
      if (!reworkIds.has(criterionId)) fail("DECISION_REWORK_CHANGES_UNMATCHED", `Role "${args.roleId}" required change references non-rework criterion "${criterionId}"`);
      changeIds.add(criterionId);
    }
    for (const id of reworkIds) if (!changeIds.has(id)) fail("DECISION_REWORK_CHANGES_MISSING", `Role "${args.roleId}" has no required change for criterion "${id}"`);
  }
  if (args.event === "BLOCKED") {
    if (unknowns.length === 0) {
      fail("DECISION_BLOCKED_MISSING_CONDITION", `Role "${args.roleId}" is blocked without an unknown criterion`);
    }
    const unexplained = unknowns.filter(({ result }) => !nonEmptyString(result.reason));
    if (unexplained.length > 0) {
      fail("DECISION_BLOCKED_REASON_REQUIRED", `Role "${args.roleId}" blocked criteria must include a specific reason`);
    }
    if (unknowns.some(({ result }) => result.evidence.length === 0)) {
      fail("DECISION_BLOCKED_EVIDENCE_REQUIRED", `Role "${args.roleId}" blocked criteria must include evidence for the missing condition or dependency`);
    }
  }
}
