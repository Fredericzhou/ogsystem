import type { ValidateFunction } from "ajv";
import type { CompiledTeamPlan } from "./compiler.js";
import type { TeamIrDiagnostic } from "./types.js";

export type TeamPayloadTarget =
  | { kind: "run-input"; part: "input" | "preferences" }
  | { kind: "run-result" }
  | { kind: "agent-input" | "agent-output"; agentId: string; portId: string }
  | { kind: "review-feedback"; reviewId: string };

export class TeamPayloadValidationError extends Error {
  readonly diagnostics: TeamIrDiagnostic[];

  constructor(diagnostics: TeamIrDiagnostic[]) {
    super(`Team payload failed Schema validation with ${diagnostics.length} error(s).`);
    this.name = "TeamPayloadValidationError";
    this.diagnostics = diagnostics;
  }
}

function pointerPart(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

export function payloadValidatorKey(target: TeamPayloadTarget): string {
  switch (target.kind) {
    case "run-input": return `run.${target.part}`;
    case "run-result": return "result.data";
    case "agent-input": return `agent.${target.agentId}.input.${target.portId}`;
    case "agent-output": return `agent.${target.agentId}.output.${target.portId}`;
    case "review-feedback": return `review.${target.reviewId}.feedback`;
  }
}

function targetPointer(plan: CompiledTeamPlan, target: TeamPayloadTarget): string {
  switch (target.kind) {
    case "run-input": return target.part === "input" ? "/runInput/dataSchema" : "/runInput/preferencesSchema";
    case "run-result": return "/runResult/dataSchema";
    case "agent-input": {
      const index = plan.team.agents.findIndex((agent) => agent.id === target.agentId);
      return `/agents/${index}/inputPorts/${pointerPart(target.portId)}/dataSchema`;
    }
    case "agent-output": {
      const index = plan.team.agents.findIndex((agent) => agent.id === target.agentId);
      return `/agents/${index}/outputPorts/${pointerPart(target.portId)}/dataSchema`;
    }
    case "review-feedback": {
      const orchestration = plan.team.orchestration as Record<string, unknown>;
      const reviews = Array.isArray(orchestration.reviews) ? orchestration.reviews as Array<Record<string, unknown>> : [];
      const index = reviews.findIndex((review) => review.id === target.reviewId);
      return `/orchestration/reviews/${index}/feedbackSchema`;
    }
  }
}

export function validateTeamPayload(plan: CompiledTeamPlan, target: TeamPayloadTarget, value: unknown): TeamIrDiagnostic[] {
  const key = payloadValidatorKey(target);
  const validate = plan.payloadValidators.get(key) as ValidateFunction | undefined;
  if (!validate) {
    return [{
      code: "IR_RUNTIME_SCHEMA_UNAVAILABLE",
      pointer: targetPointer(plan, target),
      message: `No compiled payload Schema is available for '${key}'.`,
      severity: "error"
    }];
  }
  if (validate(value)) return [];
  const base = targetPointer(plan, target);
  return (validate.errors ?? []).map((error) => {
    const path = error.instancePath ?? "";
    const params = error.params as Record<string, unknown> | undefined;
    const property = typeof params?.missingProperty === "string" ? params.missingProperty
      : typeof params?.additionalProperty === "string" ? params.additionalProperty
        : undefined;
    return {
      code: "IR_RUNTIME_SCHEMA_INVALID",
      pointer: `${base}${path}${property ? `/${pointerPart(property)}` : ""}`,
      message: error.message ?? "Payload does not match its declared Schema.",
      severity: "error"
    };
  });
}

export function assertValidTeamPayload(plan: CompiledTeamPlan, target: TeamPayloadTarget, value: unknown): void {
  const diagnostics = validateTeamPayload(plan, target, value);
  if (diagnostics.length > 0) throw new TeamPayloadValidationError(diagnostics);
}
