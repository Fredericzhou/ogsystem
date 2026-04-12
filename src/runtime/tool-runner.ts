/**
 * Executes configured CLI tools while enforcing the runtime's safety invariants on
 * output size, timeout, and single-shot resolution. The file is limited to launching
 * helpers and feeding them the runtime's template variables, so it does not manage
 * scheduling, prompt design, or result ingestion beyond returning structured stdout/stderr.
 */
import { spawn } from "node:child_process";

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

function renderTemplate(value: string, vars: Record<string, string>): string {
  return value.replace(/\{\{([a-zA-Z0-9_.-]+)\}\}/g, (_all, key) => vars[key] ?? "");
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
  workdir: string;
  timeoutMs: number;
  maxOutputBytes: number;
  dryRun?: boolean;
  dryRunOutput?: {
    event?: string;
  };
}): Promise<{ exitCode: number; stdout: string; stderr: string; args: string[] }> {
  const renderedArgs = renderArgs(args.tool.argsTemplate, args.vars);

  if (args.dryRun) {
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        event: args.dryRunOutput?.event,
        content: buildDryRunContent(args.tool.command, renderedArgs)
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

    const child = spawn(args.tool.command, renderedArgs, {
      cwd: args.workdir,
      env: {
        ...process.env,
        ...args.env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });

    // Invariant: once any path resolves/rejects the promise, the result is fixed and later child events are ignored.
    const rejectOnce = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    const resolveOnce = (exitCode: number) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
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
