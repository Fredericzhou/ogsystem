import { createInterface } from "node:readline";
import { createServer } from "node:net";
import { createOpencodeServer } from "@opencode-ai/sdk/v2/server";

function resolveChatCompatibleProviders(): Record<string, { npm: "@ai-sdk/openai-compatible" }> {
  const configured = process.env.OGS_OPENCODE_COMPATIBLE_PROVIDERS ?? "codex-gateway";
  const providerIds = configured
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return Object.fromEntries(providerIds.map((providerId) => [providerId, { npm: "@ai-sdk/openai-compatible" }]));
}

async function findFreePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => resolve());
  });
  const address = probe.address();
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  if (!address || typeof address === "string") {
    throw new Error("Could not determine a free OpenCode server port");
  }
  return address.port;
}

try {
  // OpenCode's OpenAI provider now defaults to the Responses API. The
  // project API gateway exposes Chat Completions, so force only the
  // explicitly configured compatible providers onto the chat adapter.
  const compatibleProviders = resolveChatCompatibleProviders();
  const port = await findFreePort();
  const server = await createOpencodeServer({
    hostname: "127.0.0.1",
    port,
    timeout: Number(process.env.OGS_OPENCODE_SERVER_STARTUP_TIMEOUT_MS) || 120000,
    config: Object.keys(compatibleProviders).length
      ? { provider: compatibleProviders }
      : undefined
  });
  process.stdout.write(`${JSON.stringify({ type: "ready", url: server.url })}\n`);
  const input = createInterface({ input: process.stdin });
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    input.close();
    await server.close();
    process.stdin.pause();
  };
  const closeSafely = () => { void close().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exitCode = 1;
  }); };
  input.once("line", (line) => { if (line === "close") closeSafely(); });
  process.stdin.once("end", closeSafely);
  process.once("SIGTERM", closeSafely);
} catch (error) {
  process.stdout.write(`${JSON.stringify({ type: "error", error: error instanceof Error ? error.message : String(error) })}\n`);
  process.stdin.destroy();
  process.exitCode = 1;
}
