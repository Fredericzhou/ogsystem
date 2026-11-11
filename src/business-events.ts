/**
 * System owned business event vocabulary shared by Runtime and Studio.
 */
export const BUSINESS_EVENT_TYPES = [
  "READY",
  "APPROVED",
  "REJECTED",
  "NEEDS_REWORK",
  "BLOCKED"
] as const;

export type BusinessEventType = (typeof BUSINESS_EVENT_TYPES)[number];
export type BusinessEventKind = "handoff" | "decision" | "correction" | "exception";
export type RuntimeErrorEventType = "ERROR" | `ERROR.${string}`;
export const RUNTIME_CONTROL_EVENT_TYPES = [
  "loop_exhausted"
] as const;
export const RUNTIME_EVENT_LOOP_EXHAUSTED = RUNTIME_CONTROL_EVENT_TYPES[0];
export type RuntimeControlEventType = (typeof RUNTIME_CONTROL_EVENT_TYPES)[number];
/** Runtime audit records are observable events, never valid Flow/Role events. */
export const RUNTIME_AUDIT_EVENT_TYPES = [
  "human_review_rejected",
  "human_review_decision_rejected"
] as const;
export const RUNTIME_EVENT_HUMAN_REVIEW_REJECTED = RUNTIME_AUDIT_EVENT_TYPES[0];
export const RUNTIME_EVENT_HUMAN_REVIEW_DECISION_REJECTED = RUNTIME_AUDIT_EVENT_TYPES[1];
export type RuntimeAuditEventType = (typeof RUNTIME_AUDIT_EVENT_TYPES)[number];
export type SystemEventType = "START" | RuntimeErrorEventType;
export type EventType = BusinessEventType | SystemEventType;

const BUSINESS_EVENT_SET = new Set<string>(BUSINESS_EVENT_TYPES);
const RUNTIME_CONTROL_EVENT_SET = new Set<string>(RUNTIME_CONTROL_EVENT_TYPES);
const RUNTIME_AUDIT_EVENT_SET = new Set<string>(RUNTIME_AUDIT_EVENT_TYPES);

export const BUSINESS_EVENT_KIND: Readonly<Record<BusinessEventType, BusinessEventKind>> = Object.freeze({
  READY: "handoff",
  APPROVED: "decision",
  REJECTED: "decision",
  NEEDS_REWORK: "correction",
  BLOCKED: "exception"
});

export function isBusinessEvent(value: unknown): value is BusinessEventType {
  return typeof value === "string" && BUSINESS_EVENT_SET.has(value);
}

export function isRuntimeErrorEvent(value: unknown): value is RuntimeErrorEventType {
  return typeof value === "string" && (value === "ERROR" || value.startsWith("ERROR."));
}

export function isRuntimeControlEvent(value: unknown): value is RuntimeControlEventType {
  return typeof value === "string" && RUNTIME_CONTROL_EVENT_SET.has(value);
}

export function isRuntimeAuditEvent(value: unknown): value is RuntimeAuditEventType {
  return typeof value === "string" && RUNTIME_AUDIT_EVENT_SET.has(value);
}

export function listRuntimeAuditEventTypes(): RuntimeAuditEventType[] {
  return [...RUNTIME_AUDIT_EVENT_TYPES];
}

export function isSystemEvent(value: unknown): value is SystemEventType {
  return value === "START" || isRuntimeErrorEvent(value);
}

export function isRegisteredEvent(value: unknown): value is EventType {
  return isBusinessEvent(value) || isSystemEvent(value);
}

export function assertBusinessEvent(value: string, context = "event"): asserts value is BusinessEventType {
  if (!isBusinessEvent(value)) {
    throw new Error(`${context} must be one of ${BUSINESS_EVENT_TYPES.join(", ")}; received "${value}"`);
  }
}

export function listBusinessEventTypes(): BusinessEventType[] {
  return [...BUSINESS_EVENT_TYPES];
}

export function businessEventDescription(eventType: BusinessEventType): string {
  switch (eventType) {
    case "READY": return "Role has produced a result ready for handoff";
    case "APPROVED": return "Result was approved";
    case "REJECTED": return "Result was rejected";
    case "NEEDS_REWORK": return "Result needs revision before continuing";
    case "BLOCKED": return "Business conditions prevent progress";
  }
}

export function validateSystemEventBoundaries(args: {
  flows: Array<{ fromRoleId: string; toRoleId: string; eventType: string }>;
  startFlows?: Array<{ fromRoleId: string; toRoleId: string; eventType: string }>;
}): string[] {
  const errors: string[] = [];
  for (const flow of args.flows) {
    if (!isBusinessEvent(flow.eventType) && !isRuntimeErrorEvent(flow.eventType)) {
      errors.push(`Business flow ${flow.fromRoleId} -> ${flow.toRoleId} uses unregistered event "${flow.eventType}"`);
    }
  }
  for (const flow of args.startFlows ?? []) {
    if (flow.eventType !== "START") errors.push(`Start flow ${flow.toRoleId} must use START`);
  }
  return errors;
}
