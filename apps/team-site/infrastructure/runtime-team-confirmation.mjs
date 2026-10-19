import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { computeProjectAssetDigest } from "../../../dist/runtime/project-asset-digest.js";
import { createExecutionPlan } from "../../../dist/runtime/execution-plan.js";
import { parseSystemFromMermaidSource } from "../../../dist/runtime/parse-mermaid.js";
import { validateLinearProjectTopology } from "../../../dist/runtime/project-run.js";
import { exportTeamPackage } from "../../../dist/visualizer/project-projection.js";
import { computeTeamPackageCoreDigest } from "./package-integrity.mjs";

export function createRuntimeTeamConfirmation() {
  return Object.freeze({
    async validateTopology(project, { trustedClassic = false } = {}) {
      const systemSource = await readFile(join(project.workdir, "system.mmd"), "utf8");
      const executionPlan = createExecutionPlan(parseSystemFromMermaidSource(systemSource));
      const nodeGraph = Array.from(executionPlan.nodesByRoleId.values()).map((node) => ({
        nodeId: node.roleId,
        incoming: node.incoming.map((flow) => ({ from: flow.fromRoleId, event: flow.eventType })),
        outgoing: node.outgoing.map((flow) => ({ to: flow.toRoleId, event: flow.eventType })),
        reviewRequired: node.review?.mode === "required",
        loopMax: node.loopMax
      }));
      if (!trustedClassic && project.source !== "classic" && project.source !== "classic-template") {
        validateLinearProjectTopology(nodeGraph, executionPlan.entryRoleId);
      }
    },

    async computeDigests(project) {
      const bundle = await exportTeamPackage(project.workdir);
      return {
        projectDigest: await computeProjectAssetDigest(project.workdir),
        teamCoreDigest: computeTeamPackageCoreDigest(bundle)
      };
    }
  });
}
