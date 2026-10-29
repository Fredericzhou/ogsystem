import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { compileTeamIr, FileTeamArtifactStore } from "../../../dist/team-ir/index.js";
import { createTeamIrV2A2AResolver } from "../infrastructure/team-ir-v2-a2a-resolver.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const resolverPath = fileURLToPath(new URL("./team-ir-a2a-project-task-resolver.mjs", import.meta.url));
const enabled = process.env.OGS_TEAM_IR_A2A_PROJECT_TASK_UAT === "1";

async function generateCertificate(directory) {
  const keyPath = join(directory, "agent-key.pem");
  const certPath = join(directory, "agent-cert.pem");
  const command = spawn("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", keyPath, "-out", certPath, "-days", "2", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1,DNS:localhost"], { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  command.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const [code] = await once(command, "exit");
  if (code !== 0) throw new Error("Unable to create temporary A2A UAT TLS certificate: " + stderr);
  return { keyPath, certPath };
}

async function checkUnauthorizedCard(endpoint, certPath) {
  const ca = await readFile(certPath);
  return new Promise((resolve, reject) => {
    const request = httpsRequest(endpoint + "/.well-known/agent-card.json", { ca }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    request.once("error", reject);
    request.end();
  });
}

function startSite(projectsRoot, certPath, evidenceRoot, secret) {
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: {
      ...process.env,
      PORT: "0",
      OGS_SITE_PROJECTS_DIR: projectsRoot,
      OGS_PLATFORM_CONFIG_DIR: projectsRoot,
      OGS_TEAM_IR_V2_RESOLVER_MODULE: resolverPath,
      OGS_TEAM_IR_A2A_LOCAL_UAT_ENDPOINT_FILE: join(evidenceRoot, "agent-endpoint.txt"),
      OGS_TEAM_IR_A2A_LOCAL_UAT_CARD_FILE: join(evidenceRoot, "agent-card.json"),
      OGS_TEAM_IR_A2A_LOCAL_UAT_REQUEST_LOG: join(evidenceRoot, "agent-requests.jsonl"),
      TEAM_IR_A2A_TEST_SECRET: secret,
      TEAM_IR_A2A_TEST_TLS_KEY: join(evidenceRoot, "agent-key.pem"),
      TEAM_IR_A2A_TEST_TLS_CERT: certPath,
      NODE_EXTRA_CA_CERTS: certPath
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const ready = (async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 15000) {
      const baseUrl = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (baseUrl) return baseUrl;
      if (server.exitCode !== null) throw new Error("Team Site exited before ready: " + output);
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    throw new Error("Team Site did not start: " + output);
  })();
  return { server, ready };
}

async function waitFor(baseUrl, projectId, taskId) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const task = await fetch(`${baseUrl}/api/v1/projects/${projectId}/tasks/${taskId}`).then((response) => response.json());
    if (task.currentRunId) {
      const run = await fetch(`${baseUrl}/api/v1/projects/${projectId}/tasks/${taskId}/runs/${task.currentRunId}`).then((response) => response.json());
      if (["completed", "failed", "cancelled"].includes(run.state?.status)) return { task, run };
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error("A2A Project Task did not settle in time.");
}

test("A2A Agent in a separate local HTTPS process completes and survives query of a native v2 Project Task", { skip: !enabled }, async (t) => {
  const uatRoot = await mkdtemp(join(tmpdir(), "ogs-team-ir-a2a-project-uat-"));
  const projectsRoot = uatRoot;
  const evidenceRoot = join(uatRoot, "tls-evidence");
  await mkdir(evidenceRoot, { recursive: true });
  const { certPath } = await generateCertificate(evidenceRoot);
  const secret = randomBytes(32).toString("base64url");
  const previousTestSecret = process.env.TEAM_IR_A2A_TEST_SECRET;
  process.env.TEAM_IR_A2A_TEST_SECRET = secret;
  const localResolver = await import("./team-ir-a2a-project-task-resolver.mjs");
  if (previousTestSecret === undefined) delete process.env.TEAM_IR_A2A_TEST_SECRET;
  else process.env.TEAM_IR_A2A_TEST_SECRET = previousTestSecret;
  let server;
  try {
    let site = startSite(projectsRoot, certPath, evidenceRoot, secret);
    server = site.server;
    let baseUrl = await site.ready;

    const templateResponse = await fetch(`${baseUrl}/api/v1/cases/a2a-intake/template`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Local A2A Project UAT", locale: "en" })
    });
    const team = await templateResponse.json();
    assert.equal(templateResponse.status, 201, JSON.stringify(team));
    const teamVersionId = team.teamVersionId;

    const simulationResponse = await fetch(`${baseUrl}/api/v1/team-versions/${teamVersionId}/ir/simulations`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { request: "Create a concise intake summary for a contract review request." }, task: "A2A local Project Task release evidence" })
    });
    const simulation = await simulationResponse.json();
    assert.equal(simulationResponse.status, 200, JSON.stringify(simulation));
    assert.equal(simulation.status, "completed", JSON.stringify(simulation));
    assert.equal(simulation.run?.resultWritten, true);
    assert.match(simulation.result?.data?.summary || "", /^accepted: /, JSON.stringify(simulation));

    const endpoint = await readFile(join(evidenceRoot, "agent-endpoint.txt"), "utf8");
    assert.match(endpoint, /^https:\/\/127\.0\.0\.1:/);
    assert.equal(await checkUnauthorizedCard(endpoint, certPath), 401, "Agent Card requires bearer auth over trusted local TLS");
    const agentCard = JSON.parse(await readFile(join(evidenceRoot, "agent-card.json"), "utf8"));
    assert.equal(agentCard.protocolVersion, "1.0");
    assert.equal(agentCard.version, "1.0.0");

    const releaseResponse = await fetch(`${baseUrl}/api/v1/team-versions/${teamVersionId}/release`, { method: "POST" });
    const released = await releaseResponse.json();
    assert.equal(releaseResponse.status, 200, JSON.stringify(released));
    assert.equal(released.teamVersionStatus, "released");
    const teamIR = await fetch(`${baseUrl}/api/v1/team-versions/${teamVersionId}/ir`).then((response) => response.json()).then((body) => body.teamIR);
    const a2aResolver = createTeamIrV2A2AResolver({ resolveAgent: async () => ({
      agentCard,
      client: { async getAgentCard() { return agentCard; }, async sendMessage() {}, async getTask() {}, async cancelTask() {} }
    }) });
    const [modelClosure, a2aClosure] = await Promise.all([
      localResolver.resolveTeamIrReleaseClosure({ team: {}, teamIR }),
      a2aResolver.resolveClosure({ team: {}, teamIR })
    ]);
    const frozenClosure = {
      ...modelClosure,
      bindingDigests: { ...modelClosure.bindingDigests, ...a2aClosure.bindingDigests },
      adapterVersions: { ...modelClosure.adapterVersions, ...a2aClosure.adapterVersions },
      schemaDigests: { ...modelClosure.schemaDigests, ...a2aClosure.schemaDigests }
    };
    assert.equal(compileTeamIr(teamIR, frozenClosure).compiledPlanDigest, released.compiledPlanDigest,
      "released plan digest must include the authenticated HTTPS Agent Card pin");

    const projectResponse = await fetch(`${baseUrl}/api/v1/projects`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "A2A local Project UAT", teamVersionIds: [teamVersionId] })
    });
    const project = await projectResponse.json();
    assert.equal(projectResponse.status, 201, JSON.stringify(project));
    const taskResponse = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}/tasks`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "Create a concise intake summary for a contract review request.", teamVersionId, idempotencyKey: "a2a-local-project-task" })
    });
    const task = await taskResponse.json();
    assert.equal(taskResponse.status, 201, JSON.stringify(task));
    const startResponse = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}/start`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mode: "sandbox" })
    });
    assert.equal(startResponse.status, 202, await startResponse.text());

    const finished = await waitFor(baseUrl, project.projectId, task.taskId);
    assert.equal(finished.run.state.status, "completed", JSON.stringify(finished.run.state));
    assert.equal(finished.run.state.resultWritten, true);
    assert.match(finished.run.state.result?.data?.summary || "", /^accepted: /);
    const evidenceReference = finished.run.state.result?.artifacts?.evidence;
    assert.equal(evidenceReference?.mediaType, "text/plain");
    const projectArtifactStore = new FileTeamArtifactStore(join(projectsRoot, project.projectId, ".ogs", "team-artifacts"));
    const authorizedArtifactReader = await projectArtifactStore.createInvocationResolver({
      owner: { projectId: project.projectId, runId: finished.run.runId }, allowedArtifacts: [evidenceReference]
    });
    assert.equal(Buffer.from(await authorizedArtifactReader.read(evidenceReference.artifactId)).toString("utf8"), "independent agent evidence");
    assert.equal(finished.run.state.events.filter((event) => event.type === "run.result.written").length, 1);
    assert.equal(finished.run.owner.teamIrSemanticDigest, released.teamIrSemanticDigest);
    assert.equal(finished.run.owner.compiledPlanDigest, released.compiledPlanDigest);
    assert.ok(finished.run.state.events.some((event) => event.type === "binding.attempt.started"));
    const agentRequests = (await readFile(join(evidenceRoot, "agent-requests.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(agentRequests.filter((request) => request.authorized === false).length, 1);
    assert.ok(agentRequests.some((request) => request.method === "GET" && request.url === "/.well-known/agent-card.json" && request.authorized));
    assert.ok(agentRequests.some((request) => request.method === "POST" && request.url === "/rpc" && request.authorized));
    assert.ok(agentRequests.some((request) => request.rpcMethod === "SendMessage" && request.authorized));
    assert.ok(agentRequests.some((request) => request.rpcMethod === "GetTask" && request.authorized), "the client must poll the remote A2A Task");
    assert.ok(agentRequests.every((request) => !Object.hasOwn(request, "authorization")), "request evidence must not persist credentials");

    server.kill("SIGTERM");
    await once(server, "exit");
    site = startSite(projectsRoot, certPath, evidenceRoot, secret);
    server = site.server;
    baseUrl = await site.ready;
    const recoveredTask = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}`).then((response) => response.json());
    const recoveredRun = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}/runs/${finished.run.runId}`).then((response) => response.json());
    const recoveredResult = await fetch(`${baseUrl}/api/v1/projects/${project.projectId}/tasks/${task.taskId}/runs/${finished.run.runId}/result`).then((response) => response.json());
    assert.equal(recoveredTask.status, "completed");
    assert.equal(recoveredTask.currentRunId, finished.run.runId);
    assert.equal(recoveredRun.state.status, "completed");
    assert.equal(recoveredRun.owner.teamIrSemanticDigest, released.teamIrSemanticDigest);
    assert.equal(recoveredRun.owner.compiledPlanDigest, released.compiledPlanDigest);
    assert.deepEqual(recoveredResult.result, { teamResult: finished.run.state.result });
    assert.deepEqual(recoveredResult.result.teamResult.artifacts, finished.run.state.result.artifacts);
    t.diagnostic(JSON.stringify({
      teamVersionId,
      simulationId: simulation.simulationId,
      teamIrSemanticDigest: released.teamIrSemanticDigest,
      compiledPlanDigest: released.compiledPlanDigest,
      projectId: project.projectId,
      taskId: task.taskId,
      runId: finished.run.runId,
      runStatus: recoveredRun.state.status,
      result: recoveredRun.state.result,
      restartQuery: "passed",
      transport: "HTTPS loopback to independent official SDK Agent process",
      agentCardVersion: agentCard.version,
      authentication: "bearer required; unauthenticated discovery returned 401",
      artifact: "evidence:text/plain"
    }));
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await once(server, "exit").catch(() => undefined);
    }
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
