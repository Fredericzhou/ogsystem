import { createServer } from "node:http";
import { createInterface } from "node:readline";

const UPSTREAM = "http://host.docker.internal:4096";
const MODEL = { providerID: "codex-gateway", modelID: "gpt-6-luna" };
const TOOL_IDS = ["invalid", "question", "bash", "read", "glob", "grep", "edit", "write", "task", "webfetch", "todowrite", "websearch", "skill", "apply_patch"];
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

async function readConfig() {
  const lines = createInterface({ input: process.stdin });
  for await (const line of lines) {
    lines.close();
    const config = JSON.parse(line);
    if (typeof config.password !== "string" || config.password.length < 16 || config.password.length > 256) {
      throw new Error("credential_invalid");
    }
    return config;
  }
  throw new Error("config_missing");
}

async function readRequestBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new Error("request_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function validMessage(body) {
  return body && Object.keys(body).sort().join(",") === "format,model,options,parts,system,tools"
    && body.model && Object.keys(body.model).sort().join(",") === "modelID,providerID"
    && body.model.providerID === MODEL.providerID
    && body?.model?.modelID === MODEL.modelID
    && body?.format?.type === "json_schema"
    && Object.keys(body.format).sort().join(",") === "schema,type"
    && body?.format?.schema && typeof body.format.schema === "object" && !Array.isArray(body.format.schema)
    && body?.options && Object.keys(body.options).sort().join(",") === "structuredOutputMode"
    && body.options.structuredOutputMode === "outputFormat"
    && body?.tools && typeof body.tools === "object" && !Array.isArray(body.tools)
    && Object.keys(body.tools).length === TOOL_IDS.length
    && TOOL_IDS.every((tool) => body.tools[tool] === false)
    && typeof body.system === "string" && Buffer.byteLength(body.system) <= MAX_REQUEST_BYTES
    && Array.isArray(body.parts) && body.parts.length === 1
    && body.parts[0] && Object.keys(body.parts[0]).sort().join(",") === "text,type"
    && body.parts[0]?.type === "text" && typeof body.parts[0].text === "string"
    && Buffer.byteLength(body.parts[0].text) <= MAX_REQUEST_BYTES;
}

async function boundedResponse(response) {
  const chunks = [];
  let size = 0;
  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("response_too_large");
      }
      chunks.push(Buffer.from(value));
    }
  }
  return Buffer.concat(chunks);
}

function safeSessionId(value) {
  return /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

const config = await readConfig();
const authorization = "Basic " + Buffer.from("opencode:" + config.password).toString("base64");
const server = createServer(async (request, response) => {
  try {
    let path;
    let body;
    const healthProbe = request.method === "GET" && request.url === "/global/health";
    if (healthProbe) {
      const upstream = await fetch(UPSTREAM + "/global/health", { redirect: "error", signal: AbortSignal.timeout(5_000) });
      const bytes = await boundedResponse(upstream);
      response.writeHead(upstream.status, { "content-type": "application/json", "content-length": bytes.length });
      response.end(bytes);
      return;
    } else if (request.method === "POST" && request.url === "/session") {
      body = JSON.parse(await readRequestBody(request).then((bytes) => bytes.toString("utf8")));
      if (!body || Object.keys(body).join(",") !== "title" || body.title !== "Team IR model invocation") throw new Error("request_contract_invalid");
      path = "/session";
    } else {
      const match = request.method === "POST" && /^\/session\/([A-Za-z0-9_-]{1,128})\/message$/.exec(request.url || "");
      if (!match || !safeSessionId(match[1])) throw new Error("request_not_allowed");
      body = JSON.parse(await readRequestBody(request).then((bytes) => bytes.toString("utf8")));
      if (!validMessage(body)) throw new Error("request_contract_invalid");
      path = "/session/" + match[1] + "/message";
    }

    const upstream = await fetch(UPSTREAM + path, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(120_000),
      headers: { authorization, "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const bytes = await boundedResponse(upstream);
    response.writeHead(upstream.status, { "content-type": "application/json", "content-length": bytes.length });
    response.end(bytes);
  } catch (error) {
    const denied = error?.message === "request_not_allowed" || error?.message === "request_contract_invalid";
    response.writeHead(denied ? 403 : 502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: denied ? "egress_request_denied" : "egress_upstream_failed" }));
  }
});

server.on("connect", (_request, socket) => {
  socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
});
server.listen(4318, "0.0.0.0", () => process.stdout.write("EGRESS_PROXY_READY\n"));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
