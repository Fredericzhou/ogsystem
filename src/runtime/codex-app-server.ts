import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";

type JsonRecord = Record<string, unknown>;
type PendingRequest = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout };

export type CodexModelInfo = { id: string; displayName: string; isDefault?: boolean };

export class CodexAppServerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly waiters = new Set<(message: JsonRecord) => void>();
  private nextId = 0;
  private stderr = "";
  private closed = false;

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.onMessage(line));
    child.stderr.on("data", (data) => {
      this.stderr = (this.stderr + data.toString()).slice(-8000);
    });
    child.on("error", (error) => this.failAll(error));
    child.on("exit", (code, signal) => {
      this.failAll(new Error(`Codex app-server exited (${signal ?? code ?? "unknown"})${this.stderr.trim() ? `: ${this.stderr.trim()}` : ""}`));
    });
  }

  static async start(args: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }): Promise<CodexAppServerClient> {
    const child = spawn("codex", ["app-server", "--stdio"], {
      cwd: args.cwd,
      env: { ...process.env, ...args.env },
      stdio: ["pipe", "pipe", "pipe"],
      shell: process.platform === "win32"
    });
    const client = new CodexAppServerClient(child);
    try {
      await client.request("initialize", {
        clientInfo: { name: "ogs", title: "OGSystem", version: "0.3.0" },
        capabilities: { experimentalApi: false, requestAttestation: false }
      }, args.timeoutMs ?? 20000);
      client.notify("initialized");
      return client;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  private send(message: JsonRecord): void {
    if (this.closed || !this.child.stdin.writable) throw new Error("Codex app-server is not running");
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(method: string, params: unknown, timeoutMs = 20000): Promise<unknown> {
    const id = String(++this.nextId);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex app-server request ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
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

  private notify(method: string, params?: unknown): void {
    this.send({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }

  private onMessage(line: string): void {
    let message: JsonRecord;
    try {
      message = JSON.parse(line) as JsonRecord;
    } catch {
      this.failAll(new Error(`Codex app-server emitted invalid JSON: ${line.slice(0, 300)}`));
      return;
    }
    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(String(message.id));
      if (message.error) pending.reject(new Error(`Codex app-server: ${JSON.stringify(message.error)}`));
      else pending.resolve(message.result);
      return;
    }
    for (const waiter of this.waiters) waiter(message);
    if (message.id !== undefined && typeof message.method === "string") {
      this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `OGS does not support server request ${message.method}` } });
    }
  }

  private failAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  async listModels(): Promise<CodexModelInfo[]> {
    const models: CodexModelInfo[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    for (let page = 0; page < 20; page += 1) {
      const result = await this.request("model/list", { includeHidden: false, limit: 100, cursor }) as JsonRecord;
      if (Array.isArray(result.data)) models.push(...result.data.flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const model = item as JsonRecord;
          return typeof model.id === "string" ? [{ id: model.id, displayName: String(model.displayName ?? model.model ?? model.id), isDefault: model.isDefault === true }] : [];
        }));
      const nextCursor = typeof result.nextCursor === "string" ? result.nextCursor : "";
      if (!nextCursor) return models;
      if (seenCursors.has(nextCursor)) throw new Error("Codex model/list returned a repeated pagination cursor");
      seenCursors.add(nextCursor);
      cursor = nextCursor;
    }
    throw new Error("Codex model/list exceeded the 20-page safety limit");
  }

  async execute(args: {
    roleId: string;
    prompt: string;
    schema: unknown;
    modelId: string;
    cwd: string;
    timeoutMs: number;
    sessionId?: string;
    signal?: AbortSignal;
  }): Promise<{ sessionId: string; stdout: string; messageId?: string }> {
    const threadId = args.sessionId || undefined;
    const thread = threadId
      ? await this.request("thread/resume", { threadId, cwd: args.cwd }) as JsonRecord
      : await this.request("thread/start", {
          model: args.modelId,
          cwd: args.cwd,
          approvalPolicy: "never",
          sandbox: "read-only",
          ephemeral: false
        }) as JsonRecord;
    const threadRecord = (thread.thread ?? thread) as JsonRecord;
    const sessionId = String(threadRecord.id ?? threadId ?? "");
    if (!sessionId) throw new Error("Codex app-server did not return a thread id");

    const completed = new Promise<JsonRecord>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error(`Codex role ${args.roleId} timed out after ${args.timeoutMs}ms`)), args.timeoutMs);
      const abort = () => {
        void this.request("turn/interrupt", { threadId: sessionId }).catch(() => undefined);
        finish(new Error(`Codex role ${args.roleId} was cancelled`));
      };
      const finish = (error?: Error, value?: JsonRecord) => {
        clearTimeout(timeout);
        args.signal?.removeEventListener("abort", abort);
        this.waiters.delete(onMessage);
        if (error) reject(error);
        else resolve(value ?? {});
      };
      const onMessage = (message: JsonRecord) => {
        if (message.method !== "turn/completed") return;
        const params = message.params as JsonRecord | undefined;
        if (params?.threadId !== sessionId) return;
        const turn = params.turn as JsonRecord | undefined;
        finish(undefined, turn ?? {});
      };
      this.waiters.add(onMessage);
      args.signal?.addEventListener("abort", abort, { once: true });
      if (args.signal?.aborted) abort();
    });

    await this.request("turn/start", {
      threadId: sessionId,
      cwd: args.cwd,
      model: args.modelId,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly" },
      outputSchema: args.schema,
      input: [{ type: "text", text: args.prompt, text_elements: [] }]
    });
    const turn = await completed;
    if (turn.status !== "completed") {
      throw new Error(`Codex turn ended with status ${String(turn.status ?? "unknown")}${turn.error ? `: ${JSON.stringify(turn.error)}` : ""}`);
    }
    const items = Array.isArray(turn.items) ? turn.items as JsonRecord[] : [];
    const messages = items.filter((item) => item.type === "agentMessage" && typeof item.text === "string");
    const finalMessage = messages[messages.length - 1];
    if (!finalMessage) throw new Error("Codex completed the turn without an assistant message");
    return { sessionId, stdout: String(finalMessage.text), messageId: String(finalMessage.id ?? randomUUID()) };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new Error("Codex app-server closed"));
    if (process.platform === "win32" && this.child.pid) {
      const killer = spawn("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { stdio: "ignore" });
      await new Promise<void>((resolve) => killer.once("close", () => resolve()));
    } else {
      this.child.kill();
    }
    await new Promise<void>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) resolve();
      else {
        const timer = setTimeout(resolve, 1500);
        this.child.once("exit", () => { clearTimeout(timer); resolve(); });
      }
    });
  }
}
