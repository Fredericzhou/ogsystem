import type { Edge, Graph, Node } from "@antv/x6";

import { authoringToCanvasDocument } from "../studio-authoring-projection.js";
import {
  normalizeStudioGraphStoredRoleId,
  studioFlowKey,
  type GraphViewModelEdge,
  type GraphViewModelNode,
  type StudioAuthoringDocument,
  type StudioCanvasDocument
} from "../studio-contracts.js";

export function graphToAuthoringLayoutPatch(
  graph: Graph,
  authoring: StudioAuthoringDocument
): StudioAuthoringDocument["layout"] {
  const nodes = { ...(authoring.layout?.nodes ?? {}) };
  graph.getNodes().forEach((cell: Node) => {
    const data = cell.getData() as { studioNode?: GraphViewModelNode } | undefined;
    const studioNode = data?.studioNode;
    if (!studioNode || studioNode.kind !== "role") {
      return;
    }
    const size = cell.getSize();
    const position = cell.getPosition();
    nodes[studioNode.roleId] = {
      x: position.x,
      y: position.y,
      width: size.width,
      height: size.height
    };
  });
  return {
    nodes,
    viewport: {
      x: graph.translate().tx,
      y: graph.translate().ty,
      zoom: graph.zoom()
    }
  };
}

export function graphToCanvasDocument(graph: Graph, authoring: StudioAuthoringDocument): StudioCanvasDocument {
  const canvas = authoringToCanvasDocument({
    ...authoring,
    layout: graphToAuthoringLayoutPatch(graph, authoring)
  });
  const edges = graph.getEdges().flatMap((cell: Edge) => {
    const data = cell.getData() as { studioEdge?: GraphViewModelEdge } | undefined;
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
    ...canvas,
    edges
  };
}

export function studioEdgeFlowKey(edge: GraphViewModelEdge): string {
  return studioFlowKey({
    fromRoleId: edge.source,
    eventType: edge.eventType,
    toRoleId: normalizeStudioGraphStoredRoleId(edge.target)
  });
}
