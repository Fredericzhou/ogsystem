import { createInterface } from "node:readline";
import { createOpencodeServer } from "@opencode-ai/sdk/v2/server";

try {
  const server = await createOpencodeServer({
    hostname: "127.0.0.1",
    port: 0,
    timeout: Number(process.env.OGS_OPENCODE_SERVER_TIMEOUT_MS) || 30000
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
