import type { Edge, Graph, Node } from "@antv/x6";

import {
  normalizeStudioGraphStoredRoleId,
  normalizeStudioGraphTargetRoleId,
  STUDIO_SYSTEM_END_ROLE_ID,
  studioFlowKey,
  type StudioAuthoringDocument,
  type StudioCanvasDocument,
  type StudioGraphProjection,
  type StudioGraphProjectionEdge,
  type StudioGraphProjectionNode
} from "../studio-contracts.js";

type ValidationLike = {
  ok?: unknown;
  diagnostics?: unknown;
};

type DiagnosticRecord = {
  code?: string;
  message?: string;
  severity?: string;
  roleId?: string;
  selector?: string;
  flowKey?: string;
};

function asDiagnostics(validation: ValidationLike | null | undefined): DiagnosticRecord[] {
  return Array.isArray(validation?.diagnostics)
    ? validation.diagnostics.filter((item): item is DiagnosticRecord => typeof item === "object" && item !== null)
    : [];
}

function diagnosticSeverity(diagnostics: DiagnosticRecord[], roleId: string, flowKeyValue?: string): "warning" | "error" | undefined {
  const matched = diagnostics.find((diagnostic) =>
    diagnostic.roleId === roleId ||
    diagnostic.selector === roleId ||
    (flowKeyValue && diagnostic.flowKey === flowKeyValue)
  );
  if (!matched) {
    return undefined;
  }
  return matched.severity === "error" ? "error" : "warning";
}

export function canvasToStudioGraphProjection(args: {
  authoring: StudioAuthoringDocument | null | undefined;
  canvas: StudioCanvasDocument | null | undefined;
  validation?: ValidationLike | null;
}): StudioGraphProjection {
  const canvas = args.canvas ?? { version: 1, nodes: [], edges: [] };
  const diagnostics = asDiagnostics(args.validation);
  const roleNodes: StudioGraphProjectionNode[] = canvas.nodes.map((node) => ({
    id: node.roleId,
    roleId: node.roleId,
    kind: "role",
    label: node.label || node.roleId,
    x: Number.isFinite(node.x) ? node.x : 120,
    y: Number.isFinite(node.y) ? node.y : 120,
    width: Number.isFinite(node.width) ? node.width : 180,
    height: Number.isFinite(node.height) ? node.height : 84,
    badges: node.badges ?? [],
    bindingKind: node.bindingKind ?? "noop",
    editable: true,
    severity: diagnosticSeverity(diagnostics, node.roleId)
  }));
  const minX = roleNodes.length ? Math.min(...roleNodes.map((node) => node.x)) : 120;
  const maxX = roleNodes.length ? Math.max(...roleNodes.map((node) => node.x + node.width)) : 360;
  const baseY = roleNodes.length ? Math.min(...roleNodes.map((node) => node.y)) : 120;
  const entryRoleId = args.authoring?.system.entryRoleId || roleNodes[0]?.roleId || "";
  const nodes: StudioGraphProjectionNode[] = [
    {
      id: "input",
      roleId: "input",
      kind: "boundary",
      label: "input/start",
      x: minX - 260,
      y: baseY,
      width: 170,
      height: 70,
      badges: ["START"],
      bindingKind: "boundary",
      editable: false
    },
    ...roleNodes,
    {
      id: "output",
      roleId: STUDIO_SYSTEM_END_ROLE_ID,
      kind: "boundary",
      label: "output/end",
      x: maxX + 90,
      y: baseY,
      width: 170,
      height: 70,
      badges: ["END"],
      bindingKind: "boundary",
      editable: false
    }
  ];

  const edges: StudioGraphProjectionEdge[] = [];
  if (entryRoleId) {
    edges.push({
      id: "__boundary__:input:entry",
      source: "input",
      target: entryRoleId,
      label: "entry",
      eventType: "entry",
      runtimeOnlyErrorFlow: false,
      participatesInJoin: false,
      editable: false
    });
  }
  for (const edge of canvas.edges) {
    const target = normalizeStudioGraphTargetRoleId(edge.target);
    const key = `${edge.source}:${edge.eventType}:${target}`;
    edges.push({
      id: edge.id || key,
      source: edge.source,
      target,
      label: edge.label || edge.eventType,
      eventType: edge.eventType,
      runtimeOnlyErrorFlow: Boolean(edge.runtimeOnlyErrorFlow),
      participatesInJoin: Boolean(edge.participatesInJoin),
      editable: true,
      severity: edge.runtimeOnlyErrorFlow ? "warning" : diagnosticSeverity(diagnostics, edge.source, key)
    });
  }

  return {
    version: 1,
    nodes,
    edges,
    capabilities: {
      editable: Boolean(args.authoring),
      canAddRole: Boolean(args.authoring),
      canAddEdge: Boolean(args.authoring),
      canDelete: Boolean(args.authoring)
    },
    validation: {
      ok: args.validation?.ok === true,
      diagnostics
    }
  };
}

export function graphToCanvasDocument(graph: Graph, baseCanvas: StudioCanvasDocument): StudioCanvasDocument {
  const nodeByRoleId = new Map(baseCanvas.nodes.map((node) => [node.roleId, { ...node }]));
  graph.getNodes().forEach((cell: Node) => {
    const data = cell.getData() as { studioNode?: StudioGraphProjectionNode } | undefined;
    const studioNode = data?.studioNode;
    if (!studioNode || studioNode.kind !== "role") {
      return;
    }
    const size = cell.getSize();
    const position = cell.getPosition();
    const existing = nodeByRoleId.get(studioNode.roleId);
    nodeByRoleId.set(studioNode.roleId, {
      id: studioNode.roleId,
      roleId: studioNode.roleId,
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height,
      label: existing?.label || studioNode.label,
      badges: existing?.badges || studioNode.badges,
      bindingKind: existing?.bindingKind || (studioNode.bindingKind === "boundary" ? "noop" : studioNode.bindingKind)
    });
  });

  const edges = graph.getEdges().flatMap((cell: Edge) => {
    const data = cell.getData() as { studioEdge?: StudioGraphProjectionEdge } | undefined;
    const studioEdge = data?.studioEdge;
    if (!studioEdge || !studioEdge.editable) {
      return [];
    }
    const sourceCellId = cell.getSourceCellId() || studioEdge.source;
    const targetCellId = cell.getTargetCellId() || studioEdge.target;
    const source = sourceCellId === "input" ? "" : sourceCellId;
    const target = normalizeStudioGraphStoredRoleId(targetCellId);
    if (!source || !target || target === "input") {
      return [];
    }
    return [{
      id: studioEdge.id,
      source,
      target,
      label: studioEdge.label || studioEdge.eventType,
      eventType: studioEdge.eventType || "DONE",
      runtimeOnlyErrorFlow: Boolean(studioEdge.runtimeOnlyErrorFlow),
      participatesInJoin: Boolean(studioEdge.participatesInJoin)
    }];
  });

  return {
    ...baseCanvas,
    nodes: Array.from(nodeByRoleId.values()),
    edges,
    viewport: {
      x: graph.translate().tx,
      y: graph.translate().ty,
      zoom: graph.zoom()
    }
  };
}

export function studioEdgeFlowKey(edge: StudioGraphProjectionEdge): string {
  return studioFlowKey({
    fromRoleId: edge.source,
    eventType: edge.eventType,
    toRoleId: normalizeStudioGraphStoredRoleId(edge.target)
  });
}
