import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { chromium } from "@playwright/test";
import { teamIRSemanticDigest } from "../../../dist/team-ir/index.js";
import { reserveBrowserSafePort } from "./browser-safe-port.mjs";

const appRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));

function advancedTeamIr(teamVersionId) {
  const slot = { required: false, acceptedMediaTypes: ["text/markdown"], cardinality: "single" };
  const outputSlot = { required: false, mediaTypes: ["text/markdown"], cardinality: "single" };
  return {
    schemaVersion: 2,
    team: { id: teamVersionId, version: "2.0.0" },
    runInput: { dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false }, preferencesSchema: { type: "object" }, artifactSlots: { brief: slot } },
    runResult: { dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false }, artifactSlots: { report: slot } },
    executionPolicy: { resultMode: "required", activeExecutionBudgetMs: 30000 },
    agents: [{
      id: "writer", packageRef: "role:writer@1", bindingRef: "binding:writer",
      inputPorts: {
        draft: { dataSchema: { type: "object", properties: { prompt: { type: "string" } }, required: ["prompt"], additionalProperties: false }, artifactSlots: { sources: slot } },
        revise: { dataSchema: { type: "object", properties: { answer: { type: "string" } }, required: [], additionalProperties: false } },
        audit: { dataSchema: { type: "object", properties: { reason: { type: "string" } }, required: [], additionalProperties: false } }
      },
      outputPorts: {
        DONE: { dataSchema: { type: "object", properties: { answer: { type: "string" }, again: { type: "boolean" } }, required: ["answer", "again"], additionalProperties: false }, artifactSlots: { report: outputSlot } },
        BLOCKED: { dataSchema: { type: "object", properties: { reason: { type: "string" } }, required: [], additionalProperties: false } }
      }
    }],
    handoffs: [
      { id: "entry", from: { kind: "run" }, to: { kind: "agent", agentId: "writer", inputPort: "draft" }, map: { data: { prompt: { $ref: "$.run.input.prompt" } } }, when: { priority: 0 }, delivery: { deadlineMs: 10000 } },
      { id: "revise", from: { kind: "agent", agentId: "writer", outputPort: "DONE" }, to: { kind: "agent", agentId: "writer", inputPort: "revise" }, map: { data: { answer: { $ref: "$.run.input.prompt" } } }, when: { condition: { op: "equals", args: [{ $ref: "$.output.data.again" }, { $literal: true }] }, priority: 0 }, delivery: { deadlineMs: 10000 } },
      { id: "exit", from: { kind: "agent", agentId: "writer", outputPort: "DONE" }, to: { kind: "result" }, map: { data: { answer: { $ref: "$.output.data.answer" } }, artifacts: { report: { $ref: "$.output.artifacts.report" } } }, when: { priority: 1 } }
    ],
    orchestration: {
      routes: [
        { from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["entry"] },
        { from: { kind: "agent", agentId: "writer", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["revise", "exit"] }
      ],
      joins: [{ id: "revision-input", agentId: "writer", inputPort: "revise", mode: "all_of", handoffIds: ["revise"], scope: { kind: "loop", loopId: "revision" }, timeoutMs: 5000, onTimeout: "fail" }],
      loops: [{ id: "revision", members: ["writer"], boundaryAgentId: "writer", entryHandoffIds: ["entry"], continueHandoffIds: ["revise"], exitHandoffIds: ["exit"], maxRounds: 3, maxAgentActivations: 6, onExhausted: "fail" }],
      reviews: [{ id: "review-draft", at: { kind: "agentOutput", agentId: "writer", outputPort: "DONE" }, feedbackSchema: { type: "object", properties: { decision: { enum: ["approve", "reject"] } }, required: ["decision"], additionalProperties: false }, timeoutMs: 5000, onTimeout: "fail" }]
    },
    bindings: [{ id: "binding:writer", kind: "a2a", agentCardRef: "https://agents.example/card.json", attemptTimeoutMs: 10000, retry: { maxAttempts: 1, retryOn: [], backoff: { mode: "none" } } }]
  };
}

test("Team IR v2 Studio validates, saves, reopens and preserves v2 API boundaries on mobile", async () => {
  const projectsRoot = await mkdtemp(join(tmpdir(), "ogs-team-ir-studio-browser-"));
  const resolverPath = join(projectsRoot, "test-resolver.mjs");
  await writeFile(resolverPath, `
export async function resolveTeamIrReleaseClosure({ teamIR }) {
  return {
    complete: true,
    packageDigests: Object.fromEntries(teamIR.agents.map((agent) => [agent.packageRef, "${"a".repeat(64)}"])),
    bindingDigests: Object.fromEntries(teamIR.bindings.map((binding) => [binding.id, "${"b".repeat(64)}"])),
    adapterVersions: Object.fromEntries([...new Set(teamIR.bindings.map((binding) => binding.kind))].map((kind) => [kind, "browser-fake/1"]))
  };
}
export const a2aAdapterVersion = "browser-fake-a2a/1";
const a2aCard = {
  protocolVersion: "1.0", name: "Browser Fake Agent", version: "1",
  defaultInputModes: ["application/json"], defaultOutputModes: ["application/json"],
  capabilities: { streaming: false, pushNotifications: false }
};
export async function resolveA2AAgent() {
  return {
    agentCard: a2aCard,
    client: {
      async getAgentCard() { return a2aCard; },
      async sendMessage() { return { id: "browser-task", status: "completed", result: { event: "DONE", data: { answer: "Simulation result", again: false } } }; },
      async getTask(taskId) { return { id: taskId, status: "completed", result: { event: "DONE", data: { answer: "Simulation result", again: false } } }; },
      async cancelTask() { return true; }
    }
  };
}
export async function resolveBindings({ teamIR }) {
  return Object.fromEntries(teamIR.agents.map((agent) => {
    const [event, port] = Object.entries(agent.outputPorts)[0];
    const data = Object.fromEntries(Object.entries(port.dataSchema?.properties || {}).map(([key, schema]) => [key, schema.type === "string" ? "Simulation result" : schema.type === "boolean" ? false : null]));
    return [agent.bindingRef, { async invoke(invocation) {
      if (invocation.artifactResolver) {
        const reference = invocation.input.artifacts.sources;
        await invocation.artifactResolver.read(reference.artifactId);
      }
      return { kind: "completed", output: { event, data } };
    } }];
  }));
}
`, "utf8");
  const port = await reserveBrowserSafePort();
  const server = spawn(process.execPath, ["server.mjs"], {
    cwd: appRoot,
    env: { ...process.env, PORT: String(port), OGS_SITE_PROJECTS_DIR: projectsRoot, OGS_PLATFORM_CONFIG_DIR: projectsRoot, OGS_TEAM_IR_V2_RESOLVER_MODULE: resolverPath },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  server.stdout.on("data", (chunk) => { output += chunk.toString(); });
  server.stderr.on("data", (chunk) => { output += chunk.toString(); });
  let browser;
  try {
    const startedAt = Date.now();
    let url;
    while (!url && Date.now() - startedAt < 10000) {
      url = output.match(/ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1];
      if (!url) await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    assert.ok(url, `Team Site did not start: ${output}`);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));

    await page.goto(`${url}/studio/new`, { waitUntil: "networkidle" });
    await page.locator("#new-project-form input[name=name]").fill("IR v2 Browser UAT");
    await page.locator("#new-project-form textarea[name=overview]").fill("Create a simple versioned Team IR and verify it after reopening.");
    await page.locator("#new-project-form button[type=submit]").click();
    await page.waitForURL(/\/teams\/[a-z0-9-]+\/ir$/);
    const teamVersionId = page.url().match(/\/teams\/([a-z0-9-]+)\/ir$/)?.[1];
    assert.ok(teamVersionId);

    await page.goto(`${url}/studio/teams/${teamVersionId}/ir`, { waitUntil: "networkidle" });
    await page.locator("#team-ir-editor").waitFor({ timeout: 5000 }).catch(async () => {
      assert.fail(`Team IR editor did not render at ${page.url()}: ${await page.locator("body").innerText().catch(() => "no body")} | page errors: ${pageErrors.join("; ")}`);
    });
    assert.equal(await page.locator('[data-ir-agent]').count(), 1);
    assert.equal(await page.locator('[name="agent-0-id"]').inputValue(), "worker");
    assert.equal(await page.locator('[name="agent-0-package"]').inputValue(), "role:worker@1");
    assert.equal(await page.locator('[name="agent-0-binding"]').inputValue(), "binding:worker");
    assert.equal(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).bindings[0].modelRef, "codex-gateway/gpt-6-luna");
    await page.locator('[data-ir-remove-handoff="1"]').click();
    await page.locator('[data-ir-remove-handoff="0"]').click();

    await page.locator('[data-ir-connect-target-agent-index="0"]').click();
    assert.match(await page.locator("[data-ir-connect-status]").innerText(), /先选择来源/);
    assert.equal(await page.locator("[data-ir-handoff]").count(), 0, "target-first selection must not create an edge");
    await page.locator('[data-ir-connect-source="run"]').click();
    assert.match(await page.locator("[data-ir-connect-status]").innerText(), /来源已选择/);
    await page.locator("[data-ir-connect-cancel]").click();
    assert.match(await page.locator("[data-ir-connect-status]").innerText(), /连接已取消/);
    assert.equal(await page.locator("[data-ir-handoff]").count(), 0, "cancel must discard the selected source");
    await page.locator('[data-ir-connect-source="run"]').click();
    await page.locator('[data-ir-connect-target-agent-index="0"]').click();
    assert.equal(await page.locator("[data-ir-handoff]").count(), 1);
    const generatedContracts = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    assert.deepEqual(generatedContracts.handoffContracts["handoff-1"].from, { kind: "run" });
    assert.deepEqual(generatedContracts.handoffContracts["handoff-1"].to, { kind: "agent", agentId: "worker", inputPort: "default" });
    assert.deepEqual(generatedContracts.handoffContracts["handoff-1"].map, { data: {} }, "generated edge keeps data mapping explicit");
    assert.equal(generatedContracts.bindings.find((binding) => binding.id === "binding:worker")?.modelRef, "codex-gateway/gpt-6-luna");
    await page.locator('[name="handoff-0-id"]').fill("run-to-worker");
    const runMapping = page.locator('[name="handoff-0-mapping"]');
    assert.equal(await runMapping.inputValue(), "", "mapping suggestions must not become semantics before acceptance");
    await page.locator('[data-ir-map-suggest="0"]').click();
    const runSuggestion = page.locator('[data-ir-map-accept="request"]');
    await runSuggestion.waitFor();
    assert.equal(await runMapping.inputValue(), "");
    await runSuggestion.click();
    assert.equal(await runMapping.inputValue(), "request=$.run.input.request");
    assert.equal(await page.locator('[data-ir-map-row="0"] [data-ir-map-target]').inputValue(), "request");
    assert.equal(await page.locator('[data-ir-map-row="0"] [data-ir-map-source]').inputValue(), "$.run.input.request");
    await page.locator('[data-ir-handoff="0"] [data-ir-map-remove]').click();
    assert.equal(await runMapping.inputValue(), "", "removing a field row removes its mapping");
    await page.locator('[data-ir-map-add="0"]').click();
    const addedMapRow = page.locator('[data-ir-handoff="0"] [data-ir-map-row]');
    await addedMapRow.locator('[data-ir-map-target]').selectOption("request");
    await addedMapRow.locator('[data-ir-map-source]').selectOption("$.run.input.request");
    assert.equal(await runMapping.inputValue(), "request=$.run.input.request", "field selections update the Team IR mapping");
    await page.locator('[data-ir-connect-source-agent-index="0"]').click();
    await page.locator('[data-ir-connect-target="result"]').click();
    await page.locator('[name="handoff-1-id"]').fill("worker-to-result");
    const resultMapping = page.locator('[name="handoff-1-mapping"]');
    await page.locator('[data-ir-map-suggest="1"]').click();
    const resultSuggestion = page.locator('[data-ir-map-accept="summary"]');
    await resultSuggestion.waitFor();
    assert.equal(await resultMapping.inputValue(), "");
    await resultSuggestion.click();
    assert.equal(await resultMapping.inputValue(), "summary=$.output.data.summary");

    const validationResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const validation = await validationResponse;
    const validationBody = await validation.json();
    assert.equal(validation.status(), 200);
    assert.equal(validationBody.ok, true, JSON.stringify(validationBody.diagnostics));
    const saveResponse = await page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/ir`, { timeout: 5000 });
    assert.equal(saveResponse.status(), 200, await saveResponse.text());
    await page.getByText("Saved and reopened ·", { exact: false }).waitFor();

    const reopened = await page.request.get(`${url}/api/v1/team-versions/${teamVersionId}/ir`).then((response) => response.json());
    const expectedDigest = teamIRSemanticDigest(reopened.teamIR);
    assert.equal(reopened.semanticDigest, expectedDigest);
    assert.equal(await page.locator('[data-ir-agent]').count(), 1);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("#team-ir-editor").waitFor();
    assert.equal(await page.locator('[name="agent-0-id"]').inputValue(), "worker");
    assert.equal(await page.locator('[data-ir-handoff]').count(), 2);
    assert.equal((await page.locator("[data-team-ir-digest]").innerText()).trim(), expectedDigest);
    assert.equal(await page.locator('[data-ir-handoff="0"] [data-ir-map-target]').inputValue(), "request");
    assert.equal(await page.locator('[data-ir-handoff="0"] [data-ir-map-source]').inputValue(), "$.run.input.request");
    const blockedReadiness = await page.request.post(`${url}/api/v1/team-versions/${teamVersionId}/release`, { data: {} });
    assert.notEqual(blockedReadiness.status(), 200);
    assert.match((await blockedReadiness.json()).error, /TEAM_IR_V2_RELEASE_EVIDENCE_REQUIRED/);
    const simulationResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${teamVersionId}/ir/simulations`);
    await page.locator("[data-ir-simulation-run]").click();
    const simulationResponseValue = await simulationResponse;
    const simulation = await simulationResponseValue.json();
    assert.equal(simulationResponseValue.status(), 200, JSON.stringify(simulation));
    assert.equal(simulation.status, "completed", JSON.stringify(simulation));
    assert.equal(simulation.run.resultWritten, true);
    await page.locator("[data-ir-simulation-evidence] h3").getByText(simulation.simulationId).waitFor();
    await page.locator("[data-ir-simulation-history]").getByText(simulation.simulationId, { exact: false }).first().waitFor();
    await page.goto(`${url}/studio/teams/${teamVersionId}/release`, { waitUntil: "networkidle" });
    await page.locator("h1").filter({ hasText: "Team IR v2" }).waitFor();
    assert.equal(await page.locator("#studio-release-button").isDisabled(), false);
    await page.locator("#studio-release-button").click();
    await page.locator("#studio-view .status-chip.released").waitFor();
    const released = await page.request.get(`${url}/api/v1/team-versions/${teamVersionId}`).then((response) => response.json());
    assert.equal(released.teamVersionStatus, "released");
    const releaseSnapshot = await page.request.get(`${url}/api/v1/team-versions/${teamVersionId}/ir/release-snapshot`);
    assert.equal(releaseSnapshot.status(), 200);
    await page.goto(`${url}/studio/teams/${teamVersionId}/ir`, { waitUntil: "networkidle" });
    assert.equal(await page.locator("[data-ir-add-join]").isDisabled(), true);
    assert.equal(await page.locator("[data-ir-add-loop]").isDisabled(), true);
    const layout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(layout.content <= layout.viewport + 1, `mobile page overflows horizontally: ${JSON.stringify(layout)}`);

    const legacy = await page.request.post(`${url}/api/v1/team-versions/${teamVersionId}/design/validate`, {
      data: { schemaVersion: 2, teamIR: reopened.teamIR }
    });
    assert.equal(legacy.status(), 409);
    assert.match((await legacy.json()).error, /TEAM_IR_V2_REQUIRED/);

    const advancedTeam = await page.request.post(`${url}/api/v1/team-ir-drafts`, {
      data: { name: "IR v2 Advanced Contracts", overview: "Round-trip advanced Team IR contracts." }
    }).then((response) => response.json());
    const advancedId = advancedTeam.projectId;
    const advancedIr = advancedTeamIr(advancedId);
    advancedIr.runInput.artifactSlots.brief = { ...advancedIr.runInput.artifactSlots.brief, required: true };
    advancedIr.agents[0].inputPorts.draft.artifactSlots.sources = {
      ...advancedIr.agents[0].inputPorts.draft.artifactSlots.sources, required: true
    };
    advancedIr.handoffs.find((handoff) => handoff.id === "entry").map.artifacts = {
      sources: { $ref: "$.run.attachments.brief" }
    };
    const advancedStored = await page.request.get(`${url}/api/v1/team-versions/${advancedId}/ir`).then((response) => response.json());
    const seeded = await page.request.put(`${url}/api/v1/team-versions/${advancedId}/ir`, {
      data: { teamIR: advancedIr, expectedSemanticDigest: advancedStored.semanticDigest }
    });
    const seededBody = await seeded.json();
    assert.equal(seeded.status(), 200, JSON.stringify(seededBody));
    assert.equal(seededBody.saved, true, JSON.stringify(seededBody.diagnostics));
    await page.goto(`${url}/studio/teams/${advancedId}/ir`, { waitUntil: "networkidle" });
    await page.locator("[data-ir-advanced-json]").waitFor();
    const advancedEditor = page.locator("[data-ir-advanced-json]");
    const contracts = JSON.parse(await advancedEditor.inputValue());
    assert.equal(contracts.orchestration.joins[0].id, "revision-input");
    assert.equal(contracts.orchestration.loops[0].id, "revision");
    assert.equal(contracts.orchestration.reviews[0].id, "review-draft");
    assert.equal(contracts.agentPortContracts.writer.outputPorts.DONE.artifactSlots.report.required, false);
    assert.equal(contracts.bindings[0].kind, "a2a");
    assert.equal(await page.locator("[data-ir-join]").count(), 1);
    assert.equal(await page.locator("[data-ir-loop]").count(), 1);
    assert.deepEqual(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.joins[0].handoffIds, ["revise"]);
    assert.deepEqual(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.loops[0].entryHandoffIds, ["entry"]);
    await page.locator('[name="join-0-timeout"]').fill("6500");
    await page.locator('[name="loop-0-rounds"]').fill("4");
    const structuredValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    const structuredSave = page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const structuredBody = await (await structuredValidation).json();
    assert.equal(structuredBody.ok, true, JSON.stringify(structuredBody.diagnostics));
    assert.equal((await structuredSave).status(), 200);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator('[name="join-0-timeout"]').waitFor();
    assert.equal(await page.locator('[name="join-0-timeout"]').inputValue(), "6500");
    assert.equal(await page.locator('[name="loop-0-rounds"]').inputValue(), "4");
    assert.deepEqual(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.joins[0].baseMapping,
      contracts.orchestration.joins[0].baseMapping, "structured edits preserve advanced Join fields");
    Object.assign(contracts.orchestration, JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration);
    assert.equal(contracts.orchestration.joins[0].timeoutMs, 6500);
    assert.equal(contracts.orchestration.loops[0].maxRounds, 4);
    advancedIr.orchestration.joins[0].timeoutMs = 6500;
    advancedIr.orchestration.loops[0].maxRounds = 4;

    const advancedEdit = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    advancedEdit.orchestration.joins[0].timeoutMs = 7100;
    advancedEdit.orchestration.loops[0].maxRounds = 5;
    await page.locator("[data-ir-advanced-json]").fill(JSON.stringify(advancedEdit, null, 2));
    const advancedEditValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    const advancedEditSave = page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const advancedEditValidationBody = await (await advancedEditValidation).json();
    assert.equal(advancedEditValidationBody.ok, true, JSON.stringify(advancedEditValidationBody.diagnostics));
    const advancedEditSaveResponse = await advancedEditSave;
    assert.equal(advancedEditSaveResponse.status(), 200);
    const advancedEditSavedBody = advancedEditSaveResponse.request().postDataJSON();
    assert.equal(advancedEditSavedBody.teamIR.orchestration.joins[0].timeoutMs, 7100);
    assert.equal(advancedEditSavedBody.teamIR.orchestration.loops[0].maxRounds, 5);
    await page.getByText("Saved and reopened ·", { exact: false }).waitFor();
    await page.locator('[name="join-0-timeout"]').waitFor();
    assert.equal(await page.locator('[name="join-0-timeout"]').inputValue(), "7100", "advanced Join edits flow back to the structured row");
    assert.equal(await page.locator('[name="loop-0-rounds"]').inputValue(), "5", "advanced Loop edits flow back to the structured row");
    const roundTripped = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    assert.deepEqual(roundTripped.orchestration.joins[0].handoffIds, ["revise"], "Join Handoff IDs survive a visual/JSON round trip");
    assert.deepEqual(roundTripped.orchestration.loops[0].entryHandoffIds, ["entry"], "Loop Handoff IDs survive a visual/JSON round trip");

    await page.locator("[data-ir-add-join]").click();
    assert.equal(await page.locator("[data-ir-join]").count(), 2);
    assert.equal(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.joins[1].id, "join-2");
    await page.locator('[data-ir-remove-join="1"]').click();
    assert.equal(await page.locator("[data-ir-join]").count(), 1);
    assert.deepEqual(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.joins[0].handoffIds, ["revise"]);
    await page.locator("[data-ir-add-loop]").click();
    assert.equal(await page.locator("[data-ir-loop]").count(), 2);
    assert.equal(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.loops[1].id, "loop-2");
    await page.locator('[data-ir-remove-loop="1"]').click();
    assert.equal(await page.locator("[data-ir-loop]").count(), 1);
    assert.deepEqual(JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue()).orchestration.loops[0].entryHandoffIds, ["entry"]);

    await page.locator('[name="join-0-timeout"]').fill("0");
    let structuredInvalidSaves = 0;
    page.on("request", (request) => {
      if (request.method() === "PUT" && new URL(request.url()).pathname === `/api/v1/team-versions/${advancedId}/ir`) structuredInvalidSaves += 1;
    });
    const structuredInvalidValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const structuredInvalid = await (await structuredInvalidValidation).json();
    assert.equal(structuredInvalid.ok, false);
    assert.ok(structuredInvalid.diagnostics.some((item) => item.code === "IR_SCHEMA_INVALID" && item.pointer === "/orchestration/joins/0/timeoutMs"), JSON.stringify(structuredInvalid.diagnostics));
    assert.equal(structuredInvalidSaves, 0, "invalid structured contracts must not reach save API");
    await page.locator('[data-team-ir-diagnostics] .ir-diagnostic').first().waitFor();
    assert.equal(await page.locator("[data-team-ir-diagnostics]").isVisible(), true, "server diagnostics are shown for invalid structured contracts");
    await page.reload({ waitUntil: "networkidle" });

    await page.locator('[data-ir-connect-source-agent-index="0"]').click();
    await page.locator('[data-ir-connect-target-agent-index="0"]').click();
    assert.equal(await page.locator("[data-ir-handoff]").count(), 4, "same-Agent distinct-port Loop handoffs remain authorable");
    const selfLoopContracts = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    assert.deepEqual(selfLoopContracts.handoffContracts["handoff-4"].from, { kind: "agent", agentId: "writer", outputPort: "DONE" });
    assert.deepEqual(selfLoopContracts.handoffContracts["handoff-4"].to, { kind: "agent", agentId: "writer", inputPort: "draft" });
    assert.deepEqual(selfLoopContracts.orchestration.routes.find((route) => route.from.kind === "agent" && route.from.outputPort === "DONE").handoffIds,
      ["revise", "exit", "handoff-4"], "an existing route must continue to list every outgoing Handoff");
    await page.locator('[data-ir-link-source-port="0"]').selectOption("BLOCKED");
    await page.locator('[data-ir-link-target-port="0"]').selectOption("audit");
    await page.locator('[data-ir-connect-source-agent-index="0"]').click();
    await page.locator('[data-ir-connect-target-agent-index="0"]').click();
    assert.equal(await page.locator("[data-ir-handoff]").count(), 5);
    const selectedPortContracts = JSON.parse(await page.locator("[data-ir-advanced-json]").inputValue());
    assert.deepEqual(selectedPortContracts.handoffContracts["handoff-5"].from,
      { kind: "agent", agentId: "writer", outputPort: "BLOCKED" });
    assert.deepEqual(selectedPortContracts.handoffContracts["handoff-5"].to,
      { kind: "agent", agentId: "writer", inputPort: "audit" });
    await page.reload({ waitUntil: "networkidle" });
    await page.locator("[data-ir-advanced-json]").waitFor();

    const incompatibleContracts = structuredClone(contracts);
    incompatibleContracts.runInput.dataSchema.properties.prompt.pattern = "^source-";
    incompatibleContracts.agentPortContracts.writer.inputPorts.draft.dataSchema.properties.prompt.pattern = "^target-";
    incompatibleContracts.handoffContracts.entry.map.data = {};
    await advancedEditor.fill(JSON.stringify(incompatibleContracts, null, 2));
    await page.locator('[data-ir-map-suggest="0"]').click();
    await page.locator('[data-ir-map-suggestions="0"]').getByText("No compatible required fields with matching names.").waitFor();
    assert.equal(await page.locator('[data-ir-map-accept="prompt"]').count(), 0,
      "same-name fields with incompatible pattern constraints must not be suggested");
    await advancedEditor.fill(JSON.stringify(contracts, null, 2));

    contracts.orchestration.reviews[0].timeoutMs = 0;
    await advancedEditor.fill(JSON.stringify(contracts, null, 2));
    let invalidSaves = 0;
    page.on("request", (request) => {
      if (request.method() === "PUT" && new URL(request.url()).pathname === `/api/v1/team-versions/${advancedId}/ir`) invalidSaves += 1;
    });
    const invalidValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const invalidBody = await (await invalidValidation).json();
    assert.equal(invalidBody.ok, false);
    await page.locator("[data-team-ir-diagnostics]").getByText("/orchestration/reviews/0/timeoutMs").waitFor();
    assert.match(await page.locator("[data-team-ir-diagnostics]").innerText(), /IR_SCHEMA_INVALID/);
    assert.equal(invalidSaves, 0, "invalid advanced contracts must not reach save API");
    await page.locator("[data-team-ir-diagnostics]").getByText("/orchestration/reviews/0/timeoutMs").click();
    assert.equal(await advancedEditor.evaluate((element) => document.activeElement === element), true);
    assert.equal(await advancedEditor.evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd)), "0");

    contracts.orchestration.reviews[0].timeoutMs = 5000;
    contracts.runInput.dataSchema.properties["bad/~key"] = { type: "not-a-json-type" };
    await advancedEditor.fill(JSON.stringify(contracts, null, 2));
    const escapedPointerValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const escapedPointerBody = await (await escapedPointerValidation).json();
    assert.equal(escapedPointerBody.ok, false);
    const escapedPointer = "/runInput/dataSchema/properties/bad~1~0key/type";
    const escapedDiagnostic = page.locator("[data-team-ir-diagnostics] button.ir-diagnostic").filter({ hasText: escapedPointer }).first();
    await escapedDiagnostic.click();
    assert.equal(await advancedEditor.evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd)), '"not-a-json-type"');

    delete contracts.runInput.dataSchema.properties["bad/~key"];
    await advancedEditor.fill(JSON.stringify(contracts, null, 2));
    const advancedValidation = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/validate`);
    const advancedSave = page.waitForResponse((response) => response.request().method() === "PUT"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir`).catch(() => null);
    await page.locator('#team-ir-editor button[type="submit"]').click();
    const advancedValidationBody = await (await advancedValidation).json();
    assert.equal(advancedValidationBody.ok, true, JSON.stringify(advancedValidationBody.diagnostics));
    assert.equal((await advancedSave).status(), 200);
    await page.getByText("Saved and reopened ·", { exact: false }).waitFor();
    await page.reload({ waitUntil: "networkidle" });
    const advancedReopened = await page.request.get(`${url}/api/v1/team-versions/${advancedId}/ir`).then((response) => response.json());
    assert.equal(advancedReopened.semanticDigest, teamIRSemanticDigest(advancedReopened.teamIR));
    assert.deepEqual(advancedReopened.teamIR.orchestration.loops, advancedIr.orchestration.loops);
    assert.deepEqual(advancedReopened.teamIR.orchestration.joins, advancedIr.orchestration.joins);
    assert.deepEqual(advancedReopened.teamIR.orchestration.reviews, advancedIr.orchestration.reviews);
    assert.deepEqual(advancedReopened.teamIR.orchestration.routes, advancedIr.orchestration.routes);
    assert.deepEqual(advancedReopened.teamIR.runInput.artifactSlots, advancedIr.runInput.artifactSlots);
    assert.deepEqual(advancedReopened.teamIR.runResult.artifactSlots, advancedIr.runResult.artifactSlots);
    assert.deepEqual(advancedReopened.teamIR.agents[0].inputPorts, advancedIr.agents[0].inputPorts);
    assert.deepEqual(advancedReopened.teamIR.agents[0].outputPorts, advancedIr.agents[0].outputPorts);
    assert.deepEqual(advancedReopened.teamIR.handoffs.find((handoff) => handoff.id === "exit").map.artifacts, advancedIr.handoffs.find((handoff) => handoff.id === "exit").map.artifacts);
    assert.deepEqual(advancedReopened.teamIR.handoffs, advancedIr.handoffs);
    assert.deepEqual(advancedReopened.teamIR.bindings, advancedIr.bindings);
    const artifactUatIr = structuredClone(advancedReopened.teamIR);
    artifactUatIr.handoffs = artifactUatIr.handoffs.filter((handoff) => ["entry", "exit"].includes(handoff.id));
    artifactUatIr.handoffs.find((handoff) => handoff.id === "exit").map = {
      data: { answer: { $ref: "$.output.data.answer" } }
    };
    artifactUatIr.orchestration = {
      routes: [
        { from: { kind: "run" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["entry"] },
        { from: { kind: "agent", agentId: "writer", outputPort: "DONE" }, mode: "exclusive_priority", onNoMatch: "fail", handoffIds: ["exit"] }
      ], joins: [], loops: [], reviews: []
    };
    const artifactUatSave = await page.request.put(`${url}/api/v1/team-versions/${advancedId}/ir`, {
      data: { teamIR: artifactUatIr, expectedSemanticDigest: advancedReopened.semanticDigest }
    });
    const artifactUatSaved = await artifactUatSave.json();
    assert.equal(artifactUatSave.status(), 200, JSON.stringify(artifactUatSaved));
    await page.reload({ waitUntil: "networkidle" });
    const browserArtifactSlotsResponse = await page.request.get(`${url}/api/v1/team-versions/${advancedId}/ir/simulation-artifact-slots`);
    const browserArtifactSlots = await browserArtifactSlotsResponse.json();
    assert.equal(browserArtifactSlotsResponse.status(), 200, JSON.stringify(browserArtifactSlots));
    assert.deepEqual(browserArtifactSlots.slots.map((slot) => slot.slotId), ["brief"]);
    await page.locator("[data-ir-simulation-artifact-slot]").waitFor({ state: "attached" });
    assert.equal(await page.locator("[data-ir-simulation-artifact-inputs]").isVisible(), true,
      `Simulation Artifact controls did not load: ${await page.locator("[data-ir-simulation-artifact-status]").innerText()}`);
    assert.equal(await page.locator("[data-ir-simulation-artifact-slot] option").first().getAttribute("value"), "brief");
    await page.locator("[data-ir-simulation-artifact-file]").setInputFiles({
      name: "source.md", mimeType: "text/markdown", buffer: Buffer.from("Browser Sandbox source")
    });
    await page.locator("[data-ir-simulation-artifact-add]").click();
    await page.getByText("Simulation attachment registered.").waitFor();
    assert.match(await page.locator("[data-ir-simulation-artifact-list]").innerText(), /brief[\s\S]*source\.md/);
    await page.locator("[data-ir-simulation-input]").fill(JSON.stringify({ prompt: "Use the attached source" }));
    const artifactSimulationResponse = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === `/api/v1/team-versions/${advancedId}/ir/simulations`);
    await page.locator("[data-ir-simulation-run]").click();
    const artifactSimulation = await (await artifactSimulationResponse).json();
    assert.equal(artifactSimulation.status, "completed", JSON.stringify(artifactSimulation));
    assert.deepEqual(Object.keys(artifactSimulation.attachments), ["brief"]);
    assert.match(artifactSimulation.attachments.brief.artifactId, /^art_[a-f0-9-]+$/);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator("[data-ir-graph-node=run]").click();
    assert.equal(await page.locator('[name="team-id"]').evaluate((element) => document.activeElement === element), true);
    await page.locator('[data-ir-graph-node="agent"][data-agent-id="writer"]').click();
    assert.equal(await page.locator('[name="agent-0-id"]').evaluate((element) => document.activeElement === element), true);
    await page.locator('[data-ir-graph-handoff="0"]').click();
    assert.equal(await page.locator('[data-ir-handoff="0"] [data-ir-map-target]').evaluate((element) => document.activeElement === element), true);
    await page.locator("[data-ir-graph-node=result]").click();
    assert.equal(await advancedEditor.evaluate((element) => document.activeElement === element), true);
    await page.setViewportSize({ width: 390, height: 844 });
    const advancedLayout = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
    assert.ok(advancedLayout.content <= advancedLayout.viewport + 1, `advanced graph/editor overflows narrow viewport: ${JSON.stringify(advancedLayout)}`);
    assert.equal(await page.locator("[data-ir-graph-node]").count(), advancedIr.agents.length + 2);
    assert.ok(await page.locator("[data-ir-graph-handoff]").count() >= 2);

    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    await page.locator('#studio-view a[href="/studio/new"]').click();
    await page.waitForURL(`${url}/studio/new`);
    await page.locator(".new-team-heading h1").getByText("Team IR v2").waitFor();
    await page.locator("#new-project-form input[name=name]").fill("Native v2 draft");
    await page.locator("#new-project-form textarea[name=overview]").fill("A native Team IR draft with a typed starter workflow.");
    const nativeCreate = page.waitForResponse((response) => response.request().method() === "POST"
      && new URL(response.url()).pathname === "/api/v1/team-ir-drafts");
    await page.locator("#new-project-form button[type=submit]").click();
    const nativeCreateResponse = await nativeCreate;
    assert.equal(nativeCreateResponse.status(), 201, await nativeCreateResponse.text());
    await page.waitForURL(/\/studio\/teams\/[a-z0-9-]+\/ir$/);
    const nativeId = page.url().match(/\/studio\/teams\/([a-z0-9-]+)\/ir$/)?.[1];
    assert.ok(nativeId);
    const nativeProject = await page.request.get(`${url}/api/v1/team-versions/${nativeId}`).then((response) => response.json());
    assert.equal(nativeProject.source, "team-ir-v2");
    assert.equal(nativeProject.templateId, "team-ir-v2");
    const nativeIr = await page.request.get(`${url}/api/v1/team-versions/${nativeId}/ir`).then((response) => response.json());
    assert.equal(nativeIr.teamIR.schemaVersion, 2);
    assert.equal(nativeIr.semanticDigest, teamIRSemanticDigest(nativeIr.teamIR));
    assert.equal(nativeIr.teamIR.agents[0].id, "worker");
    assert.match(await readFile(join(projectsRoot, nativeId, ".ogs", "team.ir.json"), "utf8"), /"schemaVersion": 2/);
    await assert.rejects(access(join(projectsRoot, nativeId, "system.mmd")), { code: "ENOENT" });
    await assert.rejects(access(join(projectsRoot, nativeId, ".ogs", "authoring.json")), { code: "ENOENT" });
    await page.reload({ waitUntil: "networkidle" });
    assert.equal((await page.locator("[data-team-ir-digest]").innerText()).trim(), nativeIr.semanticDigest);
    await page.goto(`${url}/studio`, { waitUntil: "networkidle" });
    const nativeCard = page.locator(`[data-team-root-id="${nativeId}"]`);
    await nativeCard.locator(`a[href="/studio/teams/${nativeId}/ir"]`).waitFor();
    assert.equal(await nativeCard.locator(`a[href="/studio/teams/${nativeId}/design"]`).count(), 0);

    const v2ReviewRouteCalls = [];
    let v2ReviewStatus = "pending";
    let validReviewPosts = 0;
    let reviewReads = 0;
    await page.route("**/api/v1/projects/project-v2/tasks/task-v2/runs/run-v2/team-ir-reviews/review-draft", async (route) => {
      const request = route.request();
      v2ReviewRouteCalls.push({ method: request.method(), body: request.postDataJSON() });
      if (request.method() === "GET") {
        reviewReads += 1;
        if (reviewReads === 1) {
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "temporary review query failure" }) });
          return;
        }
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
          projectId: "project-v2", taskId: "task-v2", runId: "run-v2", reviewId: "review-draft",
          revision: 3, revisionToken: "trusted-revision-token", activatedAt: "2026-10-28T00:00:00.000Z",
          deadlineAt: "2026-10-28T01:00:00.000Z", status: v2ReviewStatus
        }) });
      } else if (request.postDataJSON()?.feedback?.comments === "valid feedback") {
        validReviewPosts += 1;
        if (validReviewPosts === 1) {
          v2ReviewStatus = "rejected";
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "resume dispatch response was lost" }) });
        } else {
          await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "rejected", decision: "reject", revision: 4, resumedRun: { runId: "run-v2", status: "completed" } }) });
        }
      } else {
        await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "REVIEW_FEEDBACK_INVALID: comments required" }) });
      }
    });
    await page.evaluate(async () => {
      const { mountTeamIrRunReviews } = await import("/app/views/app.js");
      const detail = document.createElement("div");
      detail.dataset.projectId = "project-v2";
      detail.dataset.taskId = "task-v2";
      detail.dataset.runId = "run-v2";
      detail.dataset.selectedRunId = "run-v2";
      document.body.append(detail);
      window.__teamIrReviewDetail = detail;
      await mountTeamIrRunReviews(detail, {
        runId: "run-v2", owner: { teamIrSemanticDigest: "f".repeat(64) },
        plan: { team: { orchestration: { reviews: [{ id: "review-draft" }] } } }
      });
    });
    const reviewPanel = page.locator("[data-team-ir-run-reviews]");
    await reviewPanel.getByText("temporary review query failure").waitFor();
    await reviewPanel.getByRole("button", { name: "重新读取审核状态" }).click();
    await page.locator("[data-team-ir-run-reviews] h3").getByText("review-draft").waitFor();
    const reviewForm = page.locator('[data-team-ir-review="0"]');
    assert.equal(await reviewForm.locator("[name=decision]").inputValue(), "approve");
    await reviewForm.locator("[name=decision]").selectOption("reject");
    await reviewForm.locator("[name=feedback]").fill("not-json");
    await reviewForm.locator("button[type=submit]").click();
    await reviewForm.getByText("反馈必须是有效 JSON 对象。").waitFor();
    assert.equal(v2ReviewRouteCalls.length, 2, "invalid feedback must not be sent to the server");
    await reviewForm.locator("[name=feedback]").fill("{}");
    await reviewForm.locator("button[type=submit]").click();
    await reviewForm.getByText(/REVIEW_FEEDBACK_INVALID/).waitFor();
    await reviewForm.locator("[name=feedback]").fill('{"comments":"valid feedback"}');
    await reviewForm.locator("button[type=submit]").click();
    await reviewForm.getByText(/resume dispatch response was lost/).waitFor();
    await reviewForm.locator("button[type=submit]").click();
    await page.locator("[data-team-ir-run-reviews]").waitFor({ state: "detached" });
    assert.deepEqual(v2ReviewRouteCalls.map((call) => call.method), ["GET", "GET", "POST", "POST", "POST", "GET"]);
    assert.equal(v2ReviewRouteCalls[2].body.decision, "reject");
    assert.deepEqual(v2ReviewRouteCalls[2].body.feedback, {});
    assert.equal(v2ReviewRouteCalls[2].body.revisionToken, "trusted-revision-token");
    assert.match(v2ReviewRouteCalls[2].body.idempotencyKey, /^[0-9a-f-]{36}$/i);
    assert.equal(Object.hasOwn(v2ReviewRouteCalls[2].body, "reviewerId"), false);
    assert.equal(v2ReviewRouteCalls[3].body.feedback.comments, "valid feedback");
    assert.equal(v2ReviewRouteCalls[4].body.idempotencyKey, v2ReviewRouteCalls[3].body.idempotencyKey, "retry after a lost response must replay with the same idempotency key");
    assert.equal(Object.hasOwn(v2ReviewRouteCalls[4].body, "reviewerId"), false);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    server.kill("SIGTERM");
    await new Promise((resolveWait) => server.once("exit", resolveWait)).catch(() => {});
    await rm(projectsRoot, { recursive: true, force: true });
  }
});
