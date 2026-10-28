import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";

const REQUIRED_EXPORTS = ["resolveTeamIrReleaseClosure", "resolveBindings"];

export async function loadTeamIrV2Resolvers(modulePath = process.env.OGS_TEAM_IR_V2_RESOLVER_MODULE) {
  if (!modulePath) return Object.freeze({});
  if (!isAbsolute(modulePath)) throw new Error("TEAM_IR_V2_RESOLVER_PATH_INVALID: resolver module path must be absolute.");
  const loaded = await import(pathToFileURL(resolve(modulePath)).href);
  const missing = REQUIRED_EXPORTS.filter((name) => typeof loaded[name] !== "function");
  if (missing.length) throw new Error(`TEAM_IR_V2_RESOLVER_INVALID: missing exports ${missing.join(", ")}.`);
  return Object.freeze({
    resolveTeamIrReleaseClosure: loaded.resolveTeamIrReleaseClosure,
    resolveBindings: loaded.resolveBindings
  });
}
