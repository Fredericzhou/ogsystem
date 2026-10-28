import { createHash } from "node:crypto";
import { teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { TEAM_CORE_DIGEST_VERSION } from "./package-integrity.mjs";
import { createFileTeamIrStore } from "./file-team-ir-store.mjs";

export function createRuntimeTeamConfirmation({ teamIrStore = createFileTeamIrStore() } = {}) {
  async function readNativeTeamIr(project) {
    const stored = await teamIrStore.read({ workdir: project.workdir });
    if (stored.teamIR?.schemaVersion !== 2) {
      throw new Error("TEAM_IR_V2_REQUIRED: TeamVersion must contain a native Team IR v2 document.");
    }
    return stored.teamIR;
  }

  return Object.freeze({
    async validateTopology(project) {
      await readNativeTeamIr(project);
    },

    async computeDigests(project) {
      const teamIR = await readNativeTeamIr(project);
      const semanticDigest = teamIRSemanticDigest(teamIR);
      const digest = createHash("sha256").update(JSON.stringify({
        digestVersion: TEAM_CORE_DIGEST_VERSION,
        schemaVersion: teamIR.schemaVersion,
        semanticDigest
      })).digest("hex");
      return {
        projectDigest: digest,
        teamCoreDigest: digest,
        teamDigestVersion: TEAM_CORE_DIGEST_VERSION
      };
    },

    async computeTopologyDigest(project) {
      return teamIRSemanticDigest(await readNativeTeamIr(project));
    }
  });
}
