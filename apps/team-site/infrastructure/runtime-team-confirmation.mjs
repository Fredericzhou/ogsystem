import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { computeProjectAssetDigest } from "../../../dist/runtime/project-asset-digest.js";
import { createExecutionPlan } from "../../../dist/runtime/execution-plan.js";
import { parseSystemFromMermaidSource } from "../../../dist/runtime/parse-mermaid.js";
import { validateLinearProjectTopology } from "../../../dist/runtime/project-run.js";
import { exportTeamPackage } from "../../../dist/visualizer/project-projection.js";
import { computeTeamPackageCoreDigest, TEAM_CORE_DIGEST_VERSION } from "./package-integrity.mjs";

export function createRuntimeTeamConfirmation() {
  async function loadExecutionPlan(project) {
    const systemSource = await readFile(join(project.workdir, "system.mmd"), "utf8");
    return createExecutionPlan(parseSystemFromMermaidSource(systemSource));
  }

  async function computeTopologyDigest(project) {
    const plan = await loadExecutionPlan(project);
    const topology = Array.from(plan.nodesByRoleId.values()).map((node) => ({
      roleId: node.roleId,
      dispatchMode: node.dispatchMode,
      join: node.join,
      loopMax: node.loopMax,
      review: node.review,
      incoming: node.incoming.map((flow) => ({ from: flow.fromRoleId, event: flow.eventType, priority: flow.priority, condition: flow.condition })).sort((a, b) => `${a.from}:${a.event}`.localeCompare(`${b.from}:${b.event}`)),
      outgoing: node.outgoing.map((flow) => ({ to: flow.toRoleId, event: flow.eventType, priority: flow.priority, condition: flow.condition })).sort((a, b) => `${a.to}:${a.event}`.localeCompare(`${b.to}:${b.event}`))
    })).sort((a, b) => a.roleId.localeCompare(b.roleId));
    return createHash("sha256").update(JSON.stringify({ entryRoleId: plan.entryRoleId, topology })).digest("hex");
  }

  return Object.freeze({
    async validateTopology(project, { trustedClassic = false } = {}) {
      const executionPlan = await loadExecutionPlan(project);
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
        teamCoreDigest: computeTeamPackageCoreDigest(bundle),
        teamDigestVersion: TEAM_CORE_DIGEST_VERSION
      };
    },
    computeTopologyDigest
  });
}
