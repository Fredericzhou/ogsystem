import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";
import { loadRole } from "../infrastructure/team-ir-v2-opencode-docker-resolver.mjs";
import { createTeamA2AHttpClient } from "../../../dist/team-ir/index.js";

const secret = process.env.TEAM_IR_A2A_TEST_SECRET;
if (!secret) throw new Error("TEAM_IR_A2A_TEST_SECRET_REQUIRED");
const serviceFile = fileURLToPath(new URL("../../../tests/fixtures/team-ir-a2a-http-agent-service.mjs", import.meta.url));
let endpointPromise;
let agentProcess;

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

async function ensureAgent() {
  if (endpointPromise) return endpointPromise;
  endpointPromise = new Promise((resolve, reject) => {
    agentProcess = spawn(process.execPath, [serviceFile], {
      env: {
        ...process.env,
        TEAM_IR_A2A_TEST_SECRET: secret,
        TEAM_IR_A2A_TEST_REQUEST_LOG: process.env.OGS_TEAM_IR_A2A_LOCAL_UAT_REQUEST_LOG
      },
      stdio: ["ignore", "pipe", "ignore"]
    });
    const lines = createInterface({ input: agentProcess.stdout });
    const timer = setTimeout(() => reject(new Error("TEAM_IR_A2A_LOCAL_UAT_AGENT_START_TIMEOUT")), 10000);
    lines.once("line", async (line) => {
      clearTimeout(timer);
      lines.close();
      if (!line.startsWith("READY https://127.0.0.1:")) {
        reject(new Error("TEAM_IR_A2A_LOCAL_UAT_AGENT_READY_INVALID"));
        return;
      }
      const endpoint = line.slice("READY ".length);
      if (process.env.OGS_TEAM_IR_A2A_LOCAL_UAT_ENDPOINT_FILE) {
        await writeFile(process.env.OGS_TEAM_IR_A2A_LOCAL_UAT_ENDPOINT_FILE, endpoint, "utf8");
      }
      resolve(endpoint);
    });
    agentProcess.once("error", (error) => {
      clearTimeout(timer);
      reject(new Error("TEAM_IR_A2A_LOCAL_UAT_AGENT_START_FAILED: " + error.message));
    });
    agentProcess.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("TEAM_IR_A2A_LOCAL_UAT_AGENT_EXITED: " + code));
    });
  });
  return endpointPromise;
}

process.once("exit", () => {
  if (agentProcess && agentProcess.exitCode === null) agentProcess.kill("SIGTERM");
});

export async function resolveA2AAgent() {
  const endpoint = await ensureAgent();
  const client = createTeamA2AHttpClient({ endpoint, authorization: "Bearer " + secret });
  const agentCard = await client.getAgentCard();
  if (process.env.OGS_TEAM_IR_A2A_LOCAL_UAT_CARD_FILE) {
    await writeFile(process.env.OGS_TEAM_IR_A2A_LOCAL_UAT_CARD_FILE, JSON.stringify(agentCard), "utf8");
  }
  return { client, agentCard };
}

export async function resolveTeamIrReleaseClosure({ teamIR }) {
  const packageDigests = {};
  const packageSchemas = {};
  for (const agent of teamIR.agents || []) {
    const role = await loadRole(agent.packageRef);
    packageDigests[agent.packageRef] = role.digest;
    packageSchemas["schemas/roles/" + agent.packageRef.replaceAll(":", "/").replaceAll("@", "/") + "/output.schema.json"] = role.outputSchema;
  }
  return {
    complete: true,
    packageDigests,
    packageSchemas,
    bindingDigests: {},
    adapterVersions: {},
    schemaDigests: { localA2AUatAgent: digest({ service: "team-ir-a2a-http-agent-service", version: "1" }) }
  };
}

export async function resolveBindings() {
  return {};
}
