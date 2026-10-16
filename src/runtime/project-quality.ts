import type { ProjectRunPlan } from "./project-run.js";
import type { ProjectRunState } from "./project-run-state.js";

export type ProjectQualityCheck = {
  id: string;
  passed: boolean;
  severity: "error" | "warning";
  detail: string;
};

export type ProjectQualityReport = {
  passed: boolean;
  checks: ProjectQualityCheck[];
  metrics: {
    requiredNodeCount: number;
    completedNodeCount: number;
    nodeCompletionRate: number;
    sourceCitationRate?: number;
  };
};

export function evaluateProjectRunPlan(plan: ProjectRunPlan): ProjectQualityReport {
  const checks: ProjectQualityCheck[] = [];
  const nodeIds = plan.nodeGraph.map((node) => node.nodeId);
  const nodeSet = new Set(nodeIds);
  const duplicate = nodeIds.find((nodeId, index) => nodeIds.indexOf(nodeId) !== index);
  checks.push({
    id: "unique-node-ids",
    passed: !duplicate,
    severity: "error",
    detail: duplicate ? `Duplicate node id: ${duplicate}` : "Node ids are unique."
  });
  checks.push({
    id: "entry-node",
    passed: nodeSet.has(plan.entryNodeId),
    severity: "error",
    detail: nodeSet.has(plan.entryNodeId) ? "Entry node exists." : `Missing entry node: ${plan.entryNodeId}`
  });
  const dangling = plan.nodeGraph.flatMap((node) => node.outgoing
    .filter((edge) => edge.to !== "output" && !nodeSet.has(edge.to))
    .map((edge) => `${node.nodeId}->${edge.to}`));
  checks.push({
    id: "valid-edges",
    passed: dangling.length === 0,
    severity: "error",
    detail: dangling.length ? `Dangling edges: ${dangling.join(", ")}` : "All edges target known nodes or output."
  });
  checks.push({
    id: "single-worker",
    passed: plan.executionPolicy.singleWorker === true,
    severity: "error",
    detail: plan.executionPolicy.singleWorker ? "Single-worker execution is enabled." : "Run plan is not single-worker."
  });
  return {
    passed: checks.every((check) => check.passed || check.severity !== "error"),
    checks,
    metrics: {
      requiredNodeCount: nodeIds.length,
      completedNodeCount: 0,
      nodeCompletionRate: 0
    }
  };
}

export function evaluateProjectRunResult(args: {
  plan: ProjectRunPlan;
  state: ProjectRunState;
  sourceCitationRate?: number;
}): ProjectQualityReport {
  const base = evaluateProjectRunPlan(args.plan);
  const requiredNodeCount = args.plan.nodeGraph.length;
  const completedNodeCount = args.plan.nodeGraph.filter(
    (node) => args.state.nodes[node.nodeId]?.status === "completed"
  ).length;
  const nodeCompletionRate = requiredNodeCount ? completedNodeCount / requiredNodeCount : 0;
  const checks = [...base.checks, {
    id: "required-nodes-completed",
    passed: completedNodeCount === requiredNodeCount,
    severity: "error" as const,
    detail: `${completedNodeCount}/${requiredNodeCount} required nodes completed.`
  }];
  return {
    passed: checks.every((check) => check.passed || check.severity !== "error"),
    checks,
    metrics: {
      requiredNodeCount,
      completedNodeCount,
      nodeCompletionRate,
      ...(args.sourceCitationRate === undefined ? {} : { sourceCitationRate: args.sourceCitationRate })
    }
  };
}
