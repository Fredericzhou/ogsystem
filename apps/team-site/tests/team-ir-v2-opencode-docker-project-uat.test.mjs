import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { compileTeamIr } from "../../../dist/team-ir/index.js";
import { resolveTeamIrReleaseClosure } from "../infrastructure/team-ir-v2-opencode-docker-resolver.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const resolverPath = resolve(process.env.OGS_TEAM_IR_V2_PROJECT_TASK_RESOLVER
  || resolve(appRoot, "infrastructure/team-ir-v2-opencode-docker-resolver.mjs"));
const resolverMode = resolverPath.endsWith("team-ir-v2-opencode-direct-resolver.mjs") ? "direct OpenCode" : "Docker OpenCode";
const passwordSource = process.env.OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE;
const enabled = process.env.OGS_TEAM_IR_V2_PROJECT_TASK_UAT === "1";
const cases = [
  { id: "software-team", fixture: "software-team", input: "Plan a small bookkeeping tool release with expense entry, monthly summaries, dependencies, and acceptance checks.", minimumAttempts: 4, resultHandoff: "lead-to-result" },
  { id: "expert-consultation", fixture: "expert-consultation", input: "Organize the supplied headache and brief blurred vision case. Separate observations from hypotheses and identify urgent red flags and missing information.", minimumAttempts: 4 },
  { id: "structured-debate", fixture: "structured-debate", input: "Assess a city pilot for protected bicycle lanes. Present balanced arguments, a neutral bounded decision, and a concise report.", minimumAttempts: 4, loop: true },
  { id: "artifact-evidence", fixture: "artifact-evidence", input: "Create a concise evidence summary for this engineering change. Cite only the supplied brief, distinguish stated evidence from assumptions, and return the declared report Artifact.", minimumAttempts: 2, artifact: "report", artifactInput: { slotId: "brief", mediaType: "text/markdown", content: "# Engineering change evidence\n\n- Change: migrate the billing export to the v2 endpoint.\n- Verification: the focused export test passed on build 1842.\n- Rollback: the v1 endpoint remains available for one release window.\n- Unknown: production traffic has not yet exercised the v2 endpoint." } },
  { id: "conditional-signoff", fixture: "conditional-signoff", input: "Review this ordinary service change for operational and compliance risks. Summarize all required sign-off contributions.", minimumAttempts: 3 },
  { id: "maker-checker", fixture: "maker-checker", input: "Prepare a concise, verifiable release checklist with evidence and assumptions.", minimumAttempts: 2, review: true },
  { id: "release-gate", fixture: "release-gate", input: "Evaluate exactly these five required release criteria; this list is complete and no external evidence is required. CI-1842 automated tests: required tests completed and passed. MIG-77 migration: rehearsal passed and rollback is ready. SEC-913 security: zero critical or high findings. OPS-55 operations: alerts are configured and the on-call owner is confirmed. CHANGE-202 change record: release notes and rollback instructions are included. All five criteria are explicitly satisfied by the supplied evidence. Return PASS and cite all five IDs in the summary.", minimumAttempts: 1, resultHandoff: "gate-pass-result" }
];
const liveCases = process.env.OGS_TEAM_IR_V2_PROJECT_TASK_CASE_FILTER
  ? cases.filter((item) => process.env.OGS_TEAM_IR_V2_PROJECT_TASK_CASE_FILTER.split(",").includes(item.id))
  : cases;

test("Docker Project Task UAT inventory maps and compiles every model-bound classic fixture offline", async () => {
  for (const spec of cases) {
    const teamIR = JSON.parse(await readFile(new URL(`../../../examples/team-ir-v2/classic-${spec.fixture}.json`, import.meta.url), "utf8"));
    assert.equal(teamIR.team.id, `classic-${spec.fixture}`, spec.id);
    assert.ok(teamIR.bindings.every((binding) => binding.kind === "model" && binding.modelRef === "codex-gateway/gpt-6-luna"), spec.id);
    assert.ok(teamIR.bindings.length > 0, `${spec.id}: expected at least one model Binding`);
    if (spec.resultHandoff) assert.ok(teamIR.handoffs.some((handoff) => handoff.id === spec.resultHandoff), `${spec.id}: unknown result Handoff`);
    if (spec.artifact) assert.ok(teamIR.runResult.artifactSlots[spec.artifact], `${spec.id}: unknown result Artifact ${spec.artifact}`);
    if (spec.review) assert.ok(teamIR.orchestration.reviews.length > 0, `${spec.id}: Review gate expected`);
    if (spec.loop) assert.ok(teamIR.orchestration.loops.length > 0, `${spec.id}: Loop expected`);
    const closure = await resolveTeamIrReleaseClosure({ teamIR });
    assert.equal(closure.complete, true, spec.id);
    assert.doesNotThrow(() => compileTeamIr(teamIR, closure), spec.id);
  }
});

function startSite(root, passwordFile) {
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: {
      ...process.env,
      PORT: "0",
      OGS_SITE_PROJECTS_DIR: root,
      OGS_PLATFORM_CONFIG_DIR: root,
      OGS_TEAM_IR_V2_RESOLVER_MODULE: resolverPath,
      OGS_TEAM_IR_V2_OPENCODE_PASSWORD_FILE: passwordFile
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  const ready = (async () => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < 20000) {
      const baseUrl = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (baseUrl) return baseUrl;
      if (server.exitCode !== null) throw new Error("Team Site exited before ready: " + output);
      await new Promise((wait) => setTimeout(wait, 50));
    }
    throw new Error("Team Site did not start: " + output);
  })();
  return { server, ready };
}

async function json(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...options.headers },
    ...(options.body && typeof options.body !== "string" ? { body: JSON.stringify(options.body) } : {})
  });
  const body = await response.json().catch(() => ({}));
  assert.ok(response.ok, `${options.method || "GET"} ${path} returned ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

async function browserSimulationAndRelease(browser, baseUrl, teamVersionId, spec, mode) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(180000);
  const pageErrors = [];
  const apiResponses = [];
  page.on("pageerror", (error) => pageErrors.push(error.name));
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname === `/api/v1/team-versions/${teamVersionId}` || pathname === `/api/v1/team-versions/${teamVersionId}/ir`) {
      apiResponses.push({ pathname, status: response.status() });
    }
  });
  try {
    await page.goto(`${baseUrl}/studio/teams/${teamVersionId}/ir`, { waitUntil: "networkidle" });
    let simulation;
    if (!spec.artifactInput) {
      const requestField = page.locator('[data-ir-simulation-field="request"]');
      try {
        await requestField.waitFor({ state: "visible", timeout: 15000 });
      } catch {
        const rootText = (await page.locator("#studio-view").innerText().catch(() => "")).slice(0, 600);
        throw new Error(`STUDIO_SIMULATION_FORM_NOT_READY:url=${page.url()};fieldCount=${await requestField.count()};root=${JSON.stringify(rootText)};pageErrors=${pageErrors.join(",")};apiResponses=${JSON.stringify(apiResponses)}`);
      }
      assert.equal(await requestField.isDisabled(), false, `${spec.id}: Simulation request field should be enabled`);
      await requestField.fill(spec.input);
      await page.locator("[data-ir-simulation-task]").fill(`${mode} classic UAT: ${spec.id}`);
      const responsePromise = page.waitForResponse((response) => response.request().method() === "POST"
        && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/ir/simulations`);
      await page.locator("[data-ir-simulation-run]").click();
      const response = await responsePromise;
      assert.equal(response.status(), 200, `${spec.id}: browser Simulation returned ${response.status()}`);
      simulation = await response.json();
      await page.locator("[data-ir-simulation-status]").getByText(`Simulation ${simulation.status}.`).waitFor();
      if (simulation.status !== "completed") return simulation;
      assert.equal(simulation.run?.resultWritten, true);
    }
    await page.goto(`${baseUrl}/studio/teams/${teamVersionId}/release`, { waitUntil: "networkidle" });
    await page.locator("#studio-release-button").waitFor();
    assert.equal(await page.locator("#studio-release-button").isDisabled(), false, `${spec.id}: release gate should be ready after successful Simulation`);
    await page.locator("#studio-release-button").click();
    await page.locator("#studio-view .status-chip.released").waitFor();
    return simulation;
  } finally {
    await page.close();
  }
}

async function queryRun(baseUrl, projectId, taskId, runId) {
  return json(baseUrl, `/api/v1/projects/${projectId}/tasks/${taskId}/runs/${runId}`);
}

async function settleTask(baseUrl, projectId, taskId, { reviewPolicy } = {}) {
  const reviewRounds = [];
  for (let attempt = 0; attempt < 1800; attempt += 1) {
    const task = await json(baseUrl, `/api/v1/projects/${projectId}/tasks/${taskId}`);
    if (task.currentRunId) {
      let run;
      try {
        run = await queryRun(baseUrl, projectId, taskId, task.currentRunId);
      } catch (error) {
        const checkpointPending = String(error?.message || "").includes("TEAM_IR_V2_REQUIRED: Project Task Run checkpoint is unavailable.");
        if (checkpointPending && !["completed", "failed", "cancelled"].includes(task.status)) {
          await new Promise((wait) => setTimeout(wait, 100));
          continue;
        }
        throw error;
      }
      const state = run.state;
      const waiting = state?.waitingReviews || (state?.waitingReview ? [state.waitingReview] : []);
      if (state?.status === "waiting_human_review") {
        assert.ok(waiting.length > 0, "waiting Review state must expose an activation checkpoint");
        for (const activation of waiting) {
          const key = `${activation.reviewId}:${activation.loopRound ?? "run"}`;
          if (reviewRounds.includes(key)) continue;
          const route = `/api/v1/projects/${projectId}/tasks/${taskId}/runs/${task.currentRunId}/team-ir-reviews/${activation.reviewId}`;
          const review = await json(baseUrl, route);
          const decision = reviewPolicy?.({ activation, review, reviewRounds }) || "approve";
          const response = await json(baseUrl, route, {
            method: "POST",
            body: {
              decision,
              revisionToken: review.revisionToken,
              idempotencyKey: `docker-project-uat-${activation.reviewId}-${activation.loopRound ?? "run"}`,
              ...(decision === "reject" ? { feedback: { comments: "Add explicit evidence and resolve the identified gap." } } : {})
            }
          });
          assert.equal(response.decision, decision);
          reviewRounds.push(key);
        }
        continue;
      }
      if (["completed", "failed", "cancelled"].includes(state?.status)) return { task, run, reviewRounds };
    }
    await new Promise((wait) => setTimeout(wait, 100));
  }
  throw new Error(`Project Task ${taskId} did not settle within 180 seconds.`);
}

function assertScenario(run, spec) {
  const state = run.state;
  const data = state.result?.data ?? state.result;
  if (state.status !== "completed") throw new Error(`RUN_FAILED:${failureSummary(state)}`);
  assert.equal(state.resultWritten, true);
  assert.equal(state.events.filter((event) => event.type === "run.result.written").length, 1);
  assert.equal(state.events.filter((event) => event.type === "run.completed").length, 1);
  assert.ok(data && typeof data === "object", "completed Team must return structured result data");
  assert.ok(Object.values(data).some((value) => typeof value === "string" && value.trim().length > 0), "result must contain substantive text");
  if (spec.id === "release-gate" && data.decision !== "PASS") throw new Error(`RELEASE_GATE_DECISION_${String(data.decision || "MISSING")}`);
  const attempts = state.events.filter((event) => event.type === "binding.attempt.started").length;
  assert.ok(attempts >= spec.minimumAttempts, `expected at least ${spec.minimumAttempts} model attempts; observed ${attempts}`);
  const resultWritten = state.events.find((event) => event.type === "run.result.written");
  if (spec.resultHandoff) assert.equal(resultWritten?.data?.handoffId, spec.resultHandoff);
  if (spec.loop) assert.ok(state.events.some((event) => event.type === "loop.round.completed"), "bounded debate must persist at least one Loop round");
  if (spec.artifact) {
    assert.ok(state.result.artifacts?.[spec.artifact]?.artifactId, `expected result Artifact ${spec.artifact}`);
    assert.ok(state.result.artifacts[spec.artifact].mediaType === "text/markdown");
  }
}

function failureSummary(input) {
  const message = String(input?.message || input || "unknown failure");
  const httpStatus = message.match(/returned ([0-9]{3}):/);
  if (httpStatus) {
    const bodyStart = message.indexOf("{", httpStatus.index);
    try {
      const bodyEnd = message.indexOf("\n", bodyStart);
      const body = JSON.parse(message.slice(bodyStart, bodyEnd < 0 ? undefined : bodyEnd));
      return `HTTP_${httpStatus[1]}:${String(body.error || "API_ERROR").slice(0, 100)}`;
    } catch { return `HTTP_${httpStatus[1]}`; }
  }
  const line = message.split("\n")[0];
  try {
    const value = input && typeof input === "object" && !("message" in input)
      ? input
      : JSON.parse(line);
    const candidates = [];
    const visit = (item) => {
      if (!item || typeof item !== "object") return;
      candidates.push(item);
      for (const child of Object.values(item)) if (child && typeof child === "object") visit(child);
    };
    visit(value);
    for (const state of candidates) {
      const failed = state.events?.findLast((event) => event.type === "binding.attempt.failed" && event.data?.diagnosticCode);
      if (failed) return `${failed.data.diagnosticCode}:${String(failed.id || "unknown-invocation").slice(0, 180)}${failed.data.diagnosticPointer ? ":" + failed.data.diagnosticPointer : ""}`;
    }
    for (const state of candidates) {
      const code = state.events?.findLast((event) => event.type === "run.failing")?.data?.code;
      if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(code)) return code;
    }
    for (const state of candidates) {
      const failed = Object.values(state.invocations || {}).findLast((invocation) => invocation?.diagnosticCode);
      if (failed) return `${failed.diagnosticCode}:${failed.agentId || "unknown-agent"}:${failed.handoffId || "unknown-handoff"}${failed.diagnosticPointer ? ":" + failed.diagnosticPointer : ""}`;
    }
    for (const state of candidates) {
      for (const value of [state.error, state.lastError, state.failureCode, state.terminalIntent]) {
        if (typeof value === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(value)) return value;
      }
    }
    return candidates.find((state) => state.status)?.status || "RUN_FAILED";
  } catch { return line.slice(0, 180); }
}

async function uploadArtifact(baseUrl, path, body) {
  const { content, ...metadata } = body;
  return json(baseUrl, path, {
    method: "POST",
    body: { ...metadata, contentBase64: Buffer.from(content).toString("base64") }
  });
}

async function hashTree(root) {
  const files = [];
  async function visit(directory, prefix = "") {
    const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path, relativePath);
      else if (entry.isFile()) files.push([relativePath, createHash("sha256").update(await readFile(path)).digest("hex")]);
    }
  }
  await visit(root);
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

test(`${resolverMode} native v2 Project Tasks cover every current model classic, including automatic Review and retry recovery`, {
  skip: !enabled || !passwordSource
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ogs-team-ir-docker-project-uat-"));
  const passwordFile = join(root, "opencode.env");
  const password = await readFile(passwordSource);
  await writeFile(passwordFile, password, { mode: 0o600 });
  await chmod(passwordFile, 0o600);
  t.after(async () => rm(root, { recursive: true, force: true }));
  const browser = await chromium.launch({ headless: true });
  t.after(async () => browser.close());
  const runs = [];
  const scenarioFailures = [];
  let site = startSite(root, passwordFile);
  let baseUrl = await site.ready;
  try {
    for (const spec of liveCases) {
      try {
      const templated = await json(baseUrl, `/api/v1/cases/${spec.id}/template`, {
        method: "POST", body: { name: `Docker UAT ${spec.id}`, locale: "en" }
      });
      const teamVersionId = templated.teamVersionId;
      const fixture = await json(baseUrl, `/api/v1/cases/${spec.id}/ir`).then((value) => value.teamIR);
      assert.equal(fixture.team.id, `classic-${spec.fixture}`);
      const initialIr = await json(baseUrl, `/api/v1/team-versions/${teamVersionId}/ir`);
      const validatedIr = await json(baseUrl, `/api/v1/team-versions/${teamVersionId}/ir/validate`, {
        method: "POST", body: { teamIR: initialIr.teamIR }
      });
      assert.equal(validatedIr.ok, true, `${spec.id}: stored native IR must validate before Simulation: ${JSON.stringify(validatedIr.diagnostics)}`);
      const savedIr = await json(baseUrl, `/api/v1/team-versions/${teamVersionId}/ir`, {
        method: "PUT", body: { teamIR: initialIr.teamIR, expectedSemanticDigest: initialIr.semanticDigest }
      });
      assert.equal(savedIr.saved, true, `${spec.id}: native IR save failed: ${JSON.stringify(savedIr.diagnostics)}`);
      const reopenedIr = await json(baseUrl, `/api/v1/team-versions/${teamVersionId}/ir`);
      assert.equal(reopenedIr.semanticDigest, initialIr.semanticDigest, `${spec.id}: saved IR digest changed after reopen`);
      let simulationAttachments = {};
      let simulationArtifactScopeId;
      if (spec.artifactInput) {
        const slotList = await json(baseUrl, `/api/v1/team-versions/${teamVersionId}/ir/simulation-artifact-slots`);
        assert.ok(slotList.slots.some((slot) => slot.slotId === spec.artifactInput.slotId && slot.required));
        simulationArtifactScopeId = `uat-${randomUUID()}`;
        const registered = await uploadArtifact(baseUrl, `/api/v1/team-versions/${teamVersionId}/ir/simulation-artifacts/run-input`, {
          artifactScopeId: simulationArtifactScopeId,
          slotId: spec.artifactInput.slotId,
          mediaType: spec.artifactInput.mediaType,
          content: spec.artifactInput.content
        });
        simulationAttachments = { [spec.artifactInput.slotId]: { artifactId: registered.artifactId, mediaType: registered.mediaType } };
      }
      let simulation;
      if (spec.artifactInput) {
        simulation = await json(baseUrl, `/api/v1/team-versions/${teamVersionId}/ir/simulations`, {
          method: "POST", body: {
            input: { request: spec.input }, task: `${resolverMode} classic UAT: ${spec.id}`,
            attachments: simulationAttachments, artifactScopeId: simulationArtifactScopeId
          }
        });
      } else {
        simulation = await browserSimulationAndRelease(browser, baseUrl, teamVersionId, spec, resolverMode);
      }
      if (simulation.status !== "completed") throw new Error(`SIMULATION_FAILED:${failureSummary(simulation)}`);
      assert.equal(simulation.run?.resultWritten, true);
      const simulationData = simulation.result?.data ?? simulation.result;
      assert.ok(simulationData && typeof simulationData === "object", JSON.stringify(simulation));
      if (spec.artifactInput) await browserSimulationAndRelease(browser, baseUrl, teamVersionId, spec, resolverMode);
      const released = await json(baseUrl, `/api/v1/team-versions/${teamVersionId}`);
      assert.equal(released.teamVersionStatus, "released");
      assert.match(released.teamIrSemanticDigest, /^[a-f0-9]{64}$/);
      assert.match(released.compiledPlanDigest, /^[a-f0-9]{64}$/);
      const project = await json(baseUrl, "/api/v1/projects", {
        method: "POST", body: { name: `Docker Project ${spec.id}`, teamVersionIds: [teamVersionId] }
      });
      let taskAttachments = {};
      if (spec.artifactInput) {
        const registered = await uploadArtifact(baseUrl, `/api/v1/projects/${project.projectId}/artifacts/run-input`, {
          teamVersionId,
          slotId: spec.artifactInput.slotId,
          mediaType: spec.artifactInput.mediaType,
          content: spec.artifactInput.content
        });
        taskAttachments = { [spec.artifactInput.slotId]: { artifactId: registered.artifactId, mediaType: registered.mediaType } };
      }
      const task = await json(baseUrl, `/api/v1/projects/${project.projectId}/tasks`, {
        method: "POST", body: { input: spec.input, teamVersionId, attachments: taskAttachments, idempotencyKey: `${resolverMode}-uat-${spec.id}` }
      });
      const started = await json(baseUrl, `/api/v1/projects/${project.projectId}/tasks/${task.taskId}/start`, {
        method: "POST", body: { mode: "sandbox" }
      });
      assert.equal(started.task?.taskId || started.taskId, task.taskId);
      const finished = await settleTask(baseUrl, project.projectId, task.taskId, {
        reviewPolicy: spec.review ? ({ activation }) => activation.loopRound === 1 ? "reject" : "approve" : undefined
      });
      assertScenario(finished.run, spec);
      if (spec.review) {
        assert.ok(finished.run.state.events.some((event) => event.type === "run.review.rejected"));
        assert.ok(finished.run.state.events.some((event) => event.type === "run.review.approved"));
        assert.ok(finished.reviewRounds.length >= 2);
      }
      runs.push({ spec, simulationId: simulation.simulationId, projectId: project.projectId, taskId: task.taskId, runId: finished.run.state.runId, teamVersionId, semanticDigest: released.teamIrSemanticDigest, compiledDigest: released.compiledPlanDigest });
      t.diagnostic(`${spec.id}: ${resolverMode} release, Project Task completed; result schema/trace assertions passed`);
      } catch (error) {
        const reason = failureSummary(error);
        scenarioFailures.push({ id: spec.id, reason });
        t.diagnostic(`${spec.id}: ${resolverMode} scenario failed (${reason})`);
      }
    }

    const gate = runs.find((item) => item.spec.id === "release-gate");
    if (gate) {
      await writeFile(passwordFile, "OPENCODE_API_KEY=deliberately-invalid-uat-key\n", { mode: 0o600 });
      await chmod(passwordFile, 0o600);
      const retryTask = await json(baseUrl, `/api/v1/projects/${gate.projectId}/tasks`, {
        method: "POST", body: { input: gate.spec.input, teamVersionId: (await json(baseUrl, `/api/v1/projects/${gate.projectId}`)).mountedTeams[0].teamVersionId, idempotencyKey: "docker-uat-release-gate-controlled-failure" }
      });
      await json(baseUrl, `/api/v1/projects/${gate.projectId}/tasks/${retryTask.taskId}/start`, { method: "POST", body: { mode: "sandbox" } });
      const failed = await settleTask(baseUrl, gate.projectId, retryTask.taskId);
      assert.equal(failed.run.state.status, "failed", "bad upstream credentials must produce a controlled failed Run");
      assert.notEqual(failed.run.state.resultWritten, true);
      assert.equal(failed.run.state.result, undefined);
      await writeFile(passwordFile, password, { mode: 0o600 });
      await chmod(passwordFile, 0o600);
      await json(baseUrl, `/api/v1/projects/${gate.projectId}/tasks/${retryTask.taskId}/retry`, { method: "POST", body: { mode: "sandbox", idempotencyKey: "docker-uat-release-gate-retry" } });
      const retried = await settleTask(baseUrl, gate.projectId, retryTask.taskId);
      assertScenario(retried.run, gate.spec);
      assert.equal(retried.task.runIds.length, 2);
      const failureRunId = failed.run.state.runId;
      runs.push({ spec: gate.spec, projectId: gate.projectId, taskId: retryTask.taskId, runId: retried.run.state.runId, teamVersionId: gate.teamVersionId, priorFailedRunId: failureRunId, semanticDigest: gate.semanticDigest, compiledDigest: gate.compiledDigest });
    }

    site.server.kill("SIGTERM");
    await once(site.server, "exit");
    site = startSite(root, passwordSource);
    baseUrl = await site.ready;
    for (const item of runs) {
      const task = await json(baseUrl, `/api/v1/projects/${item.projectId}/tasks/${item.taskId}`);
      assert.equal(task.status, "completed");
      const run = await queryRun(baseUrl, item.projectId, item.taskId, item.runId);
      assert.equal(run.state.status, "completed");
      assert.equal(run.owner.teamIrSemanticDigest, item.semanticDigest);
      assert.equal(run.owner.compiledPlanDigest, item.compiledDigest);
      const result = await json(baseUrl, `/api/v1/projects/${item.projectId}/tasks/${item.taskId}/runs/${item.runId}/result`);
      assert.ok(result.result?.teamResult?.data || result.result?.teamResult, JSON.stringify(result));
      if (item.priorFailedRunId) {
        const prior = await queryRun(baseUrl, item.projectId, item.taskId, item.priorFailedRunId);
        assert.equal(prior.state.status, "failed");
        assert.notEqual(prior.state.resultWritten, true);
      }
    }

    const forkSource = runs[0];
    const sourceBeforeFork = await json(baseUrl, `/api/v1/team-versions/${forkSource.teamVersionId}`);
    const sourceIrBeforeFork = await json(baseUrl, `/api/v1/team-versions/${forkSource.teamVersionId}/ir`);
    const forkResponse = await fetch(`${baseUrl}/api/v1/team-versions/${forkSource.teamVersionId}/edit`, { method: "POST" });
    const forkedVersion = await forkResponse.json().catch(() => ({}));
    assert.equal(forkResponse.status, 201, `fork released v2 TeamVersion: ${JSON.stringify(forkedVersion)}`);
    const forkedId = forkedVersion.projectId;
    const [sourceAfterFork, forkedIr] = await Promise.all([
      json(baseUrl, `/api/v1/team-versions/${forkSource.teamVersionId}`),
      json(baseUrl, `/api/v1/team-versions/${forkedId}/ir`)
    ]);
    assert.equal(sourceBeforeFork.teamVersionStatus, "released");
    assert.equal(sourceAfterFork.teamVersionStatus, "released");
    assert.equal(sourceAfterFork.teamIrSemanticDigest, forkSource.semanticDigest);
    assert.equal(forkedVersion.teamVersionStatus, "draft");
    assert.equal(forkedVersion.parentTeamVersionId, forkSource.teamVersionId);
    assert.equal(forkedIr.semanticDigest, sourceIrBeforeFork.semanticDigest);

    const legacyTeamId = "legacy-team-no-v2-ir";
    const legacyProjectId = "legacy-collaboration-project";
    const legacyTeamRoot = join(root, legacyTeamId);
    const legacyProjectRoot = join(root, legacyProjectId);
    await mkdir(join(legacyTeamRoot, ".site"), { recursive: true });
    await mkdir(join(legacyTeamRoot, ".ogs", "runs", "run-old"), { recursive: true });
    await writeFile(join(legacyTeamRoot, ".site", "project.json"), JSON.stringify({
      projectId: legacyTeamId, name: "Legacy Team", teamName: "Legacy Team", overview: "Legacy Team workspace",
      templateId: "classic", projectDigest: "legacy-project-digest", teamId: legacyTeamId,
      teamRootId: legacyTeamId, teamVersionId: legacyTeamId, teamVersionNumber: 1,
      teamVersionStatus: "released", source: "classic", projectType: "team", mountedTeams: [], taskRecords: []
    }));
    await writeFile(join(legacyTeamRoot, "system.mmd"), "flowchart TD\n  A[Legacy] --> B[Run]\n");
    await writeFile(join(legacyTeamRoot, ".ogs", "authoring.json"), JSON.stringify({ schemaVersion: 1 }));
    await writeFile(join(legacyTeamRoot, ".ogs", "runs", "run-old", "run-plan.json"), JSON.stringify({ version: 1, source: "legacy-mermaid" }));
    await writeFile(join(legacyTeamRoot, ".ogs", "runs", "run-old", "state.json"), JSON.stringify({ status: "completed" }));
    await mkdir(join(legacyProjectRoot, ".site"), { recursive: true });
    await writeFile(join(legacyProjectRoot, ".site", "project.json"), JSON.stringify({
      projectId: legacyProjectId, name: "Legacy Project", overview: "Legacy mounted Team",
      projectType: "collaboration", source: "collaboration-project", projectStatus: "confirmed",
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
      nextTaskNumber: 1, mountedTeams: [{ teamId: legacyTeamId, teamVersionId: legacyTeamId, teamVersionNumber: 1, teamName: "Legacy Team" }], taskRecords: []
    }));
    const cleanWorkspaceDigest = await hashTree(root);
    const expectRejected = async (path, options, pattern, status) => {
      const response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: { ...(options?.body ? { "content-type": "application/json" } : {}), ...options?.headers },
        ...(options?.body && typeof options.body !== "string" ? { body: JSON.stringify(options.body) } : {})
      });
      const body = await response.json().catch(() => ({}));
      assert.equal(response.status, status, `${options?.method || "GET"} ${path}: ${JSON.stringify(body)}`);
      if (pattern) assert.match(String(body.error || ""), pattern, `${path}: ${JSON.stringify(body)}`);
    };
    await expectRejected("/api/v1/team-factory", { method: "POST", body: { name: "Legacy draft" } }, undefined, 405);
    for (const [method, path, body] of [
      ["GET", `/api/v1/team-versions/${legacyTeamId}/design?locale=en`],
      ["POST", `/api/v1/team-versions/${legacyTeamId}/design/validate`, { authoring: { roles: {} } }],
      ["PUT", `/api/v1/team-versions/${legacyTeamId}/design`, { authoring: { roles: {} } }],
      ["GET", `/api/v1/team-versions/${legacyTeamId}/design/assets`],
      ["PUT", `/api/v1/team-versions/${legacyTeamId}/design/assets`, { assets: {} }]
    ]) await expectRejected(path, { method, ...(body ? { body } : {}) }, /TEAM_IR_V2_REQUIRED/, 409);
    await expectRejected(`/api/v1/team-versions/${legacyTeamId}/ir`, {}, /TEAM_IR_V2_REQUIRED/, 400);
    await expectRejected(`/api/v1/team-versions/${legacyTeamId}/ir/release-snapshot`, {}, /TEAM_IR_V2_REQUIRED/, 400);
    await expectRejected(`/api/v1/team-versions/${legacyTeamId}/release`, { method: "POST" }, /TEAM_IR_V2_REQUIRED/, 400);
    await expectRejected(`/api/v1/projects/${legacyProjectId}/teams`, { method: "PUT", body: { teamVersionIds: [legacyTeamId] } }, /TEAM_IR_V2_REQUIRED/, 400);
    await expectRejected(`/api/v1/projects/${legacyProjectId}/tasks`, { method: "POST", body: { input: "Must not execute", teamVersionId: legacyTeamId } }, /TEAM_IR_V2_REQUIRED/, 400);
    assert.equal(await hashTree(root), cleanWorkspaceDigest,
      "old-format initialization, authoring, release, mount and Task requests must not write to this completed v2 workspace root");

    t.diagnostic(JSON.stringify({
      classicTeams: liveCases.map(({ id }) => id),
      resolverMode,
      automaticReview: true,
      controlledFailureRetry: Boolean(gate),
      restartQueries: runs.length,
      scenarioFailures,
      runs: runs.map(({ spec, simulationId, projectId, taskId, runId, priorFailedRunId, semanticDigest, compiledDigest }) => ({
        case: spec.id, simulationId, projectId, taskId, runId, priorFailedRunId, semanticDigest, compiledDigest
      }))
    }));
    assert.deepEqual(scenarioFailures.map(({ id }) => id), [], `${resolverMode} classic Project Task failures: ${JSON.stringify(scenarioFailures)}`);
  } finally {
    if (site.server.exitCode === null) {
      site.server.kill("SIGTERM");
      await once(site.server, "exit").catch(() => undefined);
    }
  }
});
