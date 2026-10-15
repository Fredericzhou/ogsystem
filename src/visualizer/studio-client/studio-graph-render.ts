import type { Edge, Graph, Node } from "@antv/x6";

import type { GraphViewModel, GraphViewModelEdge, GraphViewModelNode } from "../studio-contracts.js";
import { roleColorForId } from "../role-color.js";
import {
  formatStudioEdgeLabel,
  formatStudioEdgeSummaryLabel,
  formatStudioEdgeTopologyLabel,
  estimateStudioEdgeSummaryLabelWidth,
  STUDIO_EDGE_SUMMARY_LABEL_MAX_WIDTH
} from "../studio-edge-semantics.js";
import {
  formatStudioNodeLabel,
  type LayoutEdgeBundle,
  type LayoutEdgeRouting,
  type LayoutPortSpec,
  type LayoutProjection,
  type LayoutSide
} from "./semantic-layout-projection.js";
import { studioRoleMarkerVisible, studioRoleMonogram } from "./studio-role-marker.js";

export {
  formatStudioEdgeLabel,
  formatStudioEdgeSummaryLabel,
  formatStudioEdgeTopologyLabel
} from "../studio-edge-semantics.js";

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
  if (node.kind === "boundary") return "#91aa9d";
  if (node.roleSeat) return roleColorForId(node.roleId).accent;
  return "#55798c";
}

function edgeStroke(edge: GraphViewModelEdge): string {
  if (edge.diagnostic?.severity === "error") return "#c9674b";
  if (edge.diagnostic?.severity === "warning" || edge.runtimeOnlyErrorFlow) return "#bc8b39";
  if (edge.channel === "loop" || edge.channel === "feedback" || edge.topologyOrder?.endsWith("L")) return "#55798c";
  if (edge.participatesInJoin) return "#1b7662";
  return "#82998e";
}

function isLoopEdge(edge: GraphViewModelEdge): boolean {
  return edge.channel === "loop"
    || edge.channel === "feedback"
    || edge.topologyOrder?.endsWith("L") === true
    || edge.source === edge.target;
}

function nodeLabel(node: GraphViewModelNode): string {
  return formatStudioNodeLabel(node);
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
  args: { radius: 4 }
};
const STUDIO_BOUNDARY_CONNECTION_POINT = {
  name: "boundary",
  args: { offset: 0 }
} as const;

function projectionRouting(routing: LayoutEdgeRouting): StudioEdgeRouting {
  const toTerminal = (value: LayoutEdgeRouting["source"]): StudioEdgeTerminal => value.port
    ? { cell: value.cell, port: value.port, connectionPoint: { name: "anchor" } }
    : {
        cell: value.cell,
        anchor: {
          name: value.side,
          args: value.offset
            ? value.side === "top" || value.side === "bottom" ? { dx: value.offset } : { dy: value.offset }
            : {}
        },
        connectionPoint: STUDIO_BOUNDARY_CONNECTION_POINT
      };
  return {
    source: toTerminal(routing.source),
    target: toTerminal(routing.target),
    // A projection with vertices already owns the route. Letting X6 run a
    // second router here can add terminal loops or undo ELK's channel lanes.
    router: routing.routePoints.length > 0
      ? { name: "normal", args: {} }
      : routing.router as NonNullable<Edge.Metadata["router"]>,
    connector: routing.connector as NonNullable<Edge.Metadata["connector"]>,
    vertices: routing.routePoints
  };
}

export function renderStudioGraphViewModel(
  graph: Graph,
  viewModel: GraphViewModel,
  projection: LayoutProjection,
  options: { showTechnicalDetails?: boolean } = {}
): void {
  const showTechnicalDetails = options.showTechnicalDetails !== false;
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
        updateStudioEdge(existing, edge, routingByEdgeId.get(edge.id), undefined, showTechnicalDetails);
      } else {
        graph.addEdge(studioEdgeMetadata(edge, routingByEdgeId.get(edge.id), showTechnicalDetails));
      }
    }

    // Edge terminals must be rebound while the previous ports still exist.
    // Remove obsolete ports only after every business edge has its new stable
    // endpoint, otherwise X6 can rewrite the edge to a node boundary.
    for (const node of projectedViewModel.nodes) {
      const cell = graph.getCellById(node.id);
      if (!cell?.isNode()) continue;
      finalizeStudioNodePorts(cell, node, portsByNodeId.get(node.id));
    }

  });
  positionStudioEdgeLabels(graph, viewModel.edges, showTechnicalDetails);
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
  paddingX: number;
  paddingY: number;
  color: { fill: string; stroke: string; label: string };
};

const SCC_GROUP_PADDING_X = 12;
const SCC_GROUP_PADDING_Y = 64;

export function studioSccGroupGeometry(args: {
  members: readonly { id: string; x: number; y: number; width: number; height: number }[];
  obstacles: readonly { id: string; x: number; y: number; width: number; height: number }[];
  paddingX?: number;
  paddingY?: number;
}): { x: number; y: number; width: number; height: number; paddingX: number; paddingY: number } | undefined {
  if (!args.members.length) return undefined;
  const left = Math.min(...args.members.map((node) => node.x));
  const top = Math.min(...args.members.map((node) => node.y));
  const right = Math.max(...args.members.map((node) => node.x + node.width));
  const bottom = Math.max(...args.members.map((node) => node.y + node.height));
  let paddingX = args.paddingX ?? SCC_GROUP_PADDING_X;
  let paddingY = args.paddingY ?? SCC_GROUP_PADDING_Y;
  for (const obstacle of args.obstacles) {
    const gapX = Math.max(obstacle.x - right, left - (obstacle.x + obstacle.width), 0);
    const gapY = Math.max(obstacle.y - bottom, top - (obstacle.y + obstacle.height), 0);
    if (gapX < paddingX && gapY < paddingY) {
      // Keep the larger free gap as the separating axis and tighten the other margin.
      if (gapX >= gapY) paddingX = Math.min(paddingX, gapX);
      else paddingY = Math.min(paddingY, gapY);
    }
  }
  return {
    x: left - paddingX,
    y: top - paddingY,
    width: right - left + paddingX * 2,
    height: bottom - top + paddingY * 2,
    paddingX,
    paddingY
  };
}

const SCC_COLORS = [
  { fill: "rgba(45, 212, 191, 0.025)", stroke: "rgba(45, 212, 191, 0.38)", label: "#7fbdb4" },
  { fill: "rgba(96, 165, 250, 0.025)", stroke: "rgba(96, 165, 250, 0.38)", label: "#8eafd0" },
  { fill: "rgba(251, 191, 36, 0.025)", stroke: "rgba(251, 191, 36, 0.38)", label: "#c6ae71" },
  { fill: "rgba(192, 132, 252, 0.025)", stroke: "rgba(192, 132, 252, 0.38)", label: "#b39acb" }
];

function buildSccGroups(nodes: readonly GraphViewModelNode[], graph: Graph): SccGroup[] {
  const groups = new Map<string, GraphViewModelNode[]>();
  for (const node of nodes) {
    if (!node.topologyComponentId?.startsWith("SCC-")) continue;
    groups.set(node.topologyComponentId, [...(groups.get(node.topologyComponentId) ?? []), node]);
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([label, members], index) => {
    const memberIds = members.map((node) => node.id).sort();
    const geometry = studioSccGroupGeometry({
      members: members.map((node) => ({ id: node.id, ...node.layout })),
      obstacles: nodes
        .filter((node) => !memberIds.includes(node.id))
        .map((node) => ({ id: node.id, ...node.layout }))
    })!;
    return {
      id: `__ogs-scc-${label}`,
      label,
      ...geometry,
      memberIds,
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
        paddingX: group.paddingX,
        paddingY: group.paddingY,
        lastPosition: { x: group.x, y: group.y }
      }
    },
    interacting: true
  };
}

function sccGroupAttrs(group: SccGroup): Node.Metadata["attrs"] {
  return {
    body: { fill: group.color.fill, stroke: group.color.stroke, strokeWidth: 1.2, strokeDasharray: "5 7", rx: 12, ry: 12 },
    label: { text: group.label, refX: 12, refY: 6, textAnchor: "start", textVerticalAnchor: "top", fill: group.color.label, fontSize: 10, fontWeight: 700 }
  };
}

function updateSccGroup(cell: Node, group: SccGroup): void {
  cell.setData({
    studioSccGroup: {
      memberIds: group.memberIds,
      paddingX: group.paddingX,
      paddingY: group.paddingY,
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
  const nodes = graph.getNodes();
  for (const group of nodes.filter(isStudioSccGroup)) {
    const data = group.getData() as { studioSccGroup?: { memberIds?: unknown; paddingX?: unknown; paddingY?: unknown } } | undefined;
    const memberIds = Array.isArray(data?.studioSccGroup?.memberIds)
      ? data.studioSccGroup.memberIds.filter((id): id is string => typeof id === "string")
      : [];
    const members = memberIds
      .map((id) => graph.getCellById(id))
      .filter((cell): cell is Node => Boolean(cell?.isNode() && !isStudioSccGroup(cell)));
    if (!members.length) continue;
    const geometry = studioSccGroupGeometry({
      members: members.map((member) => ({ id: member.id, ...member.getPosition(), ...member.getSize() })),
      obstacles: nodes
        .filter((node) => !memberIds.includes(node.id) && !isStudioSccGroup(node))
        .map((node) => ({ id: node.id, ...node.getPosition(), ...node.getSize() })),
      paddingX: Number.isFinite(data?.studioSccGroup?.paddingX) ? Number(data.studioSccGroup.paddingX) : undefined,
      paddingY: Number.isFinite(data?.studioSccGroup?.paddingY) ? Number(data.studioSccGroup.paddingY) : undefined
    });
    if (!geometry) continue;
    group.position(geometry.x, geometry.y);
    group.resize(geometry.width, geometry.height);
    group.setData({
      studioSccGroup: {
        memberIds,
        paddingX: geometry.paddingX,
        paddingY: geometry.paddingY,
        lastPosition: { x: geometry.x, y: geometry.y }
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
      r: 4,
      magnet: true,
      stroke: direction === "in" ? "#bae6fd" : "#67e8f9",
      strokeWidth: 1.5,
      fill: "#07111f",
      "vector-effect": "non-scaling-stroke",
      "data-studio-port": direction
    }
  };
}

function fallbackPortSpecs(node: GraphViewModelNode): StudioPortSpec[] {
  if (!node.roleSeat) return [];
  return [
    { id: "in-fallback", direction: "in", side: "left", offset: 0 },
    { id: "out-fallback", direction: "out", side: "right", offset: 0 }
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
      { tagName: "title", selector: "nodeTitle" },
      { tagName: "rect", selector: "roleMarkerBadge", className: "studio-role-marker-badge" },
      { tagName: "text", selector: "roleMarkerText", className: "studio-role-marker-text" },
      { tagName: "text", selector: "label" },
      { tagName: "text", selector: "description" },
      { tagName: "circle", selector: "diagnosticBadge" },
      { tagName: "text", selector: "diagnosticText" }
    ],
    data: { studioNode: node },
    attrs: studioNodeAttrs(node),
    ports: studioNodePorts(node, ports)
  };
}

function nodeFill(node: GraphViewModelNode): string {
  if (node.kind === "boundary") return "#f1f7f3";
  if (node.roleSeat) return "#ffffff";
  return "#ffffff";
}

function studioNodeAttrs(node: GraphViewModelNode): Node.Metadata["attrs"] {
  const showRoleMarker = studioRoleMarkerVisible(node);
  const roleColor = showRoleMarker ? roleColorForId(node.roleId) : undefined;
  const markerX = 28;
  const markerY = 10;
  return {
    body: {
      rx: node.kind === "boundary" ? 20 : 8,
      ry: node.kind === "boundary" ? 20 : 8,
      fill: nodeFill(node),
      stroke: nodeStroke(node),
      strokeWidth: node.kind === "boundary" ? 1.2 : 1.5,
      strokeDasharray: node.kind === "boundary" ? "6 4" : ""
    },
    nodeTitle: {
      text: showRoleMarker ? formatStudioNodeLabel(node) : ""
    },
    roleMarkerBadge: {
      x: markerX - 22,
      y: markerY - 12,
      width: 44,
      height: 24,
      rx: 8,
      ry: 8,
      fill: roleColor?.fill ?? "none",
      fillOpacity: 1,
      stroke: roleColor?.accent ?? "none",
      strokeOpacity: 0.85,
      strokeWidth: 1.6,
      visibility: showRoleMarker ? "visible" : "hidden"
    },
    roleMarkerText: {
      x: markerX - node.layout.width / 2,
      y: markerY - node.layout.height / 2 + 3.5,
      text: node.roleSeat ? studioRoleMonogram(node.label, node.roleId) : "",
      textAnchor: "middle",
      fontSize: 11,
      fontWeight: 700,
      fill: "#29463b",
      visibility: showRoleMarker ? "visible" : "hidden"
    },
    label: {
      text: showRoleMarker ? node.label : nodeLabel(node),
      ...(showRoleMarker ? {
        x: 70 - node.layout.width / 2,
        y: 0,
        textAnchor: "start",
        textVerticalAnchor: "middle"
      } : {}),
      fill: node.kind === "boundary" ? "#165f50" : "#243b32",
      fontSize: node.kind === "boundary" ? 14 : 13,
      fontWeight: 650,
      textWrap: {
        width: node.layout.width - (showRoleMarker ? 74 : 18),
        height: node.layout.height - 12,
        ellipsis: true
      }
    },
    description: {
      text: node.description || "",
      x: 70 - node.layout.width / 2,
      y: 19,
      textAnchor: "start",
      textVerticalAnchor: "middle",
      fill: "#6b7e78",
      fontSize: 11,
      fontWeight: 450,
      textWrap: {
        width: node.layout.width - 76,
        height: 36,
        ellipsis: true
      },
      visibility: node.description ? "visible" : "hidden"
    },
    diagnosticBadge: {
      cx: node.layout.width - 14,
      cy: 14,
      r: 9,
      fill: node.diagnostic?.severity === "error" ? "#c9674b" : "#bc8b39",
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
      fill: "#ffffff",
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
  const currentPorts = cell.getPorts();
  const missingPorts = nextPorts.items.filter((port) => !cell.hasPort(String(port.id ?? "")));
  const currentGroups = (cell.getProp("ports") as { groups?: Record<string, unknown> } | undefined)?.groups ?? {};
  cell.setProp("ports", {
    groups: { ...currentGroups, ...nextPorts.groups },
    // Retain stale ports until all edge terminals have been rebound.
    items: [...currentPorts, ...missingPorts]
  });
}

function finalizeStudioNodePorts(cell: Node, node: GraphViewModelNode, projectedPorts?: readonly StudioPortSpec[]): void {
  const nextPorts = studioNodePorts(node, projectedPorts);
  const expectedPortIds = new Set(nextPorts.items.map((port) => String(port.id ?? "")));
  const stalePorts = cell.getPorts()
    .map((port) => String(port.id ?? ""))
    .filter((id) => id && !expectedPortIds.has(id));
  if (stalePorts.length) cell.removePorts(stalePorts);
  cell.setProp("ports", {
    groups: nextPorts.groups,
    items: cell.getPorts()
  });
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

function studioEdgeMetadata(
  edge: GraphViewModelEdge,
  routing?: StudioEdgeRouting,
  showTechnicalDetails = true
): Edge.Metadata {
  return {
    id: edge.id,
    source: routing?.source ?? { cell: edge.source },
    target: routing?.target ?? { cell: edge.target },
    zIndex: 1,
    data: { studioEdge: edge },
    labels: studioEdgeLabels(edge, undefined, showTechnicalDetails),
    attrs: studioEdgeAttrs(edge),
    router: routing?.router,
    connector: routing?.connector ?? STUDIO_EDGE_CONNECTOR,
    vertices: routing?.vertices
  };
}

type StudioEdgeLabelPosition = { distance: number; offset: number };
type StudioEdgeLabelPositions = { summary: StudioEdgeLabelPosition; topology?: StudioEdgeLabelPosition };
type StudioLabelRect = { left: number; right: number; top: number; bottom: number };

function positionStudioEdgeLabels(graph: Graph, edges: readonly GraphViewModelEdge[], showTechnicalDetails: boolean): void {
  const visibleNodes = Array.from(graph.container.querySelectorAll<SVGGElement>(".x6-node[data-cell-id]"))
    .filter((node) => !node.getAttribute("data-cell-id")?.startsWith("__ogs-scc-"))
    .map((node) => {
      const bounds = node.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
    });
  const ordered = edges.map((edge) => ({
    edge,
    width: estimateStudioEdgeSummaryLabelWidth(showTechnicalDetails ? formatStudioEdgeSummaryLabel(edge) : edge.label)
  })).sort((left, right) => right.width - left.width || left.edge.id.localeCompare(right.edge.id));
  const canvasBounds = graph.container.getBoundingClientRect();
  const viewport: StudioLabelRect = {
    left: canvasBounds.left,
    right: canvasBounds.right,
    top: canvasBounds.top,
    bottom: canvasBounds.bottom
  };
  const reservations: StudioLabelRect[] = [];
  for (const { edge } of ordered) {
    if (!formatStudioEdgeTopologyLabel(edge) ||
      estimateStudioEdgeSummaryLabelWidth(showTechnicalDetails ? formatStudioEdgeSummaryLabel(edge) : edge.label) > STUDIO_EDGE_SUMMARY_LABEL_MAX_WIDTH) continue;
    const cell = graph.getCellById(edge.id);
    const view = cell?.isEdge() ? graph.findViewByCell(cell) : null;
    const badge = view?.container.querySelector<SVGGElement>('.x6-edge-label[data-index="0"]');
    if (!badge) continue;
    const bounds = badge.getBoundingClientRect();
    reservations.push({ left: bounds.left - 4, right: bounds.right + 4, top: bounds.top - 4, bottom: bounds.bottom + 4 });
  }

  for (const { edge } of ordered) {
    const topologyLabel = Boolean(formatStudioEdgeTopologyLabel(edge)) &&
      estimateStudioEdgeSummaryLabelWidth(showTechnicalDetails ? formatStudioEdgeSummaryLabel(edge) : edge.label) <= STUDIO_EDGE_SUMMARY_LABEL_MAX_WIDTH;
    const labelIndex = topologyLabel ? 1 : 0;
    const defaultLabels = studioEdgeLabels(edge, undefined, showTechnicalDetails);
    const defaultPosition = defaultLabels[labelIndex]?.position as StudioEdgeLabelPosition | undefined;
    const position = findStudioEdgeLabelPosition(
      graph,
      edge,
      labelIndex,
      visibleNodes,
      reservations,
      viewport,
      defaultPosition?.offset ?? 0,
      showTechnicalDetails
    );
    if (!position) continue;
    reservations.push(position.bounds);
  }
}

function findStudioEdgeLabelPosition(
  graph: Graph,
  edge: GraphViewModelEdge,
  labelIndex: number,
  obstacles: readonly StudioLabelRect[],
  reserved: readonly StudioLabelRect[],
  viewport: StudioLabelRect,
  preferredOffset: number,
  showTechnicalDetails: boolean
): { position: StudioEdgeLabelPosition; bounds: StudioLabelRect } | undefined {
  const cell = graph.getCellById(edge.id);
  if (!cell?.isEdge()) return undefined;
  const view = graph.findViewByCell(cell) as unknown as StudioEdgeViewGeometry | null;
  const path = view?.container.querySelector<SVGPathElement>("path[marker-end]");
  const label = view?.container.querySelector<SVGGElement>(`.x6-edge-label[data-index="${labelIndex}"]`);
  const matrix = path?.getScreenCTM();
  if (!view || !path || !label || !matrix) return undefined;
  const length = path.getTotalLength();
  if (length <= 1) return undefined;
  const labelSize = label.getBoundingClientRect();
  const width = labelSize.width + 4;
  const summaryText = showTechnicalDetails ? formatStudioEdgeSummaryLabel(edge) : edge.label;
  const inlineTopology = estimateStudioEdgeSummaryLabelWidth(summaryText) > STUDIO_EDGE_SUMMARY_LABEL_MAX_WIDTH
    ? formatStudioEdgeTopologyLabel(edge)
    : "";
  const summaryWidth = estimateStudioEdgeSummaryLabelWidth(inlineTopology ? `${inlineTopology} ${summaryText}` : summaryText);
  const summaryHeight = Math.ceil(summaryWidth / STUDIO_EDGE_SUMMARY_LABEL_MAX_WIDTH) * 20 + 12;
  const height = Math.max(labelSize.height, summaryHeight) + 8;
  const fractions = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8, 0.1, 0.9, 0.05, 0.95, 0.02, 0.98];
  // Keep labels attached to their route. Long-range offsets avoid collisions
  // visually, but make a flow label read as if it belongs to another edge.
  const offsetRange = edge.topologyOrder?.endsWith("L") ? 10 : 18;
  const offsets = [...new Set([preferredOffset, 0, preferredOffset + offsetRange, preferredOffset - offsetRange])];
  const candidates = fractions.flatMap((fraction) => {
    const distance = length * fraction;
    const point = path.getPointAtLength(distance);
    const before = path.getPointAtLength(Math.max(0, distance - 2));
    const after = path.getPointAtLength(Math.min(length, distance + 2));
    const screenPoint = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    const screenBefore = new DOMPoint(before.x, before.y).matrixTransform(matrix);
    const screenAfter = new DOMPoint(after.x, after.y).matrixTransform(matrix);
    const tangentLength = Math.hypot(screenAfter.x - screenBefore.x, screenAfter.y - screenBefore.y) || 1;
    const normal = {
      x: -(screenAfter.y - screenBefore.y) / tangentLength,
      y: (screenAfter.x - screenBefore.x) / tangentLength
    };
    const normalScale = Math.hypot(
      matrix.a * normal.x + matrix.c * normal.y,
      matrix.b * normal.x + matrix.d * normal.y
    ) || 1;
    return offsets.map((offset) => {
      const x = screenPoint.x + normal.x * offset * normalScale;
      const y = screenPoint.y + normal.y * offset * normalScale;
      return {
        position: { distance: fraction, offset },
        bounds: { left: x - width / 2, right: x + width / 2, top: y - height / 2, bottom: y + height / 2 },
        fraction,
        offset
      };
    });
  });
  const intersects = (left: StudioLabelRect, right: StudioLabelRect) =>
    left.left < right.right && right.left < left.right && left.top < right.bottom && right.top < left.bottom;
  const predictedScore = (candidate: typeof candidates[number]) =>
    obstacles.filter((obstacle) => intersects(candidate.bounds, obstacle)).length * 10000 +
    reserved.filter((obstacle) => intersects(candidate.bounds, obstacle)).length * 1000 +
    (candidate.bounds.left < viewport.left || candidate.bounds.right > viewport.right ||
      candidate.bounds.top < viewport.top || candidate.bounds.bottom > viewport.bottom ? 10000 : 0) +
    Math.abs(candidate.fraction - 0.5) * 10 + Math.abs(candidate.offset - preferredOffset) * 0.01;
  const best = candidates.slice().sort((left, right) => predictedScore(left) - predictedScore(right))[0];
  if (!best) return undefined;
  const currentLabels = cell.getLabels();
  cell.setLabels(studioEdgeLabels(edge, {
    summary: best.position,
    ...(formatStudioEdgeTopologyLabel(edge)
      ? { topology: currentLabels[0]?.position as StudioEdgeLabelPosition ?? { distance: 0.5, offset: -15 } }
      : {})
  }, showTechnicalDetails));
  return { position: best.position, bounds: best.bounds };
}

function studioEdgeLabels(
  edge: GraphViewModelEdge,
  positions?: StudioEdgeLabelPositions,
  showTechnicalDetails = true
): Edge.Metadata["labels"] {
  const labels: NonNullable<Edge.Metadata["labels"]> = [];
  const summaryLabel = showTechnicalDetails ? formatStudioEdgeSummaryLabel(edge) : edge.label;
  const topologyLabel = formatStudioEdgeTopologyLabel(edge);
  const hasWrappedSummaryLabel = estimateStudioEdgeSummaryLabelWidth(summaryLabel) > STUDIO_EDGE_SUMMARY_LABEL_MAX_WIDTH;
  const inlineTopologyLabel = hasWrappedSummaryLabel ? formatStudioEdgeTopologyLabel(edge) : "";
  const renderedSummaryLabel = inlineTopologyLabel ? `${inlineTopologyLabel} ${summaryLabel}` : summaryLabel;
  const summaryLabelHeight = Math.ceil(
    estimateStudioEdgeSummaryLabelWidth(renderedSummaryLabel) / STUDIO_EDGE_SUMMARY_LABEL_MAX_WIDTH
  ) * 20 + 12;
  const separateTopologyLabel = topologyLabel && !hasWrappedSummaryLabel;
  const topologyLabelOffset = 15;
  const summaryLabelOffset = separateTopologyLabel ? 9 : 0;
  const summaryPosition = positions?.summary ?? { distance: 0.5, offset: summaryLabelOffset };
  const isCycle = edge.topologyOrder?.endsWith("L") === true;
  if (separateTopologyLabel) {
    labels.push({
      position: {
        distance: positions?.topology?.distance ?? 0.5,
        offset: positions?.topology?.offset ?? -topologyLabelOffset
      },
      markup: [
        { tagName: "rect", selector: "body", className: "studio-edge-label-body" },
        { tagName: "text", selector: "label" }
      ],
      attrs: {
        label: {
          text: topologyLabel,
          fill: isCycle ? "#165f50" : "#55798c",
          fontSize: 10,
          fontWeight: 800
        },
        body: {
          fill: "#f1f7f3",
          stroke: isCycle ? "#1b7662" : "#9fc3b1",
          strokeWidth: 1,
          rx: 5,
          ry: 5
        }
      }
    });
  }
  labels.push({
    markup: [
      { tagName: "rect", selector: "body", className: "studio-edge-label-body" },
      { tagName: "text", selector: "label" }
    ],
    position: {
      distance: summaryPosition.distance,
      offset: summaryPosition.offset
    },
    attrs: {
      label: {
        text: renderedSummaryLabel,
        fill: "#33483f",
        fontSize: 11,
        textWrap: {
          width: STUDIO_EDGE_SUMMARY_LABEL_MAX_WIDTH,
          height: summaryLabelHeight,
          ellipsis: false
        }
      },
      body: {
        fill: "#ffffff",
        stroke: edgeStroke(edge),
        strokeWidth: 1.2,
        rx: 4,
        ry: 4
      }
    }
  });
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
          fill: edge.diagnostic.severity === "error" ? "#c9674b" : "#bc8b39",
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
  const stroke = edgeStroke(edge);
  const loopEdge = isLoopEdge(edge);
  return {
    line: {
      stroke,
      strokeWidth: loopEdge ? 2.2 : edge.participatesInJoin ? 2.4 : 1.7,
      strokeDasharray: loopEdge ? "7 5" : "",
      strokeLinecap: "round",
      targetMarker: {
        name: "block",
        width: loopEdge ? 14 : 12,
        height: loopEdge ? 10 : 9,
        fill: stroke,
        stroke,
        strokeWidth: 1
      }
    }
  };
}

function updateStudioEdge(
  cell: Edge,
  edge: GraphViewModelEdge,
  routing?: StudioEdgeRouting,
  labelPosition?: StudioEdgeLabelPosition,
  showTechnicalDetails = true
): void {
  cell.setData({ studioEdge: edge });
  cell.setSource(routing?.source ?? { cell: edge.source });
  cell.setTarget(routing?.target ?? { cell: edge.target });
  cell.setLabels(studioEdgeLabels(edge, labelPosition, showTechnicalDetails));
  cell.attr(studioEdgeAttrs(edge));
  cell.setRouter(routing?.router ?? STUDIO_EDGE_ORTH_ROUTER);
  cell.setVertices(routing?.vertices ?? []);
  cell.setConnector(routing?.connector ?? STUDIO_EDGE_CONNECTOR);
}
