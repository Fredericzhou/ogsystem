import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { createTeamIrV2A2AResolver } from "./team-ir-v2-a2a-resolver.mjs";

const REQUIRED_EXPORTS = ["resolveTeamIrReleaseClosure", "resolveBindings"];

export async function loadTeamIrV2Resolvers(modulePath = process.env.OGS_TEAM_IR_V2_RESOLVER_MODULE) {
  if (!modulePath) return Object.freeze({});
  if (!isAbsolute(modulePath)) throw new Error("TEAM_IR_V2_RESOLVER_PATH_INVALID: resolver module path must be absolute.");
  const loaded = await import(pathToFileURL(resolve(modulePath)).href);
  const missing = REQUIRED_EXPORTS.filter((name) => typeof loaded[name] !== "function");
  if (missing.length) throw new Error(`TEAM_IR_V2_RESOLVER_INVALID: missing exports ${missing.join(", ")}.`);
  const resolveA2AAgent = loaded.resolveA2AAgent;
  const a2aResolver = typeof resolveA2AAgent === "function"
    ? createTeamIrV2A2AResolver({ resolveAgent: resolveA2AAgent, adapterVersion: loaded.a2aAdapterVersion })
    : null;

  async function resolveTeamIrReleaseClosure(input) {
    const bindings = input.teamIR?.bindings || [];
    const a2aBindings = bindings.filter((binding) => binding.kind === "a2a");
    if (a2aBindings.length && !a2aResolver) {
      throw new Error("TEAM_IR_A2A_RESOLVER_UNAVAILABLE: trusted A2A Agent resolver is not configured.");
    }
    const modelTeamIR = { ...input.teamIR, bindings: bindings.filter((binding) => binding.kind !== "a2a") };
    const modelClosure = await loaded.resolveTeamIrReleaseClosure({ ...input, teamIR: modelTeamIR });
    if (!a2aBindings.length) return modelClosure;
    const a2aClosure = await a2aResolver.resolveClosure(input);
    return {
      ...modelClosure,
      bindingDigests: { ...modelClosure.bindingDigests, ...a2aClosure.bindingDigests },
      adapterVersions: { ...modelClosure.adapterVersions, ...a2aClosure.adapterVersions },
      schemaDigests: { ...modelClosure.schemaDigests, ...a2aClosure.schemaDigests }
    };
  }

  async function resolveBindings(input) {
    const bindings = input.teamIR?.bindings || [];
    const a2aBindings = bindings.filter((binding) => binding.kind === "a2a");
    if (a2aBindings.length && !a2aResolver) {
      throw new Error("TEAM_IR_A2A_RESOLVER_UNAVAILABLE: trusted A2A Agent resolver is not configured.");
    }
    const modelTeamIR = { ...input.teamIR, bindings: bindings.filter((binding) => binding.kind !== "a2a") };
    const modelBindings = await loaded.resolveBindings({ ...input, teamIR: modelTeamIR });
    if (!a2aBindings.length) return modelBindings;
    const a2aBindingsResolved = await a2aResolver.resolveBindings(input);
    return { ...modelBindings, ...a2aBindingsResolved };
  }

  return Object.freeze({
    resolveTeamIrReleaseClosure,
    resolveBindings,
    ...(typeof loaded.authorizeTeamIrReviewer === "function"
      ? { authorizeTeamIrReviewer: loaded.authorizeTeamIrReviewer }
      : {})
  });
}
