import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { terminateChildProcessTree, waitForChildExit } from "./child-process-lifecycle.js";

export type JsonRpcMessage = Record<string, unknown>;
type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout };

export class RpcStdioClient {
  readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, Pending>();
  private readonly notifications = new Set<(message: JsonRpcMessage) => void>();
  private readonly maxOutputBytes: number;
  private stderr = "";
  private nextId = 0;
  private closed = false;

  constructor(child: ChildProcessWithoutNullStreams, args: { maxOutputBytes?: number } = {}) {
    this.child = child;
    this.maxOutputBytes = Math.max(1024, args.maxOutputBytes ?? 64 * 1024);
    createInterface({ input: child.stdout }).on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk) => {
      this.stderr = `${this.stderr}${chunk.toString()}`.slice(-this.maxOutputBytes);
    });
    child.on("error", (error) => this.failAll(error instanceof Error ? error : new Error(String(error))));
    child.on("exit", (code, signal) => {
      if (!this.closed) this.failAll(new Error(`stdio process exited (${signal ?? code ?? "unknown"})${this.stderr ? `: ${this.stderr}` : ""}`));
    });
  }

  static spawn(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; maxOutputBytes?: number }): RpcStdioClient {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32"
    });
    return new RpcStdioClient(child, options);
  }

  onNotification(listener: (message: JsonRpcMessage) => void): () => void {
    this.notifications.add(listener);
    return () => this.notifications.delete(listener);
  }

  notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  respond(id: string | number, result?: unknown, error?: unknown): void {
    this.send({ jsonrpc: "2.0", id, ...(error === undefined ? { result } : { error }) });
  }

  request(method: string, params: unknown, timeoutMs = 20_000): Promise<unknown> {
    const id = String(++this.nextId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC request ${method} timed out after ${timeoutMs}ms`));
      }, Math.max(1, timeoutMs));
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private send(message: JsonRpcMessage): void {
    if (this.closed || !this.child.stdin.writable) throw new Error("stdio RPC process is not running");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage;
    try {
      const value = JSON.parse(line) as unknown;
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("message must be an object");
      message = value as JsonRpcMessage;
    } catch {
      this.failAll(new Error(`stdio RPC emitted invalid JSON: ${line.slice(0, 300)}`));
      return;
    }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const id = String(message.id);
      const pending = this.pending.get(id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(id);
      if (message.error) pending.reject(new Error(`RPC error: ${JSON.stringify(message.error)}`));
      else pending.resolve(message.result);
      return;
    }
    for (const listener of this.notifications) listener(message);
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("stdio RPC process closed"));
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    this.child.stdin.end();
    if (!await waitForChildExit(this.child, 3000)) await terminateChildProcessTree(this.child);
  }
}
