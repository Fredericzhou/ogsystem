import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { AgentEvent, DefaultRequestHandler, InMemoryTaskStore, JsonRpcTransportHandler, ServerCallContext } from "@a2a-js/sdk/server";
import { TaskState } from "@a2a-js/sdk";

const secret = process.env.TEAM_IR_A2A_TEST_SECRET;
if (!secret) throw new Error("TEAM_IR_A2A_TEST_SECRET_REQUIRED");

const agentCard = {
  name: "Local Team IR test agent",
  description: "Independent A2A protocol fixture",
  supportedInterfaces: [{ url: "", protocolBinding: "JSONRPC", protocolVersion: "1.0" }],
  provider: { organization: "OGSystem tests", url: "https://example.test" },
  version: "1.0.0",
  capabilities: { streaming: false, pushNotifications: false, extensions: [] },
  securitySchemes: {},
  securityRequirements: [],
  defaultInputModes: ["application/json"],
  defaultOutputModes: ["application/json", "text/plain"],
  skills: [{ id: "team-ir-test", name: "Team IR test", description: "Returns a typed Team IR envelope and text Artifact", tags: [], examples: [], inputModes: ["application/json"], outputModes: ["application/json", "text/plain"], securityRequirements: [] }],
  signatures: []
};

const executor = {
  async execute(requestContext, eventBus) {
    const parts = requestContext.userMessage.parts || [];
    const request = parts.find((part) => part.content?.$case === "data")?.content?.value;
    const summary = typeof request?.request === "string" ? "accepted: " + request.request : "accepted";
    const taskId = requestContext.taskId;
    const contextId = requestContext.contextId;
    eventBus.publish(AgentEvent.task({
      id: taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_WORKING, message: undefined, timestamp: new Date().toISOString() },
      artifacts: [], history: [], metadata: {}
    }));
    eventBus.publish(AgentEvent.artifactUpdate({
      taskId,
      contextId,
      artifact: {
        artifactId: "team-ir-result",
        name: "Team IR result",
        parts: [{ content: { $case: "data", value: { event: "INTAKE_COMPLETE", data: { summary } } }, mediaType: "application/json", filename: "", metadata: undefined }],
        metadata: undefined,
        extensions: []
      },
      append: false,
      lastChunk: true,
      metadata: undefined
    }));
    if (process.env.TEAM_IR_A2A_TEST_INCLUDE_TEXT_ARTIFACT !== "0") {
      eventBus.publish(AgentEvent.artifactUpdate({
        taskId,
        contextId,
        artifact: {
          artifactId: "team-ir-evidence",
          name: "Team IR evidence",
          parts: [{ content: { $case: "raw", value: Buffer.from("independent agent evidence") }, mediaType: "text/plain", filename: "evidence.txt", metadata: { "team.ir": { slotId: "evidence" } } }],
          metadata: { "team.ir": { slotId: "evidence" } },
          extensions: []
        },
        append: false,
        lastChunk: true,
        metadata: undefined
      }));
    }
    eventBus.publish(AgentEvent.statusUpdate({
      taskId,
      contextId,
      status: { state: TaskState.TASK_STATE_COMPLETED, message: undefined, timestamp: new Date().toISOString() },
      metadata: undefined
    }));
  },
  async cancelTask() {}
};

const requestHandler = new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), executor);
const transport = new JsonRpcTransportHandler(requestHandler);
const handler = async (request, response) => {
  const authorized = request.headers.authorization === "Bearer " + secret;
  if (process.env.TEAM_IR_A2A_TEST_REQUEST_LOG) {
    await appendFile(process.env.TEAM_IR_A2A_TEST_REQUEST_LOG, JSON.stringify({ method: request.method, url: request.url, authorized }) + "\n", "utf8");
  }
  if (!authorized) {
    response.writeHead(401);
    response.end();
    return;
  }
  if (request.url === "/.well-known/agent-card.json" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(agentCard));
    return;
  }
  if (request.url !== "/rpc" || request.method !== "POST") {
    response.writeHead(404);
    response.end();
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (process.env.TEAM_IR_A2A_TEST_REQUEST_LOG) {
      await appendFile(process.env.TEAM_IR_A2A_TEST_REQUEST_LOG, JSON.stringify({ method: request.method, url: request.url, rpcMethod: body.method, authorized }) + "\n", "utf8");
    }
    const result = await transport.handle(body, new ServerCallContext({ requestedVersion: "1.0" }));
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(result));
  } catch {
    response.writeHead(500);
    response.end();
  }
};
const tlsKeyPath = process.env.TEAM_IR_A2A_TEST_TLS_KEY;
const tlsCertPath = process.env.TEAM_IR_A2A_TEST_TLS_CERT;
if (Boolean(tlsKeyPath) !== Boolean(tlsCertPath)) throw new Error("TEAM_IR_A2A_TEST_TLS_CONFIG_INVALID");
const server = tlsKeyPath
  ? createHttpsServer({ key: readFileSync(tlsKeyPath), cert: readFileSync(tlsCertPath) }, handler)
  : createServer(handler);

server.listen(0, "127.0.0.1", () => {
  const address = server.address();
  const endpoint = `${tlsKeyPath ? "https" : "http"}://127.0.0.1:${address.port}`;
  agentCard.supportedInterfaces[0].url = endpoint + "/rpc";
  process.stdout.write("READY " + endpoint + "\n");
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
