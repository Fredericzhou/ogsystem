import type { Edge, Graph, Node } from "@antv/x6";

import type { GraphViewModel, GraphViewModelEdge, GraphViewModelNode } from "../studio-contracts.js";
import { formatStudioEdgeLabel } from "../studio-edge-semantics.js";
import { formatStudioRuntimeNodeBadges } from "./studio-graph-runtime.js";
import type {
  LayoutEdgeBundle,
  LayoutEdgeRouting,
  LayoutPortSpec,
  LayoutProjection,
  LayoutSide
} from "./semantic-layout-projection.js";

export { formatStudioEdgeLabel } from "../studio-edge-semantics.js";

function diagnosticBadgeText(severity: GraphViewModelNode["diagnostic"] extends infer T
  ? T extends { severity: infer S }
    ? S
    : never
  : never): string {
  return severity === "error" ? "!" : "?";
}

function nodeStroke(node: GraphViewModelNode): string {
  if (node.diagnostic?.severity === "error") return "#f87171";
  if (node.diagnostic?.severity === "warning") return "#fbbf24";
  if (node.kind === "boundary") return "#64748b";
  if (node.structure?.review) return "#c084fc";
  if (node.structure?.joinMode) return "#a78bfa";
  if (node.structure?.loopMax && node.structure.loopMax > 1) return "#2dd4bf";
  return "#38bdf8";
}

function edgeStroke(edge: GraphViewModelEdge): string {
  if (edge.diagnostic?.severity === "error") return "#f87171";
  if (edge.diagnostic?.severity === "warning" || edge.runtimeOnlyErrorFlow) return "#fbbf24";
  if (edge.participatesInJoin) return "#a78bfa";
  return "#94a3b8";
}

function nodeLabel(node: GraphViewModelNode): string {
  const normalizedBadges = formatStudioRuntimeNodeBadges(node);
  const semantic = node.roleSeat
    ? [
        node.structure.modes?.length ? `mode:${node.structure.modes.join("/")}` : "",
        node.structure.loopScope ? `loop:${node.structure.loopScope.loopId}` : "",
        node.structure.review ? "review" : ""
      ].filter(Boolean)
    : [];
  const topology = node.topologyComponentId ? [node.topologyComponentId] : [];
  const badges = [...semantic, ...normalizedBadges, ...topology];
  return badges.length ? `${node.label}  [${badges.join(" ")}]` : node.label;
}

type StudioEdgeTerminal = NonNullable<Edge.Metadata["source"]>;
type StudioEdgeRouting = {
  source: StudioEdgeTerminal;
  target: StudioEdgeTerminal;
  router: NonNullable<Edge.Metadata["router"]>;
  connector: NonNullable<Edge.Metadata["connector"]>;
  vertices: NonNullable<Edge.Metadata["vertices"]>;
};
const STUDIO_EDGE_ORTH_ROUTER: StudioEdgeRouting["router"] = {
  name: "orth",
  args: { padding: 18 }
};
const STUDIO_EDGE_CONNECTOR: StudioEdgeRouting["connector"] = {
  name: "rounded",
  args: { radius: 10 }
};
const STUDIO_BOUNDARY_CONNECTION_POINT = {
  name: "boundary",
  args: { offset: 8 }
} as const;

function projectionRouting(routing: LayoutEdgeRouting): StudioEdgeRouting {
  const toTerminal = (value: LayoutEdgeRouting["source"]): StudioEdgeTerminal => ({
    cell: value.cell,
    port: value.port,
    anchor: {
      name: value.side,
      args: value.offset
        ? value.side === "top" || value.side === "bottom" ? { dx: value.offset } : { dy: value.offset }
        : {}
    },
    connectionPoint: STUDIO_BOUNDARY_CONNECTION_POINT
  });
  return {
    source: toTerminal(routing.source),
    target: toTerminal(routing.target),
    router: routing.router as NonNullable<Edge.Metadata["router"]>,
    connector: routing.connector as NonNullable<Edge.Metadata["connector"]>,
    vertices: routing.routePoints
  };
}

export function renderStudioGraphViewModel(graph: Graph, viewModel: GraphViewModel, projection: LayoutProjection): void {
  const projectedNodes = viewModel.nodes.map((node) => {
    const layout = projection.nodes.find((candidate) => candidate.id === node.id);
    return layout ? { ...node, layout } : node;
  });
  const projectedViewModel = { ...viewModel, nodes: projectedNodes };
  const routingByEdgeId = new Map(projection.edges.map((edge) => [edge.id, projectionRouting(edge.routing)]));
  const portsByNodeId = projectionPortsByNode(projection);
  graph.batchUpdate("studio-projection", () => {
    const nextNodeIds = new Set(projectedViewModel.nodes.map((node) => node.id));
    const sccGroups = buildSccGroups(projectedViewModel.nodes, graph);
    for (const group of sccGroups) nextNodeIds.add(group.id);
    const nextEdgeIds = new Set(viewModel.edges.map((edge) => edge.id));
    for (const bundle of projection.bundles) nextEdgeIds.add(bundle.id);

    for (const cell of graph.getCells()) {
      if (cell.isNode() && !nextNodeIds.has(cell.id)) {
        cell.remove();
      }
      if (cell.isEdge() && !nextEdgeIds.has(cell.id)) {
        cell.remove();
      }
    }

    for (const node of projectedViewModel.nodes) {
      const existing = graph.getCellById(node.id);
      if (existing?.isNode()) {
        updateStudioNode(existing, node, portsByNodeId.get(node.id));
      } else {
        graph.addNode(studioNodeMetadata(node, portsByNodeId.get(node.id)));
      }
    }

    for (const group of sccGroups) {
      const existing = graph.getCellById(group.id);
      if (existing?.isNode()) updateSccGroup(existing, group);
      else graph.addNode(sccGroupMetadata(group));
    }

    for (const bundle of projection.bundles) {
      const existing = graph.getCellById(bundle.id);
      if (existing?.isEdge()) updateBundleEdge(existing, bundle);
      else graph.addEdge(bundleEdgeMetadata(bundle));
    }

    for (const edge of viewModel.edges) {
      const existing = graph.getCellById(edge.id);
      if (existing?.isEdge()) {
        updateStudioEdge(existing, edge, routingByEdgeId.get(edge.id));
      } else {
        graph.addEdge(studioEdgeMetadata(edge, routingByEdgeId.get(edge.id)));
      }
    }
  });
}

function bundleStroke(channel: string): string {
  if (channel === "error") return "#b7791f";
  if (channel === "join") return "#8064b5";
  if (channel === "loop" || channel === "feedback") return "#168477";
  return "#64748b";
}

function bundleEdgeMetadata(bundle: LayoutEdgeBundle): Edge.Metadata {
  return {
    id: bundle.id,
    source: bundle.trunk[0],
    target: bundle.trunk[bundle.trunk.length - 1],
    zIndex: 0,
    data: { studioLayoutBundle: bundle },
    attrs: {
      line: {
        stroke: bundleStroke(bundle.channel),
        strokeWidth: 3.2,
        strokeLinecap: "round",
        targetMarker: null,
        pointerEvents: "none"
      }
    },
    vertices: bundle.trunk.slice(1, -1),
    router: { name: "normal", args: {} },
    connector: STUDIO_EDGE_CONNECTOR
  };
}

function updateBundleEdge(cell: Edge, bundle: LayoutEdgeBundle): void {
  cell.setSource(bundle.trunk[0]);
  cell.setTarget(bundle.trunk[bundle.trunk.length - 1]);
  cell.setVertices(bundle.trunk.slice(1, -1));
  cell.setData({ studioLayoutBundle: bundle });
  cell.attr(bundleEdgeMetadata(bundle).attrs ?? {});
  cell.setRouter({ name: "normal", args: {} });
  cell.setConnector(STUDIO_EDGE_CONNECTOR);
}

export function isStudioLayoutBundleEdge(edge: Edge): boolean {
  const data = edge.getData() as { studioLayoutBundle?: unknown } | undefined;
  return Boolean(data?.studioLayoutBundle);
}

export function isStudioLayoutJunction(node: Node): boolean {
  const data = node.getData() as { studioLayoutJunction?: unknown } | undefined;
  return Boolean(data?.studioLayoutJunction);
}

export function studioNodePortId(node: Node | null | undefined, direction: LayoutPortSpec["direction"]): string | undefined {
  const ids = node?.getPorts()
    .map((port) => String(port.id ?? ""))
    .filter((id) => id.startsWith(`${direction}-`)) ?? [];
  const preferredSide = direction === "out" ? "right" : "left";
  return ids.sort((left, right) => {
    const leftPreferred = left.startsWith(`${direction}-${preferredSide}-`);
    const rightPreferred = right.startsWith(`${direction}-${preferredSide}-`);
    if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
    return left.localeCompare(right);
  })[0];
}

type SccGroup = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  memberIds: string[];
  padding: number;
  color: { fill: string; stroke: string; label: string };
};

const SCC_COLORS = [
  { fill: "rgba(45, 212, 191, 0.075)", stroke: "rgba(45, 212, 191, 0.82)", label: "#99f6e4" },
  { fill: "rgba(96, 165, 250, 0.075)", stroke: "rgba(96, 165, 250, 0.82)", label: "#bfdbfe" },
  { fill: "rgba(251, 191, 36, 0.075)", stroke: "rgba(251, 191, 36, 0.82)", label: "#fde68a" },
  { fill: "rgba(192, 132, 252, 0.075)", stroke: "rgba(192, 132, 252, 0.82)", label: "#e9d5ff" }
];

function buildSccGroups(nodes: readonly GraphViewModelNode[], graph: Graph): SccGroup[] {
  const groups = new Map<string, GraphViewModelNode[]>();
  for (const node of nodes) {
    if (!node.topologyComponentId?.startsWith("SCC-")) continue;
    groups.set(node.topologyComponentId, [...(groups.get(node.topologyComponentId) ?? []), node]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([label, members], index) => {
    const left = Math.min(...members.map((node) => node.layout.x));
    const top = Math.min(...members.map((node) => node.layout.y));
    const right = Math.max(...members.map((node) => node.layout.x + node.layout.width));
    const bottom = Math.max(...members.map((node) => node.layout.y + node.layout.height));
    const padding = 28;
    const memberIds = members.map((node) => node.id).sort();
    return {
      id: `__ogs-scc-${label}`,
      label,
      x: left - padding,
      y: top - padding,
      width: right - left + padding * 2,
      height: bottom - top + padding * 2,
      memberIds,
      padding,
      color: SCC_COLORS[index % SCC_COLORS.length]
    };
  });
}

function sccGroupMetadata(group: SccGroup): Node.Metadata {
  return {
    id: group.id,
    x: group.x,
    y: group.y,
    width: group.width,
    height: group.height,
    zIndex: 0,
    shape: "rect",
    markup: [{ tagName: "rect", selector: "body" }, { tagName: "text", selector: "label" }],
    attrs: sccGroupAttrs(group),
    data: {
      studioSccGroup: {
        memberIds: group.memberIds,
        padding: group.padding,
        lastPosition: { x: group.x, y: group.y }
      }
    },
    interacting: true
  };
}

function sccGroupAttrs(group: SccGroup): Node.Metadata["attrs"] {
  return {
    body: { fill: group.color.fill, stroke: group.color.stroke, strokeWidth: 2, strokeDasharray: "8 5", rx: 12, ry: 12 },
    label: { text: group.label, refX: 12, refY: 6, textAnchor: "start", textVerticalAnchor: "top", fill: group.color.label, fontSize: 11, fontWeight: 800 }
  };
}

function updateSccGroup(cell: Node, group: SccGroup): void {
  cell.setData({
    studioSccGroup: {
      memberIds: group.memberIds,
      padding: group.padding,
      lastPosition: { x: group.x, y: group.y }
    }
  });
  cell.position(group.x, group.y);
  cell.resize(group.width, group.height);
  cell.attr(sccGroupAttrs(group));
}

export function isStudioSccGroup(node: Node): boolean {
  const data = node.getData() as { studioSccGroup?: unknown } | undefined;
  return Boolean(data?.studioSccGroup);
}

/** Keeps each non-embedded SCC annotation aligned with the nodes it describes. */
export function alignStudioSccGroups(graph: Graph): void {
  for (const group of graph.getNodes().filter(isStudioSccGroup)) {
    const data = group.getData() as { studioSccGroup?: { memberIds?: unknown; padding?: unknown } } | undefined;
    const memberIds = Array.isArray(data?.studioSccGroup?.memberIds)
      ? data.studioSccGroup.memberIds.filter((id): id is string => typeof id === "string")
      : [];
    const members = memberIds
      .map((id) => graph.getCellById(id))
      .filter((cell): cell is Node => Boolean(cell?.isNode() && !isStudioSccGroup(cell)));
    if (!members.length) continue;
    const padding = Number.isFinite(data?.studioSccGroup?.padding) ? Number(data!.studioSccGroup!.padding) : 28;
    const bounds = members.reduce((result, member) => {
      const position = member.getPosition();
      const size = member.getSize();
      return {
        left: Math.min(result.left, position.x),
        top: Math.min(result.top, position.y),
        right: Math.max(result.right, position.x + size.width),
        bottom: Math.max(result.bottom, position.y + size.height)
      };
    }, { left: Number.POSITIVE_INFINITY, top: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY, bottom: Number.NEGATIVE_INFINITY });
    group.position(bounds.left - padding, bounds.top - padding);
    group.resize(bounds.right - bounds.left + padding * 2, bounds.bottom - bounds.top + padding * 2);
    group.setData({
      studioSccGroup: {
        memberIds,
        padding,
        lastPosition: { x: bounds.left - padding, y: bounds.top - padding }
      }
    });
  }
}

export function studioSccGroupMembers(node: Node): string[] {
  const data = node.getData() as { studioSccGroup?: { memberIds?: unknown } } | undefined;
  return Array.isArray(data?.studioSccGroup?.memberIds)
    ? data.studioSccGroup.memberIds.filter((id): id is string => typeof id === "string")
    : [];
}

export function studioSccGroupPreviousPosition(node: Node): { x: number; y: number } | undefined {
  const data = node.getData() as { studioSccGroup?: { lastPosition?: { x?: unknown; y?: unknown } } } | undefined;
  const x = data?.studioSccGroup?.lastPosition?.x;
  const y = data?.studioSccGroup?.lastPosition?.y;
  return Number.isFinite(x) && Number.isFinite(y) ? { x: Number(x), y: Number(y) } : undefined;
}

type StudioPortSpec = LayoutPortSpec;

function portPosition(side: LayoutSide, offset: number): { name: LayoutSide; args: { dx?: number; dy?: number } } {
  return side === "top" || side === "bottom"
    ? { name: side, args: { dx: offset } }
    : { name: side, args: { dy: offset } };
}

function portAttrs(direction: LayoutPortSpec["direction"]): Record<string, unknown> {
  return {
    circle: {
      r: 7,
      magnet: true,
      stroke: direction === "in" ? "#bae6fd" : "#67e8f9",
      strokeWidth: 2.2,
      fill: "#07111f",
      "vector-effect": "non-scaling-stroke",
      "data-studio-port": direction
    }
  };
}

function fallbackPortSpecs(node: GraphViewModelNode): StudioPortSpec[] {
  if (!node.roleSeat) return [];
  return [
    { id: "in-left-forward-normal", direction: "in", side: "left", offset: 0 },
    { id: "out-right-forward-normal", direction: "out", side: "right", offset: 0 }
  ];
}

function studioNodeMetadata(node: GraphViewModelNode, ports?: readonly StudioPortSpec[]): Node.Metadata {
  return {
    id: node.id,
    x: node.layout.x,
    y: node.layout.y,
    width: node.layout.width,
    height: node.layout.height,
    zIndex: 2,
    shape: "rect",
    markup: [
      { tagName: "rect", selector: "body" },
      { tagName: "text", selector: "label" },
      { tagName: "circle", selector: "diagnosticBadge" },
      { tagName: "text", selector: "diagnosticText" }
    ],
    data: { studioNode: node },
    attrs: studioNodeAttrs(node),
    ports: studioNodePorts(node, ports)
  };
}

function nodeFill(node: GraphViewModelNode): string {
  if (node.kind === "boundary") return "rgba(15, 23, 42, 0.6)";
  if (node.structure?.review) return "rgba(88, 28, 135, 0.18)";
  if (node.structure?.joinMode) return "rgba(67, 56, 202, 0.14)";
  if (node.structure?.loopMax && node.structure.loopMax > 1) return "rgba(13, 148, 136, 0.12)";
  return "rgba(15, 23, 42, 0.96)";
}

function studioNodeAttrs(node: GraphViewModelNode): Node.Metadata["attrs"] {
  return {
    body: {
      rx: node.kind === "boundary" ? 20 : 8,
      ry: node.kind === "boundary" ? 20 : 8,
      fill: nodeFill(node),
      stroke: nodeStroke(node),
      strokeWidth: node.kind === "boundary" ? 1.2 : 1.5,
      strokeDasharray: node.kind === "boundary" ? "6 4" : ""
    },
    label: {
      text: nodeLabel(node),
      fill: node.kind === "boundary" ? "#94a3b8" : "#e5eefb",
      fontSize: 12,
      fontWeight: 600,
      textWrap: {
        width: node.layout.width - 18,
        height: node.layout.height - 12,
        ellipsis: true
      }
    },
    diagnosticBadge: {
      cx: node.layout.width - 14,
      cy: 14,
      r: 9,
      fill: node.diagnostic?.severity === "error" ? "#7f1d1d" : "#713f12",
      stroke: node.diagnostic?.severity === "error" ? "#f87171" : "#fbbf24",
      strokeWidth: 1.2,
      visibility: node.roleSeat && node.diagnostic ? "visible" : "hidden"
    },
    diagnosticText: {
      x: node.layout.width - 14,
      y: 18,
      textAnchor: "middle",
      fontSize: 11,
      fontWeight: 700,
      fill: "#f8fafc",
      text: node.diagnostic ? diagnosticBadgeText(node.diagnostic.severity) : "",
      visibility: node.roleSeat && node.diagnostic ? "visible" : "hidden"
    }
  };
}

function studioNodePorts(node: GraphViewModelNode, projectedPorts?: readonly StudioPortSpec[]): Node.Metadata["ports"] {
  const specs = [...(projectedPorts ?? [])];
  if (node.roleSeat) {
    for (const fallback of fallbackPortSpecs(node)) {
      if (!specs.some((spec) => spec.direction === fallback.direction)) specs.push(fallback);
    }
  }
  specs.sort((left, right) => left.id.localeCompare(right.id));
  const groups = Object.fromEntries(specs.map((spec) => [spec.id, {
    position: portPosition(spec.side, spec.offset),
    attrs: portAttrs(spec.direction)
  }]));
  return {
    groups,
    items: specs.map((spec) => ({ id: spec.id, group: spec.id }))
  };
}

function updateStudioNode(cell: Node, node: GraphViewModelNode, projectedPorts?: readonly StudioPortSpec[]): void {
  cell.setData({ studioNode: node });
  cell.position(node.layout.x, node.layout.y);
  cell.resize(node.layout.width, node.layout.height);
  cell.attr(studioNodeAttrs(node));
  const nextPorts = studioNodePorts(node, projectedPorts);
  cell.setProp("ports", nextPorts);
  const expectedPortIds = nextPorts.items.map((port) => String(port.id ?? ""));
  const currentPortIds = cell.getPorts().map((port) => String(port.id ?? ""));
  const missingPorts = expectedPortIds.filter((id) => !cell.hasPort(id));
  if (missingPorts.length) {
    cell.addPorts(missingPorts.map((id) => ({ id, group: id })));
  }
  const stalePorts = currentPortIds.filter((id) => id && !expectedPortIds.includes(id));
  if (stalePorts.length) {
    cell.removePorts(stalePorts);
  }
}

function projectionPortsByNode(projection: LayoutProjection): Map<string, StudioPortSpec[]> {
  const portsByNodeId = new Map<string, Map<string, StudioPortSpec>>();
  for (const edge of projection.edges) {
    for (const [direction, terminal] of [["out", edge.routing.source], ["in", edge.routing.target]] as const) {
      if (!terminal.port) continue;
      const ports = portsByNodeId.get(terminal.cell) ?? new Map<string, StudioPortSpec>();
      ports.set(terminal.port, {
        id: terminal.port,
        direction,
        side: terminal.side,
        offset: terminal.offset
      });
      portsByNodeId.set(terminal.cell, ports);
    }
  }
  return new Map([...portsByNodeId.entries()].map(([nodeId, ports]) => [
    nodeId,
    [...ports.values()].sort((left, right) => left.id.localeCompare(right.id))
  ]));
}

function studioEdgeMetadata(edge: GraphViewModelEdge, routing?: StudioEdgeRouting): Edge.Metadata {
  return {
    id: edge.id,
    source: routing?.source ?? { cell: edge.source },
    target: routing?.target ?? { cell: edge.target },
    zIndex: 1,
    data: { studioEdge: edge },
    labels: studioEdgeLabels(edge),
    attrs: studioEdgeAttrs(edge),
    router: routing?.router,
    connector: routing?.connector ?? STUDIO_EDGE_CONNECTOR,
    vertices: routing?.vertices
  };
}

function studioEdgeLabels(edge: GraphViewModelEdge): Edge.Metadata["labels"] {
  const labels: NonNullable<Edge.Metadata["labels"]> = [{
    attrs: {
      label: {
        text: formatStudioEdgeLabel(edge),
        fill: "#dbeafe",
        fontSize: 11
      },
      body: {
        fill: "rgba(15, 23, 42, 0.94)",
        stroke: edgeStroke(edge),
        strokeWidth: 1
      }
    }
  }];
  if (edge.diagnostic) {
    labels.push({
      position: {
        distance: 0.82,
        offset: -16
      },
      attrs: {
        label: {
          text: diagnosticBadgeText(edge.diagnostic.severity),
          fill: "#f8fafc",
          fontSize: 10,
          fontWeight: 700
        },
        body: {
          fill: edge.diagnostic.severity === "error" ? "#7f1d1d" : "#713f12",
          stroke: edge.diagnostic.severity === "error" ? "#f87171" : "#fbbf24",
          strokeWidth: 1
        }
      },
      markup: [
        { tagName: "rect", selector: "body" },
        { tagName: "text", selector: "label" }
      ]
    });
  }
  return labels;
}

function studioEdgeAttrs(edge: GraphViewModelEdge): Edge.Metadata["attrs"] {
  return {
    line: {
      stroke: edgeStroke(edge),
      strokeWidth: edge.participatesInJoin ? 2.4 : 1.7,
      targetMarker: {
        name: "block",
        width: 8,
        height: 6
      }
    }
  };
}

function updateStudioEdge(cell: Edge, edge: GraphViewModelEdge, routing?: StudioEdgeRouting): void {
  cell.setData({ studioEdge: edge });
  cell.setSource(routing?.source ?? { cell: edge.source });
  cell.setTarget(routing?.target ?? { cell: edge.target });
  cell.setLabels(studioEdgeLabels(edge));
  cell.attr(studioEdgeAttrs(edge));
  cell.setRouter(routing?.router ?? STUDIO_EDGE_ORTH_ROUTER);
  cell.setVertices(routing?.vertices ?? []);
  cell.setConnector(routing?.connector ?? STUDIO_EDGE_CONNECTOR);
}
