import type { GraphViewModelEdge, GraphViewModelNode } from "./studio-contracts.js";

type TopologyEdgeOrderArgs = {
  nodes: readonly GraphViewModelNode[];
  edges: readonly GraphViewModelEdge[];
  entryNodeId?: string;
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

function edgeExecutionChannelRank(edge: GraphViewModelEdge): number {
  if (
    edge.runtimeOnlyErrorFlow ||
    edge.channel === "error" ||
    (typeof edge.eventType === "string" && (edge.eventType === "ERROR" || edge.eventType.startsWith("ERROR.")))
  ) return 3;
  if (edge.channel === "loop" || edge.channel === "feedback") return 2;
  if (edge.channel === "join" || edge.participatesInJoin) return 1;
  return 0;
}

function edgeRouteOrderRank(
  edge: GraphViewModelEdge,
  nodeById: ReadonlyMap<string, GraphViewModelNode>
): number {
  const index = nodeById.get(edge.source)?.structure?.routeOrder?.indexOf(edge.target) ?? -1;
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

function compareEdgesByExecutionOrder(
  left: GraphViewModelEdge,
  right: GraphViewModelEdge,
  nodeById: ReadonlyMap<string, GraphViewModelNode>
): number {
  return edgeExecutionChannelRank(left) - edgeExecutionChannelRank(right) ||
    edgeRouteOrderRank(left, nodeById) - edgeRouteOrderRank(right, nodeById) ||
    (right.priority ?? 0) - (left.priority ?? 0) ||
    stableEdgeKey(left).localeCompare(stableEdgeKey(right));
}

/**
 * Compresses cycles (SCCs) before assigning a hierarchical topology order to
 * every valid flow. Cross-component handoffs receive sequential top-level
 * numbers (`1`, `2`, `3`, ...); each cycle body occupies one top-level number
 * `k` at its topological position, and its internal edges receive secondary
 * numbers (`k.1`, `k.2`, ...) ordered from entry forward before back-edges.
 */
export function addTopologyFlowOrder(args: TopologyEdgeOrderArgs): GraphViewModelEdge[] {
  const nodeById = new Map(args.nodes.map((node) => [node.id, node]));
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
  const entryComponent = componentByNode.get(args.entryNodeId ?? "input");
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

  const orderByEdge = new Map<GraphViewModelEdge, { topologyOrder: string; topologyCycle: boolean }>();
  const earliestIncomingMajorByNode = new Map<string, number>();
  let nextMajor = 1;

  for (const componentIndex of orderedComponents) {
    const componentSourceEdges = edges.filter((edge) => componentByNode.get(edge.source) === componentIndex);
    const internalEdges = componentSourceEdges.filter((edge) => componentByNode.get(edge.target) === componentIndex);
    const outgoingEdges = componentSourceEdges
      .filter((edge) => componentByNode.get(edge.target) !== componentIndex)
      .sort((left, right) => compareEdgesByExecutionOrder(left, right, nodeById));

    if (internalEdges.length > 0) {
      const cycleMajor = nextMajor;
      nextMajor += 1;
      const members = components[componentIndex] ?? [];
      const incomingEntryMembers = members
        .filter((id) => earliestIncomingMajorByNode.has(id) || id === args.entryNodeId)
        .sort((left, right) =>
          (earliestIncomingMajorByNode.get(left) ?? Number.MAX_SAFE_INTEGER) -
            (earliestIncomingMajorByNode.get(right) ?? Number.MAX_SAFE_INTEGER) ||
          left.localeCompare(right)
        );
      const seeds = incomingEntryMembers.length > 0 ? incomingEntryMembers : members.slice(0, 1);
      const internalOutgoing = new Map<string, GraphViewModelEdge[]>();
      for (const edge of internalEdges) {
        internalOutgoing.set(edge.source, [...(internalOutgoing.get(edge.source) ?? []), edge]);
      }
      for (const list of internalOutgoing.values()) {
        list.sort((left, right) => compareEdgesByExecutionOrder(left, right, nodeById));
      }
      const memberDepth = new Map<string, number>();
      const bfsQueue: string[] = [];
      for (const seed of seeds) {
        if (memberDepth.has(seed)) continue;
        memberDepth.set(seed, 0);
        bfsQueue.push(seed);
      }
      for (let cursor = 0; cursor < bfsQueue.length; cursor += 1) {
        const current = bfsQueue[cursor]!;
        const depth = memberDepth.get(current) ?? 0;
        for (const edge of internalOutgoing.get(current) ?? []) {
          if (memberDepth.has(edge.target)) continue;
          memberDepth.set(edge.target, depth + 1);
          bfsQueue.push(edge.target);
        }
      }
      const depthOf = (id: string): number => memberDepth.get(id) ?? Number.MAX_SAFE_INTEGER;
      internalEdges.sort((left, right) => {
        const leftSourceDepth = depthOf(left.source);
        const leftTargetDepth = depthOf(left.target);
        const rightSourceDepth = depthOf(right.source);
        const rightTargetDepth = depthOf(right.target);
        const leftBackRank = left.source === left.target ? 2 : leftSourceDepth >= leftTargetDepth ? 1 : 0;
        const rightBackRank = right.source === right.target ? 2 : rightSourceDepth >= rightTargetDepth ? 1 : 0;
        return leftBackRank - rightBackRank ||
          leftSourceDepth - rightSourceDepth ||
          leftTargetDepth - rightTargetDepth ||
          compareEdgesByExecutionOrder(left, right, nodeById);
      });
      internalEdges.forEach((edge, minorIndex) => {
        orderByEdge.set(edge, {
          topologyOrder: `${cycleMajor}.${minorIndex + 1}`,
          topologyCycle: true
        });
      });
    }

    for (const edge of outgoingEdges) {
      const assigned = nextMajor;
      nextMajor += 1;
      orderByEdge.set(edge, { topologyOrder: String(assigned), topologyCycle: false });
      const prior = earliestIncomingMajorByNode.get(edge.target);
      if (prior === undefined || assigned < prior) {
        earliestIncomingMajorByNode.set(edge.target, assigned);
      }
    }
  }

  return args.edges.map((edge) => {
    const entry = orderByEdge.get(edge);
    if (!entry) return edge;
    return entry.topologyCycle
      ? { ...edge, topologyOrder: entry.topologyOrder, topologyCycle: true }
      : { ...edge, topologyOrder: entry.topologyOrder };
  });
}
