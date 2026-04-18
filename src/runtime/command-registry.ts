/**
 * Central command registry for help text, option specs, and visualizer graph generation.
 * Responsibilities:
 * - Keep CLI usage strings and parse option definitions in one source.
 * - Provide lightweight command metadata for command-graph rendering.
 * Boundaries:
 * - Does not parse argv or execute commands.
 */

export type CommandOptionSpec = {
  name: string;
  type: "string" | "boolean";
  short?: string;
  description: string;
};

export type CommandUsageSpec = {
  id: string;
  title: string;
  lines: string[];
  options: CommandOptionSpec[];
};

export type CommandGraphNodeSpec = {
  id: string;
  label: string;
  summary: string;
  parentId?: string;
};

export type CommandParseOptionMap = Record<
  string,
  {
    type: "string" | "boolean";
    short?: string;
  }
>;

export type RuntimeCommandId =
  | "project.init"
  | "project.create"
  | "run.start"
  | "run.resume"
  | "run.stop"
  | "run.list"
  | "run.status"
  | "run.inspect"
  | "run.logs"
  | "run.reindex"
  | "visualizer"
  | "legacy";

export type RuntimeCliTopic = "project" | "run" | "visualizer" | "legacy";

export type RuntimeCliSubcommand =
  | "project init"
  | "project create"
  | "run start"
  | "run resume"
  | "run stop"
  | "run list"
  | "run status"
  | "run inspect"
  | "run logs"
  | "run reindex"
  | "visualizer";

function cloneOptions(options: CommandOptionSpec[]): CommandOptionSpec[] {
  return options.map((option) => ({ ...option }));
}

function joinLines(lines: string[]): string {
  return lines.join("\n");
}

function parseArgsOptionsFromSpecs(
  specs: CommandOptionSpec[]
): Record<string, { type: "string" | "boolean"; short?: string }> {
  return Object.fromEntries(
    specs.map((spec) => {
      const option: { type: "string" | "boolean"; short?: string } = {
        type: spec.type
      };
      if (spec.short) {
        option.short = spec.short;
      }
      return [spec.name, option];
    })
  );
}

function cloneOptionMap(options: CommandParseOptionMap): CommandParseOptionMap {
  return Object.fromEntries(
    Object.entries(options).map(([name, spec]) => [name, { ...spec }])
  );
}

function makeOptionSpecs(specs: CommandOptionSpec[]): CommandOptionSpec[] {
  return cloneOptions(specs);
}

const runtimeRootUsage = [
  "Usage:",
  "  ogs project init",
  "  ogs project create <name> --template <minimal|software-dev|consultation>",
  "  ogs run start --system <file.mmd> --prompt <text> [options]",
  "  ogs run resume <run-id> [options]",
  "  ogs run stop <run-id> [--reason <text>]",
  "  ogs run list [--reindex]",
  "  ogs run status <run-id>",
  "  ogs run inspect <run-id>",
  "  ogs run logs <run-id> [--engine|--role <roleId>] [--json] [--tail <n>] [--since <iso>] [--follow]",
  "  ogs run reindex",
  "  ogs visualizer [--workdir <path>] [--host <host>] [--port <n>]",
  "",
  "Help:",
  "  ogs help [project|run|visualizer|legacy]",
  "  ogs project --help",
  "  ogs run --help",
  "  ogs visualizer --help",
  "",
  "Defaults:",
  "  project commands use the current directory unless --workdir is provided",
  "  run commands use the current directory unless --workdir is provided",
  "  visualizer uses the current directory unless --workdir is provided",
  "  project create writes a new project folder under the current directory",
  "",
  "Legacy-compatible mode:",
  "  pnpm run run:adapter -- --system <file.mmd> --prompt <text> [options]"
];

const runtimeProjectUsage = [
  "Usage:",
  "  ogs project init [--workdir <path>]",
  "  ogs project create <name> --template <minimal|software-dev|consultation> [--workdir <path>]",
  "",
  "Project lifecycle:",
  "  init   create .ogs/project.json, .ogs/runtime.json, .ogs/providers/opencode.json, and .ogs/runs-index.json",
  "  create scaffold a new project directory from a template",
  "",
  "Defaults:",
  "  current directory is the project root unless --workdir is set",
  "  create uses the current directory as the parent directory unless --workdir is set",
  "  templates are intentionally limited to keep project management consistent",
  "",
  "Templates:",
  "  minimal",
  "  software-dev",
  "  consultation",
  "",
  "Examples:",
  "  ogs project init",
  "  ogs project create demo-app --template minimal"
];

const runtimeRunUsage = [
  "Usage:",
  "  ogs run start --system <file.mmd> --prompt <text> [options]",
  "  ogs run resume <run-id> [options]",
  "  ogs run stop <run-id> [--reason <text>] [--workdir <path>]",
  "  ogs run list [--reindex] [--workdir <path>]",
  "  ogs run status <run-id> [--workdir <path>]",
  "  ogs run inspect <run-id> [--workdir <path>]",
  "  ogs run logs <run-id> [--engine|--role <roleId>] [--json] [--tail <n>] [--since <iso>] [--follow] [--workdir <path>]",
  "  ogs run reindex [--workdir <path>]",
  "",
  "Common Run Options:",
  "  --runtime <file>           Runtime config JSON override",
  "  --user-profile <file>      User profile JSON override",
  "  --laws <file>              Law catalog JSON override",
  "  --profiles <file>          Legacy execution profiles JSON (optional)",
  "  --tools <file>             Legacy CLI tools JSON (optional)",
  "  --workdir <path>           Working directory (default: cwd)",
  "  --cleanup-executions <n>   Keep only latest n per-role execution snapshots",
  "  --log-run                  Print role/transition runtime logs to stderr",
  "  --print-graph-link         Print Mermaid Live graph preview URL to stderr (run start only)",
  "  --trace-out <file>         Write final runtime result JSON",
  "  --dry-run                  Do not execute external commands",
  "  --help                     Show help"
];

const runtimeLegacyUsage = [
  "Usage:",
  "  pnpm run run:adapter -- --system <file.mmd> --prompt <text> [options]",
  "",
  "Legacy-compatible mode bridges the runtime directly.",
  "Prefer ogs project/run commands for normal project management."
];

const nl2mmdUsage = [
  "Usage:",
  "  pnpm run run:nl2mmd -- [--message <text>] [--model <modelId>]",
  "",
  "Base command:",
  "  direct entrypoint for prompt generation and validation against local roles/models",
  "",
  "Options:",
  "  --message <text>       One-shot NL2MMD request; omit for interactive mode",
  "  --model <modelId>      Default model id (default: fast-gpt54)",
  "  --runtime <file>       Runtime config JSON (optional)",
  "  --laws <file>          Laws JSON (optional)",
  "  --profiles <file>      Legacy profiles JSON for exec.bind validation (optional)",
  "  --user-profile <file>  User profile JSON for validation (optional)",
  "  --no-preflight         Skip startup preflight (default is preflight enabled)",
  "  --workdir <path>       Working directory (default: cwd)",
  "  --help                 Show help",
  "",
  "Defaults:",
  "  workdir defaults to the current directory",
  "  model defaults to fast-gpt54",
  "  preflight runs before the first turn unless disabled",
  "",
  "Interactive commands:",
  "  /help                  Show commands",
  "  /roles <query>         Search role repo",
  "  /models <query>        Search model repo",
  "  /laws                  List discovered law ids",
  "  /use-model <modelId>   Switch the conversation model",
  "  /status                Show current draft/model/session status",
  "  /validate              Re-run local validation for the current Mermaid draft",
  "  /clear                 Clear current draft/validation state",
  "  /quit                  Exit"
];

const visualizerUsage = [
  "Usage:",
  "  pnpm run run:visualizer -- [--workdir <path>] [--host <host>] [--port <n>]",
  "",
  "Defaults:",
  "  workdir: current directory",
  "  host: 127.0.0.1",
  "  port: 3337"
];

const runtimeVisualizerUsage = [
  "Usage:",
  "  ogs visualizer [--workdir <path>] [--host <host>] [--port <n>]",
  "",
  "Defaults:",
  "  workdir: current directory",
  "  host: 127.0.0.1",
  "  port: 3337"
];

const runtimeHelp: Record<string, CommandUsageSpec> = {
  root: {
    id: "runtime.root",
    title: "ogs",
    lines: runtimeRootUsage,
    options: []
  },
  project: {
    id: "runtime.project",
    title: "ogs project",
    lines: runtimeProjectUsage,
    options: [
      { name: "workdir", type: "string", description: "Working directory" },
      { name: "name", type: "string", description: "Project name" },
      { name: "help", type: "boolean", short: "h", description: "Show help" }
    ]
  },
  run: {
    id: "runtime.run",
    title: "ogs run",
    lines: runtimeRunUsage,
    options: [
      { name: "system", type: "string", description: "System Mermaid file" },
      { name: "runtime", type: "string", description: "Runtime config JSON override" },
      { name: "user-profile", type: "string", description: "User profile JSON override" },
      { name: "profiles", type: "string", description: "Legacy execution profiles JSON" },
      { name: "tools", type: "string", description: "Legacy CLI tools JSON" },
      { name: "laws", type: "string", description: "Law catalog JSON override" },
      { name: "prompt", type: "string", description: "Run prompt" },
      { name: "workdir", type: "string", description: "Working directory" },
      { name: "cleanup-executions", type: "string", description: "Keep only latest executions" },
      { name: "log-run", type: "boolean", description: "Print runtime logs" },
      { name: "print-graph-link", type: "boolean", description: "Print Mermaid Live graph preview URL" },
      { name: "trace-out", type: "string", description: "Write final runtime result JSON" },
      { name: "dry-run", type: "boolean", description: "Do not execute external commands" },
      { name: "help", type: "boolean", short: "h", description: "Show help" }
    ]
  },
  visualizer: {
    id: "runtime.visualizer",
    title: "ogs visualizer",
    lines: runtimeVisualizerUsage,
    options: [
      { name: "workdir", type: "string", description: "Working directory" },
      { name: "host", type: "string", description: "Bind host" },
      { name: "port", type: "string", description: "Bind port" },
      { name: "help", type: "boolean", short: "h", description: "Show help" }
    ]
  },
  legacy: {
    id: "runtime.legacy",
    title: "pnpm run run:adapter",
    lines: runtimeLegacyUsage,
    options: [
      { name: "system", type: "string", description: "System Mermaid file" },
      { name: "runtime", type: "string", description: "Runtime config JSON override" },
      { name: "user-profile", type: "string", description: "User profile JSON override" },
      { name: "resume-run", type: "string", description: "Resume run directory" },
      { name: "profiles", type: "string", description: "Legacy execution profiles JSON" },
      { name: "tools", type: "string", description: "Legacy CLI tools JSON" },
      { name: "laws", type: "string", description: "Law catalog JSON override" },
      { name: "prompt", type: "string", description: "Run prompt" },
      { name: "workdir", type: "string", description: "Working directory" },
      { name: "cleanup-executions", type: "string", description: "Keep only latest executions" },
      { name: "log-run", type: "boolean", description: "Print runtime logs" },
      { name: "print-graph-link", type: "boolean", description: "Print Mermaid Live graph preview URL" },
      { name: "trace-out", type: "string", description: "Write final runtime result JSON" },
      { name: "dry-run", type: "boolean", description: "Do not execute external commands" },
      { name: "help", type: "boolean", short: "h", description: "Show help" }
    ]
  }
};

const runtimeSubcommandOptions: Record<RuntimeCliSubcommand, CommandOptionSpec[]> = {
  "project init": makeOptionSpecs([
    { name: "workdir", type: "string", description: "Working directory" },
    { name: "name", type: "string", description: "Project name" },
    { name: "help", type: "boolean", short: "h", description: "Show help" }
  ]),
  "project create": makeOptionSpecs([
    { name: "template", type: "string", description: "Project template" },
    { name: "workdir", type: "string", description: "Working directory" },
    { name: "help", type: "boolean", short: "h", description: "Show help" }
  ]),
  "run start": makeOptionSpecs([
    { name: "system", type: "string", description: "System Mermaid file" },
    { name: "runtime", type: "string", description: "Runtime config JSON override" },
    { name: "user-profile", type: "string", description: "User profile JSON override" },
    { name: "profiles", type: "string", description: "Legacy execution profiles JSON" },
    { name: "tools", type: "string", description: "Legacy CLI tools JSON" },
    { name: "laws", type: "string", description: "Law catalog JSON override" },
    { name: "prompt", type: "string", description: "Run prompt" },
    { name: "workdir", type: "string", description: "Working directory" },
    { name: "cleanup-executions", type: "string", description: "Keep only latest executions" },
    { name: "log-run", type: "boolean", description: "Print runtime logs" },
    { name: "print-graph-link", type: "boolean", description: "Print Mermaid Live graph preview URL" },
    { name: "trace-out", type: "string", description: "Write final runtime result JSON" },
    { name: "dry-run", type: "boolean", description: "Do not execute external commands" },
    { name: "help", type: "boolean", short: "h", description: "Show help" }
  ]),
  "run resume": makeOptionSpecs([
    { name: "system", type: "string", description: "System Mermaid file" },
    { name: "runtime", type: "string", description: "Runtime config JSON override" },
    { name: "user-profile", type: "string", description: "User profile JSON override" },
    { name: "profiles", type: "string", description: "Legacy execution profiles JSON" },
    { name: "tools", type: "string", description: "Legacy CLI tools JSON" },
    { name: "laws", type: "string", description: "Law catalog JSON override" },
    { name: "prompt", type: "string", description: "Run prompt" },
    { name: "workdir", type: "string", description: "Working directory" },
    { name: "cleanup-executions", type: "string", description: "Keep only latest executions" },
    { name: "log-run", type: "boolean", description: "Print runtime logs" },
    { name: "trace-out", type: "string", description: "Write final runtime result JSON" },
    { name: "dry-run", type: "boolean", description: "Do not execute external commands" },
    { name: "help", type: "boolean", short: "h", description: "Show help" }
  ]),
  "run stop": makeOptionSpecs([
    { name: "workdir", type: "string", description: "Working directory" },
    { name: "reason", type: "string", description: "Stop reason" },
    { name: "help", type: "boolean", short: "h", description: "Show help" }
  ]),
  "run list": makeOptionSpecs([
    { name: "workdir", type: "string", description: "Working directory" },
    { name: "reindex", type: "boolean", description: "Rebuild the runs index first" },
    { name: "help", type: "boolean", short: "h", description: "Show help" }
  ]),
  "run status": makeOptionSpecs([
    { name: "workdir", type: "string", description: "Working directory" },
    { name: "help", type: "boolean", short: "h", description: "Show help" }
  ]),
  "run inspect": makeOptionSpecs([
    { name: "workdir", type: "string", description: "Working directory" },
    { name: "help", type: "boolean", short: "h", description: "Show help" }
  ]),
  "run logs": makeOptionSpecs([
    { name: "workdir", type: "string", description: "Working directory" },
    { name: "engine", type: "boolean", description: "Read engine logs" },
    { name: "role", type: "string", description: "Filter by role id" },
    { name: "tail", type: "string", description: "Tail count" },
    { name: "since", type: "string", description: "ISO lower bound" },
    { name: "follow", type: "boolean", description: "Follow live logs" },
    { name: "json", type: "boolean", description: "Print JSON output" },
    { name: "help", type: "boolean", short: "h", description: "Show help" }
  ]),
  "run reindex": makeOptionSpecs([
    { name: "workdir", type: "string", description: "Working directory" },
    { name: "help", type: "boolean", short: "h", description: "Show help" }
  ]),
  visualizer: makeOptionSpecs([
    { name: "workdir", type: "string", description: "Working directory" },
    { name: "host", type: "string", description: "Bind host" },
    { name: "port", type: "string", description: "Bind port" },
    { name: "help", type: "boolean", short: "h", description: "Show help" }
  ])
};

const nl2mmdHelp: CommandUsageSpec = {
  id: "nl2mmd.root",
  title: "pnpm run run:nl2mmd",
  lines: nl2mmdUsage,
  options: [
    { name: "message", type: "string", description: "One-shot NL2MMD request" },
    { name: "model", type: "string", description: "Default model id" },
    { name: "runtime", type: "string", description: "Runtime config JSON" },
    { name: "laws", type: "string", description: "Laws JSON" },
    { name: "profiles", type: "string", description: "Legacy profiles JSON" },
    { name: "user-profile", type: "string", description: "User profile JSON" },
    { name: "no-preflight", type: "boolean", description: "Skip startup preflight" },
    { name: "workdir", type: "string", description: "Working directory" },
    { name: "help", type: "boolean", short: "h", description: "Show help" }
  ]
};

const runtimeCommandOptions: Record<RuntimeCommandId, CommandParseOptionMap> = {
  "project.init": {
    workdir: { type: "string" },
    name: { type: "string" },
    help: { type: "boolean", short: "h" }
  },
  "project.create": {
    template: { type: "string" },
    workdir: { type: "string" },
    help: { type: "boolean", short: "h" }
  },
  "run.start": {
    system: { type: "string" },
    runtime: { type: "string" },
    "user-profile": { type: "string" },
    profiles: { type: "string" },
    tools: { type: "string" },
    laws: { type: "string" },
    prompt: { type: "string" },
    workdir: { type: "string" },
    "cleanup-executions": { type: "string" },
    "log-run": { type: "boolean" },
    "print-graph-link": { type: "boolean" },
    "trace-out": { type: "string" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" }
  },
  "run.resume": {
    system: { type: "string" },
    runtime: { type: "string" },
    "user-profile": { type: "string" },
    profiles: { type: "string" },
    tools: { type: "string" },
    laws: { type: "string" },
    prompt: { type: "string" },
    workdir: { type: "string" },
    "cleanup-executions": { type: "string" },
    "log-run": { type: "boolean" },
    "trace-out": { type: "string" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" }
  },
  "run.stop": {
    workdir: { type: "string" },
    reason: { type: "string" },
    help: { type: "boolean", short: "h" }
  },
  "run.list": {
    workdir: { type: "string" },
    reindex: { type: "boolean" },
    help: { type: "boolean", short: "h" }
  },
  "run.status": {
    workdir: { type: "string" },
    help: { type: "boolean", short: "h" }
  },
  "run.inspect": {
    workdir: { type: "string" },
    help: { type: "boolean", short: "h" }
  },
  "run.logs": {
    workdir: { type: "string" },
    engine: { type: "boolean" },
    role: { type: "string" },
    tail: { type: "string" },
    since: { type: "string" },
    follow: { type: "boolean" },
    json: { type: "boolean" },
    help: { type: "boolean", short: "h" }
  },
  "run.reindex": {
    workdir: { type: "string" },
    help: { type: "boolean", short: "h" }
  },
  visualizer: {
    workdir: { type: "string" },
    host: { type: "string" },
    port: { type: "string" },
    help: { type: "boolean", short: "h" }
  },
  legacy: {
    system: { type: "string" },
    runtime: { type: "string" },
    "user-profile": { type: "string" },
    "resume-run": { type: "string" },
    profiles: { type: "string" },
    tools: { type: "string" },
    laws: { type: "string" },
    prompt: { type: "string" },
    workdir: { type: "string" },
    "cleanup-executions": { type: "string" },
    "log-run": { type: "boolean" },
    "print-graph-link": { type: "boolean" },
    "trace-out": { type: "string" },
    "dry-run": { type: "boolean" },
    help: { type: "boolean", short: "h" }
  }
};

const visualizerHelp: CommandUsageSpec = {
  id: "visualizer.root",
  title: "pnpm run run:visualizer",
  lines: visualizerUsage,
  options: [
    { name: "workdir", type: "string", description: "Working directory" },
    { name: "host", type: "string", description: "Bind host" },
    { name: "port", type: "string", description: "Bind port" },
    { name: "help", type: "boolean", short: "h", description: "Show help" }
  ]
};

export function getRuntimeCliUsage(topic?: "project" | "run" | "visualizer" | "legacy"): string {
  if (topic === "project") {
    return joinLines(runtimeHelp.project.lines);
  }
  if (topic === "run") {
    return joinLines(runtimeHelp.run.lines);
  }
  if (topic === "visualizer") {
    return joinLines(runtimeHelp.visualizer.lines);
  }
  if (topic === "legacy") {
    return joinLines(runtimeHelp.legacy.lines);
  }
  return joinLines(runtimeHelp.root.lines);
}

export function getRuntimeCliOptions(topic: "project" | "run" | "visualizer" | "legacy"): Record<string, { type: "string" | "boolean"; short?: string }> {
  return parseArgsOptionsFromSpecs(cloneOptions(runtimeHelp[topic].options));
}

export function getRuntimeCommandOptions(commandId: RuntimeCommandId): CommandParseOptionMap {
  return cloneOptionMap(runtimeCommandOptions[commandId]);
}

export function getRuntimeCliSubcommandOptions(
  subcommand: RuntimeCliSubcommand
): Record<string, { type: "string" | "boolean"; short?: string }> {
  return parseArgsOptionsFromSpecs(cloneOptions(runtimeSubcommandOptions[subcommand]));
}

export function getNl2MmdCliUsage(): string {
  return joinLines(nl2mmdHelp.lines);
}

export function getNl2MmdCliOptions(): Record<string, { type: "string" | "boolean"; short?: string }> {
  return parseArgsOptionsFromSpecs(cloneOptions(nl2mmdHelp.options));
}

export function getVisualizerCliUsage(): string {
  return joinLines(visualizerHelp.lines);
}

export function getVisualizerCliOptions(): Record<string, { type: "string" | "boolean"; short?: string }> {
  return parseArgsOptionsFromSpecs(cloneOptions(visualizerHelp.options));
}

export function getCommandRegistryHelp(): Record<string, CommandUsageSpec> {
  return {
    runtimeRoot: runtimeHelp.root,
    runtimeProject: runtimeHelp.project,
    runtimeRun: runtimeHelp.run,
    runtimeVisualizer: runtimeHelp.visualizer,
    runtimeLegacy: runtimeHelp.legacy,
    nl2mmd: nl2mmdHelp,
    visualizer: visualizerHelp
  };
}

export function getCommandGraphNodes(): CommandGraphNodeSpec[] {
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
