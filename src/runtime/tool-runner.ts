/**
 * Executes configured CLI tools while enforcing the runtime's safety invariants on
 * output size, timeout, and single-shot resolution. The file is limited to launching
 * helpers and feeding them the runtime's template variables, so it does not manage
 * scheduling, prompt design, or result ingestion beyond returning structured stdout/stderr.
 */
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

import type { CliTool } from "./types.js";

/**
 * Wraps the child process exit semantics so upper layers can react by intent.
 * The runtime uses `category` to drive retry policies while the `message` stays human-friendly.
 */
export class ToolExecutionError extends Error {
  constructor(
    public readonly category: "spawn" | "timeout" | "output_limit" | "exit_code",
    message: string
  ) {
    super(message);
    this.name = "ToolExecutionError";
  }
}

type ResolveCliCommandOptions = {
  execPath?: string;
  env?: NodeJS.ProcessEnv;
  probeCommand?: (command: string) => boolean;
  lookupVoltaNode?: (env: NodeJS.ProcessEnv) => string | undefined;
};

function renderTemplate(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_all, key) => vars[key] ?? "");
}

function materializePathLikeArg(arg: string, baseDir: string): string {
  if (!arg || arg.startsWith("-") || arg.startsWith("/") || arg.includes("://")) {
    return arg;
  }
  const candidate = resolve(baseDir, arg);
  return existsSync(candidate) ? candidate : arg;
}

/**
 * Materializes the CLI argument template with the provided run-time vars.
 * The caller must ensure the vars cover every placeholder that the tool needs.
 */
export function renderArgs(argsTemplate: string[], vars: Record<string, string>): string[] {
  return argsTemplate.map((item) => renderTemplate(item, vars));
}

function buildDryRunContent(command: string, args: string[]): string {
  return `[dry-run] ${command} ${args.join(" ")}`.trimEnd();
}

function canExecuteFile(candidate: string): boolean {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function collectPathCommandCandidates(command: string, envPath?: string): string[] {
  if (!envPath) {
    return [];
  }

  const candidates: string[] = [];
  for (const entry of envPath.split(delimiter)) {
    if (!entry) {
      continue;
    }
    const candidate = join(entry, command);
    if (canExecuteFile(candidate)) {
      candidates.push(candidate);
    }
  }
  return candidates;
}

function probeCommand(command: string): boolean {
  const result = spawnSync(command, ["-p", "process.execPath"], {
    stdio: "ignore"
  });
  return !result.error && result.status === 0;
}

function lookupVoltaNode(env: NodeJS.ProcessEnv): string | undefined {
  const voltaCommandCandidates = [
    env.VOLTA_HOME ? join(env.VOLTA_HOME, "bin", "volta") : undefined,
    "volta"
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of voltaCommandCandidates) {
    const result = spawnSync(candidate, ["which", "node"], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...env
      }
    });

    if (result.error || result.status !== 0) {
      continue;
    }

    const resolvedNode = result.stdout.trim();
    if (resolvedNode) {
      return resolvedNode;
    }
  }

  return undefined;
}

function appendUnique(target: string[], value: string | undefined) {
  if (!value || target.includes(value)) {
    return;
  }
  target.push(value);
}
export function resolveCliCommand(
  command: string,
  options: ResolveCliCommandOptions = {}
): string {
  if (command !== "node") {
    return command;
  }

  const env = options.env ?? process.env;
  const probe = options.probeCommand ?? probeCommand;
  const lookupVoltaNodeFn = options.lookupVoltaNode ?? lookupVoltaNode;
  const candidates: string[] = [];

  appendUnique(candidates, env.OGSYSTEM_NODE_BIN);
  appendUnique(candidates, options.execPath ?? process.execPath);
  appendUnique(candidates, lookupVoltaNodeFn(env));

  for (const candidate of collectPathCommandCandidates("node", env.PATH)) {
    appendUnique(candidates, candidate);
  }

  for (const candidate of [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/usr/bin/node",
    "node"
  ]) {
    appendUnique(candidates, candidate);
  }

  for (const candidate of candidates) {
    if (probe(candidate)) {
      return candidate;
    }
  }

  return command;
}

/**
 * Launches the CLI tool described by `CliTool`, enforcing the timeout/output invariants.
 * Failure window: after `settled` flips, the promise is immutable and the tool must not touch
 * stdout/stderr anymore.
 * Recovery: oversized output or timeouts send a `ToolExecutionError` so callers can fail or stop
 * the run without treating partial tool output as valid.
 */
export async function runCliTool(args: {
  tool: CliTool;
  vars: Record<string, string>;
  env?: Record<string, string>;
  commandBaseDir: string;
  workdir: string;
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  dryRun?: boolean;
  dryRunOutput?: {
    event?: string;
  };
}): Promise<{ exitCode: number; stdout: string; stderr: string; args: string[] }> {
  const renderedArgs = renderArgs(args.tool.argsTemplate, args.vars).map((item) =>
    materializePathLikeArg(item, args.commandBaseDir)
  );
  const resolvedCommand = resolveCliCommand(args.tool.command);

  if (args.dryRun) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        event: args.dryRunOutput?.event,
        content: buildDryRunContent(resolvedCommand, renderedArgs)
      }),
      stderr: "",
      args: renderedArgs
    };
  }

  return await new Promise((resolve, reject) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    let totalBytes = 0;

    const child = spawn(resolvedCommand, renderedArgs, {
      cwd: args.workdir,
      env: {
        ...process.env,
        ...args.env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    const removeAbortListener = () => {
      args.signal?.removeEventListener("abort", onAbort);
    };

    // Invariant: once any path resolves/rejects the promise, the result is fixed and later child events are ignored.
    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      removeAbortListener();
      reject(error);
    };

    const resolveOnce = (exitCode: number) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      removeAbortListener();
      resolve({
        exitCode,
        stdout,
        stderr,
        args: renderedArgs
      });
    };

    const enforceOutputLimit = (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > args.maxOutputBytes) {
        // Failure window: once we exceed the limit we kill the process so no more bytes arrive.
        child.kill("SIGKILL");
        rejectOnce(
          new ToolExecutionError(
            "output_limit",
            `Command output exceeded ${args.maxOutputBytes} bytes`
          )
        );
        return false;
      }
      return true;
    };

    // Failure window: timer expiry is the last chance to stop the tool before the runtime assumes hung state.
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectOnce(
        new ToolExecutionError("timeout", `Command timeout after ${args.timeoutMs}ms`)
      );
    }, args.timeoutMs);

    const onAbort = () => {
      child.kill("SIGTERM");
      rejectOnce(
        args.signal?.reason instanceof Error
          ? args.signal.reason
          : new ToolExecutionError("timeout", `Command timeout after ${args.timeoutMs}ms`)
      );
    };
    args.signal?.addEventListener("abort", onAbort, { once: true });
    if (args.signal?.aborted) {
      onAbort();
      return;
    }

    if (args.tool.stdinMode === "text") {
      child.stdin.write(args.vars.prompt ?? "");
    }
    child.stdin.end();

    child.stdout.on("data", (chunk: Buffer) => {
      if (!enforceOutputLimit(chunk)) {
        return;
      }
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (!enforceOutputLimit(chunk)) {
        return;
      }
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      rejectOnce(new ToolExecutionError("spawn", error.message));
    });

    child.on("close", (code) => {
      // Reliability: Follow strict POSIX exit code semantics. 
      // Non-zero exit codes MUST be treated as failures to prevent "silent failure" 
      // where an error message in stderr is mistakenly consumed as a valid result by an LLM.
      const exitCode = code ?? 1;
      if (exitCode !== 0) {
        const stderrText = stderr.trim();
        rejectOnce(
          new ToolExecutionError(
            "exit_code",
            stderrText
              ? `Command exited with code ${exitCode}: ${stderrText}`
              : `Command exited with code ${exitCode}`
          )
        );
        return;
      }
      resolveOnce(exitCode);
    });
  });
}
