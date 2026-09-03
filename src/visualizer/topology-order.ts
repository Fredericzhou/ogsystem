import type { GraphViewModelEdge, GraphViewModelNode } from "./studio-contracts.js";

type TopologyEdgeOrderArgs = {
  nodes: readonly GraphViewModelNode[];
  edges: readonly GraphViewModelEdge[];
  entryRoleId?: string;
};

export function topologyComponentIds(args: TopologyEdgeOrderArgs): ReadonlyMap<string, string> {
  const nodeIds = args.nodes.map((node) => node.id).sort();
  const nodeSet = new Set(nodeIds);
  const outgoing = new Map(nodeIds.map((id) => [id, [] as string[]]));
  for (const edge of args.edges) {
    if (nodeSet.has(edge.source) && nodeSet.has(edge.target)) outgoing.get(edge.source)?.push(edge.target);
  }
  for (const targets of outgoing.values()) targets.sort();
  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (id: string): void => {
    indices.set(id, index);
    lowLinks.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);
    for (const target of outgoing.get(id) ?? []) {
      if (!indices.has(target)) {
        visit(target);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(target)!));
      } else if (onStack.has(target)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indices.get(target)!));
      }
    }
    if (lowLinks.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    let member = "";
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    components.push(component.sort());
  };
  for (const id of nodeIds) if (!indices.has(id)) visit(id);
  components.sort((left, right) => (left[0] ?? "").localeCompare(right[0] ?? ""));
  const result = new Map<string, string>();
  components.forEach((component, componentIndex) => {
    const cyclic = component.length > 1 || args.edges.some((edge) => edge.source === component[0] && edge.target === component[0]);
    if (cyclic) component.forEach((id) => result.set(id, `SCC-${componentIndex + 1}`));
  });
  return result;
}

function stableEdgeKey(edge: GraphViewModelEdge): string {
  return `${edge.source}:${edge.target}:${edge.eventType}:${edge.id}`;
}

/** Compresses cycles before assigning ranks so a cyclic graph still has a useful start-to-end order. */
export function addTopologyFlowOrder(args: TopologyEdgeOrderArgs): GraphViewModelEdge[] {
  const nodeIds = args.nodes.map((node) => node.id);
  const nodeSet = new Set(nodeIds);
  const edges = args.edges.filter((edge) => nodeSet.has(edge.source) && nodeSet.has(edge.target));
  const outgoing = new Map(nodeIds.map((id) => [id, [] as GraphViewModelEdge[]]));
  for (const edge of edges) outgoing.get(edge.source)?.push(edge);
  for (const list of outgoing.values()) list.sort((a, b) => stableEdgeKey(a).localeCompare(stableEdgeKey(b)));

  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];
  const visit = (id: string): void => {
    indices.set(id, index);
    lowLinks.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);
    for (const edge of outgoing.get(id) ?? []) {
      if (!indices.has(edge.target)) {
        visit(edge.target);
        lowLinks.set(id, Math.min(lowLinks.get(id)!, lowLinks.get(edge.target)!));
      } else if (onStack.has(edge.target)) {
        lowLinks.set(id, Math.min(lowLinks.get(id)!, indices.get(edge.target)!));
      }
    }
    if (lowLinks.get(id) !== indices.get(id)) return;
    const component: string[] = [];
    let member = "";
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    components.push(component.sort());
  };
  for (const id of nodeIds.slice().sort()) if (!indices.has(id)) visit(id);

  const componentByNode = new Map<string, number>();
  components.forEach((component, componentIndex) => component.forEach((id) => componentByNode.set(id, componentIndex)));
  const componentEdges = new Map<number, Set<number>>();
  const indegree = new Map<number, number>();
  components.forEach((_, componentIndex) => {
    componentEdges.set(componentIndex, new Set());
    indegree.set(componentIndex, 0);
  });
  for (const edge of edges) {
    const source = componentByNode.get(edge.source)!;
    const target = componentByNode.get(edge.target)!;
    if (source === target || componentEdges.get(source)!.has(target)) continue;
    componentEdges.get(source)!.add(target);
    indegree.set(target, indegree.get(target)! + 1);
  }

  const componentName = (componentIndex: number): string => components[componentIndex]?.[0] ?? "";
  const queue = components.map((_, componentIndex) => componentIndex)
    .filter((componentIndex) => indegree.get(componentIndex) === 0)
    .sort((a, b) => componentName(a).localeCompare(componentName(b)));
  const componentRank = new Map<number, number>();
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    const rank = componentRank.get(current) ?? 0;
    componentRank.set(current, rank);
    for (const target of componentEdges.get(current) ?? []) {
      componentRank.set(target, Math.max(componentRank.get(target) ?? 0, rank + 1));
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) {
        queue.push(target);
        queue.sort((a, b) => (componentRank.get(a) ?? 0) - (componentRank.get(b) ?? 0) || componentName(a).localeCompare(componentName(b)));
      }
    }
  }

  const entryComponent = componentByNode.get(args.entryRoleId ?? "input");
  if (entryComponent !== undefined) {
    const entryRank = componentRank.get(entryComponent) ?? 0;
    for (const [componentIndex, rank] of componentRank) componentRank.set(componentIndex, rank - entryRank);
  }
  const outgoingByComponent = new Map<number, GraphViewModelEdge[]>();
  for (const edge of edges) {
    const componentIndex = componentByNode.get(edge.source)!;
    outgoingByComponent.set(componentIndex, [...(outgoingByComponent.get(componentIndex) ?? []), edge]);
  }
  for (const list of outgoingByComponent.values()) list.sort((a, b) => stableEdgeKey(a).localeCompare(stableEdgeKey(b)));
  const branchLabels = new Map<string, string>();
  for (const list of outgoingByComponent.values()) {
    const byTarget = new Map<string, GraphViewModelEdge[]>();
    for (const edge of list) byTarget.set(edge.target, [...(byTarget.get(edge.target) ?? []), edge]);
    const targets = [...byTarget.keys()].sort((a, b) => a.localeCompare(b));
    if (targets.length < 2) continue;
    targets.forEach((target, targetIndex) => {
      for (const edge of byTarget.get(target) ?? []) branchLabels.set(edge.id, String.fromCharCode(97 + targetIndex));
    });
  }
  return args.edges.map((edge) => {
    const sourceComponent = componentByNode.get(edge.source);
    const targetComponent = componentByNode.get(edge.target);
    if (sourceComponent === undefined || targetComponent === undefined) return edge;
    const sourceRank = Math.max(0, componentRank.get(sourceComponent) ?? 0) + 1;
    if (sourceComponent === targetComponent) return { ...edge, topologyOrder: `L${sourceRank}` };
    const branch = branchLabels.get(edge.id);
    return { ...edge, topologyOrder: `${sourceRank}${branch ?? ""}` };
  });
}
