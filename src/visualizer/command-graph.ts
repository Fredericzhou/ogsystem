/**
 * @fileoverview Read-only command registry and Mermaid graph helpers for the visualizer.
 * Responsibilities:
 * - Re-export the shared command registry for visualizer-facing consumers.
 * - Provide stable Mermaid graph payloads without any runtime mutation.
 * Boundaries:
 * - No parsing, execution, or filesystem mutation.
 */
import { buildCommandGraphLiveUrl } from "../runtime/command-graph.js";
import {
  getCommandGraphNodes,
  getCommandRegistryHelp,
  getVisualizerCliOptions,
  getVisualizerCliUsage
} from "../runtime/command-registry.js";

export type VisualizerCommandGroup = {
  id: string;
  label: string;
  summary: string;
};

export type VisualizerCommand = {
  id: string;
  groupId: string;
  surface: "wrapper" | "base";
  command: string;
  summary: string;
  usage: string[];
  notes: string[];
};

export type VisualizerCommandGraph = {
  direction: "TD";
  mermaid: string;
  liveUrl: string;
  text: string;
  nodes: ReturnType<typeof getCommandGraphNodes>;
};

type VisualizerGraphNode = {
  id: string;
  label: string;
  summary: string;
  parentId?: string;
};

const COMMAND_GROUPS: VisualizerCommandGroup[] = [
  {
    id: "project",
    label: "ogs project",
    summary: "Project bootstrap and scaffolding commands."
  },
  {
    id: "run",
    label: "ogs run",
    summary: "Run lifecycle commands."
  },
  {
    id: "visualizer",
    label: "ogs visualizer",
    summary: "Read-only visualizer launch command."
  },
  {
    id: "base",
    label: "pnpm run",
    summary: "Direct command entrypoints."
  }
];

export function getVisualizerCommandGroups(): VisualizerCommandGroup[] {
  return COMMAND_GROUPS.slice();
}

export function getVisualizerCommands(): VisualizerCommand[] {
  const registry = getCommandRegistryHelp();
  const summaryById = new Map(buildVisualizerCommandGraphNodes().map((node) => [node.id, node.summary]));
  return [
    {
      id: "ogs",
      groupId: "project",
      surface: "wrapper",
      command: "ogs",
      summary: summaryById.get("ogs") ?? registry.runtimeRoot.title,
      usage: registry.runtimeRoot.lines.slice(),
      notes: ["Single-entry wrapper for project and run commands."]
    },
    {
      id: "ogs.project",
      groupId: "project",
      surface: "wrapper",
      command: "ogs project",
      summary: summaryById.get("ogs project") ?? registry.runtimeProject.title,
      usage: registry.runtimeProject.lines.slice(),
      notes: ["Uses the shared lifecycle registry for help and parsing."]
    },
    {
      id: "ogs.run",
      groupId: "run",
      surface: "wrapper",
      command: "ogs run",
      summary: summaryById.get("ogs run") ?? registry.runtimeRun.title,
      usage: registry.runtimeRun.lines.slice(),
      notes: ["Uses the shared lifecycle registry for help and parsing."]
    },
    {
      id: "ogs.visualizer",
      groupId: "visualizer",
      surface: "wrapper",
      command: "ogs visualizer",
      summary: summaryById.get("ogs visualizer") ?? registry.runtimeVisualizer.title,
      usage: registry.runtimeVisualizer.lines.slice(),
      notes: ["Launches the read-only visualizer from the wrapper CLI."]
    },
    {
      id: "ogs.run.start",
      groupId: "run",
      surface: "wrapper",
      command: "ogs run start",
      summary: summaryById.get("ogs run start") ?? "Start a new run",
      usage: ["ogs run start --system system.mmd --prompt \"...\" [options]"],
      notes: ["Starts a new run from a Mermaid system file."]
    },
    {
      id: "ogs.run.resume",
      groupId: "run",
      surface: "wrapper",
      command: "ogs run resume",
      summary: summaryById.get("ogs run resume") ?? "Resume an existing run",
      usage: ["ogs run resume <run-id> [options]"],
      notes: ["Resumes a previous run from its checkpointed state."]
    },
    {
      id: "ogs.run.stop",
      groupId: "run",
      surface: "wrapper",
      command: "ogs run stop",
      summary: summaryById.get("ogs run stop") ?? "Request run stop",
      usage: ["ogs run stop <run-id> [--reason <text>]"],
      notes: ["Requests stop through the runtime lifecycle layer."]
    },
    {
      id: "ogs.run.list",
      groupId: "run",
      surface: "wrapper",
      command: "ogs run list",
      summary: summaryById.get("ogs run list") ?? "List indexed runs",
      usage: ["ogs run list [--reindex]"],
      notes: ["Lists indexed runs or rebuilds the index first."]
    },
    {
      id: "ogs.run.status",
      groupId: "run",
      surface: "wrapper",
      command: "ogs run status",
      summary: summaryById.get("ogs run status") ?? "Show run status",
      usage: ["ogs run status <run-id>"],
      notes: ["Reads the stored summary and state projection."]
    },
    {
      id: "ogs.run.inspect",
      groupId: "run",
      surface: "wrapper",
      command: "ogs run inspect",
      summary: summaryById.get("ogs run inspect") ?? "Inspect run artifacts",
      usage: ["ogs run inspect <run-id>"],
      notes: ["Dumps the full run artifact bundle."]
    },
    {
      id: "ogs.run.logs",
      groupId: "run",
      surface: "wrapper",
      command: "ogs run logs",
      summary: summaryById.get("ogs run logs") ?? "Read run logs",
      usage: ["ogs run logs <run-id> [--engine|--role <roleId>] [--json] [--tail <n>]"],
      notes: ["Reads run logs with optional filtering."]
    },
    {
      id: "ogs.run.reindex",
      groupId: "run",
      surface: "wrapper",
      command: "ogs run reindex",
      summary: summaryById.get("ogs run reindex") ?? "Rebuild the runs index",
      usage: ["ogs run reindex"],
      notes: ["Refreshes the cached run index from the filesystem."]
    },
    {
      id: "run.adapter",
      groupId: "base",
      surface: "base",
      command: "pnpm run run:adapter",
      summary: summaryById.get("pnpm run run:adapter") ?? registry.runtimeLegacy.title,
      usage: registry.runtimeLegacy.lines.slice(),
      notes: ["Legacy-compatible runtime entrypoint."]
    },
    {
      id: "run.nl2mmd",
      groupId: "base",
      surface: "base",
      command: "pnpm run run:nl2mmd",
      summary: summaryById.get("pnpm run run:nl2mmd") ?? registry.nl2mmd.title,
      usage: registry.nl2mmd.lines.slice(),
      notes: ["Conversation-driven Mermaid drafting."]
    },
    {
      id: "run.visualizer",
      groupId: "base",
      surface: "base",
      command: "pnpm run run:visualizer",
      summary: summaryById.get("pnpm run run:visualizer") ?? registry.visualizer.title,
      usage: registry.visualizer.lines.slice(),
      notes: ["Read-only visualizer server."]
    }
  ];
}

export function getVisualizerCommandRegistry() {
  return getCommandRegistryHelp();
}

export function getVisualizerCommandGraph(): VisualizerCommandGraph {
  const nodes = buildVisualizerCommandGraphNodes();
  const mermaid = buildVisualizerCommandGraphMermaid(nodes);
  return {
    direction: "TD",
    mermaid,
    liveUrl: buildCommandGraphLiveUrl(mermaid),
    text: buildVisualizerCommandGraphText(nodes),
    nodes: nodes as ReturnType<typeof getCommandGraphNodes>
  };
}

function buildVisualizerCommandGraphNodes(): VisualizerGraphNode[] {
  return [
    { id: "ogs", label: "ogs", summary: "Runtime wrapper root" },
    { id: "ogs project", label: "ogs project", summary: "Project lifecycle commands", parentId: "ogs" },
    { id: "ogs project init", label: "project init", summary: "Create local control plane", parentId: "ogs project" },
    { id: "ogs project create", label: "project create", summary: "Scaffold a project from template", parentId: "ogs project" },
    { id: "ogs run", label: "ogs run", summary: "Runtime execution commands", parentId: "ogs" },
    { id: "ogs run start", label: "run start", summary: "Start a new run", parentId: "ogs run" },
    { id: "ogs run resume", label: "run resume", summary: "Resume an existing run", parentId: "ogs run" },
    { id: "ogs run stop", label: "run stop", summary: "Request run stop", parentId: "ogs run" },
    { id: "ogs run list", label: "run list", summary: "List indexed runs", parentId: "ogs run" },
    { id: "ogs run status", label: "run status", summary: "Show run status", parentId: "ogs run" },
    { id: "ogs run inspect", label: "run inspect", summary: "Inspect run artifacts", parentId: "ogs run" },
    { id: "ogs run logs", label: "run logs", summary: "Read run logs", parentId: "ogs run" },
    { id: "ogs run reindex", label: "run reindex", summary: "Rebuild the runs index", parentId: "ogs run" },
    { id: "ogs visualizer", label: "visualizer", summary: "Launch the read-only visualizer", parentId: "ogs" },
    { id: "ogs help", label: "ogs help", summary: "Show help", parentId: "ogs" },
    { id: "pnpm run run:adapter", label: "run:adapter", summary: "Legacy-compatible runtime mode" },
    { id: "pnpm run run:nl2mmd", label: "run:nl2mmd", summary: "Conversation-driven Mermaid drafting" },
    { id: "pnpm run run:visualizer", label: "run:visualizer", summary: "Read-only visualizer server" }
  ];
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/"/g, "'");
}

function nodeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
}

function buildVisualizerCommandGraphMermaid(nodes: VisualizerGraphNode[]): string {
  const lines = ["flowchart TD", '  root["OGSystem command surface"]'];
  for (const node of nodes) {
    if (node.id === "ogs") continue;
    const id = nodeId(node.id);
    lines.push(`  ${id}["${escapeMermaidLabel(node.label)}"]`);
  }
  for (const node of nodes) {
    if (!node.parentId) continue;
    lines.push(`  ${nodeId(node.parentId)} --> ${nodeId(node.id)}`);
  }
  lines.push('  root --> ogs');
  return lines.join("\n");
}

function buildVisualizerCommandGraphText(nodes: VisualizerGraphNode[]): string {
  return nodes
    .map((node) => `${node.id} | ${node.summary}${node.parentId ? ` | parent=${node.parentId}` : ""}`)
    .join("\n");
}

export {
  buildCommandGraphLiveUrl as buildVisualizerCommandGraphLiveUrl,
  getCommandGraphNodes,
  getCommandRegistryHelp,
  getVisualizerCliOptions,
  getVisualizerCliUsage
};
