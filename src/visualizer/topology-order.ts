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

/**
 * Compresses cycles before assigning one global order to every valid flow.
 * Forward handoffs are numbered first; cycle edges are numbered afterwards
 * with an `L` suffix so the main path remains easy to scan.
 */
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
  const entryComponent = componentByNode.get(args.entryRoleId ?? "input");
  const componentDistance = new Map<number, number>();
  if (entryComponent !== undefined) {
    componentDistance.set(entryComponent, 0);
    const pending = [entryComponent];
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const current = pending[cursor]!;
      const distance = componentDistance.get(current) ?? 0;
      for (const target of componentEdges.get(current) ?? []) {
        if (componentDistance.has(target)) continue;
        componentDistance.set(target, distance + 1);
        pending.push(target);
      }
    }
  }
  const compareReadyComponents = (left: number, right: number): number => {
    const leftDistance = componentDistance.get(left);
    const rightDistance = componentDistance.get(right);
    if (leftDistance === undefined && rightDistance !== undefined) return 1;
    if (leftDistance !== undefined && rightDistance === undefined) return -1;
    if (leftDistance !== undefined && rightDistance !== undefined && leftDistance !== rightDistance) {
      return leftDistance - rightDistance;
    }
    return componentName(left).localeCompare(componentName(right));
  };
  const queue = components.map((_, componentIndex) => componentIndex)
    .filter((componentIndex) => indegree.get(componentIndex) === 0)
    .sort(compareReadyComponents);
  const orderedComponents: number[] = [];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    orderedComponents.push(current);
    for (const target of componentEdges.get(current) ?? []) {
      indegree.set(target, indegree.get(target)! - 1);
      if (indegree.get(target) === 0) {
        queue.push(target);
        queue.sort(compareReadyComponents);
      }
    }
  }

  // Defensive fallback for malformed disconnected condensation graphs. A
  // valid condensation DAG is fully emitted by Kahn's algorithm above.
  for (const componentIndex of components.map((_, index) => index)) {
    if (!orderedComponents.includes(componentIndex)) orderedComponents.push(componentIndex);
  }
  const orderedComponentIndex = new Map(orderedComponents.map((component, index) => [component, index]));
  const forwardEdges: GraphViewModelEdge[] = [];
  const cycleEdges: GraphViewModelEdge[] = [];
  for (const componentIndex of orderedComponents) {
    const componentEdgesForSource = edges
      .filter((edge) => componentByNode.get(edge.source) === componentIndex)
      .sort((left, right) => stableEdgeKey(left).localeCompare(stableEdgeKey(right)));
    for (const edge of componentEdgesForSource) {
      if (componentByNode.get(edge.target) === componentIndex) cycleEdges.push(edge);
      else forwardEdges.push(edge);
    }
  }
  cycleEdges.sort((left, right) => {
    const leftComponent = orderedComponentIndex.get(componentByNode.get(left.source)! ) ?? 0;
    const rightComponent = orderedComponentIndex.get(componentByNode.get(right.source)! ) ?? 0;
    return leftComponent - rightComponent || stableEdgeKey(left).localeCompare(stableEdgeKey(right));
  });
  const orderByEdge = new Map<GraphViewModelEdge, string>();
  [...forwardEdges, ...cycleEdges].forEach((edge, index) => {
    const component = componentByNode.get(edge.source);
    const isCycle = component !== undefined && component === componentByNode.get(edge.target);
    orderByEdge.set(edge, `${index + 1}${isCycle ? "L" : ""}`);
  });
  return args.edges.map((edge) => {
    const topologyOrder = orderByEdge.get(edge);
    return topologyOrder ? { ...edge, topologyOrder } : edge;
  });
}
