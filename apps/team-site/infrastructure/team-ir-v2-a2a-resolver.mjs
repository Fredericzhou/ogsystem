import { createHash } from "node:crypto";
import { assertTeamA2ACardCompatible, createTeamA2ABinding } from "../../../dist/team-ir/index.js";

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stable(value)), "utf8").digest("hex");
}

function a2aBindings(teamIR) {
  if (!Array.isArray(teamIR?.bindings)) throw new Error("TEAM_IR_A2A_BINDINGS_INVALID");
  return teamIR.bindings.filter((binding) => binding.kind === "a2a");
}

function assertResolved(binding, resolved) {
  if (!resolved?.client || typeof resolved.client.getAgentCard !== "function"
    || typeof resolved.client.sendMessage !== "function" || typeof resolved.client.getTask !== "function"
    || typeof resolved.client.cancelTask !== "function") {
    throw new Error(`TEAM_IR_A2A_CLIENT_UNAVAILABLE: ${binding.id}`);
  }
  if (!resolved.agentCard || typeof resolved.agentCard.protocolVersion !== "string"
    || typeof resolved.agentCard.version !== "string") {
    throw new Error(`TEAM_IR_A2A_CARD_UNAVAILABLE: ${binding.id}`);
  }
  return resolved;
}

function cardPin(binding, resolved, adapterVersion) {
  assertResolved(binding, resolved);
  assertTeamA2ACardCompatible(resolved.agentCard, {
    protocolVersion: resolved.agentCard.protocolVersion,
    agentVersion: resolved.agentCard.version,
    inputMediaTypes: binding.capabilities?.inputMediaTypes,
    outputMediaTypes: binding.capabilities?.outputMediaTypes,
    skillId: binding.skillId
  });
  return {
    agentCardRef: binding.agentCardRef,
    protocolVersion: resolved.agentCard.protocolVersion,
    agentVersion: resolved.agentCard.version,
    agentCardDigest: digest(resolved.agentCard),
    adapterVersion
  };
}

/**
 * Bridges a deployment-owned, allowlisted A2A client factory into Team IR v2.
 * The resolver owns endpoint and credential policy; neither is read from Team IR.
 */
export function createTeamIrV2A2AResolver({ resolveAgent, adapterVersion = "ogs-team-ir-a2a-binding/1" } = {}) {
  if (typeof resolveAgent !== "function") throw new TypeError("Team IR A2A resolver requires a trusted Agent client resolver.");
  if (typeof adapterVersion !== "string" || !adapterVersion.trim()) throw new TypeError("Team IR A2A adapter version is required.");

  async function resolvePins({ team, teamIR }) {
    const pins = {};
    for (const binding of a2aBindings(teamIR)) {
      const resolved = await resolveAgent({ team, teamIR, binding, phase: "closure" });
      pins[binding.id] = cardPin(binding, resolved, adapterVersion);
    }
    return pins;
  }

  return Object.freeze({
    async resolveClosure({ team, teamIR }) {
      const pins = await resolvePins({ team, teamIR });
      return {
        bindingDigests: Object.fromEntries(Object.entries(pins).map(([bindingId, pin]) => [bindingId, digest(pin)])),
        adapterVersions: Object.keys(pins).length ? { a2a: adapterVersion } : {},
        schemaDigests: Object.keys(pins).length ? { a2aAgentCards: digest(pins) } : {}
      };
    },

    async resolveBindings({ team, teamIR, closure, ...context }) {
      const output = {};
      for (const binding of a2aBindings(teamIR)) {
        const resolved = await resolveAgent({ team, teamIR, binding, phase: "execution", ...context });
        const pin = cardPin(binding, resolved, adapterVersion);
        if (closure?.bindingDigests?.[binding.id] !== digest(pin)
          || closure?.adapterVersions?.a2a !== adapterVersion) {
          throw new Error(`TEAM_IR_A2A_CARD_DRIFT: ${binding.id}`);
        }
        output[binding.id] = createTeamA2ABinding({
          client: resolved.client,
          artifactReader: resolved.artifactReader,
          expectedProtocolVersion: pin.protocolVersion,
          expectedAgentVersion: pin.agentVersion,
          inputMediaTypes: binding.capabilities?.inputMediaTypes,
          outputMediaTypes: binding.capabilities?.outputMediaTypes,
          pollIntervalMs: binding.pollIntervalMs,
          skillId: binding.skillId
        });
      }
      return output;
    }
  });
}
